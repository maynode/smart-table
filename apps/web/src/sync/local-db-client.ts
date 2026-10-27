/**
 * Main-thread facade: prefers Dedicated Worker; falls back to same-thread backend.
 */

import { isProxy, toRaw } from 'vue';
import * as backend from './local-db-backend';
import type { LocalDbRequest, LocalDbResponse, ChunkPayload } from './local-db-protocol';
import type { QueuedMutationRow } from './queued-mutation';
import { chunkKey, splitIntoLocalBlocks } from './chunk-math';

/** Vue reactive proxies are not structured-cloneable for Worker.postMessage. */
function unwrapForWorker(value: unknown): unknown {
  if (value instanceof Blob || value instanceof ArrayBuffer || value instanceof Uint8Array) {
    return value;
  }
  const raw = isProxy(value) ? toRaw(value) : value;
  if (Array.isArray(raw)) return raw.map(unwrapForWorker);
  if (raw && typeof raw === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
      out[key] = unwrapForWorker(entry);
    }
    return out;
  }
  return raw;
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
let useWorker = typeof Worker !== 'undefined';

function ensureWorker(): Worker | null {
  if (!useWorker) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./local-db.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (ev: MessageEvent<LocalDbResponse>) => {
      const msg = ev.data;
      const slot = pending.get(msg.id);
      if (!slot) return;
      pending.delete(msg.id);
      if (msg.ok) slot.resolve(msg.result);
      else slot.reject(new Error(msg.error));
    };
    worker.onerror = () => {
      useWorker = false;
      worker = null;
      for (const [id, slot] of pending) {
        pending.delete(id);
        slot.reject(new Error('local-db worker failed'));
      }
    };
    return worker;
  } catch {
    useWorker = false;
    return null;
  }
}

type LocalDbRequestBody = {
  [K in LocalDbRequest['op']]: Omit<
    Extract<LocalDbRequest, { op: K }>,
    'id'
  >;
}[LocalDbRequest['op']];

async function call(req: LocalDbRequestBody): Promise<unknown> {
  const id = nextId++;
  const full = { ...req, id } as LocalDbRequest;
  const w = ensureWorker();
  if (!w) {
    return dispatchLocal(full);
  }
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      w.postMessage(unwrapForWorker(full));
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function dispatchLocal(req: LocalDbRequest): Promise<unknown> {
  switch (req.op) {
    case 'putMutation':
      await backend.putMutation(req.row);
      return undefined;
    case 'deleteMutation':
      await backend.deleteMutation(req.clientOpId);
      return undefined;
    case 'listMutations':
      return backend.listMutations(req.sheetId);
    case 'putBlob':
      await backend.putBlob(req.row);
      return undefined;
    case 'getBlob':
      return backend.getBlob(req.blobId);
    case 'deleteBlob':
      await backend.deleteBlob(req.blobId);
      return undefined;
    case 'setMap':
      await backend.setMap(req.key, req.value);
      return undefined;
    case 'getMap':
      return backend.getMap(req.key);
    case 'putChunks':
      await backend.putChunks(req.chunks);
      return undefined;
    case 'getChunk':
      return backend.getChunk(req.key);
    case 'getChunksCovering':
      return backend.getChunksCovering(req);
    case 'patchRecordInChunks':
      return backend.patchRecordInChunks(req);
    case 'enqueueAndPatch':
      await backend.enqueueAndPatch(req);
      return undefined;
    case 'putShellMeta':
      await backend.putShellMeta(req.key, req.value);
      return undefined;
    case 'getShellMeta':
      return backend.getShellMeta(req.key);
    case 'putObjectCache':
      await backend.putObjectCache(req.key, req.kind, req.value);
      return undefined;
    case 'getObjectCache':
      return backend.getObjectCache(req.key);
    case 'invalidateSheet':
      await backend.invalidateSheet(req.sheetId, req.queryFp);
      return undefined;
    case 'evictIfNeeded':
      return backend.evictIfNeeded(req.maxChunks);
    default:
      throw new Error('unknown op');
  }
}

const persistQueue: Array<{
  chunks: Parameters<typeof backend.putChunks>[0];
}> = [];
let persistScheduled = false;

function schedulePersist(): void {
  if (persistScheduled) return;
  persistScheduled = true;
  const run = () => {
    persistScheduled = false;
    const batch = persistQueue.splice(0, persistQueue.length);
    if (batch.length === 0) return;
    const merged = new Map<string, (typeof batch)[0]['chunks'][number]>();
    for (const item of batch) {
      for (const chunk of item.chunks) merged.set(chunk.key, chunk);
    }
    void call({
      op: 'putChunks',
      chunks: [...merged.values()],
    }).then(() => call({ op: 'evictIfNeeded' }));
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 500 });
  } else {
    setTimeout(run, 0);
  }
}

export const localDb = {
  putMutation(row: QueuedMutationRow): Promise<void> {
    return call({ op: 'putMutation', row }) as Promise<void>;
  },
  deleteMutation(clientOpId: string): Promise<void> {
    return call({ op: 'deleteMutation', clientOpId }) as Promise<void>;
  },
  listMutations(sheetId?: string): Promise<QueuedMutationRow[]> {
    return call({ op: 'listMutations', sheetId }) as Promise<
      QueuedMutationRow[]
    >;
  },
  putBlob(row: {
    id: string;
    blob: Blob;
    fileName: string;
    contentType: string;
    sheetId: string;
  }): Promise<void> {
    return call({ op: 'putBlob', row }) as Promise<void>;
  },
  getBlob(blobId: string) {
    return call({ op: 'getBlob', blobId }) as ReturnType<typeof backend.getBlob>;
  },
  deleteBlob(blobId: string): Promise<void> {
    return call({ op: 'deleteBlob', blobId }) as Promise<void>;
  },
  setMap(key: string, value: string): Promise<void> {
    return call({ op: 'setMap', key, value }) as Promise<void>;
  },
  getMap(key: string): Promise<string | null> {
    return call({ op: 'getMap', key }) as Promise<string | null>;
  },
  /** Non-blocking coalesce write for network windows. */
  persistWindowAsync(input: {
    sheetId: string;
    queryFp: string;
    networkOffset: number;
    records: unknown[];
    total: number;
    sheetRev: number | null;
    fieldCount: number;
  }): void {
    const blocks = splitIntoLocalBlocks({
      records: input.records,
      networkOffset: input.networkOffset,
      fieldCount: input.fieldCount,
    });
    const chunks = blocks.map((b) => ({
      key: chunkKey(input.sheetId, input.queryFp, b.blockStartRow),
      sheetId: input.sheetId,
      queryFp: input.queryFp,
      blockStartRow: b.blockStartRow,
      total: input.total,
      sheetRev: input.sheetRev,
      records: b.records,
      fieldCount: input.fieldCount,
    }));
    persistQueue.push({ chunks });
    schedulePersist();
  },
  getChunk(key: string): Promise<ChunkPayload | null> {
    return call({ op: 'getChunk', key }) as Promise<ChunkPayload | null>;
  },
  getChunksCovering(input: {
    sheetId: string;
    queryFp: string;
    startRow: number;
    endRow: number;
    fieldCount: number;
  }): Promise<ChunkPayload[]> {
    return call({ op: 'getChunksCovering', ...input }) as Promise<
      ChunkPayload[]
    >;
  },
  patchRecordInChunks(input: {
    sheetId: string;
    queryFp: string;
    recordId: string;
    cells: Record<string, unknown>;
    version?: number;
  }): Promise<boolean> {
    return call({ op: 'patchRecordInChunks', ...input }) as Promise<boolean>;
  },
  enqueueAndPatch(input: {
    row: QueuedMutationRow;
    sheetId: string;
    queryFp: string;
    recordId: string;
    cells: Record<string, unknown>;
    version?: number;
  }): Promise<void> {
    return call({ op: 'enqueueAndPatch', ...input }) as Promise<void>;
  },
  putShellMeta(key: string, value: unknown): Promise<void> {
    return call({ op: 'putShellMeta', key, value }) as Promise<void>;
  },
  getShellMeta(key: string): Promise<unknown | null> {
    return call({ op: 'getShellMeta', key }) as Promise<unknown | null>;
  },
  putObjectCache(key: string, kind: string, value: unknown): Promise<void> {
    return call({ op: 'putObjectCache', key, kind, value }) as Promise<void>;
  },
  getObjectCache(key: string): Promise<unknown | null> {
    return call({ op: 'getObjectCache', key }) as Promise<unknown | null>;
  },
  invalidateSheet(sheetId: string, queryFp?: string): Promise<void> {
    return call({ op: 'invalidateSheet', sheetId, queryFp }) as Promise<void>;
  },
};
