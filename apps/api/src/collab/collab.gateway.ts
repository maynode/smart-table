import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { CollabRoomService } from './collab-room.service';

@WebSocketGateway({ path: '/collab' })
export class CollabGateway implements OnGatewayConnection {
  private readonly logger = new Logger(CollabGateway.name);

  constructor(private readonly rooms: CollabRoomService) {}

  handleConnection(client: WebSocket, ...args: unknown[]): void {
    const request = args[0] as IncomingMessage | undefined;
    const host = request?.headers?.host ?? '127.0.0.1';
    const url = new URL(request?.url ?? '/', `http://${host}`);
    const token = url.searchParams.get('token') ?? '';
    const sheetId = url.searchParams.get('sheetId') ?? '';
    if (!token || !sheetId) {
      try {
        client.send(
          JSON.stringify({
            type: 'error',
            code: 'INVALID',
            message: '缺少 token 或 sheetId',
          }),
        );
      } catch {
        /* ignore */
      }
      client.close();
      return;
    }
    void this.rooms.acceptConnection(client, token, sheetId).catch((error) => {
      this.logger.warn(`collab accept failed: ${String(error)}`);
      client.close();
    });
  }
}
