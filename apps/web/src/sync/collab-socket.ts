import { ref, type Ref } from 'vue';
import type { SheetMutation } from 'shared';
import { peerColorFromUserId, transformAgainstPeers } from 'shared';
import { getToken } from '../api/client';
import { resolveApiWsBase } from './ws-base';

export interface CollabPeer {
  userId: string;
  account: string;
  name: string;
  color: string;
  avatarSeed?: string;
  avatarUrl?: string | null;
}

export interface CollabCursor {
  userId: string;
  account: string;
  name: string;
  color: string;
  cursor: {
    recordId?: string;
    fieldId?: string;
    rowIndex?: number;
    colIndex?: number;
  };
}

export interface CollabCellLock {
  recordId: string;
  fieldId: string;
  userId: string;
  account: string;
  name: string;
  color: string;
  expiresAt: number;
}

export type CellLockAcquireResult =
  | { ok: true }
  | { ok: false; holderName: string; holderUserId?: string };

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
  name?: string;
  color?: string;
  cursor?: CollabCursor['cursor'];
  code?: string;
  message?: string;
  ok?: boolean;
  recordId?: string;
  fieldId?: string;
  action?: string;
  holder?: CollabCellLock | null;
  locks?: CollabCellLock[];
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
  readonly cellLocks: Ref<CollabCellLock[]> = ref([]);
  readonly lastError: Ref<string | null> = ref(null);

  private ws: WebSocket | null = null;
  private sheetId = '';
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private cursorTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingCursor: CollabCursor['cursor'] | null = null;
  private heldLock: { recordId: string; fieldId: string } | null = null;
  private lockWaiters = new Map<
    string,
    {
      resolve: (result: CellLockAcquireResult) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private onAccept:
    | ((payload: {
        results: unknown[];
        newRev: number;
        clientBatchId?: string;
        mutations: SheetMutation[];
      }) => void)
    | null = null;
  private onRemote:
    | ((payload: {
        mutations: SheetMutation[];
        authorId: string;
        newRev: number;
        commitId?: string;
      }) => void)
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

    const apiBase = resolveApiWsBase();
    if (!apiBase) return;
    const url = `${apiBase}/collab?token=${encodeURIComponent(token)}&sheetId=${encodeURIComponent(sheetId)}`;
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
      this.failAllLockWaiters('协同已断开');
    };
    ws.onerror = () => {
      this.lastError.value = '协同连接失败';
    };
    ws.onmessage = (ev) => {
      void this.handleMessage(String(ev.data));
    };
  }

  disconnect(): void {
    if (this.heldLock) {
      this.releaseCellLock(this.heldLock.recordId, this.heldLock.fieldId);
    }
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.cursorTimer) clearTimeout(this.cursorTimer);
    this.cursorTimer = null;
    this.pendingCursor = null;
    this.failAllLockWaiters('协同已断开');
    this.ws?.close();
    this.ws = null;
    this.connected.value = false;
    this.peers.value = [];
    this.cursors.value = [];
    this.cellLocks.value = [];
    this.heldLock = null;
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

  /** 选区/编辑位置广播（节流，避免每个 pointermove 打爆） */
  sendCursor(cursor: CollabCursor['cursor']): void {
    this.pendingCursor = cursor;
    if (this.cursorTimer) return;
    this.cursorTimer = setTimeout(() => {
      this.cursorTimer = null;
      const next = this.pendingCursor;
      this.pendingCursor = null;
      if (!next) return;
      this.send({ type: 'cursor_message', cursor: next });
    }, 50);
  }

  /**
   * Human cell-edit lease. Offline / no WS → allow (HTTP commit path).
   */
  acquireCellLock(
    recordId: string,
    fieldId: string,
  ): Promise<CellLockAcquireResult> {
    if (!recordId || !fieldId) return Promise.resolve({ ok: true });
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.resolve({ ok: true });
    }
    if (
      this.heldLock &&
      (this.heldLock.recordId !== recordId ||
        this.heldLock.fieldId !== fieldId)
    ) {
      this.releaseCellLock(this.heldLock.recordId, this.heldLock.fieldId);
    }
    const key = `${recordId}::${fieldId}`;
    const existing = this.lockWaiters.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      existing.resolve({ ok: false, holderName: '等待中' });
      this.lockWaiters.delete(key);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.lockWaiters.delete(key);
        resolve({ ok: false, holderName: '锁定超时' });
      }, 4_000);
      this.lockWaiters.set(key, { resolve, timer });
      this.send({ type: 'cell_lock_acquire', recordId, fieldId });
    });
  }

  releaseCellLock(recordId?: string, fieldId?: string): void {
    const target =
      recordId && fieldId ? { recordId, fieldId } : this.heldLock;
    if (!target) return;
    if (
      this.heldLock &&
      this.heldLock.recordId === target.recordId &&
      this.heldLock.fieldId === target.fieldId
    ) {
      this.heldLock = null;
    }
    this.send({
      type: 'cell_lock_release',
      recordId: target.recordId,
      fieldId: target.fieldId,
    });
  }

  /** Live 资料变更时就地补 presence（不依赖 collab 房内重推） */
  patchPeerProfile(
    userId: string,
    profile: {
      account?: string;
      name?: string;
      avatarSeed?: string;
      avatarUrl?: string | null;
    },
  ): void {
    let changed = false;
    this.peers.value = this.peers.value.map((peer) => {
      if (peer.userId !== userId) return peer;
      changed = true;
      return {
        ...peer,
        ...(profile.account !== undefined ? { account: profile.account } : {}),
        ...(profile.name !== undefined ? { name: profile.name } : {}),
        ...(profile.avatarSeed !== undefined
          ? { avatarSeed: profile.avatarSeed }
          : {}),
        ...(profile.avatarUrl !== undefined
          ? { avatarUrl: profile.avatarUrl }
          : {}),
      };
    });
    if (!changed) return;
    this.cursors.value = this.cursors.value.map((c) => {
      if (c.userId !== userId) return c;
      return {
        ...c,
        ...(profile.account !== undefined ? { account: profile.account } : {}),
        ...(profile.name !== undefined ? { name: profile.name } : {}),
      };
    });
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

  private failAllLockWaiters(reason: string): void {
    for (const [, waiter] of this.lockWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve({ ok: false, holderName: reason });
    }
    this.lockWaiters.clear();
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
      case 'user_newinfos': {
        // 防御：同账号多连接时按 userId 去重（服务端也会去重）
        const seen = new Set<string>();
        const unique: CollabPeer[] = [];
        for (const peer of msg.members ?? []) {
          if (!peer.userId || seen.has(peer.userId)) continue;
          seen.add(peer.userId);
          unique.push({
            ...peer,
            color: peer.color || peerColorFromUserId(peer.userId),
            avatarSeed: peer.avatarSeed || peer.account || peer.userId,
            avatarUrl: peer.avatarUrl ?? null,
          });
        }
        this.peers.value = unique;
        break;
      }
      case 'user_leave':
        this.peers.value = this.peers.value.filter((p) => p.userId !== msg.userId);
        this.cursors.value = this.cursors.value.filter(
          (c) => c.userId !== msg.userId,
        );
        this.cellLocks.value = this.cellLocks.value.filter(
          (l) => l.userId !== msg.userId,
        );
        break;
      case 'cursor_message': {
        if (!msg.userId) break;
        const peer = this.peers.value.find((p) => p.userId === msg.userId);
        this.cursors.value = [
          ...this.cursors.value.filter((c) => c.userId !== msg.userId),
          {
            userId: msg.userId,
            account: msg.account ?? peer?.account ?? '',
            name: msg.name ?? peer?.name ?? msg.account ?? '',
            color:
              msg.color ||
              peer?.color ||
              peerColorFromUserId(msg.userId),
            cursor: msg.cursor ?? {},
          },
        ];
        break;
      }
      case 'cell_locks_snapshot':
        this.cellLocks.value = msg.locks ?? [];
        break;
      case 'cell_lock_update': {
        if (!msg.recordId || !msg.fieldId) break;
        if (msg.action === 'released' || !msg.holder) {
          this.cellLocks.value = this.cellLocks.value.filter(
            (l) =>
              !(l.recordId === msg.recordId && l.fieldId === msg.fieldId),
          );
        } else {
          this.cellLocks.value = [
            ...this.cellLocks.value.filter(
              (l) =>
                !(l.recordId === msg.recordId && l.fieldId === msg.fieldId),
            ),
            {
              recordId: msg.recordId,
              fieldId: msg.fieldId,
              userId: msg.holder.userId,
              account: msg.holder.account,
              name: msg.holder.name,
              color: msg.holder.color,
              expiresAt: msg.holder.expiresAt,
            },
          ];
        }
        break;
      }
      case 'cell_lock_result': {
        if (!msg.recordId || !msg.fieldId) break;
        const key = `${msg.recordId}::${msg.fieldId}`;
        const waiter = this.lockWaiters.get(key);
        if (!waiter) break;
        clearTimeout(waiter.timer);
        this.lockWaiters.delete(key);
        if (msg.ok) {
          this.heldLock = { recordId: msg.recordId, fieldId: msg.fieldId };
          waiter.resolve({ ok: true });
        } else {
          waiter.resolve({
            ok: false,
            holderName: msg.holder?.name || msg.holder?.account || '其他成员',
            holderUserId: msg.holder?.userId,
          });
        }
        break;
      }
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
          commitId: msg.commitId,
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
