import { ref, computed, type Ref } from 'vue';
import type {
  CommitChangesResponse,
  MutationResult,
  SheetMutation,
} from 'shared';
import { api, ApiError, getToken } from '../api/client';
import { endpoints } from '../api/endpoints';
import {
  idbDeleteBlob,
  idbDeleteMutation,
  idbGetBlob,
  idbListMutations,
  idbPutMutation,
  type QueuedMutationRow,
} from './idb-store';

export type SyncStatus = 'online' | 'offline' | 'syncing' | 'conflict';

const CHANNEL = 'st-message-center';
const LOCK_NAME = 'st-message-center-flush';

function newId(): string {
  return crypto.randomUUID();
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
    await this.refreshCount();
    if (navigator.onLine) void this.flushAll();
  }

  onAccept(handler: (results: MutationResult[]) => void): () => void {
    this.acceptHandlers.add(handler);
    return () => this.acceptHandlers.delete(handler);
  }

  /**
   * prepareUserChange → pending → persist → schedule flush
   */
  async enqueue(
    sheetId: string,
    mutation: Omit<SheetMutation, 'clientOpId'> & { clientOpId?: string },
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
    await idbPutMutation(row);
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

  private async flushSheet(
    sheetId: string,
    rows: QueuedMutationRow[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const clientBatchId = newId();
    const mutations = await this.resolvePendingBlobs(
      sheetId,
      rows.map((r) => r.mutation as SheetMutation),
    );
    let response: CommitChangesResponse;
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
        return;
      }
      // network
      this.status.value = 'offline';
      this.lastError.value = '网络不可用，变更已保存在本地';
      return;
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
  if (s === 'offline') {
    return n > 0 ? `离线 · ${n} 条待同步` : '离线';
  }
  if (s === 'syncing') return `同步中…${n ? `（${n}）` : ''}`;
  if (s === 'conflict') return '同步冲突，请刷新后处理';
  if (n > 0) return `${n} 条待同步`;
  return '';
});

export function isAuthenticatedForSync(): boolean {
  return Boolean(getToken());
}
