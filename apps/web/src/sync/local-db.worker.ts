/// <reference lib="webworker" />

import * as backend from './local-db-backend';
import type { LocalDbRequest, LocalDbResponse } from './local-db-protocol';

const worker = self as unknown as DedicatedWorkerGlobalScope;

worker.onmessage = (ev: MessageEvent<LocalDbRequest>) => {
  void handle(ev.data);
};

async function handle(req: LocalDbRequest): Promise<void> {
  const reply = (msg: LocalDbResponse) => worker.postMessage(msg);
  try {
    switch (req.op) {
      case 'putMutation':
        await backend.putMutation(req.row);
        reply({ id: req.id, ok: true });
        break;
      case 'deleteMutation':
        await backend.deleteMutation(req.clientOpId);
        reply({ id: req.id, ok: true });
        break;
      case 'listMutations':
        reply({
          id: req.id,
          ok: true,
          result: await backend.listMutations(req.sheetId),
        });
        break;
      case 'putBlob':
        await backend.putBlob(req.row);
        reply({ id: req.id, ok: true });
        break;
      case 'getBlob':
        reply({
          id: req.id,
          ok: true,
          result: await backend.getBlob(req.blobId),
        });
        break;
      case 'deleteBlob':
        await backend.deleteBlob(req.blobId);
        reply({ id: req.id, ok: true });
        break;
      case 'setMap':
        await backend.setMap(req.key, req.value);
        reply({ id: req.id, ok: true });
        break;
      case 'getMap':
        reply({
          id: req.id,
          ok: true,
          result: await backend.getMap(req.key),
        });
        break;
      case 'putChunks':
        await backend.putChunks(req.chunks);
        reply({ id: req.id, ok: true });
        break;
      case 'getChunk':
        reply({
          id: req.id,
          ok: true,
          result: await backend.getChunk(req.key),
        });
        break;
      case 'getChunksCovering':
        reply({
          id: req.id,
          ok: true,
          result: await backend.getChunksCovering(req),
        });
        break;
      case 'patchRecordInChunks':
        reply({
          id: req.id,
          ok: true,
          result: await backend.patchRecordInChunks(req),
        });
        break;
      case 'enqueueAndPatch':
        await backend.enqueueAndPatch(req);
        reply({ id: req.id, ok: true });
        break;
      case 'putShellMeta':
        await backend.putShellMeta(req.key, req.value);
        reply({ id: req.id, ok: true });
        break;
      case 'getShellMeta':
        reply({
          id: req.id,
          ok: true,
          result: await backend.getShellMeta(req.key),
        });
        break;
      case 'putObjectCache':
        await backend.putObjectCache(req.key, req.kind, req.value);
        reply({ id: req.id, ok: true });
        break;
      case 'getObjectCache':
        reply({
          id: req.id,
          ok: true,
          result: await backend.getObjectCache(req.key),
        });
        break;
      case 'invalidateSheet':
        await backend.invalidateSheet(req.sheetId, req.queryFp);
        reply({ id: req.id, ok: true });
        break;
      case 'evictIfNeeded':
        reply({
          id: req.id,
          ok: true,
          result: await backend.evictIfNeeded(req.maxChunks),
        });
        break;
      default:
        reply({
          id: (req as { id: number }).id,
          ok: false,
          error: 'unknown op',
        });
    }
  } catch (error) {
    reply({
      id: req.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
