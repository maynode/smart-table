import {
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isInstallAdmin } from '../auth/install-admin';
import { PrismaService } from '../prisma/prisma.service';
import {
  CLIENT_EVENT_SUMMARIES,
  asUuidOrNull,
  describeActivity,
  type ActivityOp,
} from './activity-summary';

export type ActivityRecordInput = {
  actorId?: string | null;
  actorAccount?: string;
  action: string;
  op: ActivityOp | string;
  summary: string;
  method?: string;
  path?: string;
  resourceType?: string;
  resourceId?: string | null;
  workspaceId?: string | null;
  baseId?: string | null;
  sheetId?: string | null;
  source?: string;
  ip?: string;
  metadata?: Record<string, unknown>;
};

type CollabPending = {
  actorId: string;
  account: string;
  sheetId: string;
  baseId?: string | null;
  mutationCount: number;
  timer: ReturnType<typeof setTimeout>;
};

const COLLAB_COALESCE_MS = 8_000;
const CLIENT_TRACK_WINDOW_MS = 60_000;
const CLIENT_TRACK_MAX_PER_WINDOW = 30;

@Injectable()
export class ActivityLogService implements OnModuleDestroy {
  private readonly logger = new Logger(ActivityLogService.name);
  private readonly collabPending = new Map<string, CollabPending>();
  private readonly trackBuckets = new Map<
    string,
    { windowStart: number; count: number }
  >();

  constructor(private readonly prisma: PrismaService) {}

  onModuleDestroy(): void {
    for (const pending of this.collabPending.values()) {
      clearTimeout(pending.timer);
      this.flushCollabPending(pending);
    }
    this.collabPending.clear();
    this.trackBuckets.clear();
  }

  async record(input: ActivityRecordInput): Promise<void> {
    try {
      await this.prisma.activityLog.create({
        data: {
          actorId: input.actorId ?? null,
          actorAccount: (input.actorAccount ?? '').slice(0, 120),
          action: input.action.slice(0, 120),
          op: String(input.op || 'other').slice(0, 32),
          summary: input.summary.slice(0, 500),
          method: (input.method ?? '').slice(0, 16),
          path: (input.path ?? '').slice(0, 500),
          resourceType: (input.resourceType ?? '').slice(0, 64),
          resourceId: input.resourceId
            ? String(input.resourceId).slice(0, 120)
            : null,
          workspaceId: asUuidOrNull(input.workspaceId),
          baseId: asUuidOrNull(input.baseId),
          sheetId: asUuidOrNull(input.sheetId),
          source: (input.source ?? 'api').slice(0, 32),
          ip: (input.ip ?? '').slice(0, 64),
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.warn(`activity log write failed: ${String(error)}`);
    }
  }

  recordFromHttp(input: {
    method: string;
    path: string;
    account: string;
    actorId?: string | null;
    params?: Record<string, string>;
    body?: unknown;
    ip?: string;
    source?: string;
  }): void {
    const described = describeActivity({
      method: input.method,
      path: input.path,
      account: input.account,
      params: input.params,
      body: input.body,
    });
    void this.record({
      actorId: input.actorId,
      actorAccount: input.account,
      action: described.action,
      op: described.op,
      summary: described.summary,
      method: input.method.toUpperCase(),
      path: input.path,
      resourceType: described.resourceType,
      resourceId: described.resourceId,
      workspaceId: described.workspaceId,
      baseId: described.baseId,
      sheetId: described.sheetId,
      source: input.source ?? 'api',
      ip: input.ip,
    });
  }

  trackClient(
    actorId: string | null | undefined,
    account: string,
    body: {
      event: string;
      path?: string;
      title?: string;
      meta?: Record<string, unknown>;
    },
    ip?: string,
  ): void {
    const path = body.path ?? '';
    if (path.startsWith('/admin')) return;
    const factory = CLIENT_EVENT_SUMMARIES[body.event];
    if (!factory) return;
    const rateKey = actorId || account || ip || 'anon';
    if (!this.allowClientTrack(rateKey)) return;
    const who = account.trim() || '匿名用户';
    const described = factory({
      who,
      path: body.path,
      title: body.title,
    });
    void this.record({
      actorId,
      actorAccount: account,
      action: described.action,
      op: described.op,
      summary: described.summary,
      method: 'CLIENT',
      path: body.path ?? '',
      resourceType: described.resourceType,
      source: 'client',
      ip,
      metadata: { event: body.event, ...sanitizeMeta(body.meta) },
    });
  }

  /** 同一用户同一表 8s 内合并为一条协同摘要，避免连打刷屏 */
  recordCollabCommit(input: {
    actorId: string;
    account: string;
    sheetId: string;
    baseId?: string | null;
    mutationCount: number;
  }): void {
    const key = `${input.actorId}:${input.sheetId}`;
    const existing = this.collabPending.get(key);
    if (existing) {
      existing.mutationCount += input.mutationCount;
      existing.account = input.account || existing.account;
      existing.baseId = input.baseId ?? existing.baseId;
      return;
    }
    const pending: CollabPending = {
      actorId: input.actorId,
      account: input.account,
      sheetId: input.sheetId,
      baseId: input.baseId,
      mutationCount: input.mutationCount,
      timer: setTimeout(() => {
        const current = this.collabPending.get(key);
        if (!current) return;
        this.collabPending.delete(key);
        this.flushCollabPending(current);
      }, COLLAB_COALESCE_MS),
    };
    this.collabPending.set(key, pending);
  }

  async listForAdmin(
    adminUserId: string,
    filter: {
      q?: string;
      op?: string;
      action?: string;
      actorId?: string;
      source?: string;
      limit?: string;
      cursor?: string;
    },
  ) {
    if (!(await isInstallAdmin(this.prisma, adminUserId))) {
      throw new ForbiddenException('仅系统管理员可查看操作日志');
    }
    const limit = Math.min(Math.max(Number(filter.limit ?? 50) || 50, 1), 200);
    const cursor = parseListCursor(filter.cursor);
    const where: Prisma.ActivityLogWhereInput = {
      AND: [
        {
          ...(filter.op ? { op: filter.op } : {}),
          ...(filter.action ? { action: filter.action } : {}),
          ...(filter.actorId ? { actorId: filter.actorId } : {}),
          ...(filter.source ? { source: filter.source } : {}),
        },
        filter.q
          ? {
              OR: [
                { summary: { contains: filter.q, mode: 'insensitive' } },
                { actorAccount: { contains: filter.q, mode: 'insensitive' } },
                { action: { contains: filter.q, mode: 'insensitive' } },
                { path: { contains: filter.q, mode: 'insensitive' } },
              ],
            }
          : {},
        cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                {
                  AND: [
                    { createdAt: cursor.createdAt },
                    { id: { lt: cursor.id } },
                  ],
                },
              ],
            }
          : {},
      ],
    };

    const items = await this.prisma.activityLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const last = page[page.length - 1];
    return {
      items: page,
      nextCursor:
        hasMore && last
          ? `${last.createdAt.toISOString()}|${last.id}`
          : null,
    };
  }

  private flushCollabPending(pending: CollabPending): void {
    const who = pending.account.trim() || '用户';
    void this.record({
      actorId: pending.actorId,
      actorAccount: pending.account,
      action: 'sheet.collab.commit',
      op: 'update',
      summary: `${who} 在协同编辑中提交了 ${pending.mutationCount} 处变更`,
      method: 'WS',
      path: `/collab/sheets/${pending.sheetId}`,
      resourceType: 'sheet',
      resourceId: pending.sheetId,
      sheetId: asUuidOrNull(pending.sheetId),
      baseId: asUuidOrNull(pending.baseId),
      source: 'collab',
      metadata: {
        mutationCount: pending.mutationCount,
        coalescedMs: COLLAB_COALESCE_MS,
      },
    });
  }

  private allowClientTrack(key: string): boolean {
    const now = Date.now();
    const bucket = this.trackBuckets.get(key);
    if (!bucket || now - bucket.windowStart >= CLIENT_TRACK_WINDOW_MS) {
      this.trackBuckets.set(key, { windowStart: now, count: 1 });
      return true;
    }
    if (bucket.count >= CLIENT_TRACK_MAX_PER_WINDOW) return false;
    bucket.count += 1;
    return true;
  }
}

function parseListCursor(
  raw?: string,
): { createdAt: Date; id: string } | null {
  if (!raw?.trim()) return null;
  const [iso, id] = raw.split('|');
  if (!iso || !id) {
    const legacy = new Date(raw);
    return Number.isNaN(legacy.getTime())
      ? null
      : { createdAt: legacy, id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' };
  }
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime())) return null;
  if (!asUuidOrNull(id)) return null;
  return { createdAt, id };
}

function sanitizeMeta(
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!meta || typeof meta !== 'object') return {};
  const out: Record<string, unknown> = {};
  let keys = 0;
  for (const [key, value] of Object.entries(meta)) {
    if (keys >= 20) break;
    if (typeof key !== 'string' || key.length > 64) continue;
    if (
      value === null ||
      typeof value === 'boolean' ||
      typeof value === 'number'
    ) {
      out[key] = value;
      keys += 1;
      continue;
    }
    if (typeof value === 'string') {
      out[key] = value.slice(0, 200);
      keys += 1;
    }
  }
  return out;
}
