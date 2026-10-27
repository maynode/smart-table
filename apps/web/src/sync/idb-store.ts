/** IndexedDB persistence for MessageCenter — routed via local-db Worker. */

export type { QueuedMutationRow } from './queued-mutation';
import type { QueuedMutationRow } from './queued-mutation';
import { localDb } from './local-db-client';

export async function idbPutMutation(row: QueuedMutationRow): Promise<void> {
  await localDb.putMutation(row);
}

export async function idbDeleteMutation(clientOpId: string): Promise<void> {
  await localDb.deleteMutation(clientOpId);
}

export async function idbListMutations(
  sheetId?: string,
): Promise<QueuedMutationRow[]> {
  return localDb.listMutations(sheetId);
}

export async function idbPutBlob(
  id: string,
  blob: Blob,
  meta: { fileName: string; contentType: string; sheetId: string },
): Promise<void> {
  await localDb.putBlob({ id, blob, ...meta });
}

export async function idbGetBlob(
  id: string,
): Promise<{
  blob: Blob;
  fileName: string;
  contentType: string;
  sheetId: string;
} | null> {
  return localDb.getBlob(id);
}

export async function idbDeleteBlob(id: string): Promise<void> {
  await localDb.deleteBlob(id);
}

export async function idbSetMap(key: string, value: string): Promise<void> {
  await localDb.setMap(key, value);
}

export async function idbGetMap(key: string): Promise<string | null> {
  return localDb.getMap(key);
}
