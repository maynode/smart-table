import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { LiveRoomService } from './live-room.service';

@WebSocketGateway({ path: '/live' })
export class LiveGateway implements OnGatewayConnection {
  private readonly logger = new Logger(LiveGateway.name);

  constructor(private readonly rooms: LiveRoomService) {}

  handleConnection(client: WebSocket, ...args: unknown[]): void {
    const request = args[0] as IncomingMessage | undefined;
    const host = request?.headers?.host ?? '127.0.0.1';
    const url = new URL(request?.url ?? '/', `http://${host}`);
    void this.rooms
      .acceptConnection(client, {
        token: url.searchParams.get('token') ?? undefined,
        baseId: url.searchParams.get('baseId') ?? undefined,
        workspaceId: url.searchParams.get('workspaceId') ?? undefined,
        publicToken: url.searchParams.get('publicToken') ?? undefined,
        formToken: url.searchParams.get('formToken') ?? undefined,
      })
      .catch((error) => {
        this.logger.warn(`live accept failed: ${String(error)}`);
        client.close();
      });
  }
}
