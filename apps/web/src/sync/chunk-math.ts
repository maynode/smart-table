/**
 * Cell-budget chunking for local DB (WeCom chunkCellSize ≈ 15000).
 * Network windows stay WINDOW_SIZE; persistence uses smaller local blocks.
 */

import { WINDOW_SIZE } from './record-window';

/** Align with WeCom HAR `chunkCellSize`. */
export const CELL_BUDGET = 15_000;

export function localBlockRows(fieldCount: number): number {
  const cols = Math.max(1, Math.floor(fieldCount) || 1);
  const byCells = Math.max(1, Math.floor(CELL_BUDGET / cols));
  return Math.min(WINDOW_SIZE, byCells);
}

export function alignLocalBlock(
  row: number,
  fieldCount: number,
): number {
  const size = localBlockRows(fieldCount);
  if (!Number.isFinite(row) || row <= 0) return 0;
  return Math.floor(row / size) * size;
}

/** Stable fingerprint for view/query so chunks do not cross namespaces. */
export function queryFingerprint(input: {
  viewId?: string | null;
  filter?: unknown;
  sort?: unknown;
  group?: unknown;
  search?: string | null;
}): string {
  const payload = {
    v: input.viewId ?? '',
    f: input.filter ?? null,
    s: input.sort ?? null,
    g: input.group ?? null,
    q: input.search ?? '',
  };
  return fnv1aHex(stableStringify(payload));
}

export function chunkKey(
  sheetId: string,
  queryFp: string,
  blockStartRow: number,
): string {
  return `${sheetId}|${queryFp}|${blockStartRow}`;
}

/** Split a network page into local blocks for persistence. */
export function splitIntoLocalBlocks<T>(input: {
  records: T[];
  networkOffset: number;
  fieldCount: number;
}): Array<{ blockStartRow: number; records: T[] }> {
  const size = localBlockRows(input.fieldCount);
  const out: Array<{ blockStartRow: number; records: T[] }> = [];
  if (input.records.length === 0) return out;
  let i = 0;
  while (i < input.records.length) {
    const absolute = input.networkOffset + i;
    const blockStart = alignLocalBlock(absolute, input.fieldCount);
    const take = Math.min(
      size - (absolute - blockStart),
      input.records.length - i,
    );
    const slice = input.records.slice(i, i + take);
    const existing = out.find((b) => b.blockStartRow === blockStart);
    if (existing) {
      existing.records.push(...slice);
    } else {
      out.push({ blockStartRow: blockStart, records: slice });
    }
    i += take;
  }
  return out;
}

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i]!;
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function fnv1aHex(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
