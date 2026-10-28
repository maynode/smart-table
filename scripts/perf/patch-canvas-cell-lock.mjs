import { readFileSync, writeFileSync } from 'node:fs';

const path = 'apps/web/src/components/CanvasGrid.vue';
let s = readFileSync(path, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';
const toastLine =
  "      toast(`${lock.holderName} " +
  "\u6b63\u5728\u7f16\u8f91\u6b64\u5355\u5143\u683c`);";

if (!s.includes("from '../ui/toast'")) {
  s = s.replace(
    [
      "import type { FieldDto, MemberDto, RecordDto, SheetDto } from '../api/types';",
      "import { fieldTypeIcon } from '../ui/field-icons';",
    ].join(nl),
    [
      "import type { FieldDto, MemberDto, RecordDto, SheetDto } from '../api/types';",
      "import { fieldTypeIcon } from '../ui/field-icons';",
      "import { toast } from '../ui/toast';",
      'import type {',
      '  CellLockAcquireResult,',
      '  CollabCellLock,',
      "} from '../sync/collab-socket';",
    ].join(nl),
  );
}

if (!s.includes('acquireCellLock?:')) {
  s = s.replace(
    [
      '    }>;',
      '  }>(),',
    ].join(nl),
    [
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
  s = s.replace(
    ['    peerCursors: () => [],', '  },', ');'].join(nl),
    [
      '    peerCursors: () => [],',
      '    acquireCellLock: undefined,',
      '    releaseCellLock: undefined,',
      '    peerCellLocks: () => [],',
      '  },',
      ');',
    ].join(nl),
  );
}

if (!s.includes('async function beginEdit')) {
  s = s.replace(
    'function beginEdit(row: number, col: number): void {',
    'async function beginEdit(row: number, col: number): Promise<void> {',
  );
  const needle = [
    '  if (!record || !field) return;',
    '  emitPeerCursorAt(row, col);',
    '',
    '  // System / computed fields are display-only in the grid.',
  ].join(nl);
  const insert = [
    '  if (!record || !field) return;',
    '  emitPeerCursorAt(row, col);',
    '',
    '  if (props.acquireCellLock) {',
    '    if (',
    '      editing.value &&',
    '      (editing.value.recordId !== record.id ||',
    '        editing.value.field.id !== field.id)',
    '    ) {',
    '      props.releaseCellLock?.(',
    '        editing.value.recordId,',
    '        editing.value.field.id,',
    '      );',
    '    }',
    '    const lock = await props.acquireCellLock(record.id, field.id);',
    '    if (!lock.ok) {',
    toastLine,
    '      return;',
    '    }',
    '  }',
    '',
    '  // System / computed fields are display-only in the grid.',
  ].join(nl);
  if (!s.includes(needle)) {
    console.error('beginEdit insert point missing');
    process.exit(1);
  }
  s = s.replace(needle, insert);
}

if (!s.includes('props.releaseCellLock?.(current.recordId')) {
  s = s.replace(
    [
      'function commitEdit(save: boolean, navigate?: \'tab\' | \'enter\' | \'shift-tab\'): void {',
      '  const current = editing.value;',
      '  editing.value = null;',
    ].join(nl),
    [
      'function commitEdit(save: boolean, navigate?: \'tab\' | \'enter\' | \'shift-tab\'): void {',
      '  const current = editing.value;',
      '  if (current) {',
      '    props.releaseCellLock?.(current.recordId, current.field.id);',
      '  }',
      '  editing.value = null;',
    ].join(nl),
  );
}

if (!s.includes('async function toggleCheckbox')) {
  const oldToggle = [
    'function toggleCheckbox(row: number, col: number): void {',
    '  if (!props.editable) return;',
    '  const record = recordAt(row);',
    '  const field = visibleFields.value[col];',
    '  if (!record || !field || field.type !== \'checkbox\') return;',
    '  const previous = record.cells[field.id];',
    '  const next = !(previous === true || previous === \'true\');',
    '  emit(\'commit\', {',
    '    record,',
    '    field,',
    '    value: next ? \'true\' : \'false\',',
    '    previous,',
    '  });',
    '}',
  ].join(nl);
  const newToggle = [
    'async function toggleCheckbox(row: number, col: number): Promise<void> {',
    '  if (!props.editable) return;',
    '  const record = recordAt(row);',
    '  const field = visibleFields.value[col];',
    '  if (!record || !field || field.type !== \'checkbox\') return;',
    '  if (props.acquireCellLock) {',
    '    const lock = await props.acquireCellLock(record.id, field.id);',
    '    if (!lock.ok) {',
    toastLine,
    '      return;',
    '    }',
    '  }',
    '  const previous = record.cells[field.id];',
    '  const next = !(previous === true || previous === \'true\');',
    '  emit(\'commit\', {',
    '    record,',
    '    field,',
    '    value: next ? \'true\' : \'false\',',
    '    previous,',
    '  });',
    '  props.releaseCellLock?.(record.id, field.id);',
    '}',
  ].join(nl);
  if (!s.includes(oldToggle)) {
    console.error('toggleCheckbox block missing');
    process.exit(1);
  }
  s = s.replace(oldToggle, newToggle);
}

if (!s.includes('peerCellLockOverlays')) {
  const expose = [
    'defineExpose({',
    '  getEngine: () => engine,',
    '  clearRowSelection,',
    '  getSelection: () => selectedCell.value,',
    '});',
  ].join(nl);
  const overlay = [
    'const peerCellLockOverlays = computed(() => {',
    '  void layoutEpoch.value;',
    '  if (!engine || !props.peerCellLocks?.length) return [];',
    '  const fields = visibleFields.value;',
    '  const hostH = host.value?.clientHeight ?? 0;',
    '  const hostW = host.value?.clientWidth ?? 0;',
    '  const out: Array<{ key: string; label: string; style: Record<string, string> }> =',
    '    [];',
    '  for (const lock of props.peerCellLocks) {',
    '    const local = props.records.findIndex((r) => r.id === lock.recordId);',
    '    if (local < 0) continue;',
    '    const absRow = local + (props.recordOffset ?? 0);',
    '    const col = fields.findIndex((f) => f.id === lock.fieldId);',
    '    if (col < 0) continue;',
    '    const rect = engine.cellRect(absRow, col);',
    '    if (',
    '      rect.y + rect.height < 0 ||',
    '      rect.y > hostH ||',
    '      rect.x + rect.width < 0 ||',
    '      rect.x > hostW',
    '    ) {',
    '      continue;',
    '    }',
    '    out.push({',
    "      key: `${lock.userId}:${lock.recordId}:${lock.fieldId}`,",
    "      label: `${(lock.name || lock.account || '?').trim()} \u7f16\u8f91\u4e2d`,",
    '      style: {',
    "        left: `${rect.x}px`,",
    "        top: `${rect.y}px`,",
    "        width: `${Math.max(rect.width, 72)}px`,",
    "        height: `${rect.height}px`,",
    "        '--peer-color': lock.color || '#5b8ff9',",
    '      },',
    '    });',
    '  }',
    '  return out;',
    '});',
    '',
    expose,
  ].join(nl);
  if (!s.includes(expose)) {
    console.error('defineExpose missing');
    process.exit(1);
  }
  s = s.replace(expose, overlay);
}

if (!s.includes('peerCellLockOverlays') || !s.includes('data-testid="peer-cell-lock"')) {
  s = s.replace(
    [
      '    <div',
      '      v-for="cursor in peerCursorOverlays"',
      '      :key="cursor.key"',
      '      class="peer-cursor"',
      '      data-testid="peer-cursor"',
      '      :style="cursor.style"',
      '    >',
      '      <span class="peer-cursor-caret" aria-hidden="true" />',
      '      <span class="peer-cursor-label">{{ cursor.label }}</span>',
      '    </div>',
    ].join(nl),
    [
      '    <div',
      '      v-for="cursor in peerCursorOverlays"',
      '      :key="cursor.key"',
      '      class="peer-cursor"',
      '      data-testid="peer-cursor"',
      '      :style="cursor.style"',
      '    >',
      '      <span class="peer-cursor-caret" aria-hidden="true" />',
      '      <span class="peer-cursor-label">{{ cursor.label }}</span>',
      '    </div>',
      '    <div',
      '      v-for="lock in peerCellLockOverlays"',
      '      :key="lock.key"',
      '      class="peer-cell-lock"',
      '      data-testid="peer-cell-lock"',
      '      :style="lock.style"',
      '    >',
      '      <span class="peer-cell-lock-label">{{ lock.label }}</span>',
      '    </div>',
    ].join(nl),
  );
}

if (!s.includes('.peer-cell-lock')) {
  // append style before last </style> if exists
  const styleEnd = s.lastIndexOf('</style>');
  if (styleEnd > 0) {
    const css = [
      '',
      '.peer-cell-lock {',
      '  position: absolute;',
      '  pointer-events: none;',
      '  box-sizing: border-box;',
      '  border: 2px solid var(--peer-color, #5b8ff9);',
      '  background: color-mix(in srgb, var(--peer-color, #5b8ff9) 12%, transparent);',
      '  z-index: 3;',
      '}',
      '.peer-cell-lock-label {',
      '  position: absolute;',
      '  left: 0;',
      '  top: -18px;',
      '  max-width: 160px;',
      '  overflow: hidden;',
      '  text-overflow: ellipsis;',
      '  white-space: nowrap;',
      '  font-size: 11px;',
      '  line-height: 16px;',
      '  padding: 0 6px;',
      '  border-radius: 3px;',
      '  color: #fff;',
      '  background: var(--peer-color, #5b8ff9);',
      '}',
      '',
    ].join(nl);
    s = s.slice(0, styleEnd) + css + s.slice(styleEnd);
  }
}

writeFileSync(path, Buffer.from(s, 'utf8'));
console.log({
  asyncBegin: s.includes('async function beginEdit'),
  acquireProp: s.includes('acquireCellLock?:'),
  toastImport: s.includes("from '../ui/toast'"),
  chineseOk: /\u8bb0\u5f55\u6570/.test(s),
  lockOverlay: s.includes('peerCellLockOverlays'),
  toastOk: s.includes('\u6b63\u5728\u7f16\u8f91\u6b64\u5355\u5143\u683c'),
});
