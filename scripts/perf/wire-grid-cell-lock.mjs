import { readFileSync, writeFileSync } from 'node:fs';

function patch(path, fn) {
  const before = readFileSync(path, 'utf8');
  const after = fn(before);
  writeFileSync(path, Buffer.from(after, 'utf8'));
  console.log(path, before === after ? 'unchanged' : 'patched');
}

patch('apps/web/src/components/GridPanel.vue', (s) => {
  const nl = s.includes('\r\n') ? '\r\n' : '\n';
  if (s.includes('acquireCellLock?:')) return s;
  if (!s.includes("from '../api/types'")) return s;

  s = s.replace(
    "import type { FieldDto, MemberDto, RecordDto, SheetDto } from '../api/types';",
    [
      "import type { FieldDto, MemberDto, RecordDto, SheetDto } from '../api/types';",
      'import type {',
      '  CellLockAcquireResult,',
      '  CollabCellLock,',
      "} from '../sync/collab-socket';",
    ].join(nl),
  );

  s = s.replace(
    [
      '    peerCursors?: Array<{',
      '      userId: string;',
      '      account: string;',
      '      name?: string;',
      '      color?: string;',
      '      cursor: {',
      '        recordId?: string;',
      '        fieldId?: string;',
      '        rowIndex?: number;',
      '        colIndex?: number;',
      '      };',
      '    }>;',
      '  }>(),',
    ].join(nl),
    [
      '    peerCursors?: Array<{',
      '      userId: string;',
      '      account: string;',
      '      name?: string;',
      '      color?: string;',
      '      cursor: {',
      '        recordId?: string;',
      '        fieldId?: string;',
      '        rowIndex?: number;',
      '        colIndex?: number;',
      '      };',
      '    }>;',
      '    acquireCellLock?: (',
      '      recordId: string,',
      '      fieldId: string,',
      '    ) => Promise<CellLockAcquireResult>;',
      '    releaseCellLock?: (recordId: string, fieldId: string) => void;',
      '    peerCellLocks?: CollabCellLock[];',
      '  }>(),',
    ].join(nl),
  );

  // defaults object may already have recordLookup etc.
  if (s.includes('recordLookup: null, recordCacheEpoch: 0 },')) {
    s = s.replace(
      'recordLookup: null, recordCacheEpoch: 0 },',
      'recordLookup: null, recordCacheEpoch: 0, acquireCellLock: undefined, releaseCellLock: undefined, peerCellLocks: () => [] },',
    );
  } else if (s.includes('{ editable: true, totalRecordCount: null, recordOffset: 0 },')) {
    s = s.replace(
      '{ editable: true, totalRecordCount: null, recordOffset: 0 },',
      '{ editable: true, totalRecordCount: null, recordOffset: 0, acquireCellLock: undefined, releaseCellLock: undefined, peerCellLocks: () => [] },',
    );
  }

  s = s.replace(
    [
      '        :peer-cursors="peerCursors"',
      '        @commit="emit(\'commit\', $event)"',
    ].join(nl),
    [
      '        :peer-cursors="peerCursors"',
      '        :acquire-cell-lock="acquireCellLock"',
      '        :release-cell-lock="releaseCellLock"',
      '        :peer-cell-locks="peerCellLocks"',
      '        @commit="emit(\'commit\', $event)"',
    ].join(nl),
  );

  return s;
});

patch('apps/web/src/views/BaseShellView.vue', (s) => {
  const nl = s.includes('\r\n') ? '\r\n' : '\n';
  if (s.includes(':acquire-cell-lock=')) return s;

  // Add helpers near peerCursors computed
  if (!s.includes('function acquireCellLockForGrid')) {
    const marker = 'const peerCursors = computed(() =>';
    const idx = s.indexOf(marker);
    if (idx < 0) throw new Error('peerCursors missing');
    const insert = [
      'function acquireCellLockForGrid(recordId: string, fieldId: string) {',
      '  return collabSocket.acquireCellLock(recordId, fieldId);',
      '}',
      '',
      'function releaseCellLockForGrid(recordId: string, fieldId: string): void {',
      '  collabSocket.releaseCellLock(recordId, fieldId);',
      '}',
      '',
      'const peerCellLocks = computed(() => collabSocket.cellLocks.value);',
      '',
      marker,
    ].join(nl);
    s = s.replace(marker, insert);
  }

  for (const indent of ['              ', '            ']) {
    const from = [
      `${indent}:peer-cursors="peerCursors"`,
      `${indent}@add-row="addRow"`,
    ].join(nl);
    const to = [
      `${indent}:peer-cursors="peerCursors"`,
      `${indent}:acquire-cell-lock="acquireCellLockForGrid"`,
      `${indent}:release-cell-lock="releaseCellLockForGrid"`,
      `${indent}:peer-cell-locks="peerCellLocks"`,
      `${indent}@add-row="addRow"`,
    ].join(nl);
    if (s.includes(from)) s = s.replace(from, to);
  }
  return s;
});
