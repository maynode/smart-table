import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WebSocket } from 'ws';
import type IORedis from 'ioredis';
import type { SheetMutation } from 'shared';
import { COMMIT_ERROR, peerColorFromUserId } from 'shared';
import { JwtService } from '@nestjs/jwt';
import { ActivityLogService } from '../activity/activity-log.service';
import { LiveBusService } from '../live/live-bus.service';
import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { createRedisConnection } from '../queue/redis-connection';
import { SheetsService } from '../sheets/sheets.service';
import { CommitChangesService } from '../sheets/commit-changes.service';
import type { CollabClientMsg, CollabServerMsg } from './collab.types';
import { CellLockRegistry } from './cell-lock.registry';
import { CollabFanoutService } from './collab-fanout.service';
import { CoalesceThrottle } from './collab-backpressure';

interface RoomClient {
  socket: WebSocket;
  userId: string;
  account: string;
  name: string;
  /** 由 userId 哈希得到的稳定色（无人数上限） */
  color: string;
  avatarSeed: string;
  avatarUrl: string | null;
  sheetId: string;
}

@Injectable()
export class CollabRoomService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CollabRoomService.name);
  private readonly rooms = new Map<string, Set<RoomClient>>();
  /** Authoritative in-process sheetRev mirror; avoids a DB round-trip per user_changes. */
  private readonly roomSheetRev = new Map<string, number>();
  private readonly roomBaseId = new Map<string, string>();
  private readonly cellLocks: CellLockRegistry;
  private readonly lockRedis: IORedis | null;
  /** 0 = unlimited */
  private readonly maxSheetConnections: number;
  private readonly cursorThrottle: CoalesceThrottle<{
    sheetId: string;
    except?: RoomClient;
    msg: Extract<CollabServerMsg, { type: 'cursor_message' }>;
  }>;
  private readonly presenceThrottle: CoalesceThrottle<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sheets: SheetsService,
    private readonly commits: CommitChangesService,
    private readonly live: LiveBusService,
    private readonly metrics: MetricsService,
    private readonly fanout: CollabFanoutService,
    private readonly activity: ActivityLogService,
    config: ConfigService,
  ) {
    this.maxSheetConnections = Math.max(
      0,
      Number(config.get<string>('COLLAB_MAX_SHEET_CONNECTIONS') ?? 1000) || 0,
    );
    const cursorMs = Math.max(
      0,
      Number(config.get<string>('COLLAB_CURSOR_MIN_INTERVAL_MS') ?? 80) || 0,
    );
    const presenceMs = Math.max(
      0,
      Number(config.get<string>('COLLAB_PRESENCE_DEBOUNCE_MS') ?? 250) || 0,
    );
    this.cursorThrottle = new CoalesceThrottle(cursorMs, (_key, payload) => {
      // Cursor is best-effort: local only (no Redis) to cut hot-path bandwidth.
      this.localBroadcast(payload.sheetId, payload.msg, payload.except);
      this.metrics.increment('collab_cursor_flush_total');
    });
    this.presenceThrottle = new CoalesceThrottle(presenceMs, (_key, sheetId) => {
      this.flushPresence(sheetId);
    });
    const url = config.get<string>('REDIS_URL');
    if (url) {
      try {
        this.lockRedis = createRedisConnection(url, {
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          connectTimeoutMs: 3_000,
        });
        this.lockRedis.on('error', (error) => {
          this.logger.warn(`CellLock Redis error: ${String(error)}`);
        });
        this.cellLocks = new CellLockRegistry(this.lockRedis);
        this.logger.log('CellLockRegistry using Redis');
      } catch (error) {
        this.logger.warn(
          `CellLock Redis unavailable, memory-only: ${String(error)}`,
        );
        this.lockRedis = null;
        this.cellLocks = new CellLockRegistry();
      }
    } else {
      this.lockRedis = null;
      this.cellLocks = new CellLockRegistry();
    }
    this.refreshConnectionGauges();
  }

  onModuleInit(): void {
    this.fanout.setLocalHandler((sheetId, msg) => {
      this.localBroadcast(sheetId, msg);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.cursorThrottle.clear();
    this.presenceThrottle.clear();
    if (this.lockRedis) {
      try {
        await this.lockRedis.quit();
      } catch {
        this.lockRedis.disconnect();
      }
    }
  }

  async acceptConnection(
    socket: WebSocket,
    token: string,
    sheetId: string,
  ): Promise<void> {
    let payload: { sub: string; account?: string; impersonatorId?: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      this.send(socket, {
        type: 'error',
        code: 'UNAUTHORIZED',
        message: '无效令牌',
      });
      socket.close();
      return;
    }

    const authUser = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { blacklistedAt: true },
    });
    if (
      !authUser ||
      (authUser.blacklistedAt && !payload.impersonatorId)
    ) {
      this.send(socket, {
        type: 'error',
        code: 'UNAUTHORIZED',
        message: '账号已被限制登录',
      });
      socket.close();
      return;
    }

    try {
      await this.sheets.assertSheetAccess(sheetId, payload.sub, 'viewer');
    } catch {
      this.send(socket, {
        type: 'error',
        code: 'FORBIDDEN',
        message: '无表访问权限',
      });
      socket.close();
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    let room = this.rooms.get(sheetId);
    if (!room) {
      room = new Set();
      this.rooms.set(sheetId, room);
    }
    if (
      this.maxSheetConnections > 0 &&
      room.size >= this.maxSheetConnections
    ) {
      this.metrics.increment('collab_connection_rejected_total', {
        reason: 'sheet_full',
      });
      this.send(socket, {
        type: 'error',
        code: 'ROOM_FULL',
        message: `该表在线连接已达上限（${this.maxSheetConnections}）`,
      });
      socket.close();
      return;
    }
    const client: RoomClient = {
      socket,
      userId: payload.sub,
      account: user?.account ?? payload.account ?? payload.sub,
      name: user?.account ?? payload.account ?? payload.sub,
      color: peerColorFromUserId(payload.sub),
      avatarSeed: user?.avatarSeed || user?.account || payload.sub,
      avatarUrl: user?.avatarUrl ?? null,
      sheetId,
    };
    room.add(client);
    this.refreshConnectionGauges(sheetId);

    socket.on('message', (raw) => {
      void this.onMessage(client, raw.toString());
    });
    socket.on('close', () => {
      void this.leave(client);
    });
    socket.on('error', () => {
      void this.leave(client);
    });

    const sheet = await this.prisma.sheet.findUnique({
      where: { id: sheetId },
      select: { sheetRev: true, baseId: true },
    });
    const rev = sheet?.sheetRev ?? 0;
    this.roomSheetRev.set(sheetId, rev);
    if (sheet?.baseId) this.roomBaseId.set(sheetId, sheet.baseId);
    this.send(socket, {
      type: 'last_reversion',
      sheetRev: rev,
    });
    this.broadcastPresence(sheetId);
    await this.sendCellLocksSnapshot(client);
  }

  /** 用户改头像/用户名后刷新各表 presence，无需重连 */
  updateUserProfile(
    userId: string,
    profile: {
      account?: string;
      avatarSeed?: string;
      avatarUrl?: string | null;
    },
  ): void {
    const touched = new Set<string>();
    for (const [sheetId, room] of this.rooms) {
      let changed = false;
      for (const c of room) {
        if (c.userId !== userId) continue;
        if (profile.account !== undefined) {
          c.account = profile.account;
          c.name = profile.account;
        }
        if (profile.avatarSeed !== undefined) c.avatarSeed = profile.avatarSeed;
        if (profile.avatarUrl !== undefined) c.avatarUrl = profile.avatarUrl;
        changed = true;
      }
      if (changed) touched.add(sheetId);
    }
    for (const sheetId of touched) this.broadcastPresence(sheetId);
  }

  private async leave(client: RoomClient): Promise<void> {
    const room = this.rooms.get(client.sheetId);
    if (!room) return;
    room.delete(client);
    const stillPresent = [...room].some((c) => c.userId === client.userId);
    if (!stillPresent) {
      const freed = await this.cellLocks.releaseAllForUser(
        client.sheetId,
        client.userId,
      );
      for (const lock of freed) {
        this.broadcast(
          client.sheetId,
          {
            type: 'cell_lock_update',
            action: 'released',
            recordId: lock.recordId,
            fieldId: lock.fieldId,
            holder: null,
          },
          client,
        );
      }
    }
    if (room.size === 0) this.rooms.delete(client.sheetId);
    else {
      // 仅当该用户已无任何连接时才广播离开（同账号其他页签仍在则不算离线）
      if (!stillPresent) {
        this.broadcast(
          client.sheetId,
          {
            type: 'user_leave',
            userId: client.userId,
          },
          client,
        );
      }
      this.broadcastPresence(client.sheetId);
    }
    this.refreshConnectionGauges(client.sheetId);
  }

  private broadcastPresence(sheetId: string): void {
    this.presenceThrottle.push(sheetId, sheetId);
  }

  private flushPresence(sheetId: string): void {
    const room = this.rooms.get(sheetId);
    if (!room) return;
    const byUser = new Map<
      string,
      {
        userId: string;
        account: string;
        name: string;
        color: string;
        avatarSeed: string;
        avatarUrl: string | null;
      }
    >();
    for (const c of room) {
      if (!byUser.has(c.userId)) {
        byUser.set(c.userId, {
          userId: c.userId,
          account: c.account,
          name: c.name,
          color: c.color,
          avatarSeed: c.avatarSeed,
          avatarUrl: c.avatarUrl,
        });
      }
    }
    const members = [...byUser.values()];
    const msg: CollabServerMsg = { type: 'user_newinfos', members };
    // 本机房间成员列表（跨副本合并见 S5 后续；勿把单副本名单当全集 Redis 扇出）
    for (const c of room) this.send(c.socket, msg);
  }

  private async onMessage(client: RoomClient, text: string): Promise<void> {
    let msg: CollabClientMsg;
    try {
      msg = JSON.parse(text) as CollabClientMsg;
    } catch {
      this.send(client.socket, {
        type: 'error',
        code: 'INVALID',
        message: '消息不是合法 JSON',
      });
      return;
    }

    switch (msg.type) {
      case 'client_ready': {
        const sheet = await this.prisma.sheet.findUnique({
          where: { id: client.sheetId },
        });
        this.send(client.socket, {
          type: 'last_reversion',
          sheetRev: sheet?.sheetRev ?? 0,
        });
        this.broadcastPresence(client.sheetId);
        await this.sendCellLocksSnapshot(client);
        return;
      }
      case 'heart_beat':
        await this.cellLocks.renewForUser(client.sheetId, client.userId);
        this.send(client.socket, { type: 'heart_beat', ok: true });
        return;
      case 'cursor_message':
        this.cursorThrottle.push(`${client.sheetId}:${client.userId}`, {
          sheetId: client.sheetId,
          except: client,
          msg: {
            type: 'cursor_message',
            userId: client.userId,
            account: client.account,
            name: client.name,
            color: client.color,
            cursor: msg.cursor ?? {},
          },
        });
        if (this.cursorThrottle.droppedCount > 0) {
          this.metrics.setGauge(
            'collab_cursor_dropped_total',
            this.cursorThrottle.droppedCount,
          );
        }
        return;
      case 'cell_lock_acquire':
        await this.handleCellLockAcquire(client, msg.recordId, msg.fieldId);
        return;
      case 'cell_lock_release':
        await this.handleCellLockRelease(client, msg.recordId, msg.fieldId);
        return;
      case 'get_changes':
        await this.sendChanges(client, msg.fromRev);
        return;
      case 'user_changes':
        await this.handleUserChanges(client, msg);
        return;
      default:
        this.send(client.socket, {
          type: 'error',
          code: 'INVALID',
          message: '未知消息类型',
        });
    }
  }

  private async sendChanges(client: RoomClient, fromRev: number): Promise<void> {
    const rows = await this.prisma.sheetChangeset.findMany({
      where: { sheetId: client.sheetId, rev: { gt: fromRev } },
      orderBy: { rev: 'asc' },
      take: 200,
    });
    const sheet = await this.prisma.sheet.findUnique({
      where: { id: client.sheetId },
    });
    this.send(client.socket, {
      type: 'changes',
      fromRev,
      toRev: sheet?.sheetRev ?? fromRev,
      changesets: rows.map((r) => ({
        rev: r.rev,
        authorId: r.authorId,
        commitId: r.commitId,
        mutations: r.mutations as unknown as SheetMutation[],
      })),
    });
  }

  private async handleUserChanges(
    client: RoomClient,
    msg: Extract<CollabClientMsg, { type: 'user_changes' }>,
  ): Promise<void> {
    const started = Date.now();
    let sheetRev = this.roomSheetRev.get(client.sheetId);
    let baseId = this.roomBaseId.get(client.sheetId);
    if (sheetRev === undefined || !baseId) {
      const sheet = await this.prisma.sheet.findUnique({
        where: { id: client.sheetId },
        select: { sheetRev: true, baseId: true },
      });
      if (!sheet) {
        this.send(client.socket, {
          type: 'error',
          code: 'NOT_FOUND',
          message: '工作表不存在',
        });
        return;
      }
      sheetRev = sheet.sheetRev;
      baseId = sheet.baseId;
      this.roomSheetRev.set(client.sheetId, sheetRev);
      this.roomBaseId.set(client.sheetId, baseId);
    }
    // 仅拒绝「未来版本」；落后 baseRev 交给 Actor rebase（排队时人人都会落后）。
    if (msg.baseRev > sheetRev) {
      this.metrics.increment('collab_conflict_total', { reason: 'version' });
      this.send(client.socket, {
        type: 'error',
        code: COMMIT_ERROR.VERSION_CONFLICT,
        message: 'COMMIT_BASE_VER_TOO_LOW',
        sheetRev,
      });
      await this.sendChanges(client, msg.baseRev);
      return;
    }

    let response;
    try {
      response = await this.commits.commit(
        client.sheetId,
        client.userId,
        {
          clientBatchId: msg.clientBatchId,
          mutations: msg.mutations as never,
        },
        '0.0.0.0',
        msg.baseRev,
        { skipAccessCheck: true, rebase: true },
      );
    } catch {
      this.metrics.increment('collab_conflict_total', { reason: 'version' });
      const sheetNow = await this.prisma.sheet.findUnique({
        where: { id: client.sheetId },
        select: { sheetRev: true },
      });
      const revNow = sheetNow?.sheetRev ?? sheetRev;
      this.roomSheetRev.set(client.sheetId, revNow);
      this.send(client.socket, {
        type: 'error',
        code: COMMIT_ERROR.VERSION_CONFLICT,
        message: 'COMMIT_BASE_VER_TOO_LOW',
        sheetRev: revNow,
      });
      await this.sendChanges(client, msg.baseRev);
      return;
    }

    const hasError = response.results.some((r) => r.status === 'error');
    const newRev = response.sheetRev ?? sheetRev;
    this.roomSheetRev.set(client.sheetId, newRev);
    const commitId = msg.clientBatchId;

    this.send(client.socket, {
      type: 'accept_commit',
      baseRev: msg.baseRev,
      newRev,
      commitId,
      clientBatchId: msg.clientBatchId,
      results: response.results,
    });
    this.metrics.observe('collab_accept_duration_ms', Date.now() - started);

    if (hasError || response.sheetRev === undefined) {
      this.send(client.socket, {
        type: 'error',
        code: COMMIT_ERROR.FAILED,
        message: '部分 mutation 失败',
        sheetRev: newRev,
      });
      return;
    }

    this.activity.recordCollabCommit({
      actorId: client.userId,
      account: client.account,
      sheetId: client.sheetId,
      baseId,
      mutationCount: Array.isArray(msg.mutations) ? msg.mutations.length : 0,
    });

    // 落后客户端补洞，避免只靠广播漏中间 rev。
    if (msg.baseRev < newRev - 1) {
      await this.sendChanges(client, msg.baseRev);
    }

    this.broadcast(
      client.sheetId,
      {
        type: 'new_changes',
        baseRev: newRev - 1,
        newRev,
        commitId,
        authorId: client.userId,
        mutations: msg.mutations,
      },
      client,
    );
    // 勿 await：Live 总线/Redis 延迟会堵住同 socket 下一条 user_changes，压测 cps 崩塌。
    void this.live
      .emit({
        baseId,
        actorId: client.userId,
        kind: 'sheet.rev_bumped',
        entityId: client.sheetId,
        meta: { sheetRev: newRev },
      })
      .catch((error: unknown) => {
        this.logger.warn(`live emit after accept failed: ${String(error)}`);
      });
  }

  /**
   * HTTP `commitchanges` 成功后广播，使其他页签/用户不刷新也能看到。
   * （WS 路径在 handleUserChanges 内已广播；此处补齐离线/回退通道）
   */
  async publishHttpCommit(params: {
    sheetId: string;
    authorId: string;
    commitId: string;
    mutations: unknown[];
  }): Promise<void> {
    if (!params.mutations.length) return;
    const sheet = await this.prisma.sheet.findUnique({
      where: { id: params.sheetId },
    });
    if (!sheet) return;
    const newRev = sheet.sheetRev ?? 0;
    await this.live.emit({
      baseId: sheet.baseId,
      actorId: params.authorId,
      kind: 'sheet.rev_bumped',
      entityId: params.sheetId,
      meta: { sheetRev: newRev },
    });
    const room = this.rooms.get(params.sheetId);
    if (!room || room.size === 0) return;
    this.broadcast(params.sheetId, {
      type: 'new_changes',
      baseRev: Math.max(0, newRev - 1),
      newRev,
      commitId: params.commitId,
      authorId: params.authorId,
      mutations: params.mutations as SheetMutation[],
    });
    this.broadcast(params.sheetId, {
      type: 'comm_notice',
      noticeType: 'DIRTY_AREA_CHANGE',
      sheetRev: newRev,
    });
  }

  private async sendCellLocksSnapshot(client: RoomClient): Promise<void> {
    const locks = await this.cellLocks.listForSheet(client.sheetId);
    this.send(client.socket, {
      type: 'cell_locks_snapshot',
      locks: locks.map((lock) => ({
        recordId: lock.recordId,
        fieldId: lock.fieldId,
        userId: lock.userId,
        account: lock.account,
        name: lock.name,
        color: lock.color,
        expiresAt: lock.expiresAt,
      })),
    });
  }

  private async handleCellLockAcquire(
    client: RoomClient,
    recordId: string,
    fieldId: string,
  ): Promise<void> {
    if (!recordId || !fieldId) {
      this.send(client.socket, {
        type: 'error',
        code: 'INVALID',
        message: 'cell_lock_acquire 缺少 recordId/fieldId',
      });
      return;
    }
    const result = await this.cellLocks.tryAcquire({
      sheetId: client.sheetId,
      recordId,
      fieldId,
      userId: client.userId,
      account: client.account,
      name: client.name,
      color: client.color,
    });
    const holder = {
      userId: result.lock.userId,
      account: result.lock.account,
      name: result.lock.name,
      color: result.lock.color,
      expiresAt: result.lock.expiresAt,
    };
    this.send(client.socket, {
      type: 'cell_lock_result',
      ok: result.ok,
      recordId,
      fieldId,
      holder,
    });
    if (result.ok) {
      for (const prev of result.released) {
        this.broadcast(client.sheetId, {
          type: 'cell_lock_update',
          action: 'released',
          recordId: prev.recordId,
          fieldId: prev.fieldId,
          holder: null,
        });
      }
      this.broadcast(client.sheetId, {
        type: 'cell_lock_update',
        action: 'acquired',
        recordId,
        fieldId,
        holder,
      });
    }
  }

  private async handleCellLockRelease(
    client: RoomClient,
    recordId: string,
    fieldId: string,
  ): Promise<void> {
    if (!recordId || !fieldId) return;
    const freed = await this.cellLocks.release(
      client.sheetId,
      recordId,
      fieldId,
      client.userId,
    );
    if (!freed) return;
    this.send(client.socket, {
      type: 'cell_lock_result',
      ok: true,
      recordId,
      fieldId,
      holder: undefined,
    });
    this.broadcast(client.sheetId, {
      type: 'cell_lock_update',
      action: 'released',
      recordId,
      fieldId,
      holder: null,
    });
  }

  private broadcast(
    sheetId: string,
    msg: CollabServerMsg,
    except?: RoomClient,
  ): void {
    // Cross-replica first so peer pods start deliver while we chunk locally.
    void this.fanout.publish(sheetId, msg);
    this.localBroadcast(sheetId, msg, except);
  }

  /** Deliver only to sockets on this process. Used by Redis fanout handler. */
  private localBroadcast(
    sheetId: string,
    msg: CollabServerMsg,
    except?: RoomClient,
  ): void {
    const room = this.rooms.get(sheetId);
    if (!room) return;
    const targets: WebSocket[] = [];
    for (const c of room) {
      if (except && c === except) continue;
      targets.push(c.socket);
    }
    if (targets.length === 0) return;
    // 千连接：stringify 一次 + 分片 setImmediate，避免同步扇出堵死 accept 回程。
    const raw = JSON.stringify(msg);
    // 大房用更大 chunk，减少 setImmediate 调度次数（Event loop 抢占 accept）。
    const CHUNK = targets.length >= 200 ? 256 : 64;
    const sendChunk = (offset: number) => {
      const end = Math.min(offset + CHUNK, targets.length);
      for (let i = offset; i < end; i += 1) {
        this.sendRaw(targets[i], raw);
      }
      if (end < targets.length) {
        setImmediate(() => sendChunk(end));
      }
    };
    sendChunk(0);
  }

  private refreshConnectionGauges(sheetId?: string): void {
    let total = 0;
    for (const room of this.rooms.values()) total += room.size;
    this.metrics.setGauge('collab_connections', total);
    this.metrics.setGauge('collab_rooms', this.rooms.size);
    if (sheetId) {
      this.metrics.setGauge(
        'collab_sheet_connections',
        this.rooms.get(sheetId)?.size ?? 0,
        { sheet_id: sheetId },
      );
    }
  }

  private send(socket: WebSocket, msg: CollabServerMsg): void {
    this.sendRaw(socket, JSON.stringify(msg));
  }

  private sendRaw(socket: WebSocket, raw: string): void {
    if (socket.readyState !== socket.OPEN) return;
    try {
      socket.send(raw);
    } catch (error) {
      this.logger.warn(`collab send failed: ${String(error)}`);
    }
  }
}
