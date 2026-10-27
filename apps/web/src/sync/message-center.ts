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
/** 半死 WS 时尽快降级 HTTP；超时后先重试一次再短窗走 HTTP */
const WS_ACCEPT_TIMEOUT_MS = 2_000;
const PREFER_HTTP_MS = 8_000;

function humanSyncError(raw: string | null | undefined): string {
  const msg = (raw ?? '').trim();
  if (!msg) return '';
  if (
    msg.includes('COMMIT_BASE_VER_TOO_LOW') ||
    msg.includes('COMMIT_VERSION_CONFLICT') ||
    msg.includes('VERSION_CONFLICT')
  ) {
    return '内容已被他人更新，已尝试合并，请点重试';
  }
  if (msg.includes('WS accept timeout') || msg.includes('WS commit rejected')) {
    return '实时同步暂时不可用，已改用备用通道';
  }
  if (msg.startsWith('COMMIT_')) return '同步失败，请稍后重试';
  return msg;
}

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
      onError: (payload) => {
        const reason =
          payload.message || payload.code || 'WS commit rejected';
        // Fail open waiters so flush can rebase / fall back to HTTP
        for (const [batchId, waiter] of this.wsWaiters) {
          clearTimeout(waiter.timer);
          this.wsWaiters.delete(batchId);
          waiter.reject(new Error(reason));
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

  private waitWsAccept(
    clientBatchId: string,
  ): Promise<CommitChangesResponse> {
    return new Promise<CommitChangesResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.wsWaiters.delete(clientBatchId);
        reject(new Error('WS accept timeout'));
      }, WS_ACCEPT_TIMEOUT_MS);
      this.wsWaiters.set(clientBatchId, { resolve, reject, timer });
    });
  }

  private async flushViaWs(
    sheetId: string,
    clientBatchId: string,
    mutations: SheetMutation[],
  ): Promise<CommitChangesResponse | null> {
    if (Date.now() < this.preferHttpUntil) return null;
    if (!collabSocket.connected.value) return null;
    if (this.activeSheetId !== sheetId) return null;

    const attempt = async (): Promise<CommitChangesResponse | null> => {
      const sent = collabSocket.sendUserChanges(
        collabSocket.sheetRev.value,
        clientBatchId,
        mutations,
      );
      if (!sent) return null;
      return this.waitWsAccept(clientBatchId);
    };

    try {
      return await attempt();
    } catch (first) {
      const msg = first instanceof Error ? first.message : String(first);
      // 版本冲突：等远端 changes 入本地后再由调用方 rebase；此处不立刻熔断
      if (
        msg.includes('COMMIT_BASE_VER_TOO_LOW') ||
        msg.includes('VERSION_CONFLICT')
      ) {
        throw first instanceof Error ? first : new Error(msg);
      }
      // 超时/拒收：同连接再试一次，仍失败才短窗 preferHttp（不抖连）
      if (!collabSocket.connected.value || this.activeSheetId !== sheetId) {
        throw first instanceof Error ? first : new Error(msg);
      }
      try {
        return await attempt();
      } catch (second) {
        this.preferHttpUntil = Date.now() + PREFER_HTTP_MS;
        throw second instanceof Error ? second : new Error(String(second));
      }
    }
  }

  /** Rebase local pending against peer mutations already applied to sheetRev. */
  private rebaseMutations(
    mutations: SheetMutation[],
    peers: SheetMutation[],
  ): SheetMutation[] | null {
    if (!peers.length) return mutations;
    const out: SheetMutation[] = [];
    for (const local of mutations) {
      const next = collabSocket.transformPending(local, peers);
      if (!next) return null;
      if (next.type === 'setRecord') {
        out.push({
          ...next,
          baseVersion: undefined,
        });
      } else {
        out.push(next);
      }
    }
    return out;
  }

  /**
   * Merge multiple setRecord ops on the same row into one mutation so a single
   * batch does not trip baseVersion conflicts (second op still sees old version).
   */
  private coalesceMutations(mutations: SheetMutation[]): {
    mutations: SheetMutation[];
    /** result index → original mutation indexes (for queue bookkeeping) */
    groups: number[][];
  } {
    const mutationsOut: SheetMutation[] = [];
    const groups: number[][] = [];
    const setRecordGroup = new Map<string, number>();
    for (let i = 0; i < mutations.length; i += 1) {
      const mutation = mutations[i]!;
      if (mutation.type !== 'setRecord') {
        groups.push([i]);
        mutationsOut.push(mutation);
        continue;
      }
      const existing = setRecordGroup.get(mutation.recordId);
      if (existing === undefined) {
        setRecordGroup.set(mutation.recordId, mutationsOut.length);
        groups.push([i]);
        mutationsOut.push({ ...mutation, cells: { ...mutation.cells } });
        continue;
      }
      const merged = mutationsOut[existing]!;
      if (merged.type !== 'setRecord') continue;
      mutationsOut[existing] = {
        ...merged,
        cells: { ...merged.cells, ...mutation.cells },
        // Keep the earliest baseVersion — it matches pre-batch server state.
        baseVersion: merged.baseVersion ?? mutation.baseVersion,
        clientOpId: mutation.clientOpId,
      };
      groups[existing]!.push(i);
    }
    return { mutations: mutationsOut, groups };
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
    let coalesced = this.coalesceMutations(mutations);
    mutations = coalesced.mutations;
    let response: CommitChangesResponse | null = null;
    let wsConflictPeers: SheetMutation[] = [];
    let usedBatchId = clientBatchId;

    const tryWs = async (batchId: string, muts: SheetMutation[]) => {
      try {
        return await this.flushViaWs(sheetId, batchId, muts);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (
          msg.includes('COMMIT_BASE_VER_TOO_LOW') ||
          msg.includes('VERSION_CONFLICT')
        ) {
          // 服务端已推 changes；稍等 onRemote 应用后再 rebase
          await new Promise((r) => setTimeout(r, 80));
          throw error;
        }
        return null;
      }
    };

    try {
      response = await tryWs(clientBatchId, mutations);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.lastError.value = humanSyncError(msg) || msg;
      // 收集近期远端（transform 用 sheetRev 路径上的 mutations 由 collab 侧 last peers）
      wsConflictPeers = collabSocket.drainRecentPeerMutations();
      const rebased = this.rebaseMutations(mutations, wsConflictPeers);
      if (rebased) {
        mutations = rebased;
        coalesced = this.coalesceMutations(mutations);
        mutations = coalesced.mutations;
        const retryBatchId = newId();
        try {
          response = await tryWs(retryBatchId, mutations);
          if (response) usedBatchId = retryBatchId;
        } catch {
          response = null;
        }
      }
    }

    if (!response) {
      try {
        response = await api<CommitChangesResponse>(
          `/sheets/${sheetId}/commitchanges`,
          {
            method: 'POST',
            body: { clientBatchId: usedBatchId, mutations },
          },
        );
      } catch (error) {
        if (error instanceof ApiError) {
          this.lastError.value = humanSyncError(error.message) || error.message;
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
    let needsConflictRebase = false;
    for (let i = 0; i < response.results.length; i += 1) {
      const result = response.results[i];
      const group = coalesced.groups[i] ?? [];
      if (!result) continue;
      const groupRows = group
        .map((idx) => rows[idx])
        .filter((row): row is QueuedMutationRow => !!row);
      if (result.status === 'ok' || result.status === 'duplicate') {
        for (const row of groupRows) {
          await idbDeleteMutation(row.clientOpId);
        }
        accepted.push(result);
      } else if (result.status === 'error') {
        if (result.code === 'COMMIT_VERSION_CONFLICT') {
          needsConflictRebase = true;
          for (const row of groupRows) {
            conflicts.push(row.clientOpId);
            await idbPutMutation({ ...row, status: 'conflict' });
          }
          this.lastError.value =
            humanSyncError(result.message) ||
            '内容已被他人更新，已尝试合并，请点重试';
        } else if (
          result.code === 'COMMIT_NOT_FOUND' ||
          result.code === 'COMMIT_INVALID' ||
          result.code === 'COMMIT_FORBIDDEN'
        ) {
          for (const row of groupRows) {
            await idbDeleteMutation(row.clientOpId);
          }
          this.lastError.value =
            humanSyncError(result.message) || result.message;
        } else {
          this.lastError.value =
            humanSyncError(result.message) || result.message;
        }
      }
    }

    // 版本冲突：对 conflict 行做一次 OT rebase；成功则改回 pending 供重试
    let rebasedConflictIds: string[] = [];
    if (needsConflictRebase && conflicts.length) {
      const peerMuts =
        wsConflictPeers.length > 0
          ? wsConflictPeers
          : collabSocket.drainRecentPeerMutations();
      if (peerMuts.length) {
        const conflictRows = rows.filter((r) =>
          conflicts.includes(r.clientOpId),
        );
        for (const row of conflictRows) {
          const next = collabSocket.transformPending(
            row.mutation as SheetMutation,
            peerMuts,
          );
          if (!next) continue;
          await idbPutMutation({
            ...row,
            mutation: next,
            status: 'pending',
          });
          rebasedConflictIds.push(row.clientOpId);
        }
        if (rebasedConflictIds.length) {
          this.lastError.value =
            '内容已被他人更新，已尝试合并，请点重试';
        }
      }
    }

    const remainingConflicts = conflicts.filter(
      (id) => !rebasedConflictIds.includes(id),
    );
    if (remainingConflicts.length) {
      this.conflictOpIds.value = [
        ...new Set([...this.conflictOpIds.value, ...remainingConflicts]),
      ];
    } else if (rebasedConflictIds.length) {
      this.conflictOpIds.value = this.conflictOpIds.value.filter(
        (id) => !rebasedConflictIds.includes(id),
      );
    }
    if (accepted.length) {
      this.rememberBatch(usedBatchId);
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
  const err =
    humanSyncError(messageCenter.lastError.value) ||
    humanSyncError(collabSocket.lastError.value);
  if (s === 'offline') {
    return n > 0 ? `离线 · ${n} 条待同步` : '离线';
  }
  if (s === 'syncing') return `同步中…${n ? `（${n}）` : ''}`;
  if (s === 'conflict') {
    return err || '内容已被他人更新，已尝试合并，请点重试';
  }
  if (n > 0) {
    return err ? `${n} 条待同步：${err}` : `${n} 条待同步`;
  }
  if (err && collabSocket.lastError.value) {
    return err;
  }
  return '';
});

export function isAuthenticatedForSync(): boolean {
  return Boolean(getToken());
}
