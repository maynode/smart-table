import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WebSocket } from 'ws';
import type IORedis from 'ioredis';
import type { SheetMutation } from 'shared';
import { COMMIT_ERROR, peerColorFromUserId } from 'shared';
import { JwtService } from '@nestjs/jwt';
import { LiveBusService } from '../live/live-bus.service';
import { PrismaService } from '../prisma/prisma.service';
import { createRedisConnection } from '../queue/redis-connection';
import { SheetsService } from '../sheets/sheets.service';
import { CommitChangesService } from '../sheets/commit-changes.service';
import type { CollabClientMsg, CollabServerMsg } from './collab.types';
import { CellLockRegistry } from './cell-lock.registry';

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
export class CollabRoomService implements OnModuleDestroy {
  private readonly logger = new Logger(CollabRoomService.name);
  private readonly rooms = new Map<string, Set<RoomClient>>();
  private readonly cellLocks: CellLockRegistry;
  private readonly lockRedis: IORedis | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sheets: SheetsService,
    private readonly commits: CommitChangesService,
    private readonly live: LiveBusService,
    config: ConfigService,
  ) {
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
  }

  async onModuleDestroy(): Promise<void> {
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
    let payload: { sub: string; account?: string };
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
    const client: RoomClient = {
      socket,
      userId: payload.sub,
      account: user?.account ?? payload.account ?? payload.sub,
      name: user?.name ?? user?.account ?? payload.sub,
      color: peerColorFromUserId(payload.sub),
      avatarSeed: user?.avatarSeed || user?.account || payload.sub,
      avatarUrl: user?.avatarUrl ?? null,
      sheetId,
    };
    room.add(client);

    socket.on('message', (raw) => {
      void this.onMessage(client, raw.toString());
    });
    socket.on('close', () => {
      void this.leave(client);
    });
    socket.on('error', () => {
      void this.leave(client);
    });

    const sheet = await this.prisma.sheet.findUnique({ where: { id: sheetId } });
    this.send(socket, {
      type: 'last_reversion',
      sheetRev: sheet?.sheetRev ?? 0,
    });
    this.broadcastPresence(sheetId);
    await this.sendCellLocksSnapshot(client);
  }

  /** 用户改头像/用户名后刷新各表 presence，无需重连 */
  updateUserProfile(
    userId: string,
    profile: {
      account?: string;
      name?: string;
      avatarSeed?: string;
      avatarUrl?: string | null;
    },
  ): void {
    const touched = new Set<string>();
    for (const [sheetId, room] of this.rooms) {
      let changed = false;
      for (const c of room) {
        if (c.userId !== userId) continue;
        if (profile.account !== undefined) c.account = profile.account;
        if (profile.name !== undefined) c.name = profile.name;
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
  }

  private broadcastPresence(sheetId: string): void {
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
        this.broadcast(
          client.sheetId,
          {
            type: 'cursor_message',
            userId: client.userId,
            account: client.account,
            name: client.name,
            color: client.color,
            cursor: msg.cursor ?? {},
          },
          client,
        );
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
    const sheet = await this.prisma.sheet.findUnique({
      where: { id: client.sheetId },
    });
    if (!sheet) {
      this.send(client.socket, {
        type: 'error',
        code: 'NOT_FOUND',
        message: '工作表不存在',
      });
      return;
    }
    if (msg.baseRev !== sheet.sheetRev) {
      this.send(client.socket, {
        type: 'error',
        code: COMMIT_ERROR.VERSION_CONFLICT,
        message: 'COMMIT_BASE_VER_TOO_LOW',
        sheetRev: sheet.sheetRev,
      });
      await this.sendChanges(client, msg.baseRev);
      return;
    }

    try {
      await this.sheets.assertSheetAccess(
        client.sheetId,
        client.userId,
        'editor',
      );
    } catch {
      this.send(client.socket, {
        type: 'error',
        code: 'FORBIDDEN',
        message: '无编辑权限',
      });
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
      );
    } catch {
      const sheetNow = await this.prisma.sheet.findUnique({
        where: { id: client.sheetId },
      });
      this.send(client.socket, {
        type: 'error',
        code: COMMIT_ERROR.VERSION_CONFLICT,
        message: 'COMMIT_BASE_VER_TOO_LOW',
        sheetRev: sheetNow?.sheetRev ?? sheet.sheetRev,
      });
      await this.sendChanges(client, msg.baseRev);
      return;
    }

    const updated = await this.prisma.sheet.findUnique({
      where: { id: client.sheetId },
    });
    const newRev = updated?.sheetRev ?? sheet.sheetRev;
    const commitId = msg.clientBatchId;
    const hasError = response.results.some((r) => r.status === 'error');

    this.send(client.socket, {
      type: 'accept_commit',
      baseRev: msg.baseRev,
      newRev,
      commitId,
      clientBatchId: msg.clientBatchId,
      results: response.results,
    });

    if (hasError) {
      this.send(client.socket, {
        type: 'error',
        code: COMMIT_ERROR.FAILED,
        message: '部分 mutation 失败',
        sheetRev: newRev,
      });
      return;
    }

    this.broadcast(
      client.sheetId,
      {
        type: 'new_changes',
        baseRev: msg.baseRev,
        newRev,
        commitId,
        authorId: client.userId,
        mutations: msg.mutations,
      },
      client,
    );
    this.broadcast(client.sheetId, {
      type: 'comm_notice',
      noticeType: 'DIRTY_AREA_CHANGE',
      sheetRev: newRev,
    });
    await this.live.emit({
      baseId: sheet.baseId,
      actorId: client.userId,
      kind: 'sheet.rev_bumped',
      entityId: client.sheetId,
      meta: { sheetRev: newRev },
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
    const room = this.rooms.get(sheetId);
    if (!room) return;
    for (const c of room) {
      if (except && c === except) continue;
      this.send(c.socket, msg);
    }
  }

  private send(socket: WebSocket, msg: CollabServerMsg): void {
    if (socket.readyState !== socket.OPEN) return;
    try {
      socket.send(JSON.stringify(msg));
    } catch (error) {
      this.logger.warn(`collab send failed: ${String(error)}`);
    }
  }
}
