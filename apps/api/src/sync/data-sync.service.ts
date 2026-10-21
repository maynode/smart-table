import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { SheetsService } from '../sheets/sheets.service';
import { AuditService } from '../audit/audit.service';

type SyncRow = Record<string, unknown>;

@Injectable()
export class DataSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DataSyncService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheets: SheetsService,
    private readonly audit: AuditService,
  ) {}

  async uploadFile(
    sheetId: string,
    userId: string,
    file: { filename: string; mimetype: string; buffer: Buffer },
  ) {
    await this.requireSheet(sheetId, userId, 'editor');
    if (file.buffer.byteLength > 5 * 1024 * 1024) {
      throw new BadRequestException('同步文件不能超过 5MB');
    }
    const ext = file.filename.split('.').pop()?.toLowerCase() ?? '';
    if (!['csv', 'xlsx'].includes(ext)) {
      throw new BadRequestException('仅支持 CSV 或 XLSX');
    }
    const created = await this.prisma.dataSyncFile.create({
      data: {
        sheetId,
        filename: file.filename,
        mimetype: file.mimetype,
        size: file.buffer.byteLength,
        content: new Uint8Array(file.buffer),
      },
    });
    return {
      id: created.id,
      filename: created.filename,
      size: created.size,
      createdAt: created.createdAt,
    };
  }

  async create(
    sheetId: string,
    userId: string,
    body: {
      name: string;
      sourceType: 'http' | 'file';
      config?: { url?: string; headers?: Record<string, string>; fileId?: string };
      mapping: Record<string, string>;
      matchFieldId?: string;
      mode?: 'upsert' | 'replace';
      cron?: string;
      enabled?: boolean;
    },
  ) {
    const sheet = await this.requireSheet(sheetId, userId, 'editor');
    if (!body.name?.trim()) throw new BadRequestException('同步名称不能为空');
    if (!['http', 'file'].includes(body.sourceType)) {
      throw new BadRequestException('同步源类型无效');
    }
    if (body.mode && !['upsert', 'replace'].includes(body.mode)) {
      throw new BadRequestException('同步模式无效');
    }
    const fields = await this.prisma.field.findMany({
      where: { sheetId: sheet.id },
      select: { id: true },
    });
    const validFieldIds = new Set(fields.map((field) => field.id));
    const mapping = body.mapping ?? {};
    const entries = Object.entries(mapping);
    if (!entries.length) throw new BadRequestException('至少配置一个字段映射');
    for (const [key, fieldId] of entries) {
      if (!key.trim()) throw new BadRequestException('映射列名不能为空');
      if (!validFieldIds.has(fieldId)) {
        throw new BadRequestException(`字段不属于该工作表: ${fieldId}`);
      }
    }
    if (body.matchFieldId && !validFieldIds.has(body.matchFieldId)) {
      throw new BadRequestException('匹配字段不属于该工作表');
    }
    if (body.sourceType === 'http') {
      if (!body.config?.url) throw new BadRequestException('HTTP 同步缺少 URL');
      this.assertHttpUrl(body.config.url);
    } else {
      if (!body.config?.fileId) throw new BadRequestException('文件同步缺少文件');
      const file = await this.prisma.dataSyncFile.findUnique({
        where: { id: body.config.fileId },
      });
      if (!file || file.sheetId !== sheetId) {
        throw new NotFoundException('同步文件不存在');
      }
    }
    if (body.cron && body.cron.trim().split(/\s+/).length !== 5) {
      throw new BadRequestException('Cron 表达式需为 5 段');
    }
    return this.prisma.dataSync.create({
      data: {
        sheetId,
        name: body.name.trim(),
        sourceType: body.sourceType,
        config: (body.config ?? {}) as Prisma.InputJsonValue,
        mapping: mapping as Prisma.InputJsonValue,
        matchFieldId: body.matchFieldId ?? null,
        mode: body.mode ?? 'upsert',
        cron: body.cron?.trim() || null,
        enabled: body.enabled ?? true,
        nextRunAt: body.cron ? this.nextRun(body.cron) : null,
        createdBy: userId,
      },
    });
  }

  async list(sheetId: string, userId: string) {
    await this.requireSheet(sheetId, userId, 'viewer');
    return this.prisma.dataSync.findMany({
      where: { sheetId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async runs(syncId: string, userId: string) {
    const sync = await this.prisma.dataSync.findUnique({
      where: { id: syncId },
    });
    if (!sync) throw new NotFoundException('同步任务不存在');
    await this.requireSheet(sync.sheetId, userId, 'viewer');
    return this.prisma.dataSyncRun.findMany({
      where: { syncId },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
  }

  async remove(syncId: string, userId: string) {
    const sync = await this.prisma.dataSync.findUnique({
      where: { id: syncId },
    });
    if (!sync) throw new NotFoundException('同步任务不存在');
    await this.requireSheet(sync.sheetId, userId, 'editor');
    await this.prisma.dataSync.delete({ where: { id: syncId } });
    return { id: syncId, deleted: true };
  }

  async run(syncId: string, userId: string, trigger = 'manual') {
    const sync = await this.prisma.dataSync.findUnique({
      where: { id: syncId },
    });
    if (!sync) throw new NotFoundException('同步任务不存在');
    await this.requireSheet(sync.sheetId, userId, 'editor');

    const run = await this.prisma.dataSyncRun.create({
      data: { syncId, trigger, status: 'running' },
    });
    try {
      const rows = await this.readRows(sync);
      const mapping = (sync.mapping ?? {}) as Record<string, string>;
      const written = await this.writeRows(sync, rows, mapping, userId);
      const finished = await this.prisma.dataSyncRun.update({
        where: { id: run.id },
        data: {
          status: 'success',
          rowsRead: rows.length,
          rowsWritten: written,
          finishedAt: new Date(),
        },
      });
      await this.prisma.dataSync.update({
        where: { id: sync.id },
        data: {
          lastRunAt: new Date(),
          nextRunAt: sync.cron ? this.nextRun(sync.cron) : null,
        },
      });
      void this.audit.record({
        workspaceId: await this.workspaceOfSheet(sync.sheetId),
        actorId: userId,
        action: 'sync.run',
        objectType: 'data_sync',
        objectId: sync.id,
        metadata: { rowsRead: rows.length, rowsWritten: written, trigger },
      });
      return finished;
    } catch (error) {
      const failed = await this.prisma.dataSyncRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          finishedAt: new Date(),
        },
      });
      void this.audit.record({
        workspaceId: await this.workspaceOfSheet(sync.sheetId),
        actorId: userId,
        action: 'sync.failed',
        objectType: 'data_sync',
        objectId: sync.id,
        metadata: { error: failed.error, trigger },
      });
      return failed;
    }
  }

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.runDueSyncs()
        .then((count) => {
          if (count) this.logger.log(`ran ${count} data syncs`);
        })
        .catch((error: unknown) => {
          this.logger.warn(`data sync scheduler failed: ${String(error)}`);
        });
    }, 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runDueSyncs(): Promise<number> {
    const due = await this.prisma.dataSync.findMany({
      where: {
        enabled: true,
        nextRunAt: { lte: new Date() },
        createdBy: { not: null },
      },
      take: 10,
    });
    for (const sync of due) {
      await this.run(sync.id, sync.createdBy!, 'cron');
    }
    return due.length;
  }

  private async readRows(sync: {
    id: string;
    sourceType: string;
    config: Prisma.JsonValue;
  }): Promise<SyncRow[]> {
    const config = (sync.config ?? {}) as {
      url?: string;
      headers?: Record<string, string>;
      fileId?: string;
    };
    if (sync.sourceType === 'http') {
      if (!config.url) throw new BadRequestException('同步 URL 为空');
      this.assertHttpUrl(config.url);
      const response = await fetch(config.url, {
        headers: config.headers ?? {},
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new BadRequestException(`HTTP 同步失败: ${response.status}`);
      }
      const payload = (await response.json()) as unknown;
      const rows =
        Array.isArray(payload)
          ? payload
          : payload && typeof payload === 'object'
            ? ((payload as { data?: unknown; rows?: unknown }).data ??
              (payload as { rows?: unknown }).rows)
            : null;
      if (!Array.isArray(rows)) {
        throw new BadRequestException('HTTP 响应必须是 JSON 数组');
      }
      return rows.filter(
        (row): row is SyncRow => Boolean(row) && typeof row === 'object',
      );
    }

    if (!config.fileId) throw new BadRequestException('同步文件为空');
    const file = await this.prisma.dataSyncFile.findUnique({
      where: { id: config.fileId },
    });
    if (!file) throw new NotFoundException('同步文件不存在');
    const buffer = Buffer.from(file.content);
    if (file.filename.toLowerCase().endsWith('.csv')) {
      return this.parseCsv(buffer.toString('utf8'));
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('Excel 没有工作表');
    const rows: SyncRow[] = [];
    let headers: string[] = [];
    sheet.eachRow((row, index) => {
      const values = (row.values as unknown[]).slice(1);
      if (index === 1) {
        headers = values.map((value) => String(value ?? '').trim());
        return;
      }
      const mapped: SyncRow = {};
      headers.forEach((header, column) => {
        if (header) mapped[header] = values[column];
      });
      rows.push(mapped);
    });
    return rows;
  }

  private async writeRows(
    sync: {
      id: string;
      sheetId: string;
      matchFieldId: string | null;
      mode: string;
    },
    rows: SyncRow[],
    mapping: Record<string, string>,
    userId: string,
  ): Promise<number> {
    if (sync.mode === 'replace') {
      await this.prisma.recordRow.deleteMany({
        where: { sheetId: sync.sheetId },
      });
    }
    let written = 0;
    for (const row of rows) {
      const cells: Record<string, unknown> = {};
      for (const [externalKey, fieldId] of Object.entries(mapping)) {
        if (row[externalKey] !== undefined) cells[fieldId] = row[externalKey];
      }
      if (!Object.keys(cells).length) continue;

      let existingId: string | null = null;
      if (sync.matchFieldId && sync.mode === 'upsert') {
        const matchValue = cells[sync.matchFieldId];
        if (matchValue !== undefined) {
          const existing = await this.prisma.recordRow.findFirst({
            where: {
              sheetId: sync.sheetId,
              cells: {
                path: [sync.matchFieldId],
                equals: matchValue as Prisma.InputJsonValue,
              },
            },
            select: { id: true },
          });
          existingId = existing?.id ?? null;
        }
      }
      if (existingId) {
        await this.sheets.updateRecord(existingId, userId, cells);
      } else {
        await this.sheets.createRecord(sync.sheetId, userId, cells);
      }
      written += 1;
    }
    return written;
  }

  private parseCsv(text: string): SyncRow[] {
    const rows: string[][] = [];
    let row: string[] = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (quoted) {
        if (char === '"' && text[index + 1] === '"') {
          value += '"';
          index += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          value += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ',') {
        row.push(value);
        value = '';
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && text[index + 1] === '\n') index += 1;
        row.push(value);
        if (row.some((cell) => cell.length)) rows.push(row);
        row = [];
        value = '';
      } else {
        value += char;
      }
    }
    if (value.length || row.length) {
      row.push(value);
      rows.push(row);
    }
    if (rows.length < 2) return [];
    const headers = rows[0].map((header) => header.trim());
    return rows.slice(1).map((cells) => {
      const result: SyncRow = {};
      headers.forEach((header, column) => {
        if (header) result[header] = cells[column] ?? '';
      });
      return result;
    });
  }

  private async requireSheet(
    sheetId: string,
    userId: string,
    minimum: 'viewer' | 'editor',
  ) {
    const sheet = await this.prisma.sheet.findUnique({
      where: { id: sheetId },
      include: { base: true },
    });
    if (!sheet) throw new NotFoundException('工作表不存在');
    const member = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: sheet.base.workspaceId,
          userId,
        },
      },
    });
    const rank = { viewer: 0, editor: 1, admin: 2, owner: 3 } as const;
    if (!member || rank[member.role] < rank[minimum]) {
      throw new ForbiddenException('无权管理该工作表同步');
    }
    return sheet;
  }

  private async workspaceOfSheet(sheetId: string): Promise<string | null> {
    const sheet = await this.prisma.sheet.findUnique({
      where: { id: sheetId },
      include: { base: { select: { workspaceId: true } } },
    });
    return sheet?.base.workspaceId ?? null;
  }

  private assertHttpUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('同步 URL 无效');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BadRequestException('同步 URL 仅支持 http/https');
    }
  }

  private nextRun(cron: string): Date {
    const minute = Number(cron.split(/\s+/)[0]);
    const now = new Date();
    if (Number.isFinite(minute) && minute >= 0 && minute < 60) {
      const next = new Date(now.getTime() + 60 * 60 * 1000);
      next.setMinutes(minute, 0, 0);
      return next;
    }
    return new Date(now.getTime() + 60 * 60 * 1000);
  }
}
