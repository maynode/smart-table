import { describe, expect, it } from 'vitest';
import {
  CELL_BUDGET,
  alignLocalBlock,
  chunkKey,
  crc32,
  localBlockRows,
  queryFingerprint,
  splitIntoLocalBlocks,
} from './chunk-math';
import { WINDOW_SIZE } from './record-window';

describe('chunk-math', () => {
  it('caps local block rows by cell budget and WINDOW_SIZE', () => {
    expect(localBlockRows(1)).toBe(Math.min(WINDOW_SIZE, CELL_BUDGET));
    expect(localBlockRows(15)).toBe(1000);
    expect(localBlockRows(100)).toBe(150);
    expect(localBlockRows(0)).toBe(Math.min(WINDOW_SIZE, CELL_BUDGET));
  });

  it('aligns to local block boundaries', () => {
    expect(alignLocalBlock(0, 15)).toBe(0);
    expect(alignLocalBlock(999, 15)).toBe(0);
    expect(alignLocalBlock(1000, 15)).toBe(1000);
    expect(alignLocalBlock(2500, 15)).toBe(2000);
  });

  it('builds stable query fingerprints', () => {
    const a = queryFingerprint({
      viewId: 'v1',
      filter: { op: 'and', filters: [{ fieldId: 'f', op: 'eq', value: 1 }] },
      sort: [{ fieldId: 'f', direction: 'asc' }],
    });
    const b = queryFingerprint({
      sort: [{ fieldId: 'f', direction: 'asc' }],
      filter: { op: 'and', filters: [{ fieldId: 'f', op: 'eq', value: 1 }] },
      viewId: 'v1',
    });
    const c = queryFingerprint({ viewId: 'v2' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('splits network pages into local blocks', () => {
    const records = Array.from({ length: 2500 }, (_, i) => ({ id: String(i) }));
    const blocks = splitIntoLocalBlocks({
      records,
      networkOffset: 0,
      fieldCount: 15,
    });
    expect(localBlockRows(15)).toBe(1000);
    expect(blocks.map((b) => b.blockStartRow)).toEqual([0, 1000, 2000]);
    expect(blocks[0]!.records).toHaveLength(1000);
    expect(blocks[1]!.records).toHaveLength(1000);
    expect(blocks[2]!.records).toHaveLength(500);
  });

  it('chunk keys are stable', () => {
    expect(chunkKey('s1', 'abcd', 0)).toBe('s1|abcd|0');
  });

  it('crc32 is deterministic', () => {
    const bytes = new TextEncoder().encode('smart-table');
    expect(crc32(bytes)).toBe(crc32(bytes));
    expect(crc32(bytes)).not.toBe(crc32(new TextEncoder().encode('other')));
  });
});
