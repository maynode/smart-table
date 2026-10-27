/** RPC protocol between main thread and local-db worker. */

import type { QueuedMutationRow } from './queued-mutation';

export type LocalDbRequest =
  | { id: number; op: 'putMutation'; row: QueuedMutationRow }
  | { id: number; op: 'deleteMutation'; clientOpId: string }
  | { id: number; op: 'listMutations'; sheetId?: string }
  | {
      id: number;
      op: 'putBlob';
      row: {
        id: string;
        blob: Blob;
        fileName: string;
        contentType: string;
        sheetId: string;
      };
    }
  | { id: number; op: 'getBlob'; blobId: string }
  | { id: number; op: 'deleteBlob'; blobId: string }
  | { id: number; op: 'setMap'; key: string; value: string }
  | { id: number; op: 'getMap'; key: string }
  | {
      id: number;
      op: 'putChunks';
      chunks: Array<{
        key: string;
        sheetId: string;
        queryFp: string;
        blockStartRow: number;
        total: number;
        sheetRev: number | null;
        records: unknown[];
        fieldCount: number;
      }>;
    }
  | {
      id: number;
      op: 'getChunk';
      key: string;
    }
  | {
      id: number;
      op: 'getChunksCovering';
      sheetId: string;
      queryFp: string;
      startRow: number;
      endRow: number;
      fieldCount: number;
    }
  | {
      id: number;
      op: 'patchRecordInChunks';
      sheetId: string;
      queryFp: string;
      recordId: string;
      cells: Record<string, unknown>;
      version?: number;
    }
  | {
      id: number;
      op: 'enqueueAndPatch';
      row: QueuedMutationRow;
      sheetId: string;
      queryFp: string;
      recordId: string;
      cells: Record<string, unknown>;
      version?: number;
    }
  | {
      id: number;
      op: 'putShellMeta';
      key: string;
      value: unknown;
    }
  | { id: number; op: 'getShellMeta'; key: string }
  | {
      id: number;
      op: 'putObjectCache';
      key: string;
      kind: string;
      value: unknown;
    }
  | { id: number; op: 'getObjectCache'; key: string }
  | {
      id: number;
      op: 'invalidateSheet';
      sheetId: string;
      queryFp?: string;
    }
  | { id: number; op: 'evictIfNeeded'; maxChunks?: number };

export type LocalDbResponse =
  | { id: number; ok: true; result?: unknown }
  | { id: number; ok: false; error: string };

export interface ChunkPayload {
  key: string;
  sheetId: string;
  queryFp: string;
  blockStartRow: number;
  total: number;
  sheetRev: number | null;
  records: unknown[];
  fieldCount: number;
  fetchedAt: number;
  lastAccessAt: number;
  checksum: number;
}
