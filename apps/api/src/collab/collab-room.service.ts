import { Injectable, Logger } from '@nestjs/common';
import type { WebSocket } from 'ws';
import type { SheetMutation } from 'shared';
import { COMMIT_ERROR } from 'shared';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { SheetsService } from '../sheets/sheets.service';
import { CommitChangesService } from '../sheets/commit-changes.service';
import type { CollabClientMsg, CollabServerMsg } from './collab.types';

interface RoomClient {
  socket: WebSocket;
  userId: string;
  account: string;
  name: string;
  colorId: number;
  sheetId: string;
}

@Injectable()
export class CollabRoomService {
  private readonly logger = new Logger(CollabRoomService.name);
  private readonly rooms = new Map<string, Set<RoomClient>>();
  private colorSeq = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sheets: SheetsService,
    private readonly commits: CommitChangesService,
  ) {}

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
    const client: RoomClient = {
      socket,
      userId: payload.sub,
      account: user?.account ?? payload.account ?? payload.sub,
      name: user?.name ?? user?.account ?? payload.sub,
      colorId: (this.colorSeq++ % 12) + 1,
      sheetId,
    };

    let room = this.rooms.get(sheetId);
    if (!room) {
      room = new Set();
      this.rooms.set(sheetId, room);
    }
    room.add(client);

    socket.on('message', (raw) => {
      void this.onMessage(client, raw.toString());
    });
    socket.on('close', () => this.leave(client));
    socket.on('error', () => this.leave(client));

    const sheet = await this.prisma.sheet.findUnique({ where: { id: sheetId } });
    this.send(socket, {
      type: 'last_reversion',
      sheetRev: sheet?.sheetRev ?? 0,
    });
    this.broadcastPresence(sheetId);
  }

  private leave(client: RoomClient): void {
    const room = this.rooms.get(client.sheetId);
    if (!room) return;
    room.delete(client);
    if (room.size === 0) this.rooms.delete(client.sheetId);
    else {
      this.broadcast(client.sheetId, {
        type: 'user_leave',
        userId: client.userId,
      }, client);
      this.broadcastPresence(client.sheetId);
    }
  }

  private broadcastPresence(sheetId: string): void {
    const room = this.rooms.get(sheetId);
    if (!room) return;
    const members = [...room].map((c) => ({
      userId: c.userId,
      account: c.account,
      name: c.name,
      colorId: c.colorId,
    }));
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
        return;
      }
      case 'heart_beat':
        this.send(client.socket, { type: 'heart_beat', ok: true });
        return;
      case 'cursor_message':
        this.broadcast(
          client.sheetId,
          {
            type: 'cursor_message',
            userId: client.userId,
            account: client.account,
            cursor: msg.cursor ?? {},
          },
          client,
        );
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
