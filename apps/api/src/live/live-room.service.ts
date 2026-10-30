import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { WebSocket } from 'ws';
import type { LiveClientMsg, LiveEvent, LiveServerMsg } from 'shared';
import { PrismaService } from '../prisma/prisma.service';
import { LiveBusService } from './live-bus.service';
import { isPublicSafeLiveKind } from './live-public-safe';

interface LiveClient {
  socket: WebSocket;
  userId: string | null;
  baseId: string | null;
  workspaceId: string | null;
  publicToken: string | null;
  formToken: string | null;
  seenIds: Set<string>;
}

@Injectable()
export class LiveRoomService implements OnModuleInit {
  private readonly logger = new Logger(LiveRoomService.name);
  private readonly byBase = new Map<string, Set<LiveClient>>();
  private readonly byWorkspace = new Map<string, Set<LiveClient>>();
  private readonly byUser = new Map<string, Set<LiveClient>>();
  private readonly byPublic = new Map<string, Set<LiveClient>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly bus: LiveBusService,
  ) {}

  onModuleInit(): void {
    this.bus.setLocalFanout((event) => this.deliver(event));
  }

  async acceptConnection(
    socket: WebSocket,
    query: {
      token?: string;
      baseId?: string;
      workspaceId?: string;
      publicToken?: string;
      formToken?: string;
    },
  ): Promise<void> {
    const publicToken = query.publicToken?.trim() || null;
    const formToken = query.formToken?.trim() || null;
    const baseIdQ = query.baseId?.trim() || null;
    const workspaceIdQ = query.workspaceId?.trim() || null;
    const token = query.token?.trim() || '';

    if (publicToken || formToken) {
      await this.acceptPublic(socket, publicToken, formToken);
      return;
    }

    if (!token) {
      this.send(socket, {
        type: 'error',
        code: 'INVALID',
        message: '缺少 token',
      });
      socket.close();
      return;
    }

    let payload: { sub: string; impersonatorId?: string };
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
    if (!authUser || (authUser.blacklistedAt && !payload.impersonatorId)) {
      this.send(socket, {
        type: 'error',
        code: 'UNAUTHORIZED',
        message: '账号已被限制登录',
      });
      socket.close();
      return;
    }

    let baseId = baseIdQ;
    let workspaceId = workspaceIdQ;

    if (baseId) {
      const base = await this.prisma.base.findUnique({ where: { id: baseId } });
      if (!base) {
        this.send(socket, {
          type: 'error',
          code: 'NOT_FOUND',
          message: 'Base 不存在',
        });
        socket.close();
        return;
      }
      workspaceId = workspaceId || base.workspaceId;
      const member = await this.prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: base.workspaceId,
            userId: payload.sub,
          },
        },
      });
      if (!member) {
        this.send(socket, {
          type: 'error',
          code: 'FORBIDDEN',
          message: '无 Base 访问权限',
        });
        socket.close();
        return;
      }
    } else if (workspaceId) {
      const member = await this.prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId,
            userId: payload.sub,
          },
        },
      });
      if (!member) {
        this.send(socket, {
          type: 'error',
          code: 'FORBIDDEN',
          message: '无工作区访问权限',
        });
        socket.close();
        return;
      }
    }
    // else: user-only room（通知页）

    const client: LiveClient = {
      socket,
      userId: payload.sub,
      baseId,
      workspaceId,
      publicToken: null,
      formToken: null,
      seenIds: new Set(),
    };
    if (baseId) this.addBase(baseId, client);
    if (workspaceId) this.addWorkspace(workspaceId, client);
    this.addUser(payload.sub, client);
    this.wireSocket(client);

    const scopeKey = baseId
      ? `base:${baseId}`
      : workspaceId
        ? `ws:${workspaceId}`
        : `user:${payload.sub}`;
    const latest = await this.bus.latestSeq(scopeKey);
    this.send(socket, {
      type: 'live_hello',
      baseId,
      workspaceId,
      latestSeq: latest,
    });
  }

  private async acceptPublic(
    socket: WebSocket,
    publicToken: string | null,
    formToken: string | null,
  ): Promise<void> {
    let resolvedBaseId: string | null = null;
    let tokenKey = '';

    if (publicToken) {
      const view = await this.prisma.publicView.findFirst({
        where: { token: publicToken, enabled: true },
        include: { sheet: { select: { baseId: true } } },
      });
      if (!view) {
        this.send(socket, {
          type: 'error',
          code: 'FORBIDDEN',
          message: '公开链接无效',
        });
        socket.close();
        return;
      }
      resolvedBaseId = view.sheet.baseId;
      tokenKey = `pv:${publicToken}`;
    } else if (formToken) {
      const form = await this.prisma.form.findFirst({
        where: { shareToken: formToken },
        include: { sheet: { select: { baseId: true } } },
      });
      if (!form) {
        this.send(socket, {
          type: 'error',
          code: 'FORBIDDEN',
          message: '表单链接无效',
        });
        socket.close();
        return;
      }
      const share = form.share as { enabled?: boolean } | null;
      if (share && share.enabled === false) {
        this.send(socket, {
          type: 'error',
          code: 'FORBIDDEN',
          message: '表单已关闭',
        });
        socket.close();
        return;
      }
      resolvedBaseId = form.sheet.baseId;
      tokenKey = `form:${formToken}`;
    }

    if (!resolvedBaseId) {
      socket.close();
      return;
    }

    const client: LiveClient = {
      socket,
      userId: null,
      baseId: resolvedBaseId,
      workspaceId: null,
      publicToken: publicToken,
      formToken: formToken,
      seenIds: new Set(),
    };
    this.addPublic(tokenKey, client);
    this.addBase(resolvedBaseId, client);
    this.wireSocket(client);
    const latest = await this.bus.latestSeq(`base:${resolvedBaseId}`);
    this.send(socket, {
      type: 'live_hello',
      baseId: resolvedBaseId,
      workspaceId: null,
      latestSeq: latest,
    });
  }

  private wireSocket(client: LiveClient): void {
    client.socket.on('message', (raw) => {
      void this.onMessage(client, raw.toString());
    });
    client.socket.on('close', () => this.leave(client));
    client.socket.on('error', () => this.leave(client));
  }

  private async onMessage(client: LiveClient, text: string): Promise<void> {
    let msg: LiveClientMsg;
    try {
      msg = JSON.parse(text) as LiveClientMsg;
    } catch {
      this.send(client.socket, {
        type: 'error',
        code: 'INVALID',
        message: '消息不是合法 JSON',
      });
      return;
    }
    if (msg.type === 'heart_beat') {
      this.send(client.socket, { type: 'heart_beat', ok: true });
      return;
    }
    if (msg.type === 'client_ready') {
      const scopeKey = client.baseId
        ? `base:${client.baseId}`
        : client.workspaceId
          ? `ws:${client.workspaceId}`
          : client.userId
            ? `user:${client.userId}`
            : 'global';
      const latest = await this.bus.latestSeq(scopeKey);
      this.send(client.socket, {
        type: 'live_hello',
        baseId: client.baseId,
        workspaceId: client.workspaceId,
        latestSeq: latest,
      });
      return;
    }
    if (msg.type === 'catchup') {
      const scope =
        msg.scope === 'user' && client.userId
          ? `user:${client.userId}`
          : msg.scope === 'workspace' && client.workspaceId
            ? `ws:${client.workspaceId}`
            : client.baseId
              ? `base:${client.baseId}`
              : client.workspaceId
                ? `ws:${client.workspaceId}`
                : client.userId
                  ? `user:${client.userId}`
                  : null;
      if (!scope) return;
      let events = await this.bus.eventsSince(scope, msg.fromSeq);
      if (client.publicToken || client.formToken) {
        events = events.filter((e) => isPublicSafeLiveKind(e.kind));
      }
      this.send(client.socket, { type: 'live_catchup', events });
    }
  }

  private leave(client: LiveClient): void {
    if (client.baseId) {
      const room = this.byBase.get(client.baseId);
      room?.delete(client);
      if (room && room.size === 0) this.byBase.delete(client.baseId);
    }
    if (client.workspaceId) {
      const room = this.byWorkspace.get(client.workspaceId);
      room?.delete(client);
      if (room && room.size === 0) this.byWorkspace.delete(client.workspaceId);
    }
    if (client.userId) {
      const room = this.byUser.get(client.userId);
      room?.delete(client);
      if (room && room.size === 0) this.byUser.delete(client.userId);
    }
    const pubKey = client.publicToken
      ? `pv:${client.publicToken}`
      : client.formToken
        ? `form:${client.formToken}`
        : null;
    if (pubKey) {
      const room = this.byPublic.get(pubKey);
      room?.delete(client);
      if (room && room.size === 0) this.byPublic.delete(pubKey);
    }
  }

  private deliver(event: LiveEvent): void {
    const targets = new Set<LiveClient>();
    if (event.baseId) {
      for (const c of this.byBase.get(event.baseId) ?? []) targets.add(c);
    }
    if (event.workspaceId) {
      for (const c of this.byWorkspace.get(event.workspaceId) ?? []) {
        targets.add(c);
      }
    }
    const userId =
      typeof event.meta?.userId === 'string'
        ? event.meta.userId
        : event.kind.startsWith('notification.')
          ? null
          : null;
    // notification.* 走 emit.userId → 需在 emit 时同时进 user channel；
    // deliver 再按 meta.userId / 专用字段：用 actor 外的目标用户
    if (typeof event.meta?.targetUserId === 'string') {
      for (const c of this.byUser.get(event.meta.targetUserId) ?? []) {
        targets.add(c);
      }
    }
    if (userId) {
      for (const c of this.byUser.get(userId) ?? []) targets.add(c);
    }
    // 用户房：notification 事件由 Redis user channel 回环 + 本机 fanout；
    // 本机 emit 时 localFanout 已调用，需在 emit 侧把 user 连接算进 targets。
    // 简化：所有连着 user 房且 event 带 meta.userId 匹配的接收。
    if (typeof event.meta?.userId === 'string') {
      for (const c of this.byUser.get(event.meta.userId) ?? []) {
        targets.add(c);
      }
    }

    if (event.baseId && this.isPublicSafe(event.kind)) {
      for (const [, room] of this.byPublic) {
        for (const c of room) {
          if (c.baseId === event.baseId) targets.add(c);
        }
      }
    }

    for (const c of targets) {
      if (c.seenIds.has(event.eventId)) continue;
      c.seenIds.add(event.eventId);
      if (c.seenIds.size > 2000) {
        const first = c.seenIds.values().next().value as string;
        c.seenIds.delete(first);
      }
      if (
        (c.publicToken || c.formToken) &&
        !this.isPublicSafe(event.kind)
      ) {
        continue;
      }
      this.send(c.socket, event);
    }
  }

  /** 供 LiveBus 在 emit(userId) 时把事件推给该用户所有连接 */
  deliverToUser(userId: string, event: LiveEvent): void {
    for (const c of this.byUser.get(userId) ?? []) {
      if (c.seenIds.has(event.eventId)) continue;
      c.seenIds.add(event.eventId);
      this.send(c.socket, event);
    }
  }

  private isPublicSafe(kind: string): boolean {
    return isPublicSafeLiveKind(kind);
  }

  private addBase(baseId: string, client: LiveClient): void {
    let room = this.byBase.get(baseId);
    if (!room) {
      room = new Set();
      this.byBase.set(baseId, room);
    }
    room.add(client);
  }

  private addWorkspace(workspaceId: string, client: LiveClient): void {
    let room = this.byWorkspace.get(workspaceId);
    if (!room) {
      room = new Set();
      this.byWorkspace.set(workspaceId, room);
    }
    room.add(client);
  }

  private addUser(userId: string, client: LiveClient): void {
    let room = this.byUser.get(userId);
    if (!room) {
      room = new Set();
      this.byUser.set(userId, room);
    }
    room.add(client);
  }

  private addPublic(token: string, client: LiveClient): void {
    let room = this.byPublic.get(token);
    if (!room) {
      room = new Set();
      this.byPublic.set(token, room);
    }
    room.add(client);
  }

  private send(socket: WebSocket, msg: LiveServerMsg): void {
    if (socket.readyState !== socket.OPEN) return;
    try {
      socket.send(JSON.stringify(msg));
    } catch (error) {
      this.logger.warn(`live send failed: ${String(error)}`);
    }
  }
}
