/** Human cell-edit lease (抢占). System/API writes do not take this lock. */

export const CELL_LOCK_TTL_MS = 45_000;

export function cellLockKey(
  sheetId: string,
  recordId: string,
  fieldId: string,
): string {
  return `${sheetId}\u0000${recordId}\u0000${fieldId}`;
}
