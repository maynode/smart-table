/**
 * IndexedDB backend for offline queue + chunk/object cache.
 * Used by the Sync Worker (and main-thread fallback when Worker unavailable).
 */

import { zlibSync, unzlibSync } from 'fflate';
import {
  chunkKey,
  crc32,
  localBlockRows,
} from './chunk-math';
import type { ChunkPayload } from './local-db-protocol';
import type { QueuedMutationRow } from './queued-mutation';

export const DB_NAME = 'smart-table-sync';
export const DB_VERSION = 2;

const STORE_QUEUE = 'pending_mutations';
const STORE_BLOBS = 'attachment_blobs';
const STORE_MAPS = 'id_maps';
const STORE_CHUNKS = 'record_chunks';
const STORE_SHELL = 'shell_meta';
const STORE_OBJECTS = 'object_cache';

const DEFAULT_MAX_CHUNKS = 200;

export function openLocalDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error('IDB open failed'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        const store = db.createObjectStore(STORE_QUEUE, {
          keyPath: 'clientOpId',
        });
        store.createIndex('sheetId', 'sheetId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_MAPS)) {
        db.createObjectStore(STORE_MAPS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        const chunks = db.createObjectStore(STORE_CHUNKS, { keyPath: 'key' });
        chunks.createIndex('sheetId', 'sheetId', { unique: false });
        chunks.createIndex('queryFp', 'queryFp', { unique: false });
        chunks.createIndex('lastAccessAt', 'lastAccessAt', { unique: false });
        chunks.createIndex('sheetQuery', ['sheetId', 'queryFp'], {
          unique: false,
        });
      }
      if (!db.objectStoreNames.contains(STORE_SHELL)) {
        db.createObjectStore(STORE_SHELL, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_OBJECTS)) {
        const objects = db.createObjectStore(STORE_OBJECTS, { keyPath: 'key' });
        objects.createIndex('kind', 'kind', { unique: false });
      }
    };
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IDB tx failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IDB tx aborted'));
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function encodeRecords(records: unknown[]): {
  body: Uint8Array;
  checksum: number;
} {
  const json = new TextEncoder().encode(JSON.stringify(records));
  const body = zlibSync(json, { level: 6 });
  return { body, checksum: crc32(body) };
}

function asBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new Uint8Array();
}

function decodeRecords(
  bodyIn: unknown,
  checksum: number,
): unknown[] | null {
  const body = asBytes(bodyIn);
  if (body.byteLength === 0 || crc32(body) !== checksum) return null;
  try {
    const json = unzlibSync(body);
    return JSON.parse(new TextDecoder().decode(json)) as unknown[];
  } catch {
    return null;
  }
}

export async function putMutation(row: QueuedMutationRow): Promise<void> {
  const db = await openLocalDb();
  const tx = db.transaction(STORE_QUEUE, 'readwrite');
  tx.objectStore(STORE_QUEUE).put(row);
  await txDone(tx);
  db.close();
}

export async function deleteMutation(clientOpId: string): Promise<void> {
  const db = await openLocalDb();
  const tx = db.transaction(STORE_QUEUE, 'readwrite');
  tx.objectStore(STORE_QUEUE).delete(clientOpId);
  await txDone(tx);
  db.close();
}

export async function listMutations(
  sheetId?: string,
): Promise<QueuedMutationRow[]> {
  const db = await openLocalDb();
  const tx = db.transaction(STORE_QUEUE, 'readonly');
  const store = tx.objectStore(STORE_QUEUE);
  const rows = (await reqToPromise(
    sheetId
      ? store.index('sheetId').getAll(sheetId)
      : store.getAll(),
  )) as QueuedMutationRow[];
  await txDone(tx);
  db.close();
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function putBlob(row: {
  id: string;
  blob: Blob;
  fileName: string;
  contentType: string;
  sheetId: string;
}): Promise<void> {
  const db = await openLocalDb();
  const tx = db.transaction(STORE_BLOBS, 'readwrite');
  tx.objectStore(STORE_BLOBS).put({ ...row, createdAt: Date.now() });
  await txDone(tx);
  db.close();
}

export async function getBlob(blobId: string): Promise<{
  blob: Blob;
  fileName: string;
  contentType: string;
  sheetId: string;
} | null> {
  const db = await openLocalDb();
  const tx = db.transaction(STORE_BLOBS, 'readonly');
  const row = (await reqToPromise(
    tx.objectStore(STORE_BLOBS).get(blobId),
  )) as Record<string, unknown> | undefined;
  await txDone(tx);
  db.close();
  if (!row?.blob) return null;
  return {
    blob: row.blob as Blob,
    fileName: String(row.fileName ?? 'file'),
    contentType: String(row.contentType ?? 'application/octet-stream'),
    sheetId: String(row.sheetId ?? ''),
  };
}

export async function deleteBlob(blobId: string): Promise<void> {
  const db = await openLocalDb();
  const tx = db.transaction(STORE_BLOBS, 'readwrite');
  tx.objectStore(STORE_BLOBS).delete(blobId);
  await txDone(tx);
  db.close();
}

export async function setMap(key: string, value: string): Promise<void> {
  const db = await openLocalDb();
  const tx = db.transaction(STORE_MAPS, 'readwrite');
  tx.objectStore(STORE_MAPS).put({ key, value });
  await txDone(tx);
  db.close();
}

export async function getMap(key: string): Promise<string | null> {
  const db = await openLocalDb();
  const tx = db.transaction(STORE_MAPS, 'readonly');
  const row = (await reqToPromise(tx.objectStore(STORE_MAPS).get(key))) as
    | { value?: string }
    | undefined;
  await txDone(tx);
  db.close();
  return row?.value ?? null;
}

export async function putChunks(
  chunks: Array<{
    key: string;
    sheetId: string;
    queryFp: string;
    blockStartRow: number;
    total: number;
    sheetRev: number | null;
    records: unknown[];
    fieldCount: number;
  }>,
): Promise<void> {
  if (chunks.length === 0) return;
  const db = await openLocalDb();
  const tx = db.transaction(STORE_CHUNKS, 'readwrite');
  const store = tx.objectStore(STORE_CHUNKS);
  const now = Date.now();
  for (const chunk of chunks) {
    const { body, checksum } = encodeRecords(chunk.records);
    store.put({
      key: chunk.key,
      sheetId: chunk.sheetId,
      queryFp: chunk.queryFp,
      blockStartRow: chunk.blockStartRow,
      total: chunk.total,
      sheetRev: chunk.sheetRev,
      fieldCount: chunk.fieldCount,
      body,
      checksum,
      fetchedAt: now,
      lastAccessAt: now,
      byteLength: body.byteLength,
    });
  }
  await txDone(tx);
  db.close();
}

export async function getChunk(key: string): Promise<ChunkPayload | null> {
  const db = await openLocalDb();
  const tx = db.transaction(STORE_CHUNKS, 'readwrite');
  const store = tx.objectStore(STORE_CHUNKS);
  const row = (await reqToPromise(store.get(key))) as
    | Record<string, unknown>
    | undefined;
  if (!row?.body) {
    await txDone(tx);
    db.close();
    return null;
  }
  const body = row.body as Uint8Array;
  const checksum = Number(row.checksum ?? 0);
  const records = decodeRecords(body, checksum);
  if (!records) {
    store.delete(key);
    await txDone(tx);
    db.close();
    return null;
  }
  store.put({ ...row, lastAccessAt: Date.now() });
  await txDone(tx);
  db.close();
  return {
    key: String(row.key),
    sheetId: String(row.sheetId),
    queryFp: String(row.queryFp),
    blockStartRow: Number(row.blockStartRow),
    total: Number(row.total ?? 0),
    sheetRev: (row.sheetRev as number | null) ?? null,
    records,
    fieldCount: Number(row.fieldCount ?? 1),
    fetchedAt: Number(row.fetchedAt ?? 0),
    lastAccessAt: Date.now(),
    checksum,
  };
}

export async function getChunksCovering(input: {
  sheetId: string;
  queryFp: string;
  startRow: number;
  endRow: number;
  fieldCount: number;
}): Promise<ChunkPayload[]> {
  const size = localBlockRows(input.fieldCount);
  const start = Math.floor(Math.max(0, input.startRow) / size) * size;
  const end = Math.max(start, input.endRow);
  const keys: string[] = [];
  for (let row = start; row <= end; row += size) {
    keys.push(chunkKey(input.sheetId, input.queryFp, row));
  }
  const out: ChunkPayload[] = [];
  for (const key of keys) {
    const chunk = await getChunk(key);
    if (chunk) out.push(chunk);
  }
  return out;
}

export async function patchRecordInChunks(input: {
  sheetId: string;
  queryFp: string;
  recordId: string;
  cells: Record<string, unknown>;
  version?: number;
}): Promise<boolean> {
  const db = await openLocalDb();
  const tx = db.transaction(STORE_CHUNKS, 'readwrite');
  const store = tx.objectStore(STORE_CHUNKS);
  const index = store.index('sheetQuery');
  const rows = (await reqToPromise(
    index.getAll([input.sheetId, input.queryFp]),
  )) as Array<Record<string, unknown>>;
  let patched = false;
  for (const row of rows) {
    const body = row.body as Uint8Array;
    const checksum = Number(row.checksum ?? 0);
    const records = decodeRecords(body, checksum);
    if (!records) {
      store.delete(String(row.key));
      continue;
    }
    const idx = records.findIndex(
      (r) =>
        r &&
        typeof r === 'object' &&
        (r as { id?: string }).id === input.recordId,
    );
    if (idx < 0) continue;
    const prev = records[idx] as {
      id: string;
      cells?: Record<string, unknown>;
      version?: number;
    };
    records[idx] = {
      ...prev,
      cells: { ...(prev.cells ?? {}), ...input.cells },
      version: input.version ?? prev.version,
    };
    const encoded = encodeRecords(records);
    store.put({
      ...row,
      body: encoded.body,
      checksum: encoded.checksum,
      byteLength: encoded.body.byteLength,
      lastAccessAt: Date.now(),
    });
    patched = true;
  }
  await txDone(tx);
  db.close();
  return patched;
}

/** Same IDB transaction: enqueue mutation + patch record cells in chunks. */
export async function enqueueAndPatch(input: {
  row: QueuedMutationRow;
  sheetId: string;
  queryFp: string;
  recordId: string;
  cells: Record<string, unknown>;
  version?: number;
}): Promise<void> {
  const db = await openLocalDb();
  const tx = db.transaction([STORE_QUEUE, STORE_CHUNKS], 'readwrite');
  tx.objectStore(STORE_QUEUE).put(input.row);
  const store = tx.objectStore(STORE_CHUNKS);
  const index = store.index('sheetQuery');
  const rows = (await reqToPromise(
    index.getAll([input.sheetId, input.queryFp]),
  )) as Array<Record<string, unknown>>;
  for (const row of rows) {
    const body = row.body as Uint8Array;
    const checksum = Number(row.checksum ?? 0);
    const records = decodeRecords(body, checksum);
    if (!records) {
      store.delete(String(row.key));
      continue;
    }
    const idx = records.findIndex(
      (r) =>
        r &&
        typeof r === 'object' &&
        (r as { id?: string }).id === input.recordId,
    );
    if (idx < 0) continue;
    const prev = records[idx] as {
      id: string;
      cells?: Record<string, unknown>;
      version?: number;
    };
    records[idx] = {
      ...prev,
      cells: { ...(prev.cells ?? {}), ...input.cells },
      version: input.version ?? prev.version,
    };
    const encoded = encodeRecords(records);
    store.put({
      ...row,
      body: encoded.body,
      checksum: encoded.checksum,
      byteLength: encoded.body.byteLength,
      lastAccessAt: Date.now(),
    });
  }
  await txDone(tx);
  db.close();
}

export async function putShellMeta(key: string, value: unknown): Promise<void> {
  const db = await openLocalDb();
  const tx = db.transaction(STORE_SHELL, 'readwrite');
  tx.objectStore(STORE_SHELL).put({ key, value, updatedAt: Date.now() });
  await txDone(tx);
  db.close();
}

export async function getShellMeta(key: string): Promise<unknown | null> {
  const db = await openLocalDb();
  const tx = db.transaction(STORE_SHELL, 'readonly');
  const row = (await reqToPromise(tx.objectStore(STORE_SHELL).get(key))) as
    | { value?: unknown }
    | undefined;
  await txDone(tx);
  db.close();
  return row?.value ?? null;
}

export async function putObjectCache(
  key: string,
  kind: string,
  value: unknown,
): Promise<void> {
  const db = await openLocalDb();
  const tx = db.transaction(STORE_OBJECTS, 'readwrite');
  tx.objectStore(STORE_OBJECTS).put({
    key,
    kind,
    value,
    updatedAt: Date.now(),
  });
  await txDone(tx);
  db.close();
}

export async function getObjectCache(key: string): Promise<unknown | null> {
  const db = await openLocalDb();
  const tx = db.transaction(STORE_OBJECTS, 'readonly');
  const row = (await reqToPromise(tx.objectStore(STORE_OBJECTS).get(key))) as
    | { value?: unknown }
    | undefined;
  await txDone(tx);
  db.close();
  return row?.value ?? null;
}

export async function invalidateSheet(
  sheetId: string,
  queryFp?: string,
): Promise<void> {
  const db = await openLocalDb();
  const tx = db.transaction(STORE_CHUNKS, 'readwrite');
  const store = tx.objectStore(STORE_CHUNKS);
  const rows = queryFp
    ? ((await reqToPromise(
        store.index('sheetQuery').getAll([sheetId, queryFp]),
      )) as Array<{ key: string }>)
    : ((await reqToPromise(store.index('sheetId').getAll(sheetId))) as Array<{
        key: string;
      }>);
  for (const row of rows) store.delete(row.key);
  await txDone(tx);
  db.close();
}

export async function evictIfNeeded(
  maxChunks = DEFAULT_MAX_CHUNKS,
): Promise<number> {
  const db = await openLocalDb();
  const tx = db.transaction(STORE_CHUNKS, 'readwrite');
  const store = tx.objectStore(STORE_CHUNKS);
  const all = (await reqToPromise(store.getAll())) as Array<{
    key: string;
    lastAccessAt?: number;
  }>;
  if (all.length <= maxChunks) {
    await txDone(tx);
    db.close();
    return 0;
  }
  const ranked = [...all].sort(
    (a, b) => (a.lastAccessAt ?? 0) - (b.lastAccessAt ?? 0),
  );
  const drop = ranked.slice(0, all.length - maxChunks);
  for (const row of drop) store.delete(row.key);
  await txDone(tx);
  db.close();
  return drop.length;
}
