import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LiveBusService } from '../live/live-bus.service';
import { QuotasService } from '../quotas/quotas.service';
import { StorageService } from '../storage/storage.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { SheetDigestService } from '../ai/sheet-digest.service';
import {
  chatAnalysisReply,
  generateAnalysisMarkdown,
} from './analysis-llm.adapter';
import {
  markAllDone,
  markSteps,
  newMessageId,
  type AnalysisMessage,
  type AnalysisMessageAttachment,
} from './analysis-steps';

const ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;

@Injectable()
export class AnalysisReportsService {
  private readonly logger = new Logger(AnalysisReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly storage: StorageService,
    private readonly quotas: QuotasService,
    private readonly live: LiveBusService,
    private readonly digests: SheetDigestService,
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
    const sheets = await this.digests.listReadableSheets(baseId, userId);

    const now = new Date().toISOString();
    const welcome =
      sheets.length === 0
        ? '你好，我是分析助手。当前文档还没有可分析的工作表，先准备好数据再来聊。'
        : `你好，我是分析助手。当前可读 ${sheets.length} 张表，直接告诉我你想了解什么即可，例如「数据概况」或「生成分析报告」。`;

    const created = await this.prisma.analysisReport.create({
      data: {
        baseId: base.id,
        name: (name?.trim() || '分析报告') as string,
        status: sheets.length === 0 ? 'failed' : 'draft',
        messages: [
          {
            id: newMessageId(),
            role: 'assistant',
            content: welcome,
            kind: 'text',
            createdAt: now,
          },
        ] as unknown as Prisma.InputJsonValue,
        steps: [] as unknown as Prisma.InputJsonValue,
        sheetIds: sheets.map((s) => s.id) as unknown as Prisma.InputJsonValue,
        createdBy: userId,
        error: sheets.length === 0 ? '没有可分析的工作表' : null,
      },
    });
    await this.live.emit({
      baseId: created.baseId,
      actorId: userId,
      kind: 'analysis.created',
      entityId: created.id,
      meta: { name: created.name },
    });
    return created;
  }

  async uploadAttachment(
    id: string,
    userId: string,
    buffer: Buffer,
    mimetype: string,
    originalName: string,
  ) {
    const report = await this.requireReport(id, userId, 'editor');
    if (!buffer.length) {
      throw new BadRequestException('未上传文件');
    }
    if (buffer.byteLength > ATTACHMENT_MAX_BYTES) {
      throw new BadRequestException('单个文件需小于 100MB');
    }
    const base = await this.prisma.base.findUnique({
      where: { id: report.baseId },
    });
    if (!base) throw new NotFoundException('Base 不存在');
    await this.quotas.assertStorage(base.workspaceId, buffer.byteLength);
    const saved = await this.storage.saveUpload(
      buffer,
      mimetype || 'application/octet-stream',
      originalName || 'file',
    );
    await this.quotas.recordStorage(base.workspaceId, saved.key, saved.size);
    return {
      url: saved.url,
      name: saved.name,
      mimetype: saved.mimetype,
      size: saved.size,
    } satisfies AnalysisMessageAttachment;
  }

  /** 自由对话：用户发消息（可附任意文件）→ AI 回复；需要时同步更新左侧 Markdown 报告。 */
  async chat(
    id: string,
    userId: string,
    text: string,
    attachments?: AnalysisMessageAttachment[],
  ) {
    const content = text?.trim() ?? '';
    const files = normalizeAttachments(attachments);
    if (!content && !files.length) {
      throw new BadRequestException('请输入消息或添加附件');
    }

    const report = await this.requireReport(id, userId, 'editor');
    if (report.status === 'exploring' || report.status === 'generating') {
      throw new BadRequestException('正在回复中，请稍候');
    }
    if (report.status === 'failed' && !(report.sheetIds as string[])?.length) {
      throw new BadRequestException('当前没有可分析的工作表');
    }

    const sheets = await this.digests.listReadableSheets(report.baseId, userId);
    const sheetIds =
      ((report.sheetIds as string[]) ?? []).filter((sid) =>
        sheets.some((s) => s.id === sid),
      ).length > 0
        ? ((report.sheetIds as string[]) ?? []).filter((sid) =>
            sheets.some((s) => s.id === sid),
          )
        : sheets.map((s) => s.id);

    const userContent =
      content ||
      (files.length ? `（发送了 ${files.length} 个附件）` : '');

    const messages: AnalysisMessage[] = [
      ...(report.messages as unknown as AnalysisMessage[]),
      {
        id: newMessageId(),
        role: 'user',
        content: userContent,
        kind: 'text',
        ...(files.length ? { attachments: files } : {}),
        createdAt: new Date().toISOString(),
      },
    ];

    await this.prisma.analysisReport.update({
      where: { id: report.id },
      data: {
        status: 'generating',
        messages: messages as unknown as Prisma.InputJsonValue,
        sheetIds: sheetIds as unknown as Prisma.InputJsonValue,
        error: null,
      },
    });

    try {
      const base = await this.prisma.base.findUnique({
        where: { id: report.baseId },
      });
      const digests = sheetIds.length
        ? await this.digests.buildDigests(sheetIds, userId)
        : [];
      const conversation = messages.map((m) => ({
        role: m.role,
        content: formatMessageForLlm(m),
      }));
      const { reply, reportMarkdown } = await chatAnalysisReply({
        baseName: base?.name ?? '智能表格',
        digests,
        conversation,
      });

      let markdown = reportMarkdown;
      if (
        !markdown &&
        /报告|生成完整|输出报告|写一份/.test(content) &&
        digests.length
      ) {
        markdown = await generateAnalysisMarkdown({
          baseName: base?.name ?? '智能表格',
          digests,
          conversation,
        });
      }

      messages.push({
        id: newMessageId(),
        role: 'assistant',
        content: reply,
        kind: 'text',
        createdAt: new Date().toISOString(),
      });

      const updated = await this.prisma.analysisReport.update({
        where: { id: report.id },
        data: {
          status: markdown ? 'ready' : 'draft',
          messages: messages as unknown as Prisma.InputJsonValue,
          reportMarkdown: markdown ?? report.reportMarkdown,
          steps: markdown
            ? (markAllDone() as unknown as Prisma.InputJsonValue)
            : ([] as unknown as Prisma.InputJsonValue),
          error: null,
        },
      });
      await this.live.emit({
        baseId: report.baseId,
        actorId: userId,
        kind: 'analysis.message',
        entityId: report.id,
      });
      await this.live.emit({
        baseId: report.baseId,
        actorId: userId,
        kind: 'analysis.updated',
        entityId: report.id,
      });
      return updated;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '对话失败';
      return this.prisma.analysisReport.update({
        where: { id: report.id },
        data: {
          status: 'failed',
          error: message,
          messages: messages as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }

  async update(
    id: string,
    userId: string,
    body: { name?: string },
  ) {
    const report = await this.requireReport(id, userId, 'editor');
    const name = body.name?.trim();
    if (!name) {
      throw new BadRequestException('名称不能为空');
    }
    const updated = await this.prisma.analysisReport.update({
      where: { id: report.id },
      data: { name },
    });
    await this.live.emit({
      baseId: report.baseId,
      actorId: userId,
      kind: 'analysis.updated',
      entityId: report.id,
      meta: { name },
    });
    return updated;
  }

  async delete(id: string, userId: string) {
    const report = await this.requireReport(id, userId, 'editor');
    await this.prisma.analysisReport.delete({ where: { id: report.id } });
    await this.live.emit({
      baseId: report.baseId,
      actorId: userId,
      kind: 'analysis.deleted',
      entityId: report.id,
    });
    return { deleted: true, id: report.id };
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

    const sheets = await this.digests.listReadableSheets(report.baseId, userId);
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
      const matched = sheets.filter(
        (s) => text && s.name.includes(text),
      );
      sheetIds =
        matched.length > 0 ? matched.map((s) => s.id) : sheets.map((s) => s.id);
    } else if ((report.sheetIds as string[])?.length) {
      const requested = report.sheetIds as string[];
      sheetIds = requested.filter((sid) => sheets.some((s) => s.id === sid));
      if (sheetIds.length === 0) {
        throw new BadRequestException('没有可分析的工作表');
      }
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

    this.scheduleGenerate(updated.id, userId);
    return updated;
  }

  async generate(id: string, userId: string) {
    const report = await this.requireReport(id, userId, 'editor');
    const sheetIds = (report.sheetIds as string[]) ?? [];
    if (sheetIds.length === 0) {
      throw new BadRequestException('请先选择要分析的工作表');
    }
    if (report.status === 'exploring' || report.status === 'generating') {
      throw new BadRequestException('正在生成中，请稍候');
    }
    const updated = await this.prisma.analysisReport.update({
      where: { id },
      data: {
        status: 'exploring',
        steps: markSteps('explore') as unknown as Prisma.InputJsonValue,
        error: null,
      },
    });
    this.scheduleGenerate(id, userId);
    return updated;
  }

  private scheduleGenerate(id: string, userId: string) {
    setImmediate(() => {
      void this.runGenerate(id, userId).catch((error: unknown) => {
        this.logger.error(
          `analysis report ${id} generate failed`,
          error instanceof Error ? error.stack : String(error),
        );
      });
    });
  }

  private async runGenerate(id: string, userId: string) {
    const report = await this.prisma.analysisReport.findUnique({
      where: { id },
    });
    if (!report) return;
    if (report.status !== 'exploring' && report.status !== 'generating') {
      return;
    }

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

      const digests = await this.digests.buildDigests(sheetIds, userId);
      if (digests.length === 0) {
        throw new Error('没有可读取的工作表数据（可能受内容权限限制）');
      }
      const conversation = (
        report.messages as unknown as AnalysisMessage[]
      ).map((m) => ({ role: m.role, content: m.content }));
      const markdown = await generateAnalysisMarkdown({
        baseName: base?.name ?? '智能表格',
        digests,
        conversation,
      });

      const messages = [
        ...(report.messages as unknown as AnalysisMessage[]),
      ];
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

      await this.prisma.analysisReport.update({
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
      await this.prisma.analysisReport.update({
        where: { id },
        data: {
          status: 'failed',
          error: message,
          steps: markSteps('generate') as unknown as Prisma.InputJsonValue,
        },
      });
    }
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

function normalizeAttachments(
  input?: AnalysisMessageAttachment[],
): AnalysisMessageAttachment[] {
  if (!Array.isArray(input) || !input.length) return [];
  const out: AnalysisMessageAttachment[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    if (!url.startsWith('/files/')) {
      throw new BadRequestException('无效的附件');
    }
    const mimetype =
      typeof item.mimetype === 'string' && item.mimetype.trim()
        ? item.mimetype.trim()
        : 'application/octet-stream';
    const size = typeof item.size === 'number' ? item.size : 0;
    if (size > ATTACHMENT_MAX_BYTES) {
      throw new BadRequestException('单个文件需小于 100MB');
    }
    out.push({
      url,
      name:
        typeof item.name === 'string' && item.name.trim()
          ? item.name.trim()
          : 'file',
      mimetype,
      size,
    });
  }
  return out;
}

function formatMessageForLlm(message: AnalysisMessage): string {
  const attachments = message.attachments ?? [];
  if (!attachments.length) return message.content;
  const lines = attachments.map(
    (a, i) => `- 附件${i + 1}: ${a.name} (${a.mimetype}, ${a.size}B, ${a.url})`,
  );
  return `${message.content}\n[附件]\n${lines.join('\n')}`;
}
