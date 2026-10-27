import { ref, computed, type Ref } from 'vue';
import type {
  CommitChangesResponse,
  MutationResult,
  SheetMutation,
} from 'shared';
import { api, ApiError, getToken } from '../api/client';
import { endpoints } from '../api/endpoints';
import { newId } from '../ui/id';
import {
  idbDeleteBlob,
  idbDeleteMutation,
  idbGetBlob,
  idbListMutations,
  idbPutMutation,
  type QueuedMutationRow,
} from './idb-store';
import { localDb } from './local-db-client';
import { collabSocket } from './collab-socket';

export type EnqueueChunkContext = {
  queryFp: string;
  recordId: string;
  cells: Record<string, unknown>;
  version?: number;
};

export type SyncStatus = 'online' | 'offline' | 'syncing' | 'conflict';

const CHANNEL = 'st-message-center';
const LOCK_NAME = 'st-message-center-flush';
/** 半死 WS 时尽快降级 HTTP，避免每次改格空等数十秒 */
const WS_ACCEPT_TIMEOUT_MS = 4_000;

class MessageCenter {
  readonly status: Ref<SyncStatus> = ref(
    typeof navigator !== 'undefined' && navigator.onLine ? 'online' : 'offline',
  );
  readonly pendingCount: Ref<number> = ref(0);
  readonly lastError: Ref<string | null> = ref(null);
  readonly conflictOpIds: Ref<string[]> = ref([]);

  private channel: BroadcastChannel | null = null;
  private flushing = false;
  private acceptHandlers = new Set<(results: MutationResult[]) => void>();
  private bootstrapped = false;
  private wsWaiters = new Map<
    string,
    {
      resolve: (response: CommitChangesResponse) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private activeSheetId: string | null = null;
  /** 本端刚提交成功的 batch，用于忽略 HTTP 回退后广播回来的 new_changes（防重复行） */
  private recentBatchIds = new Set<string>();
  /** WS accept 超时后一段时间内跳过 WS，避免连续改格每次空等 */
  private preferHttpUntil = 0;

  async bootstrap(): Promise<void> {
    if (this.bootstrapped || typeof window === 'undefined') return;
    this.bootstrapped = true;
    (
      window as unknown as { __stMessageCenter?: MessageCenter }
    ).__stMessageCenter = this;
    this.channel = new BroadcastChannel(CHANNEL);
    this.channel.onmessage = (ev) => {
      if (ev.data?.type === 'flush-request') void this.flushAll();
      if (ev.data?.type === 'queue-changed') void this.refreshCount();
    };
    window.addEventListener('online', () => {
      this.status.value = 'online';
      void this.flushAll();
    });
    window.addEventListener('offline', () => {
      this.status.value = 'offline';
    });
    collabSocket.setHandlers({
      onAccept: (payload: {
        results: unknown[];
        newRev: number;
        clientBatchId?: string;
        mutations: SheetMutation[];
      }) => {
        const batchId =
          payload.clientBatchId ??
          [...this.wsWaiters.keys()][0];
        if (!batchId) return;
        const waiter = this.wsWaiters.get(batchId);
        if (!waiter) return;
        clearTimeout(waiter.timer);
        this.wsWaiters.delete(batchId);
        waiter.resolve({
          clientBatchId: batchId,
          results: (payload.results ?? []) as MutationResult[],
        });
      },
      onError: () => {
        // Fail open waiters so flush falls back to HTTP
        for (const [batchId, waiter] of this.wsWaiters) {
          clearTimeout(waiter.timer);
          this.wsWaiters.delete(batchId);
          waiter.reject(new Error('WS commit rejected'));
        }
      },
    });
    await this.refreshCount();
    if (navigator.onLine) void this.flushAll();
  }

  /** Bind collab socket to the active sheet (online path). */
  attachSheet(sheetId: string | null): void {
    this.activeSheetId = sheetId;
    if (!sheetId || !getToken()) {
      collabSocket.disconnect();
      return;
    }
    collabSocket.connect(sheetId);
  }

  onAccept(handler: (results: MutationResult[]) => void): () => void {
    this.acceptHandlers.add(handler);
    return () => this.acceptHandlers.delete(handler);
  }

  /** 是否应把远端 new_changes 应用到本地（跳过本端刚提交的同一批） */
  shouldApplyRemote(commitId?: string): boolean {
    if (!commitId) return true;
    return !this.recentBatchIds.has(commitId);
  }

  private rememberBatch(clientBatchId: string): void {
    this.recentBatchIds.add(clientBatchId);
    setTimeout(() => this.recentBatchIds.delete(clientBatchId), 60_000);
  }

  /**
   * prepareUserChange → pending → persist → schedule flush.
   * When chunkCtx is set, mutation + chunk patch share one IDB transaction.
   */
  async enqueue(
    sheetId: string,
    mutation: Omit<SheetMutation, 'clientOpId'> & { clientOpId?: string },
    chunkCtx?: EnqueueChunkContext,
  ): Promise<string> {
    await this.bootstrap();
    const clientOpId = mutation.clientOpId ?? newId();
    const full = { ...mutation, clientOpId } as SheetMutation;
    const row: QueuedMutationRow = {
      clientOpId,
      sheetId,
      mutation: full,
      createdAt: Date.now(),
      status: 'pending',
    };
    if (chunkCtx) {
      await localDb.enqueueAndPatch({
        row,
        sheetId,
        queryFp: chunkCtx.queryFp,
        recordId: chunkCtx.recordId,
        cells: chunkCtx.cells,
        version: chunkCtx.version,
      });
    } else {
      await idbPutMutation(row);
    }
    await this.refreshCount();
    this.channel?.postMessage({ type: 'queue-changed' });
    if (navigator.onLine) {
      void this.flushAll();
    } else {
      this.status.value = 'offline';
    }
    return clientOpId;
  }

  async flushAll(): Promise<void> {
    await this.bootstrap();
    if (!navigator.onLine) {
      this.status.value = 'offline';
      return;
    }
    if (this.flushing) return;

    const run = async () => {
      this.flushing = true;
      this.status.value = 'syncing';
      try {
        const rows = await idbListMutations();
        const bySheet = new Map<string, QueuedMutationRow[]>();
        for (const row of rows) {
          if (row.status === 'conflict') continue;
          const list = bySheet.get(row.sheetId) ?? [];
          list.push(row);
          bySheet.set(row.sheetId, list);
        }
        for (const [sheetId, list] of bySheet) {
          await this.flushSheet(sheetId, list);
        }
        await this.refreshCount();
        this.status.value = navigator.onLine
          ? this.conflictOpIds.value.length
            ? 'conflict'
            : 'online'
          : 'offline';
      } finally {
        this.flushing = false;
      }
    };

    if (typeof navigator !== 'undefined' && 'locks' in navigator) {
      await navigator.locks.request(LOCK_NAME, run);
    } else {
      await run();
    }
  }

  private async resolvePendingBlobs(
    sheetId: string,
    mutations: SheetMutation[],
  ): Promise<SheetMutation[]> {
    const out: SheetMutation[] = [];
    for (const mutation of mutations) {
      if (mutation.type !== 'setRecord' && mutation.type !== 'createAttachment') {
        out.push(mutation);
        continue;
      }
      if (mutation.type === 'createAttachment') {
        if (mutation.url.startsWith('pending-blob:')) {
          const blobId = mutation.url.slice('pending-blob:'.length);
          const stored = await idbGetBlob(blobId);
          if (!stored) continue;
          const uploaded = await endpoints.uploadAttachment(
            sheetId,
            new File([stored.blob], stored.fileName, {
              type: stored.contentType,
            }),
          );
          await idbDeleteBlob(blobId);
          out.push({ ...mutation, url: uploaded.url });
        } else {
          out.push(mutation);
        }
        continue;
      }
      const cells = { ...mutation.cells };
      for (const [fieldId, value] of Object.entries(cells)) {
        const rewrite = async (entry: Record<string, unknown>) => {
          const url = String(entry.url ?? '');
          if (!url.startsWith('pending-blob:')) return entry;
          const blobId = url.slice('pending-blob:'.length);
          const stored = await idbGetBlob(blobId);
          if (!stored) return entry;
          const uploaded = await endpoints.uploadAttachment(
            sheetId,
            new File([stored.blob], stored.fileName, {
              type: stored.contentType,
            }),
          );
          await idbDeleteBlob(blobId);
          return { ...entry, url: uploaded.url };
        };
        if (Array.isArray(value)) {
          cells[fieldId] = await Promise.all(
            value.map(async (item) =>
              item && typeof item === 'object'
                ? rewrite(item as Record<string, unknown>)
                : item,
            ),
          );
        } else if (value && typeof value === 'object') {
          cells[fieldId] = await rewrite(value as Record<string, unknown>);
        } else if (typeof value === 'string' && value.startsWith('pending-blob:')) {
          const blobId = value.slice('pending-blob:'.length);
          const stored = await idbGetBlob(blobId);
          if (stored) {
            const uploaded = await endpoints.uploadAttachment(
              sheetId,
              new File([stored.blob], stored.fileName, {
                type: stored.contentType,
              }),
            );
            await idbDeleteBlob(blobId);
            cells[fieldId] = uploaded.url;
          }
        }
      }
      out.push({ ...mutation, cells });
    }
    return out;
  }

  private async flushViaWs(
    sheetId: string,
    clientBatchId: string,
    mutations: SheetMutation[],
  ): Promise<CommitChangesResponse | null> {
    if (Date.now() < this.preferHttpUntil) return null;
    if (!collabSocket.connected.value) return null;
    if (this.activeSheetId !== sheetId) return null;
    const sent = collabSocket.sendUserChanges(
      collabSocket.sheetRev.value,
      clientBatchId,
      mutations,
    );
    if (!sent) return null;

    return new Promise<CommitChangesResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.wsWaiters.delete(clientBatchId);
        reject(new Error('WS accept timeout'));
      }, WS_ACCEPT_TIMEOUT_MS);
      this.wsWaiters.set(clientBatchId, { resolve, reject, timer });
    });
  }

  private async flushSheet(
    sheetId: string,
    rows: QueuedMutationRow[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const clientBatchId = newId();
    let mutations: SheetMutation[];
    try {
      mutations = await this.resolvePendingBlobs(
        sheetId,
        rows.map((r) => r.mutation as SheetMutation),
      );
    } catch (error) {
      // 附件上传阶段 401/403：同样丢弃，避免卡在「待同步」
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        this.lastError.value = error.message;
        for (const row of rows) {
          await idbDeleteMutation(row.clientOpId);
        }
        await this.refreshCount();
        return;
      }
      this.lastError.value =
        error instanceof Error ? error.message : '附件上传失败';
      return;
    }
    let response: CommitChangesResponse | null = null;
    try {
      response = await this.flushViaWs(sheetId, clientBatchId, mutations);
    } catch {
      // accept 超时/拒收：短期内只走 HTTP，并重连半死 WS
      this.preferHttpUntil = Date.now() + 60_000;
      if (this.activeSheetId === sheetId) {
        collabSocket.disconnect();
        collabSocket.connect(sheetId);
      }
      response = null;
    }
    if (!response) {
      try {
        response = await api<CommitChangesResponse>(
          `/sheets/${sheetId}/commitchanges`,
          {
            method: 'POST',
            body: { clientBatchId, mutations },
          },
        );
      } catch (error) {
        if (error instanceof ApiError) {
          this.lastError.value = error.message;
          // 无权/未登录：丢弃队列，避免只读账号永久「待同步」
          if (error.status === 401 || error.status === 403) {
            for (const row of rows) {
              await idbDeleteMutation(row.clientOpId);
            }
            await this.refreshCount();
          }
          return;
        }
        this.status.value = 'offline';
        this.lastError.value = '网络不可用，变更已保存在本地';
        return;
      }
    }

    const accepted: MutationResult[] = [];
    const conflicts: string[] = [];
    for (let i = 0; i < response.results.length; i += 1) {
      const result = response.results[i];
      const row = rows[i];
      if (!result || !row) continue;
      if (result.status === 'ok' || result.status === 'duplicate') {
        await idbDeleteMutation(row.clientOpId);
        accepted.push(result);
      } else if (result.status === 'error') {
        if (result.code === 'COMMIT_VERSION_CONFLICT') {
          conflicts.push(row.clientOpId);
          await idbPutMutation({ ...row, status: 'conflict' });
          this.lastError.value = result.message;
        } else if (
          result.code === 'COMMIT_NOT_FOUND' ||
          result.code === 'COMMIT_INVALID' ||
          result.code === 'COMMIT_FORBIDDEN'
        ) {
          await idbDeleteMutation(row.clientOpId);
          this.lastError.value = result.message;
        } else {
          this.lastError.value = result.message;
        }
      }
    }
    if (conflicts.length) {
      this.conflictOpIds.value = [
        ...new Set([...this.conflictOpIds.value, ...conflicts]),
      ];
    }
    if (accepted.length) {
      this.rememberBatch(clientBatchId);
      for (const handler of this.acceptHandlers) handler(accepted);
    }
    this.channel?.postMessage({ type: 'queue-changed' });
  }

  async refreshCount(): Promise<void> {
    const rows = await idbListMutations();
    this.pendingCount.value = rows.filter((r) => r.status !== 'conflict').length;
  }

  async dropConflict(clientOpId: string): Promise<void> {
    await idbDeleteMutation(clientOpId);
    this.conflictOpIds.value = this.conflictOpIds.value.filter(
      (id) => id !== clientOpId,
    );
    await this.refreshCount();
  }

  async retryConflicts(): Promise<void> {
    const rows = await idbListMutations();
    for (const row of rows) {
      if (row.status === 'conflict') {
        await idbPutMutation({ ...row, status: 'pending' });
      }
    }
    this.conflictOpIds.value = [];
    await this.flushAll();
  }
}

export const messageCenter = new MessageCenter();

export const syncBannerText = computed(() => {
  const s = messageCenter.status.value;
  const n = messageCenter.pendingCount.value;
  const err = messageCenter.lastError.value?.trim();
  if (s === 'offline') {
    return n > 0 ? `离线 · ${n} 条待同步` : '离线';
  }
  if (s === 'syncing') return `同步中…${n ? `（${n}）` : ''}`;
  if (s === 'conflict') {
    return err ? `同步冲突：${err}` : '同步冲突，请刷新后处理';
  }
  if (n > 0) {
    return err ? `${n} 条待同步：${err}` : `${n} 条待同步`;
  }
  return '';
});

export function isAuthenticatedForSync(): boolean {
  return Boolean(getToken());
}
