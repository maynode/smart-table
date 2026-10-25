/** IndexedDB persistence for MessageCenter offline queue. */

const DB_NAME = 'smart-table-sync';
const DB_VERSION = 1;
const STORE_QUEUE = 'pending_mutations';
const STORE_BLOBS = 'attachment_blobs';
const STORE_MAPS = 'id_maps';

export interface QueuedMutationRow {
  clientOpId: string;
  sheetId: string;
  mutation: unknown;
  createdAt: number;
  status: 'pending' | 'flushing' | 'conflict';
}

function openDb(): Promise<IDBDatabase> {
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

export async function idbPutMutation(row: QueuedMutationRow): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_QUEUE, 'readwrite');
  tx.objectStore(STORE_QUEUE).put(row);
  await txDone(tx);
  db.close();
}

export async function idbDeleteMutation(clientOpId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_QUEUE, 'readwrite');
  tx.objectStore(STORE_QUEUE).delete(clientOpId);
  await txDone(tx);
  db.close();
}

export async function idbListMutations(
  sheetId?: string,
): Promise<QueuedMutationRow[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_QUEUE, 'readonly');
  const store = tx.objectStore(STORE_QUEUE);
  const req = sheetId
    ? store.index('sheetId').getAll(sheetId)
    : store.getAll();
  const rows = await new Promise<QueuedMutationRow[]>((resolve, reject) => {
    req.onsuccess = () => resolve((req.result as QueuedMutationRow[]) ?? []);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function idbPutBlob(
  id: string,
  blob: Blob,
  meta: { fileName: string; contentType: string; sheetId: string },
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_BLOBS, 'readwrite');
  tx.objectStore(STORE_BLOBS).put({ id, blob, ...meta, createdAt: Date.now() });
  await txDone(tx);
  db.close();
}

export async function idbGetBlob(
  id: string,
): Promise<{ blob: Blob; fileName: string; contentType: string; sheetId: string } | null> {
  const db = await openDb();
  const tx = db.transaction(STORE_BLOBS, 'readonly');
  const req = tx.objectStore(STORE_BLOBS).get(id);
  const row = await new Promise<Record<string, unknown> | undefined>(
    (resolve, reject) => {
      req.onsuccess = () => resolve(req.result as Record<string, unknown>);
      req.onerror = () => reject(req.error);
    },
  );
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

export async function idbDeleteBlob(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_BLOBS, 'readwrite');
  tx.objectStore(STORE_BLOBS).delete(id);
  await txDone(tx);
  db.close();
}

export async function idbSetMap(key: string, value: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_MAPS, 'readwrite');
  tx.objectStore(STORE_MAPS).put({ key, value });
  await txDone(tx);
  db.close();
}

export async function idbGetMap(key: string): Promise<string | null> {
  const db = await openDb();
  const tx = db.transaction(STORE_MAPS, 'readonly');
  const req = tx.objectStore(STORE_MAPS).get(key);
  const row = await new Promise<{ value?: string } | undefined>(
    (resolve, reject) => {
      req.onsuccess = () => resolve(req.result as { value?: string });
      req.onerror = () => reject(req.error);
    },
  );
  await txDone(tx);
  db.close();
  return row?.value ?? null;
}
