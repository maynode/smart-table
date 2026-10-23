import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  generateAnalysisMarkdown,
  type SheetDigest,
} from './analysis-llm.adapter';
import {
  markAllDone,
  markSteps,
  newMessageId,
  type AnalysisMessage,
} from './analysis-steps';

const SAMPLE_LIMIT = 200;
const TOP_VALUE_LIMIT = 5;

@Injectable()
export class AnalysisReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async list(baseId: string, userId: string) {
    await this.requireBase(baseId, userId, 'viewer');
    return this.prisma.analysisReport.findMany({
      where: { baseId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        baseId: true,
        name: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async get(id: string, userId: string) {
    return this.requireReport(id, userId, 'viewer');
  }

  async create(baseId: string, userId: string, name?: string) {
    const base = await this.requireBase(baseId, userId, 'editor');
    const sheets = await this.prisma.sheet.findMany({
      where: { baseId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });

    const now = new Date().toISOString();
    const messages: AnalysisMessage[] = [
      {
        id: newMessageId(),
        role: 'user',
        content: '帮我分析表格数据，生成分析报告',
        kind: 'text',
        createdAt: now,
      },
      {
        id: newMessageId(),
        role: 'assistant',
        content:
          sheets.length === 0
            ? '当前文档还没有工作表，请先新建表格后再试。'
            : sheets.length === 1
              ? `当前文档包含工作表「${sheets[0].name}」。确认后我将开始分析。`
              : `当前文档包含 ${sheets.length} 张表，您想分析哪张表的数据？`,
        kind: sheets.length <= 1 ? 'text' : 'choice',
        options:
          sheets.length <= 1
            ? undefined
            : [
                ...sheets.map((s) => ({
                  id: `sheet:${s.id}`,
                  label: s.name,
                })),
                {
                  id: 'all',
                  label: `综合/全景（${sheets.length} 张表都看）`,
                },
                { id: 'other', label: '请输入其他…' },
              ],
        createdAt: now,
      },
    ];

    const sheetIds =
      sheets.length === 1 ? [sheets[0].id] : ([] as string[]);

    return this.prisma.analysisReport.create({
      data: {
        baseId: base.id,
        name: (name?.trim() || '分析报告') as string,
        status: sheets.length === 0 ? 'failed' : 'asking',
        messages: messages as unknown as Prisma.InputJsonValue,
        steps: markSteps('ask') as unknown as Prisma.InputJsonValue,
        sheetIds: sheetIds as unknown as Prisma.InputJsonValue,
        createdBy: userId,
        error: sheets.length === 0 ? '没有可分析的工作表' : null,
      },
    });
  }

  async answer(
    id: string,
    userId: string,
    body: {
      optionId?: string;
      text?: string;
      skip?: boolean;
    },
  ) {
    const report = await this.requireReport(id, userId, 'editor');
    if (report.status === 'ready') {
      throw new BadRequestException('报告已生成，请新建分析');
    }
    if (report.status === 'exploring' || report.status === 'generating') {
      throw new BadRequestException('正在生成中，请稍候');
    }

    const sheets = await this.prisma.sheet.findMany({
      where: { baseId: report.baseId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });
    if (sheets.length === 0) {
      throw new BadRequestException('没有可分析的工作表');
    }

    let sheetIds: string[] = [];
    let userLabel = '';

    if (body.skip) {
      sheetIds = sheets.map((s) => s.id);
      userLabel = '跳过（分析全部表）';
    } else if (body.optionId === 'all') {
      sheetIds = sheets.map((s) => s.id);
      userLabel = '综合/全景（全部表）';
    } else if (body.optionId?.startsWith('sheet:')) {
      const sid = body.optionId.slice('sheet:'.length);
      if (!sheets.some((s) => s.id === sid)) {
        throw new BadRequestException('无效的工作表选项');
      }
      sheetIds = [sid];
      userLabel = sheets.find((s) => s.id === sid)?.name ?? sid;
    } else if (body.optionId === 'other' || body.text?.trim()) {
      const text = body.text?.trim() || '';
      userLabel = text || '其他';
      // match by name contains
      const matched = sheets.filter(
        (s) => text && s.name.includes(text),
      );
      sheetIds = matched.length > 0 ? matched.map((s) => s.id) : sheets.map((s) => s.id);
    } else if ((report.sheetIds as string[])?.length) {
      sheetIds = report.sheetIds as string[];
      userLabel = '确认';
    } else {
      throw new BadRequestException('请选择要分析的表或跳过');
    }

    const messages = [...(report.messages as unknown as AnalysisMessage[])];
    messages.push({
      id: newMessageId(),
      role: 'user',
      content: userLabel,
      kind: 'text',
      createdAt: new Date().toISOString(),
    });
    messages.push({
      id: newMessageId(),
      role: 'assistant',
      content: '好的，正在探索表格数据并生成分析报告…',
      kind: 'text',
      createdAt: new Date().toISOString(),
    });

    const updated = await this.prisma.analysisReport.update({
      where: { id: report.id },
      data: {
        status: 'exploring',
        sheetIds: sheetIds as unknown as Prisma.InputJsonValue,
        messages: messages as unknown as Prisma.InputJsonValue,
        steps: markSteps('explore') as unknown as Prisma.InputJsonValue,
        error: null,
      },
    });

    // Fire generation (await so client gets ready state on same request for local mode)
    return this.runGenerate(updated.id, userId);
  }

  async generate(id: string, userId: string) {
    const report = await this.requireReport(id, userId, 'editor');
    const sheetIds = (report.sheetIds as string[]) ?? [];
    if (sheetIds.length === 0) {
      throw new BadRequestException('请先选择要分析的工作表');
    }
    await this.prisma.analysisReport.update({
      where: { id },
      data: {
        status: 'exploring',
        steps: markSteps('explore') as unknown as Prisma.InputJsonValue,
        error: null,
      },
    });
    return this.runGenerate(id, userId);
  }

  private async runGenerate(id: string, userId: string) {
    const report = await this.requireReport(id, userId, 'editor');
    const base = await this.prisma.base.findUnique({
      where: { id: report.baseId },
    });
    const sheetIds = (report.sheetIds as string[]) ?? [];

    try {
      await this.prisma.analysisReport.update({
        where: { id },
        data: {
          status: 'generating',
          steps: markSteps('generate') as unknown as Prisma.InputJsonValue,
        },
      });

      const digests = await this.buildDigests(sheetIds);
      const conversation = (report.messages as unknown as AnalysisMessage[]).map(
        (m) => ({ role: m.role, content: m.content }),
      );
      const markdown = await generateAnalysisMarkdown({
        baseName: base?.name ?? '智能表格',
        digests,
        conversation,
      });

      const messages = [
        ...(report.messages as unknown as AnalysisMessage[]),
      ];
      // avoid duplicating if answer already pushed exploring message
      const last = messages[messages.length - 1];
      if (!last || last.content !== '分析报告已生成，请在左侧查看。') {
        messages.push({
          id: newMessageId(),
          role: 'assistant',
          content: '分析报告已生成，请在左侧查看。',
          kind: 'text',
          createdAt: new Date().toISOString(),
        });
      }

      return this.prisma.analysisReport.update({
        where: { id },
        data: {
          status: 'ready',
          reportMarkdown: markdown,
          messages: messages as unknown as Prisma.InputJsonValue,
          steps: markAllDone() as unknown as Prisma.InputJsonValue,
          error: null,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '生成报告失败';
      return this.prisma.analysisReport.update({
        where: { id },
        data: {
          status: 'failed',
          error: message,
          steps: markSteps('generate') as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }

  private async buildDigests(sheetIds: string[]): Promise<SheetDigest[]> {
    const digests: SheetDigest[] = [];
    for (const sheetId of sheetIds) {
      const sheet = await this.prisma.sheet.findUnique({
        where: { id: sheetId },
        include: {
          fields: { orderBy: { order: 'asc' } },
        },
      });
      if (!sheet) continue;
      const recordCount = await this.prisma.recordRow.count({
        where: { sheetId },
      });
      const rows = await this.prisma.recordRow.findMany({
        where: { sheetId },
        take: SAMPLE_LIMIT,
        orderBy: { id: 'asc' },
        select: { cells: true },
      });

      const fields = sheet.fields.map((field) => {
        const counts = new Map<string, number>();
        let nonEmpty = 0;
        let empty = 0;
        for (const row of rows) {
          const cells = (row.cells ?? {}) as Record<string, unknown>;
          const raw = cells[field.id];
          const text = cellToText(raw);
          if (!text) {
            empty += 1;
            continue;
          }
          nonEmpty += 1;
          counts.set(text, (counts.get(text) ?? 0) + 1);
        }
        const topValues = [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, TOP_VALUE_LIMIT)
          .map(([value, count]) => ({ value: value.slice(0, 40), count }));
        // scale empty for unread rows roughly
        const sampled = rows.length;
        const scale =
          sampled > 0 && recordCount > sampled
            ? recordCount / sampled
            : 1;
        return {
          name: field.name,
          type: field.type,
          nonEmpty: Math.round(nonEmpty * scale),
          empty: Math.round(empty * scale),
          topValues,
        };
      });

      digests.push({
        sheetId: sheet.id,
        sheetName: sheet.name,
        fieldCount: sheet.fields.length,
        recordCount,
        fields,
      });
    }
    return digests;
  }

  private async requireBase(
    baseId: string,
    userId: string,
    minimum: 'viewer' | 'editor',
  ) {
    const base = await this.prisma.base.findUnique({ where: { id: baseId } });
    if (!base) throw new NotFoundException('Base 不存在');
    await this.workspaces.requireMember(base.workspaceId, userId, minimum);
    return base;
  }

  private async requireReport(
    id: string,
    userId: string,
    minimum: 'viewer' | 'editor',
  ) {
    const report = await this.prisma.analysisReport.findUnique({
      where: { id },
    });
    if (!report) throw new NotFoundException('分析报告不存在');
    await this.requireBase(report.baseId, userId, minimum);
    return report;
  }
}

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === 'object' && 'name' in item) {
          return String((item as { name: unknown }).name ?? '');
        }
        return String(item ?? '');
      })
      .filter(Boolean)
      .join(', ');
  }
  if (typeof value === 'object' && value && 'name' in value) {
    return String((value as { name: unknown }).name ?? '');
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}
