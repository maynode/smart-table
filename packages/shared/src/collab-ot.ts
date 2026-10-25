/**
 * OT transforms for SheetMutation — symbols aligned with WeCom
 * transformWith* extracted from materials/wecom-ot-transforms.extracted.json.
 * Dual-session NEW_CHANGES body still inferred; see docs/COLLAB.md.
 */
import type { SheetMutation } from './offline-mutations';

export type OtOutcome =
  | { kind: 'keep'; mutation: SheetMutation }
  | { kind: 'drop' }
  | { kind: 'conflict'; reason: string };

function isSet(m: SheetMutation): m is SheetMutation & { type: 'setRecord' } {
  return m.type === 'setRecord';
}

function isDelField(m: SheetMutation): m is SheetMutation & { type: 'deleteField' } {
  return m.type === 'deleteField';
}

function isDelRecord(m: SheetMutation): m is SheetMutation & { type: 'deleteRecord' } {
  return m.type === 'deleteRecord';
}

/**
 * Transform local pending mutation against an already-accepted peer mutation
 * (server order: peer applied first).
 * Aligns with transformWithSetRecordMutation / Insert/Delete Field|Record.
 */
export function transformMutationAgainst(
  local: SheetMutation,
  peer: SheetMutation,
): OtOutcome {
  // deleteField wins over setRecord on that field
  if (isDelField(peer) && isSet(local)) {
    if (Object.prototype.hasOwnProperty.call(local.cells, peer.fieldId)) {
      const cells = { ...local.cells };
      delete cells[peer.fieldId];
      if (Object.keys(cells).length === 0) return { kind: 'drop' };
      return { kind: 'keep', mutation: { ...local, cells } };
    }
  }
  if (isDelField(local) && isSet(peer)) {
    return { kind: 'keep', mutation: local };
  }

  // deleteRecord drops set/delete on that record
  if (isDelRecord(peer)) {
    if (isSet(local) && local.recordId === peer.recordId) return { kind: 'drop' };
    if (isDelRecord(local) && local.recordId === peer.recordId) return { kind: 'drop' };
  }
  if (isDelRecord(local) && isSet(peer) && local.recordId === peer.recordId) {
    return { kind: 'keep', mutation: local };
  }

  // setRecord vs setRecord
  if (isSet(local) && isSet(peer)) {
    if (local.recordId !== peer.recordId) {
      return { kind: 'keep', mutation: local };
    }
    const overlap = Object.keys(local.cells).filter((k) =>
      Object.prototype.hasOwnProperty.call(peer.cells, k),
    );
    if (overlap.length === 0) {
      return { kind: 'keep', mutation: local };
    }
    // Same cells: peer already won on server; drop overlapping keys from local retry
    const cells = { ...local.cells };
    for (const k of overlap) delete cells[k];
    if (Object.keys(cells).length === 0) return { kind: 'drop' };
    return {
      kind: 'keep',
      mutation: {
        ...local,
        cells,
        baseVersion: peer.baseVersion !== undefined ? peer.baseVersion + 1 : local.baseVersion,
      },
    };
  }

  // Field create/update/delete vs each other — conservative
  if (
    (local.type === 'createField' ||
      local.type === 'updateField' ||
      local.type === 'deleteField') &&
    (peer.type === 'createField' ||
      peer.type === 'updateField' ||
      peer.type === 'deleteField')
  ) {
    const localFid =
      local.type === 'createField'
        ? local.clientFieldId
        : local.fieldId;
    const peerFid =
      peer.type === 'createField'
        ? peer.clientFieldId
        : peer.fieldId;
    if (localFid === peerFid && local.type !== peer.type) {
      return { kind: 'conflict', reason: 'field_schema_race' };
    }
  }

  // Independent ops
  if (local.type !== peer.type) {
    return { kind: 'keep', mutation: local };
  }

  return { kind: 'keep', mutation: local };
}

/** Apply a sequence of accepted peer mutations to one local pending op. */
export function transformAgainstPeers(
  local: SheetMutation,
  peers: SheetMutation[],
): OtOutcome {
  let current: OtOutcome = { kind: 'keep', mutation: local };
  for (const peer of peers) {
    if (current.kind !== 'keep') return current;
    current = transformMutationAgainst(current.mutation, peer);
  }
  return current;
}
