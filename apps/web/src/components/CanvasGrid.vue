<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import {
  ADD_FIELD_COLUMN_ID,
  CanvasGridEngine,
  type CellRender,
  type GridColumn,
  type GridStats,
} from '../grid-canvas/engine';
import { endpoints } from '../api/endpoints';
import type { FieldDto, MemberDto, RecordDto, SheetDto } from '../api/types';
import { fieldTypeIcon } from '../ui/field-icons';

const props = withDefaults(
  defineProps<{
    fields: FieldDto[];
    records?: RecordDto[];
    rowCount?: number;
    provider?: ((row: number, col: number) => CellRender | null) | null;
    editable?: boolean;
    showAddColumn?: boolean;
    rowHeight?: number;
    freezeColumnCount?: number;
    rowColors?: Record<string, string>;
    /** Hierarchy indent depth keyed by record id (父记录字段). */
    rowDepths?: Record<string, number>;
    personNames?: Record<string, string>;
    members?: MemberDto[];
    sheets?: SheetDto[];
    uploadAttachment?: (file: File) => Promise<{
      url: string;
      name: string;
      mimetype?: string;
      size?: number;
    }>;
  }>(),
  {
    records: () => [],
    rowCount: undefined,
    provider: null,
    editable: true,
    showAddColumn: true,
    rowHeight: 36,
    freezeColumnCount: 0,
    rowColors: () => ({}),
    rowDepths: () => ({}),
    personNames: () => ({}),
    members: () => [],
    sheets: () => [],
    uploadAttachment: undefined,
  },
);

const emit = defineEmits<{
  commit: [
    payload: {
      record: RecordDto;
      field: FieldDto;
      value: unknown;
      previous?: unknown;
    },
  ];
  viewport: [stats: GridStats];
  addColumn: [anchor: { top: number; left: number }];
  headerClick: [
    payload: { field: FieldDto; anchor: { top: number; left: number } },
  ];
  resizeField: [payload: { field: FieldDto; width: number }];
  rowsSelected: [recordIds: string[]];
  /** 企微：向上/向下插入 N 行（相对 atIndex；无持久 order 时本地插入）。 */
  insertRows: [
    payload: { count: number; direction: 'above' | 'below'; atIndex?: number },
  ];
  insertColumns: [
    payload: {
      count: number;
      direction: 'left' | 'right';
      fieldId: string;
    },
  ];
  deleteRecords: [recordIds: string[]];
  deleteField: [field: FieldDto];
}>();

const insertMenu = ref<{
  top: number;
  left: number;
  aboveCount: number;
  belowCount: number;
  atIndex?: number;
} | null>(null);

const cellMenu = ref<{
  top: number;
  left: number;
  row: number;
  col: number;
  field: FieldDto;
  record: RecordDto;
  aboveCount: number;
  belowCount: number;
  leftCount: number;
  rightCount: number;
} | null>(null);

function openInsertMenu(
  anchor: { top: number; left: number },
  atIndex?: number,
): void {
  cellMenu.value = null;
  insertMenu.value = {
    top: anchor.top,
    left: anchor.left,
    aboveCount: 1,
    belowCount: 1,
    atIndex,
  };
}

function closeInsertMenu(): void {
  insertMenu.value = null;
}

function closeCellMenu(): void {
  cellMenu.value = null;
}

function confirmInsert(direction: 'above' | 'below'): void {
  if (!insertMenu.value) return;
  const raw =
    direction === 'above'
      ? insertMenu.value.aboveCount
      : insertMenu.value.belowCount;
  const count = Math.min(100, Math.max(1, Math.floor(Number(raw) || 1)));
  const atIndex = insertMenu.value.atIndex;
  closeInsertMenu();
  emit('insertRows', { count, direction, atIndex });
}

function openCellMenu(
  selection: { row: number; col: number },
  anchor: { top: number; left: number },
): void {
  if (!props.editable) return;
  const record = props.records[selection.row];
  const field = visibleFields.value[selection.col];
  if (!record || !field) return;
  insertMenu.value = null;
  cellMenu.value = {
    top: Math.min(anchor.top, window.innerHeight - 320),
    left: Math.min(anchor.left, window.innerWidth - 260),
    row: selection.row,
    col: selection.col,
    field,
    record,
    aboveCount: 1,
    belowCount: 1,
    leftCount: 1,
    rightCount: 1,
  };
}

function cellMenuDeleteRow(): void {
  const menu = cellMenu.value;
  if (!menu) return;
  closeCellMenu();
  emit('deleteRecords', [menu.record.id]);
}

function cellMenuDeleteCol(): void {
  const menu = cellMenu.value;
  if (!menu) return;
  closeCellMenu();
  emit('deleteField', menu.field);
}

function cellMenuInsertRows(direction: 'above' | 'below'): void {
  const menu = cellMenu.value;
  if (!menu) return;
  const raw = direction === 'above' ? menu.aboveCount : menu.belowCount;
  const count = Math.min(100, Math.max(1, Math.floor(Number(raw) || 1)));
  const atIndex = direction === 'above' ? menu.row : menu.row + 1;
  closeCellMenu();
  emit('insertRows', { count, direction, atIndex });
}

function cellMenuInsertCols(direction: 'left' | 'right'): void {
  const menu = cellMenu.value;
  if (!menu) return;
  const raw = direction === 'left' ? menu.leftCount : menu.rightCount;
  const count = Math.min(20, Math.max(1, Math.floor(Number(raw) || 1)));
  closeCellMenu();
  emit('insertColumns', {
    count,
    direction,
    fieldId: menu.field.id,
  });
}

const host = ref<HTMLDivElement | null>(null);
const editorInput = ref<HTMLInputElement | HTMLSelectElement | null>(null);
const uploadInput = ref<HTMLInputElement | null>(null);
const pendingUpload = ref<{ record: RecordDto; field: FieldDto } | null>(null);
const uploading = ref(false);
const selectedRows = ref<number[]>([]);
let rowAnchor: number | null = null;
/** Active cell selection (WeCom: click selects; edit via 2nd click / Enter / type). */
const selectedCell = ref<{ row: number; col: number } | null>(null);
const editing = ref<{
  recordId: string;
  row: number;
  col: number;
  field: FieldDto;
  value: string;
  style: Record<string, string>;
} | null>(null);
let engine: CanvasGridEngine | null = null;
const resizedWidths = new Map<string, number>();
let lastViewportEnd = -1;
/** Same-tab clipboard for raw cell values (system clipboard carries display text / TSV). */
let appClipboard: { values: unknown[][]; texts: string[][] } | null = null;

const visibleFields = computed(() =>
  props.fields.filter((field) => !field.hidden),
);

const columns = computed<GridColumn[]>(() => {
  const cols = visibleFields.value.map((field) => ({
    id: field.id,
    name: field.name,
    width: resizedWidths.get(field.id) ?? defaultWidth(field),
    icon: fieldTypeIcon(field.type),
  }));
  if (props.showAddColumn && props.editable) {
    cols.push({ id: ADD_FIELD_COLUMN_ID, name: '+', width: 44, icon: '' });
  }
  return cols;
});

const editorKind = computed(() => {
  const type = editing.value?.field.type;
  if (!type) return 'text';
  if (type === 'select') return 'select';
  if (type === 'multiSelect') return 'multiSelect';
  if (type === 'person') return 'person';
  if (type === 'relation') return 'relation';
  if (type === 'location') return 'location';
  if (type === 'barcode') return 'barcode';
  if (type === 'checkbox') return 'checkbox';
  if (type === 'date') return 'date';
  if (type === 'progress') return 'progress';
  if (type === 'number' || type === 'currency' || type === 'percent') {
    return 'number';
  }
  if (type === 'email') return 'email';
  if (type === 'phone') return 'tel';
  if (type === 'url') return 'url';
  return 'text';
});

const relationChoices = ref<Array<{ id: string; label: string }>>([]);
const relationLoading = ref(false);

async function loadRelationChoices(field: FieldDto): Promise<void> {
  const targetSheetId = (
    field.options as { relation?: { targetSheetId?: string } } | null
  )?.relation?.targetSheetId;
  if (!targetSheetId) {
    relationChoices.value = [];
    return;
  }
  relationLoading.value = true;
  try {
    const sheet = await endpoints.getSheet(targetSheetId);
    const page = await endpoints.listRecords(targetSheetId, null, 100);
    const titleField =
      sheet.fields?.find((item) => item.type === 'text') ??
      sheet.fields?.[0] ??
      null;
    relationChoices.value = page.records.map((record) => {
      const raw = titleField ? record.cells[titleField.id] : null;
      const label =
        raw === null || raw === undefined || raw === ''
          ? record.id.slice(0, 8)
          : String(raw);
      return { id: record.id, label };
    });
  } catch {
    relationChoices.value = [];
  } finally {
    relationLoading.value = false;
  }
}

const selectChoices = computed(
  () => editing.value?.field.options?.choices ?? [],
);

const multiSelected = computed(() => {
  if (!editing.value) return [] as string[];
  const raw = editing.value.value;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* plain csv */
  }
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
});

const CHOICE_COLORS: Record<string, { bg: string; color: string }> = {
  yellow: { bg: '#fff7e6', color: '#d46b08' },
  green: { bg: '#e8fff3', color: '#0f9d58' },
  blue: { bg: '#e8f3ff', color: '#1d6fdc' },
  red: { bg: '#fff1f0', color: '#d4380d' },
  purple: { bg: '#f5f0ff', color: '#7b3ff2' },
  gray: { bg: '#f2f3f5', color: '#646a73' },
};

function defaultWidth(field: FieldDto): number {
  const stored = field.options?.width;
  if (typeof stored === 'number') return stored;
  switch (field.type) {
    case 'phone':
      return 140;
    case 'select':
    case 'multiSelect':
      return 140;
    case 'number':
    case 'currency':
    case 'percent':
    case 'progress':
      return 120;
    case 'date':
      return 140;
    case 'checkbox':
      return 90;
    case 'person':
      return 120;
    case 'createdAt':
    case 'lastEditedAt':
      return 160;
    default:
      return 180;
  }
}

function textOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function attachmentOf(value: unknown): {
  url: string;
  name?: string;
} | null {
  if (!value) return null;
  if (typeof value === 'string') {
    if (value.startsWith('{')) {
      try {
        const parsed = JSON.parse(value) as { url?: string; name?: string };
        return parsed.url ? { url: parsed.url, name: parsed.name } : null;
      } catch {
        return null;
      }
    }
    if (value.startsWith('/') || value.startsWith('http')) return { url: value };
    return null;
  }
  if (typeof value === 'object') {
    const parsed = value as { url?: unknown; name?: unknown };
    if (typeof parsed.url === 'string') {
      return {
        url: parsed.url,
        name: typeof parsed.name === 'string' ? parsed.name : undefined,
      };
    }
  }
  return null;
}

function formatCell(field: FieldDto, value: unknown): CellRender | null {
  if (value === null || value === undefined || value === '') return null;

  if (field.type === 'person') {
    const ids = Array.isArray(value) ? value.map(String) : [String(value)];
    const names = ids.map((id) => props.personNames[id] ?? id).filter(Boolean);
    if (names.length === 0) return null;
    return { text: names.join('、'), pill: true, bg: '#eef4ff', color: '#1d6fdc' };
  }

  if (field.type === 'image') {
    const attachment = attachmentOf(value);
    if (!attachment) return null;
    return { text: '', image: attachment.url };
  }

  if (field.type === 'file') {
    const attachment = attachmentOf(value);
    if (!attachment) return null;
    return { text: `📎 ${attachment.name ?? '附件'}` };
  }

  if (field.type === 'select') {
    const choice = field.options?.choices?.find(
      (item) => item.id === String(value),
    );
    const palette =
      CHOICE_COLORS[choice?.color ?? ''] ?? CHOICE_COLORS.blue;
    return {
      text: choice?.name ?? String(value),
      pill: true,
      bg: palette.bg,
      color: palette.color,
    };
  }

  if (field.type === 'multiSelect' && Array.isArray(value)) {
    const labels = value.map((id) => {
      const choice = field.options?.choices?.find(
        (item) => item.id === String(id),
      );
      return choice?.name ?? String(id);
    });
    return { text: labels.join(', ') };
  }

  if (field.type === 'checkbox') {
    return { text: value === true || value === 'true' ? '☑' : '☐' };
  }

  if (field.type === 'percent' || field.type === 'progress') {
    const num = Number(value);
    if (Number.isFinite(num)) return { text: `${num}%` };
  }

  if (field.type === 'currency') {
    const num = Number(value);
    if (Number.isFinite(num)) return { text: `¥${num}` };
  }

  if (field.type === 'relation') {
    const ids = Array.isArray(value) ? value.map(String) : [String(value)];
    return { text: ids.filter(Boolean).join(', ') };
  }

  if (field.type === 'location') {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const loc = value as { address?: string; lat?: number; lng?: number };
      if (loc.address) return { text: loc.address };
      if (loc.lat != null && loc.lng != null) {
        return { text: `${loc.lat}, ${loc.lng}` };
      }
    }
    return { text: textOf(value) };
  }

  if (field.type === 'barcode') {
    return { text: textOf(value) };
  }

  // groupChat 已停用新建/编辑，旧数据仅只读展示。
  if (field.type === 'groupChat') {
    const ids = Array.isArray(value) ? value.map(String) : [];
    const names = ids
      .filter(Boolean)
      .map((id) => props.personNames[id] ?? id);
    return { text: names.join(', ') || textOf(value) };
  }

  return { text: textOf(value) };
}

function renderCell(row: number, col: number): CellRender | null {
  if (props.provider) return props.provider(row, col);
  const field = visibleFields.value[col];
  if (!field) return null;
  const record = props.records[row];
  if (!record) return null;
  const cell = formatCell(field, record.cells[field.id]);
  if (!cell) return null;
  // Indent first visible column for hierarchy (父记录字段).
  if (col === 0) {
    const depth = props.rowDepths[record.id] ?? 0;
    if (depth > 0) {
      return {
        ...cell,
        text: `${'　'.repeat(depth)}↳ ${cell.text ?? ''}`,
      };
    }
  }
  return cell;
}

function beginEdit(row: number, col: number): void {
  if (!props.editable || !engine) return;
  if (columns.value[col]?.id === ADD_FIELD_COLUMN_ID) return;
  const record = props.records[row];
  const field = visibleFields.value[col];
  if (!record || !field) return;

  // System / computed fields are display-only in the grid.
  if (
    field.type === 'formula' ||
    field.type === 'lookup' ||
    field.type === 'createdBy' ||
    field.type === 'lastEditedBy' ||
    field.type === 'createdAt' ||
    field.type === 'lastEditedAt' ||
    field.type === 'autoNumber' ||
    field.type === 'ai' ||
    field.type === 'groupChat'
  ) {
    return;
  }

  if (field.type === 'image' || field.type === 'file') {
    pendingUpload.value = { record, field };
    uploadInput.value?.click();
    return;
  }

  if (field.type === 'person') {
    const current = record.cells[field.id];
    const value = Array.isArray(current)
      ? String(current[0] ?? '')
      : String(current ?? '');
    engine.ensureCellVisible(row, col);
    const personRect = engine.cellRect(row, col);
    editing.value = {
      recordId: record.id,
      row,
      col,
      field,
      value,
      style: {
        left: `${personRect.x}px`,
        top: `${personRect.y}px`,
        width: `${Math.max(personRect.width, 140)}px`,
        height: `${personRect.height}px`,
      },
    };
    nextTick(() => editorInput.value?.focus());
    return;
  }

  if (field.type === 'relation') {
    void loadRelationChoices(field);
    const current = record.cells[field.id];
    const value = Array.isArray(current)
      ? String(current[0] ?? '')
      : String(current ?? '');
    engine.ensureCellVisible(row, col);
    const relRect = engine.cellRect(row, col);
    editing.value = {
      recordId: record.id,
      row,
      col,
      field,
      value,
      style: {
        left: `${relRect.x}px`,
        top: `${relRect.y}px`,
        width: `${Math.max(relRect.width, 180)}px`,
        height: `${relRect.height}px`,
      },
    };
    nextTick(() => editorInput.value?.focus());
    return;
  }

  if (field.type === 'location') {
    const current = record.cells[field.id];
    let value = '';
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      value = String((current as { address?: string }).address ?? '');
    } else {
      value = textOf(current);
    }
    engine.ensureCellVisible(row, col);
    const locRect = engine.cellRect(row, col);
    editing.value = {
      recordId: record.id,
      row,
      col,
      field,
      value,
      style: {
        left: `${locRect.x}px`,
        top: `${locRect.y}px`,
        width: `${Math.max(locRect.width, 200)}px`,
        height: `${locRect.height}px`,
      },
    };
    nextTick(() => editorInput.value?.focus());
    return;
  }

  engine.ensureCellVisible(row, col);
  const rect = engine.cellRect(row, col);
  let value = textOf(record.cells[field.id]);
  if (field.type === 'checkbox') {
    value =
      record.cells[field.id] === true || record.cells[field.id] === 'true'
        ? 'true'
        : 'false';
  }
  if (field.type === 'multiSelect' && Array.isArray(record.cells[field.id])) {
    value = JSON.stringify(record.cells[field.id]);
  }
  if (field.type === 'progress') {
    const num = Number(record.cells[field.id]);
    value = Number.isFinite(num) ? String(num) : '0';
  }

  editing.value = {
    recordId: record.id,
    row,
    col,
    field,
    value,
    style: {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${Math.max(rect.width, 120)}px`,
      height: `${rect.height}px`,
    },
  };

  nextTick(() => {
    editorInput.value?.focus();
    if (editorInput.value && 'select' in editorInput.value) {
      (editorInput.value as HTMLInputElement).select?.();
    }
  });
}

function toggleCheckbox(row: number, col: number): void {
  if (!props.editable) return;
  const record = props.records[row];
  const field = visibleFields.value[col];
  if (!record || !field || field.type !== 'checkbox') return;
  const previous = record.cells[field.id];
  const next = !(previous === true || previous === 'true');
  emit('commit', {
    record,
    field,
    value: next ? 'true' : 'false',
    previous,
  });
}

/** WeCom: first click selects; second click on same cell enters edit. */
function onCellClick(selection: { row: number; col: number }): void {
  // Keep keyboard focus on the grid wrap for Enter / arrows / typing.
  const wrap = host.value?.parentElement;
  wrap?.focus({ preventScroll: true });

  const field = visibleFields.value[selection.col];
  if (field?.type === 'checkbox') {
    toggleCheckbox(selection.row, selection.col);
    return;
  }
  const prev = selectedCell.value;
  selectedCell.value = { row: selection.row, col: selection.col };
  if (
    prev &&
    prev.row === selection.row &&
    prev.col === selection.col &&
    !editing.value
  ) {
    beginEdit(selection.row, selection.col);
  }
}

function moveSelection(dRow: number, dCol: number): void {
  if (!engine || editing.value) return;
  const current = selectedCell.value ?? engine.getSelection();
  if (!current) return;
  const maxRow = (props.rowCount ?? props.records.length) - 1;
  const maxCol = visibleFields.value.length - 1;
  if (maxRow < 0 || maxCol < 0) return;
  const next = {
    row: Math.min(maxRow, Math.max(0, current.row + dRow)),
    col: Math.min(maxCol, Math.max(0, current.col + dCol)),
  };
  selectedCell.value = next;
  engine.setSelection(next);
  engine.ensureCellVisible(next.row, next.col);
}

function commitEdit(save: boolean, navigate?: 'tab' | 'enter' | 'shift-tab'): void {
  const current = editing.value;
  editing.value = null;
  if (!save || !current) {
    if (navigate) {
      const dCol = navigate === 'tab' ? 1 : navigate === 'shift-tab' ? -1 : 0;
      const dRow = navigate === 'enter' ? 1 : 0;
      moveSelection(dRow, dCol);
      void nextTick(() => {
        const sel = selectedCell.value;
        if (sel) beginEdit(sel.row, sel.col);
      });
    }
    return;
  }

  const record = props.records.find((item) => item.id === current.recordId);
  if (!record) return;

  let nextValue: unknown = current.value;
  if (current.field.type === 'checkbox') {
    nextValue =
      current.value === 'true' || current.value === '1' ? 'true' : 'false';
  } else if (current.field.type === 'multiSelect') {
    try {
      nextValue = JSON.parse(current.value) as string[];
    } catch {
      nextValue = [];
    }
  } else if (current.field.type === 'location') {
    const address = current.value.trim();
    nextValue = address ? { address } : null;
  } else if (current.field.type === 'progress') {
    const num = Number(current.value);
    nextValue = Number.isFinite(num) ? num : 0;
  } else if (current.field.type === 'relation') {
    nextValue = current.value.trim() || null;
  }

  const previous = record.cells[current.field.id];
  const previousText = textOf(previous);
  if (current.field.type === 'checkbox') {
    const prevBool =
      previous === true || previous === 'true' ? 'true' : 'false';
    if (nextValue === prevBool) {
      /* unchanged */
    } else {
      emit('commit', {
        record,
        field: current.field,
        value: nextValue,
        previous,
      });
    }
  } else if (
    current.field.type === 'location' ||
    current.field.type === 'multiSelect'
  ) {
    if (JSON.stringify(previous ?? null) !== JSON.stringify(nextValue ?? null)) {
      emit('commit', {
        record,
        field: current.field,
        value: nextValue,
        previous,
      });
    }
  } else if (String(nextValue ?? '') !== previousText) {
    emit('commit', {
      record,
      field: current.field,
      value: nextValue,
      previous,
    });
  }

  if (navigate) {
    const dCol = navigate === 'tab' ? 1 : navigate === 'shift-tab' ? -1 : 0;
    const dRow = navigate === 'enter' ? 1 : 0;
    void nextTick(() => {
      moveSelection(dRow, dCol);
      const sel = selectedCell.value;
      if (sel) beginEdit(sel.row, sel.col);
    });
  }
}

function isReadonlyField(field: FieldDto): boolean {
  return (
    field.type === 'formula' ||
    field.type === 'lookup' ||
    field.type === 'autoNumber' ||
    field.type === 'ai' ||
    field.type === 'createdBy' ||
    field.type === 'lastEditedBy' ||
    field.type === 'createdAt' ||
    field.type === 'lastEditedAt' ||
    field.type === 'image' ||
    field.type === 'file'
  );
}

function displayTextOf(field: FieldDto, value: unknown): string {
  return formatCell(field, value)?.text ?? textOf(value);
}

function coercePasteValue(field: FieldDto, text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  switch (field.type) {
    case 'number':
    case 'currency':
    case 'percent':
    case 'progress':
    case 'rating': {
      const num = Number(trimmed.replace(/[%¥￥,\s]/g, ''));
      return Number.isFinite(num) ? num : trimmed;
    }
    case 'checkbox':
      return /^(1|true|yes|y|是|✓|☑|选中)$/i.test(trimmed) ? 'true' : 'false';
    case 'select': {
      const choice = field.options?.choices?.find(
        (item) => item.id === trimmed || item.name === trimmed,
      );
      return choice?.id ?? trimmed;
    }
    case 'multiSelect': {
      const parts = trimmed
        .split(/[,，;；、]/)
        .map((part) => part.trim())
        .filter(Boolean);
      return parts.map((part) => {
        const choice = field.options?.choices?.find(
          (item) => item.id === part || item.name === part,
        );
        return choice?.id ?? part;
      });
    }
    case 'person': {
      const byName = Object.entries(props.personNames).find(
        ([, label]) => label === trimmed,
      );
      return byName?.[0] ?? trimmed;
    }
    default:
      return trimmed;
  }
}

function parseTsv(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) => line.split('\t'));
}

function copySelection(): void {
  const sel = selectedCell.value ?? engine?.getSelection() ?? null;
  if (!sel) return;
  const record = props.records[sel.row];
  const field = visibleFields.value[sel.col];
  if (!record || !field) return;
  const raw = record.cells[field.id] ?? null;
  const text = displayTextOf(field, raw);
  appClipboard = { values: [[raw]], texts: [[text]] };
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

function applyPasteGrid(grid: string[][], rawValues?: unknown[][]): void {
  const sel = selectedCell.value ?? engine?.getSelection() ?? null;
  if (!sel || !props.editable || grid.length === 0) return;
  const maxRows = props.records.length;
  const maxCols = visibleFields.value.length;
  for (let r = 0; r < grid.length; r += 1) {
    const rowIndex = sel.row + r;
    if (rowIndex >= maxRows) break;
    const record = props.records[rowIndex];
    if (!record) continue;
    const rowTexts = grid[r] ?? [];
    const rowRaws = rawValues?.[r];
    for (let c = 0; c < rowTexts.length; c += 1) {
      const colIndex = sel.col + c;
      if (colIndex >= maxCols) break;
      const field = visibleFields.value[colIndex];
      if (!field || isReadonlyField(field)) continue;
      const text = rowTexts[c] ?? '';
      const nextValue =
        rowRaws && c < (rowRaws.length ?? 0)
          ? rowRaws[c]
          : coercePasteValue(field, text);
      const previous = record.cells[field.id];
      if (JSON.stringify(previous ?? null) === JSON.stringify(nextValue ?? null)) {
        continue;
      }
      emit('commit', { record, field, value: nextValue, previous });
    }
  }
}

async function pasteSelection(event?: ClipboardEvent): Promise<void> {
  if (!props.editable) return;
  let text = event?.clipboardData?.getData('text/plain') ?? '';
  if (!text && appClipboard) {
    applyPasteGrid(appClipboard.texts, appClipboard.values);
    return;
  }
  if (!text) {
    try {
      text = (await navigator.clipboard.readText()) ?? '';
    } catch {
      text = '';
    }
  }
  if (!text) {
    if (appClipboard) applyPasteGrid(appClipboard.texts, appClipboard.values);
    return;
  }
  // Prefer same-app raw values when clipboard text still matches last copy.
  if (
    appClipboard &&
    appClipboard.texts.map((row) => row.join('\t')).join('\n') ===
      text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n$/, '')
  ) {
    applyPasteGrid(appClipboard.texts, appClipboard.values);
    return;
  }
  applyPasteGrid(parseTsv(text));
}

/** Ctrl+D：用上一行同列值向下填充（企微/表格常见快捷键）。 */
function fillDownFromAbove(): void {
  const sel = selectedCell.value ?? engine?.getSelection() ?? null;
  if (!sel || sel.row <= 0 || !props.editable) return;
  fillColumnRange(sel.col, sel.row - 1, sel.row);
}

/** Fill-handle / Ctrl+D：以 fromRow 的值覆盖 [fromRow+dir … toRow]。 */
function fillColumnRange(col: number, fromRow: number, toRow: number): void {
  if (!props.editable) return;
  const field = visibleFields.value[col];
  const source = props.records[fromRow];
  if (!field || !source || isReadonlyField(field)) return;
  const nextValue = source.cells[field.id] ?? null;
  const start = Math.min(fromRow, toRow);
  const end = Math.max(fromRow, toRow);
  for (let row = start; row <= end; row += 1) {
    if (row === fromRow) continue;
    const record = props.records[row];
    if (!record) continue;
    const previous = record.cells[field.id];
    if (JSON.stringify(previous ?? null) === JSON.stringify(nextValue ?? null)) {
      continue;
    }
    emit('commit', { record, field, value: nextValue, previous });
  }
}

function onHostPaste(event: ClipboardEvent): void {
  if (!props.editable || editing.value) return;
  const target = event.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable)
  ) {
    return;
  }
  event.preventDefault();
  void pasteSelection(event);
}

function onHostKeydown(event: KeyboardEvent): void {
  if (!props.editable || !engine) return;
  if (editing.value) return;
  const target = event.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable)
  ) {
    return;
  }

  const sel = selectedCell.value ?? engine.getSelection();
  if (!sel) return;

  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === 'c') {
    event.preventDefault();
    copySelection();
    return;
  }
  if (mod && event.key.toLowerCase() === 'v') {
    event.preventDefault();
    void pasteSelection();
    return;
  }
  if (mod && event.key.toLowerCase() === 'd') {
    event.preventDefault();
    fillDownFromAbove();
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    beginEdit(sel.row, sel.col);
    return;
  }
  if (event.key === 'F2') {
    event.preventDefault();
    beginEdit(sel.row, sel.col);
    return;
  }
  if (event.key === 'Tab') {
    event.preventDefault();
    moveSelection(0, event.shiftKey ? -1 : 1);
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveSelection(-1, 0);
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveSelection(1, 0);
    return;
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    moveSelection(0, -1);
    return;
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    moveSelection(0, 1);
    return;
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    const record = props.records[sel.row];
    const field = visibleFields.value[sel.col];
    if (!record || !field || isReadonlyField(field)) return;
    const previous = record.cells[field.id];
    emit('commit', { record, field, value: null, previous });
    return;
  }
  // Start typing → open editor with first character (WeCom overwrite feel).
  if (
    event.key.length === 1 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    event.preventDefault();
    beginEdit(sel.row, sel.col);
    void nextTick(() => {
      if (editing.value && editorKind.value === 'text') {
        editing.value = { ...editing.value, value: event.key };
      }
    });
  }
}
async function onUploadFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  const target = pendingUpload.value;
  pendingUpload.value = null;
  if (!file || !target || !props.uploadAttachment || uploading.value) return;
  uploading.value = true;
  try {
    const uploaded = await props.uploadAttachment(file);
    emit('commit', {
      record: target.record,
      field: target.field,
      value: uploaded,
      previous: target.record.cells[target.field.id],
    });
  } finally {
    uploading.value = false;
  }
}

function selectRow(row: number, modifiers: { shift: boolean; meta: boolean }): void {
  if (modifiers.shift && rowAnchor !== null) {
    const start = Math.min(rowAnchor, row);
    const end = Math.max(rowAnchor, row);
    selectedRows.value = Array.from(
      { length: end - start + 1 },
      (_, index) => start + index,
    );
  } else if (modifiers.meta) {
    selectedRows.value = selectedRows.value.includes(row)
      ? selectedRows.value.filter((item) => item !== row)
      : [...selectedRows.value, row];
    rowAnchor = row;
  } else {
    selectedRows.value = [row];
    rowAnchor = row;
  }
  engine?.setSelectedRows(selectedRows.value);
  emit(
    'rowsSelected',
    selectedRows.value
      .map((index) => props.records[index]?.id)
      .filter((id): id is string => Boolean(id)),
  );
}

function clearRowSelection(): void {
  selectedRows.value = [];
  rowAnchor = null;
  engine?.setSelectedRows([]);
  emit('rowsSelected', []);
}

function toggleMultiChoice(choiceId: string): void {
  if (!editing.value) return;
  const set = new Set(multiSelected.value);
  if (set.has(choiceId)) set.delete(choiceId);
  else set.add(choiceId);
  editing.value = {
    ...editing.value,
    value: JSON.stringify([...set]),
  };
}

function handleViewport(stats: GridStats): void {
  if (stats.rows.end === lastViewportEnd) return;
  lastViewportEnd = stats.rows.end;
  emit('viewport', stats);
}

function columnFooter(col: number): string | null {
  const field = visibleFields.value[col];
  if (!field) return null;
  // 企微：首列「记录数」，数字/货币列「求和」
  if (col === 0) {
    return `记录数 ${props.records.length}`;
  }
  if (field.type === 'number' || field.type === 'currency') {
    let sum = 0;
    for (const record of props.records) {
      const raw = record.cells[field.id];
      const n =
        typeof raw === 'number'
          ? raw
          : Number(String(raw ?? '').replace(/[^0-9.\-]/g, ''));
      if (Number.isFinite(n)) sum += n;
    }
    return `求和 ${sum}`;
  }
  return null;
}

function createEngine(): void {
  if (!host.value) return;
  engine = new CanvasGridEngine(host.value, {
    columns: columns.value,
    rowCount: props.rowCount ?? props.records.length,
    rowHeight: props.rowHeight,
    freezeColumnCount: props.freezeColumnCount,
    getCell: renderCell,
    getColumnFooter: columnFooter,
    getRowColor: (row) => {
      const record = props.records[row];
      return record ? (props.rowColors[record.id] ?? null) : null;
    },
    onCellClick: onCellClick,
    onSelectionChange: (selection) => {
      selectedCell.value = selection;
    },
    onCellDoubleClick: (selection) => {
      selectedCell.value = selection;
      beginEdit(selection.row, selection.col);
    },
    onColumnResize: (columnIndex, width) => {
      const field = visibleFields.value[columnIndex];
      if (!field) return;
      resizedWidths.set(field.id, width);
      emit('resizeField', { field, width });
    },
    onRowNumberClick: selectRow,
    onAddColumnClick: (anchor) => emit('addColumn', anchor),
    onFooterAddClick: openInsertMenu,
    onRowInsertMenu: (row, anchor) => openInsertMenu(anchor, row),
    onCellContextMenu: openCellMenu,
    onHeaderClick: (columnIndex, anchor) => {
      const field = visibleFields.value[columnIndex];
      if (field) emit('headerClick', { field, anchor });
    },
    onFillExtend: ({ col, fromRow, toRow }) => {
      fillColumnRange(col, fromRow, toRow);
    },
    onViewportChange: handleViewport,
  });
}

onMounted(createEngine);

watch(
  [() => props.fields, () => props.records, () => props.rowCount],
  () => {
    if (!engine) return;
    engine.setColumns(columns.value);
    engine.setRowCount(props.rowCount ?? props.records.length);
    engine.setCellProvider(renderCell);
    engine.setColumnFooterProvider(columnFooter);
    engine.invalidate();
  },
  { deep: true },
);

watch(
  () => props.rowHeight,
  () => {
    engine?.destroy();
    engine = null;
    createEngine();
  },
);

watch(
  () => props.freezeColumnCount,
  (count) => {
    engine?.setFreezeColumnCount(count ?? 0);
  },
);

watch(
  () => props.rowColors,
  () => engine?.invalidate(),
  { deep: true },
);

watch(
  () => props.rowDepths,
  () => engine?.invalidate(),
  { deep: true },
);

onBeforeUnmount(() => {
  engine?.destroy();
  engine = null;
});

defineExpose({
  getEngine: () => engine,
  clearRowSelection,
  getSelection: () => selectedCell.value,
});
</script>

<template>
  <div
    class="canvas-grid-wrap"
    tabindex="0"
    data-testid="canvas-grid-wrap"
    @keydown="onHostKeydown"
    @paste="onHostPaste"
  >
    <div ref="host" class="canvas-grid-host" data-testid="canvas-grid"></div>
    <div
      v-if="insertMenu"
      class="insert-menu-mask"
      data-testid="insert-rows-mask"
      @mousedown.self="closeInsertMenu"
    />
    <div
      v-if="insertMenu"
      class="insert-menu"
      data-testid="insert-rows-menu"
      :style="{ top: `${insertMenu.top}px`, left: `${insertMenu.left}px` }"
    >
      <button
        type="button"
        class="insert-menu-row"
        data-testid="insert-rows-above"
        @click="confirmInsert('above')"
      >
        <span class="insert-menu-icon">↑</span>
        <span class="insert-menu-label">向上插入</span>
        <input
          v-model.number="insertMenu.aboveCount"
          type="number"
          min="1"
          max="100"
          class="insert-menu-count"
          data-testid="insert-rows-above-count"
          @click.stop
          @keydown.enter.prevent="confirmInsert('above')"
        />
        <span class="insert-menu-unit">行</span>
      </button>
      <button
        type="button"
        class="insert-menu-row"
        data-testid="insert-rows-below"
        @click="confirmInsert('below')"
      >
        <span class="insert-menu-icon">↓</span>
        <span class="insert-menu-label">向下插入</span>
        <input
          v-model.number="insertMenu.belowCount"
          type="number"
          min="1"
          max="100"
          class="insert-menu-count"
          data-testid="insert-rows-below-count"
          @click.stop
          @keydown.enter.prevent="confirmInsert('below')"
        />
        <span class="insert-menu-unit">行</span>
      </button>
    </div>

    <div
      v-if="cellMenu"
      class="insert-menu-mask"
      data-testid="cell-context-mask"
      @mousedown.self="closeCellMenu"
    />
    <div
      v-if="cellMenu"
      class="insert-menu cell-context-menu"
      data-testid="cell-context-menu"
      :style="{ top: `${cellMenu.top}px`, left: `${cellMenu.left}px` }"
      @click.stop
    >
      <button
        type="button"
        class="insert-menu-row"
        data-testid="cell-ctx-delete-row"
        @click="cellMenuDeleteRow"
      >
        <span class="insert-menu-icon">⌫</span>
        <span class="insert-menu-label">删除行</span>
      </button>
      <button
        type="button"
        class="insert-menu-row"
        data-testid="cell-ctx-delete-col"
        @click="cellMenuDeleteCol"
      >
        <span class="insert-menu-icon">⊟</span>
        <span class="insert-menu-label">删除列</span>
      </button>
      <div class="insert-menu-divider"></div>
      <button
        type="button"
        class="insert-menu-row"
        data-testid="cell-ctx-insert-above"
        @click="cellMenuInsertRows('above')"
      >
        <span class="insert-menu-icon">↑</span>
        <span class="insert-menu-label">向上插入</span>
        <input
          v-model.number="cellMenu.aboveCount"
          type="number"
          min="1"
          max="100"
          class="insert-menu-count"
          data-testid="cell-ctx-above-count"
          @click.stop
          @keydown.enter.prevent="cellMenuInsertRows('above')"
        />
        <span class="insert-menu-unit">行</span>
      </button>
      <button
        type="button"
        class="insert-menu-row"
        data-testid="cell-ctx-insert-below"
        @click="cellMenuInsertRows('below')"
      >
        <span class="insert-menu-icon">↓</span>
        <span class="insert-menu-label">向下插入</span>
        <input
          v-model.number="cellMenu.belowCount"
          type="number"
          min="1"
          max="100"
          class="insert-menu-count"
          data-testid="cell-ctx-below-count"
          @click.stop
          @keydown.enter.prevent="cellMenuInsertRows('below')"
        />
        <span class="insert-menu-unit">行</span>
      </button>
      <button
        type="button"
        class="insert-menu-row"
        data-testid="cell-ctx-insert-left"
        @click="cellMenuInsertCols('left')"
      >
        <span class="insert-menu-icon">←</span>
        <span class="insert-menu-label">向左插入</span>
        <input
          v-model.number="cellMenu.leftCount"
          type="number"
          min="1"
          max="20"
          class="insert-menu-count"
          data-testid="cell-ctx-left-count"
          @click.stop
          @keydown.enter.prevent="cellMenuInsertCols('left')"
        />
        <span class="insert-menu-unit">列</span>
      </button>
      <button
        type="button"
        class="insert-menu-row"
        data-testid="cell-ctx-insert-right"
        @click="cellMenuInsertCols('right')"
      >
        <span class="insert-menu-icon">→</span>
        <span class="insert-menu-label">向右插入</span>
        <input
          v-model.number="cellMenu.rightCount"
          type="number"
          min="1"
          max="20"
          class="insert-menu-count"
          data-testid="cell-ctx-right-count"
          @click.stop
          @keydown.enter.prevent="cellMenuInsertCols('right')"
        />
        <span class="insert-menu-unit">列</span>
      </button>
    </div>
    <input
      ref="uploadInput"
      type="file"
      class="hidden-upload"
      :accept="
        editing?.field.type === 'image' || pendingUpload?.field.type === 'image'
          ? 'image/*'
          : undefined
      "
      data-testid="cell-upload-input"
      @change="onUploadFile"
    />
    <div v-if="uploading" class="upload-hint">上传中…</div>

    <select
      v-if="editing && editorKind === 'person'"
      ref="editorInput"
      v-model="editing.value"
      class="cell-editor"
      :style="editing.style"
      data-testid="cell-editor"
      @change="commitEdit(true)"
      @blur="commitEdit(true)"
      @keydown.esc.prevent="commitEdit(false)"
    >
      <option value="">未指定成员</option>
      <option
        v-for="(memberName, memberId) in personNames"
        :key="memberId"
        :value="memberId"
      >
        {{ memberName }}
      </option>
    </select>

    <select
      v-else-if="editing && editorKind === 'relation'"
      ref="editorInput"
      v-model="editing.value"
      class="cell-editor"
      :style="editing.style"
      data-testid="cell-editor-relation"
      @change="commitEdit(true)"
      @blur="commitEdit(true)"
      @keydown.esc.prevent="commitEdit(false)"
    >
      <option value="">{{ relationLoading ? '加载中…' : '选择关联记录' }}</option>
      <option
        v-for="choice in relationChoices"
        :key="choice.id"
        :value="choice.id"
      >
        {{ choice.label }}
      </option>
    </select>

    <select
      v-else-if="editing && editorKind === 'select'"
      ref="editorInput"
      v-model="editing.value"
      class="cell-editor"
      :style="editing.style"
      data-testid="cell-editor"
      @change="commitEdit(true)"
      @blur="commitEdit(true)"
      @keydown.esc.prevent="commitEdit(false)"
    >
      <option value="">未填写</option>
      <option
        v-for="choice in selectChoices"
        :key="choice.id"
        :value="choice.id"
      >
        {{ choice.name }}
      </option>
    </select>

    <div
      v-else-if="editing && editorKind === 'multiSelect'"
      class="cell-editor multi-editor"
      :style="editing.style"
      data-testid="cell-editor"
    >
      <label
        v-for="choice in selectChoices"
        :key="choice.id"
        class="multi-option"
      >
        <input
          type="checkbox"
          :checked="multiSelected.includes(choice.id)"
          @change="toggleMultiChoice(choice.id)"
        />
        {{ choice.name }}
      </label>
      <button class="btn btn-primary multi-done" type="button" @click="commitEdit(true)">
        完成
      </button>
    </div>

    <select
      v-else-if="editing && editorKind === 'checkbox'"
      ref="editorInput"
      v-model="editing.value"
      class="cell-editor"
      :style="editing.style"
      data-testid="cell-editor"
      @change="commitEdit(true)"
      @blur="commitEdit(true)"
      @keydown.esc.prevent="commitEdit(false)"
    >
      <option value="true">已勾选</option>
      <option value="false">未勾选</option>
    </select>

    <div
      v-else-if="editing && editorKind === 'progress'"
      class="cell-editor progress-editor"
      :style="editing.style"
      data-testid="cell-editor-progress"
    >
      <input
        ref="editorInput"
        v-model="editing.value"
        type="range"
        min="0"
        max="100"
        @keydown.enter.prevent="commitEdit(true)"
        @keydown.esc.prevent="commitEdit(false)"
      />
      <span>{{ editing.value }}%</span>
      <button type="button" class="btn small" @click="commitEdit(true)">确定</button>
    </div>

    <input
      v-else-if="editing"
      ref="editorInput"
      v-model="editing.value"
      class="cell-editor"
      :style="editing.style"
      :type="
        editorKind === 'date'
          ? 'date'
          : editorKind === 'number'
            ? 'number'
            : editorKind === 'email'
              ? 'email'
              : editorKind === 'tel'
                ? 'tel'
                : editorKind === 'url'
                  ? 'url'
                  : 'text'
      "
      :placeholder="
        editorKind === 'location'
          ? '输入地址'
          : editorKind === 'barcode'
            ? '扫描或输入条码'
            : undefined
      "
      data-testid="cell-editor"
      @keydown.enter.prevent="commitEdit(true, 'enter')"
      @keydown.tab.prevent="commitEdit(true, $event.shiftKey ? 'shift-tab' : 'tab')"
      @keydown.esc.prevent="commitEdit(false)"
      @blur="commitEdit(true)"
    />
  </div>
</template>

<style scoped>
.canvas-grid-wrap {
  outline: none;
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
}
.hidden-upload {
  display: none;
}
.upload-hint {
  position: absolute;
  right: 14px;
  bottom: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(31, 35, 41, 0.82);
  color: #fff;
  font-size: 12px;
  pointer-events: none;
}
.multi-editor {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 80px !important;
  height: auto !important;
  padding: 8px !important;
  overflow: auto;
}
.multi-option {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.progress-editor {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px !important;
  height: auto !important;
  min-height: 36px !important;
  background: #fff;
}
.progress-editor input[type='range'] {
  flex: 1;
  min-width: 0;
}
.multi-done {
  align-self: flex-end;
  height: 28px;
  margin-top: 4px;
}
.insert-menu-mask {
  position: fixed;
  inset: 0;
  z-index: 40;
}
.insert-menu {
  position: fixed;
  z-index: 41;
  min-width: 220px;
  padding: 6px 0;
  background: #fff;
  border: 1px solid #e5e6eb;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(31, 35, 41, 0.12);
}
.insert-menu-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 36px;
  padding: 0 14px;
  border: 0;
  background: transparent;
  color: #1f2329;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}
.insert-menu-row:hover {
  background: #f5f6f7;
}
.insert-menu-icon {
  width: 16px;
  color: #646a73;
  text-align: center;
}
.insert-menu-label {
  flex: 1;
}
.insert-menu-count {
  width: 44px;
  height: 24px;
  padding: 0 6px;
  border: 1px solid #d0d3d6;
  border-radius: 4px;
  font-size: 13px;
  text-align: center;
}
.insert-menu-unit {
  color: #646a73;
}
.insert-menu-divider {
  height: 1px;
  margin: 4px 0;
  background: #eef0f3;
}
.cell-context-menu {
  min-width: 240px;
}
</style>
