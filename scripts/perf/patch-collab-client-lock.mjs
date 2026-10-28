/**
 * Wire collab-socket cell lock API (CRLF-safe).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'apps/web/src/sync/collab-socket.ts';
let s = readFileSync(path, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';

if (s.includes('acquireCellLock')) {
  console.log('collab-socket already has locks');
  process.exit(0);
}

s = s.replace(
  `export interface CollabCursor {
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
}`,
  `export interface CollabCursor {
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
  | { ok: false; holderName: string; holderUserId?: string };`,
);

s = s.replace(
  `  readonly cursors: Ref<CollabCursor[]> = ref([]);
  readonly lastError: Ref<string | null> = ref(null);`,
  `  readonly cursors: Ref<CollabCursor[]> = ref([]);
  readonly cellLocks: Ref<CollabCellLock[]> = ref([]);
  readonly lastError: Ref<string | null> = ref(null);`,
);

s = s.replace(
  `  private onError:
    | ((payload: { code?: string; message?: string; sheetRev?: number }) => void)
    | null = null;`,
  `  private onError:
    | ((payload: { code?: string; message?: string; sheetRev?: number }) => void)
    | null = null;
  private lockWaiters = new Map<
    string,
    {
      resolve: (result: CellLockAcquireResult) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private heldLock: { recordId: string; fieldId: string } | null = null;`,
);

s = s.replace(
  `    this.peers.value = [];
    this.cursors.value = [];
  }`,
  `    this.peers.value = [];
    this.cursors.value = [];
    this.cellLocks.value = [];
    this.failAllLockWaiters('协同已断开');
    this.heldLock = null;
  }`,
);

// Insert methods after sendCursor
s = s.replace(
  `  /** Live 资料变更时就地补 presence（不依赖 collab 房内重推） */
  patchPeerProfile(`,
  `  acquireCellLock(recordId: string, fieldId: string): Promise<CellLockAcquireResult> {
    if (!recordId || !fieldId) return Promise.resolve({ ok: true });
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Offline / no collab: allow local edit (HTTP commit path).
      return Promise.resolve({ ok: true });
    }
    const key = \`\${recordId}::\${fieldId}\`;
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
    const target = recordId && fieldId
      ? { recordId, fieldId }
      : this.heldLock;
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
  patchPeerProfile(`,
);

// Add helpers + message cases before default in handleMessage
s = s.replace(
  `      case 'cursor_message': {
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
      }`,
  `      case 'cursor_message': {
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
      case 'cell_locks_snapshot': {
        const locks = (msg as { locks?: CollabCellLock[] }).locks ?? [];
        this.cellLocks.value = locks;
        break;
      }
      case 'cell_lock_update': {
        const m = msg as {
          action?: string;
          recordId?: string;
          fieldId?: string;
          holder?: CollabCellLock | null;
        };
        if (!m.recordId || !m.fieldId) break;
        if (m.action === 'released' || !m.holder) {
          this.cellLocks.value = this.cellLocks.value.filter(
            (l) => !(l.recordId === m.recordId && l.fieldId === m.fieldId),
          );
        } else {
          this.cellLocks.value = [
            ...this.cellLocks.value.filter(
              (l) => !(l.recordId === m.recordId && l.fieldId === m.fieldId),
            ),
            {
              recordId: m.recordId,
              fieldId: m.fieldId,
              userId: m.holder.userId,
              account: m.holder.account,
              name: m.holder.name,
              color: m.holder.color,
              expiresAt: m.holder.expiresAt,
            },
          ];
        }
        break;
      }
      case 'cell_lock_result': {
        const m = msg as {
          ok?: boolean;
          recordId?: string;
          fieldId?: string;
          holder?: {
            userId: string;
            account: string;
            name: string;
            color: string;
            expiresAt: number;
          };
        };
        if (!m.recordId || !m.fieldId) break;
        const key = \`\${m.recordId}::\${m.fieldId}\`;
        const waiter = this.lockWaiters.get(key);
        if (waiter) {
          clearTimeout(waiter.timer);
          this.lockWaiters.delete(key);
          if (m.ok) {
            this.heldLock = { recordId: m.recordId, fieldId: m.fieldId };
            waiter.resolve({ ok: true });
          } else {
            waiter.resolve({
              ok: false,
              holderName: m.holder?.name || m.holder?.account || '其他成员',
              holderUserId: m.holder?.userId,
            });
          }
        }
        break;
      }`,
);

s = s.replace(
  `  private send(msg: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }`,
  `  private failAllLockWaiters(reason: string): void {
    for (const [key, waiter] of this.lockWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve({ ok: false, holderName: reason });
      this.lockWaiters.delete(key);
    }
  }

  private send(msg: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }`,
);

writeFileSync(path, Buffer.from(s, 'utf8'));
console.log({ ok: s.includes('acquireCellLock'), chinese: /协同连接失败/.test(s) });
