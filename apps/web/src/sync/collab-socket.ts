import { ref, type Ref } from 'vue';
import type { SheetMutation } from 'shared';
import { transformAgainstPeers } from 'shared';
import { getToken } from '../api/client';

export interface CollabPeer {
  userId: string;
  account: string;
  name: string;
  colorId: number;
}

export interface CollabCursor {
  userId: string;
  account: string;
  cursor: {
    recordId?: string;
    fieldId?: string;
    rowIndex?: number;
    colIndex?: number;
  };
}

type ServerMsg = {
  type: string;
  sheetRev?: number;
  members?: CollabPeer[];
  baseRev?: number;
  newRev?: number;
  commitId?: string;
  clientBatchId?: string;
  results?: unknown[];
  authorId?: string;
  mutations?: SheetMutation[];
  userId?: string;
  account?: string;
  cursor?: CollabCursor['cursor'];
  code?: string;
  message?: string;
  changesets?: Array<{
    rev: number;
    mutations: SheetMutation[];
    authorId: string | null;
    commitId: string;
  }>;
};

export class CollabSocket {
  readonly connected: Ref<boolean> = ref(false);
  readonly sheetRev: Ref<number> = ref(0);
  readonly peers: Ref<CollabPeer[]> = ref([]);
  readonly cursors: Ref<CollabCursor[]> = ref([]);
  readonly lastError: Ref<string | null> = ref(null);

  private ws: WebSocket | null = null;
  private sheetId = '';
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private onAccept:
    | ((payload: {
        results: unknown[];
        newRev: number;
        clientBatchId?: string;
        mutations: SheetMutation[];
      }) => void)
    | null = null;
  private onRemote:
    | ((payload: { mutations: SheetMutation[]; authorId: string; newRev: number }) => void)
    | null = null;
  private onError:
    | ((payload: { code?: string; message?: string; sheetRev?: number }) => void)
    | null = null;

  setHandlers(handlers: {
    onAccept?: NonNullable<typeof this.onAccept>;
    onRemote?: NonNullable<typeof this.onRemote>;
    onError?: NonNullable<typeof this.onError>;
  }): void {
    if (handlers.onAccept !== undefined) this.onAccept = handlers.onAccept;
    if (handlers.onRemote !== undefined) this.onRemote = handlers.onRemote;
    if (handlers.onError !== undefined) this.onError = handlers.onError;
  }

  connect(sheetId: string): void {
    if (this.sheetId === sheetId && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    this.disconnect();
    this.sheetId = sheetId;
    const token = getToken();
    if (!token || typeof window === 'undefined') return;

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const envWs = import.meta.env.VITE_API_WS as string | undefined;
    // Dev: same-origin /collab → Vite proxy; prod: direct API host if VITE_API_WS set
    const apiBase =
      envWs ??
      (import.meta.env.DEV
        ? `${proto}://${window.location.host}`
        : `${proto}://${window.location.hostname}:3000`);
    const url = `${apiBase.replace(/\/$/, '')}/collab?token=${encodeURIComponent(token)}&sheetId=${encodeURIComponent(sheetId)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.connected.value = true;
      this.send({ type: 'client_ready' });
      this.heartbeat = setInterval(() => {
        this.send({ type: 'heart_beat' });
      }, 15_000);
    };
    ws.onclose = () => {
      this.connected.value = false;
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
    };
    ws.onerror = () => {
      this.lastError.value = '协同连接失败';
    };
    ws.onmessage = (ev) => {
      void this.handleMessage(String(ev.data));
    };
  }

  disconnect(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.ws?.close();
    this.ws = null;
    this.connected.value = false;
    this.peers.value = [];
    this.cursors.value = [];
  }

  sendUserChanges(
    baseRev: number,
    clientBatchId: string,
    mutations: SheetMutation[],
  ): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.send({
      type: 'user_changes',
      baseRev,
      clientBatchId,
      mutations,
    });
    return true;
  }

  sendCursor(cursor: CollabCursor['cursor']): void {
    this.send({ type: 'cursor_message', cursor });
  }

  /** Transform local pending against remote peers before retry. */
  transformPending(
    local: SheetMutation,
    peers: SheetMutation[],
  ): SheetMutation | null {
    const out = transformAgainstPeers(local, peers);
    if (out.kind === 'drop') return null;
    if (out.kind === 'conflict') {
      this.lastError.value = out.reason;
      return null;
    }
    return out.mutation;
  }

  private send(msg: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  private async handleMessage(text: string): Promise<void> {
    let msg: ServerMsg;
    try {
      msg = JSON.parse(text) as ServerMsg;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'last_reversion':
        this.sheetRev.value = msg.sheetRev ?? 0;
        break;
      case 'user_newinfos':
        this.peers.value = msg.members ?? [];
        break;
      case 'user_leave':
        this.peers.value = this.peers.value.filter((p) => p.userId !== msg.userId);
        this.cursors.value = this.cursors.value.filter(
          (c) => c.userId !== msg.userId,
        );
        break;
      case 'cursor_message':
        if (!msg.userId) break;
        this.cursors.value = [
          ...this.cursors.value.filter((c) => c.userId !== msg.userId),
          {
            userId: msg.userId,
            account: msg.account ?? '',
            cursor: msg.cursor ?? {},
          },
        ];
        break;
      case 'accept_commit':
        this.sheetRev.value = msg.newRev ?? this.sheetRev.value;
        this.onAccept?.({
          results: msg.results ?? [],
          newRev: msg.newRev ?? this.sheetRev.value,
          clientBatchId: msg.clientBatchId,
          mutations: msg.mutations ?? [],
        });
        break;
      case 'new_changes':
        this.sheetRev.value = msg.newRev ?? this.sheetRev.value;
        this.onRemote?.({
          mutations: msg.mutations ?? [],
          authorId: msg.authorId ?? '',
          newRev: msg.newRev ?? this.sheetRev.value,
        });
        break;
      case 'error':
        this.lastError.value = msg.message ?? msg.code ?? '协同错误';
        if (typeof msg.sheetRev === 'number') {
          this.sheetRev.value = msg.sheetRev;
        }
        this.onError?.({
          code: msg.code,
          message: msg.message,
          sheetRev: msg.sheetRev,
        });
        break;
      case 'changes':
        for (const cs of msg.changesets ?? []) {
          this.onRemote?.({
            mutations: cs.mutations,
            authorId: cs.authorId ?? '',
            newRev: cs.rev,
          });
          this.sheetRev.value = Math.max(this.sheetRev.value, cs.rev);
        }
        break;
      default:
        break;
    }
  }
}

export const collabSocket = new CollabSocket();
