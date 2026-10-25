<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import CanvasGrid from './CanvasGrid.vue';
import FieldTypePicker from './FieldTypePicker.vue';
import FieldOptionsEditor from './FieldOptionsEditor.vue';
import { useFloatDrag } from '../composables/useFloatDrag';
import { endpoints } from '../api/endpoints';
import { toast } from '../ui/toast';
import type { FieldDto, MemberDto, RecordDto, SheetDto } from '../api/types';
import type { GridStats } from '../grid-canvas/engine';
import type {
  ColorRule,
  FieldType,
  FilterCondition,
  FilterOperator,
  GroupSpec,
  RowHeight,
  SortSpec,
  ViewQuery,
} from 'shared';
import { evaluateFormulaRows, VALUELESS_FILTER_OPERATORS } from 'shared';
import { fieldTypeIcon } from '../ui/field-icons';
import {
  canRedo,
  canUndo,
  getUndoStack,
  subscribeEditHistory,
  type EditHistoryEntry,
} from '../ui/edit-history';

const props = defineProps<{
  sheetId: string;
  sheetName: string;
  fields: FieldDto[];
  records: RecordDto[];
  nextCursor: string | null;
  loading: boolean;
  rowColors?: Record<string, string>;
  rowHeight?: number;
  groups?: Array<{ fieldId: string; key: string; label: string; count: number }>;
  members?: MemberDto[];
  /** Other sheets in the same base (relation target picker). */
  sheets?: SheetDto[];
  uploadAttachment?: (file: File) => Promise<{
    url: string;
    name: string;
    mimetype?: string;
    size?: number;
  }>;
}>();

const emit = defineEmits<{
  addRow: [];
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
  loadMore: [];
  refresh: [];
  undo: [];
  redo: [];
  commit: [
    payload: {
      record: RecordDto;
      field: FieldDto;
      value: unknown;
      previous?: unknown;
    },
  ];
  toggleField: [payload: { field: FieldDto; hidden: boolean }];
  query: [query: ViewQuery];
  queryChange: [query: ViewQuery];
  createField: [
    payload: {
      name: string;
      type: FieldType;
      options?: Record<string, unknown>;
      order?: number;
    },
  ];
  updateField: [
    payload: {
      field: FieldDto;
      name: string;
      type: FieldType;
      options?: Record<string, unknown>;
    },
  ];
  deleteField: [field: FieldDto];
  deleteRecords: [recordIds: string[]];
}>();

const gridRef = ref<InstanceType<typeof CanvasGrid> | null>(null);
const settingsOpen = ref(false);
const fieldPickerOpen = ref(false);
const automationButtons = ref<
  Array<{ buttonKey: string; buttonLabel: string; automationId: string }>
>([]);
const runningButtonKey = ref('');
const fieldPickerMode = ref<'create' | 'edit'>('create');
const fieldPickerAnchor = ref<{ top: number; left: number } | null>(null);
const editingField = ref<FieldDto | null>(null);
const addFieldBtn = ref<HTMLButtonElement | null>(null);
const activePanel = ref<
  'filter' | 'sort' | 'group' | 'rowHeight' | 'freeze' | 'color' | null
>(null);
const optionsField = ref<FieldDto | null>(null);
const deletingField = ref<FieldDto | null>(null);
const selectedRecordIds = ref<string[]>([]);
const searchOpen = ref(false);
const searchQuery = ref('');
const historyOpen = ref(false);
const fieldMenuId = ref<string | null>(null);
const undoAvailable = ref(false);
const redoAvailable = ref(false);
const historyEntries = ref<EditHistoryEntry[]>([]);

const {
  root: settingsRoot,
  style: settingsDragStyle,
  onHandlePointerDown: onSettingsDrag,
  reset: resetSettingsDrag,
} = useFloatDrag();
const {
  root: viewPanelRoot,
  style: viewPanelDragStyle,
  onHandlePointerDown: onViewPanelDrag,
  reset: resetViewPanelDrag,
} = useFloatDrag();
const {
  root: historyRoot,
  style: historyDragStyle,
  onHandlePointerDown: onHistoryDrag,
  reset: resetHistoryDrag,
} = useFloatDrag();

watch(settingsOpen, (open) => {
  if (open) resetSettingsDrag();
});
watch(activePanel, (panel) => {
  if (panel) resetViewPanelDrag();
});
watch(historyOpen, (open) => {
  if (open) resetHistoryDrag();
});

function syncHistoryState(): void {
  undoAvailable.value = canUndo();
  redoAvailable.value = canRedo();
  historyEntries.value = [...getUndoStack()].reverse().slice(0, 40);
}

let unsubscribeHistory: (() => void) | null = null;
onMounted(() => {
  syncHistoryState();
  unsubscribeHistory = subscribeEditHistory(syncHistoryState);
  void loadAutomationButtons();
});
onBeforeUnmount(() => {
  unsubscribeHistory?.();
});

const filterConjunction = ref<'and' | 'or'>('and');
const filters = ref<FilterCondition[]>([
  { fieldId: '', operator: 'equals', value: '' },
]);
const sorts = ref<SortSpec[]>([
  { fieldId: '', direction: 'asc', mode: 'value' },
]);
const groups = ref<GroupSpec[]>([{ fieldId: '' }]);
const colorRules = ref<ColorRule[]>([
  {
    fieldId: '',
    operator: 'equals',
    value: '',
    color: '#fff1f0',
    scope: 'row',
  },
]);
const rowHeightChoice = ref<'short' | 'medium' | 'tall'>('medium');
const freezeColumnCount = ref(0);
const colorField = ref('');
const colorOperator = ref<FilterOperator>('equals');
const colorValue = ref('');
const color = ref('#fff1f0');

const operators: Array<{ value: FilterOperator; label: string }> = [
  { value: 'equals', label: '等于' },
  { value: 'notEquals', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'notContains', label: '不包含' },
  { value: 'isEmpty', label: '为空' },
  { value: 'isNotEmpty', label: '不为空' },
  { value: 'gt', label: '大于' },
  { value: 'gte', label: '大于等于' },
  { value: 'lt', label: '小于' },
  { value: 'lte', label: '小于等于' },
  { value: 'before', label: '早于' },
  { value: 'after', label: '晚于' },
  { value: 'isTrue', label: '已勾选' },
  { value: 'isFalse', label: '未勾选' },
];

const COLORS = [
  { id: '#fff1f0', label: '浅红' },
  { id: '#fff7e6', label: '浅橙' },
  { id: '#fffbe6', label: '浅黄' },
  { id: '#e8fff3', label: '浅绿' },
  { id: '#e8f3ff', label: '浅蓝' },
  { id: '#f5f0ff', label: '浅紫' },
  { id: '#f2f3f5', label: '浅灰' },
];

const visibleFields = computed(() => props.fields.filter((field) => !field.hidden));
const personNames = computed<Record<string, string>>(() =>
  Object.fromEntries(
    (props.members ?? []).map((member) => [member.userId, member.name]),
  ),
);

const groupLabels = computed(() => {
  const names = new Map(props.fields.map((field) => [field.id, field.name]));
  return (props.groups ?? []).map((group) => ({
    ...group,
    fieldName: names.get(group.fieldId) ?? '',
  }));
});

const formulaRecords = computed<RecordDto[]>(() => {
  if (!props.fields.some((field) => field.type === 'formula')) {
    return props.records;
  }
  const values = evaluateFormulaRows(
    props.fields.map((field) => ({
      id: field.id,
      name: field.name,
      type: field.type,
      options: field.options as { formula?: string } | null,
    })),
    props.records,
  );
  return props.records.map((record, index) => ({
    ...record,
    cells: { ...record.cells, ...(values[index] ?? {}) },
  }));
});

const parentField = computed(() =>
  props.fields.find(
    (field) =>
      field.type === 'relation' &&
      Boolean((field.options as { asParentField?: boolean } | null)?.asParentField),
  ) ?? null,
);

const parentFieldId = computed(() => parentField.value?.id ?? '');

const relationFields = computed(() =>
  props.fields.filter((field) => field.type === 'relation'),
);

/** Flatten records into parent→child order when 父记录字段 is set. */
function hierarchyOrder(records: RecordDto[], fieldId: string): {
  records: RecordDto[];
  depths: Record<string, number>;
} {
  const byId = new Map(records.map((record) => [record.id, record]));
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  const depths: Record<string, number> = {};

  for (const record of records) {
    const raw = record.cells[fieldId];
    const parentId = Array.isArray(raw) ? String(raw[0] ?? '') : String(raw ?? '');
    if (parentId && byId.has(parentId) && parentId !== record.id) {
      const list = children.get(parentId) ?? [];
      list.push(record.id);
      children.set(parentId, list);
    } else {
      roots.push(record.id);
    }
  }

  const ordered: RecordDto[] = [];
  const visit = (id: string, depth: number) => {
    const record = byId.get(id);
    if (!record || depths[id] !== undefined) return;
    depths[id] = depth;
    ordered.push(record);
    for (const childId of children.get(id) ?? []) visit(childId, depth + 1);
  };
  for (const id of roots) visit(id, 0);
  for (const record of records) {
    if (depths[record.id] === undefined) visit(record.id, 0);
  }
  return { records: ordered, depths };
}

const hierarchy = computed(() => {
  if (!parentFieldId.value) {
    return { records: formulaRecords.value, depths: {} as Record<string, number> };
  }
  return hierarchyOrder(formulaRecords.value, parentFieldId.value);
});

/** 搜索走服务端 ViewQuery.search；此处只做层级展开，不再本地截行. */
const displayRecords = computed<RecordDto[]>(() => hierarchy.value.records);

let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(searchQuery, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    emitQuery();
  }, 280);
});

const rowDepths = computed(() => hierarchy.value.depths);

function setParentField(fieldId: string): void {
  const previous = parentField.value;
  if (previous && previous.id !== fieldId) {
    emit('updateField', {
      field: previous,
      name: previous.name,
      type: previous.type as FieldType,
      options: {
        ...(previous.options ?? {}),
        asParentField: false,
      },
    });
  }
  if (!fieldId) return;
  const next = props.fields.find((field) => field.id === fieldId);
  if (!next) return;
  emit('updateField', {
    field: next,
    name: next.name,
    type: next.type as FieldType,
    options: {
      ...(next.options ?? {}),
      asParentField: true,
    },
  });
}

const activeFilterCount = computed(
  () => filters.value.filter((row) => row.fieldId).length,
);
const activeSortCount = computed(
  () => sorts.value.filter((row) => row.fieldId).length,
);
const activeGroupCount = computed(
  () => groups.value.filter((row) => row.fieldId).length,
);
const activeColorCount = computed(
  () => colorRules.value.filter((row) => row.fieldId).length,
);
const activeConditionLabel = computed(() => {
  const parts: string[] = [];
  if (activeFilterCount.value) parts.push(`筛选 ${activeFilterCount.value}`);
  if (activeGroupCount.value) parts.push(`分组 ${activeGroupCount.value}`);
  if (activeSortCount.value) parts.push(`排序 ${activeSortCount.value}`);
  if (activeColorCount.value) parts.push(`填色 ${activeColorCount.value}`);
  if (freezeColumnCount.value > 0) {
    parts.push(`冻结 ${freezeColumnCount.value}`);
  }
  return parts.join(' · ');
});

function isValueless(operator: FilterOperator): boolean {
  return VALUELESS_FILTER_OPERATORS.includes(operator);
}

function guardError(message: string): void {
  toast(message);
}

function buildQuery(): ViewQuery {
  const query: ViewQuery = {};
  const conditions = filters.value.filter(
    (row) => row.fieldId && row.operator,
  );
  if (conditions.length > 0) {
    query.filters = {
      conjunction: filterConjunction.value,
      conditions: conditions.map((row) => ({
        fieldId: row.fieldId,
        operator: row.operator,
        value: isValueless(row.operator) ? undefined : row.value,
      })),
    };
  }
  const sortSpecs = sorts.value.filter((row) => row.fieldId);
  if (sortSpecs.length > 0) {
    query.sorts = sortSpecs.map((row) => ({
      fieldId: row.fieldId,
      direction: row.direction,
      mode: row.mode,
    }));
  }
  const groupSpecs = groups.value.filter((row) => row.fieldId);
  if (groupSpecs.length > 0) {
    query.groups = groupSpecs.map((row) => ({ fieldId: row.fieldId }));
  }
  const colors = colorRules.value.filter((row) => row.fieldId);
  if (colors.length > 0) {
    query.colorRules = colors.map((row) => ({
      fieldId: row.fieldId,
      operator: row.operator,
      value: row.value,
      color: row.color,
      scope: row.scope ?? 'row',
    }));
  }
  if (rowHeightChoice.value !== 'medium') {
    query.rowHeight = rowHeightChoice.value as RowHeight;
  }
  if (freezeColumnCount.value > 0) {
    query.freezeColumnCount = freezeColumnCount.value;
  }
  const search = searchQuery.value.trim();
  if (search) query.search = search;
  return query;
}

function emitQuery(): void {
  const query = buildQuery();
  emit('query', JSON.parse(JSON.stringify(query)) as ViewQuery);
  emit('queryChange', query);
}

/** 预览：表格立刻按当前条件刷新，面板保持打开便于继续改。 */
function previewFilters(): boolean {
  if (activeFilterCount.value === 0) {
    guardError('请至少选择一个筛选字段');
    return false;
  }
  emitQuery();
  return true;
}

function applyFilters(): void {
  if (!previewFilters()) return;
  activePanel.value = null;
}

function previewSorts(): boolean {
  if (activeSortCount.value === 0) {
    guardError('请至少选择一个排序字段');
    return false;
  }
  emitQuery();
  return true;
}

function applySorts(): void {
  if (!previewSorts()) return;
  activePanel.value = null;
}

function previewGroups(): boolean {
  emitQuery();
  return true;
}

function applyGroups(): void {
  previewGroups();
  activePanel.value = null;
}

function previewColors(): boolean {
  if (activeColorCount.value === 0) {
    guardError('请至少选择一条填色规则');
    return false;
  }
  emitQuery();
  return true;
}

function applyColors(): void {
  if (!previewColors()) return;
  activePanel.value = null;
}

function addFilter(): void {
  filters.value = [
    ...filters.value,
    { fieldId: '', operator: 'equals', value: '' },
  ];
}

function removeFilter(index: number): void {
  filters.value = filters.value.filter((_, item) => item !== index);
}

function addSort(): void {
  sorts.value = [
    ...sorts.value,
    { fieldId: '', direction: 'asc', mode: 'value' },
  ];
}

function removeSort(index: number): void {
  sorts.value = sorts.value.filter((_, item) => item !== index);
}

function addGroup(): void {
  groups.value = [...groups.value, { fieldId: '' }];
}

function removeGroup(index: number): void {
  groups.value = groups.value.filter((_, item) => item !== index);
}

function addColorRule(): void {
  colorRules.value = [
    ...colorRules.value,
    {
      fieldId: '',
      operator: 'equals',
      value: '',
      color: '#fff1f0',
      scope: 'row',
    },
  ];
}

function removeColorRule(index: number): void {
  colorRules.value = colorRules.value.filter((_, item) => item !== index);
}

function setRowHeight(height: 'short' | 'medium' | 'tall'): void {
  rowHeightChoice.value = height;
  emitQuery();
}

function maxFreezeColumns(): number {
  return Math.max(0, props.fields.filter((field) => !field.hidden).length);
}

function setFreezeColumnCount(count: number): void {
  freezeColumnCount.value = Math.max(
    0,
    Math.min(maxFreezeColumns(), Math.floor(count)),
  );
  emitQuery();
}

function clearView(): void {
  filterConjunction.value = 'and';
  filters.value = [{ fieldId: '', operator: 'equals', value: '' }];
  sorts.value = [{ fieldId: '', direction: 'asc', mode: 'value' }];
  groups.value = [{ fieldId: '' }];
  colorRules.value = [
    {
      fieldId: '',
      operator: 'equals',
      value: '',
      color: '#fff1f0',
      scope: 'row',
    },
  ];
  rowHeightChoice.value = 'medium';
  freezeColumnCount.value = 0;
  emitQuery();
}

function applySavedQuery(query: ViewQuery): void {
  const cloned = JSON.parse(JSON.stringify(query)) as ViewQuery;
  const filterGroup = cloned.filters;
  filterConjunction.value = filterGroup?.conjunction ?? 'and';
  filters.value =
    filterGroup?.conditions
      ?.filter((node): node is FilterCondition => !('conditions' in node))
      .map((node) => ({ ...node })) ?? [
      { fieldId: '', operator: 'equals', value: '' },
    ];
  sorts.value = cloned.sorts?.map((spec) => ({ ...spec })) ?? [
    { fieldId: '', direction: 'asc', mode: 'value' },
  ];
  groups.value = cloned.groups?.map((spec) => ({ ...spec })) ?? [
    { fieldId: '' },
  ];
  colorRules.value = cloned.colorRules?.map((rule) => ({ ...rule })) ?? [
    {
      fieldId: '',
      operator: 'equals',
      value: '',
      color: '#fff1f0',
      scope: 'row',
    },
  ];
  if (
    cloned.rowHeight === 'short' ||
    cloned.rowHeight === 'medium' ||
    cloned.rowHeight === 'tall'
  ) {
    rowHeightChoice.value = cloned.rowHeight;
  }
  freezeColumnCount.value = Math.max(
    0,
    Math.min(maxFreezeColumns(), Number(cloned.freezeColumnCount) || 0),
  );
  emitQuery();
}

const columnMenu = ref<{
  field: FieldDto;
  top: number;
  left: number;
} | null>(null);
const columnMenuSortOpen = ref(false);

function openColumnMenu(payload: {
  field: FieldDto;
  anchor: { top: number; left: number };
}): void {
  closeOverlaysExcept('columnMenu');
  columnMenuSortOpen.value = false;
  const left = Math.min(payload.anchor.left, window.innerWidth - 240);
  const top = Math.min(payload.anchor.top, window.innerHeight - 280);
  columnMenu.value = {
    field: payload.field,
    top: Math.max(8, top),
    left: Math.max(8, left),
  };
}

function closeColumnMenu(): void {
  columnMenu.value = null;
  columnMenuSortOpen.value = false;
}

function uniqueFieldName(base: string): string {
  const names = new Set(props.fields.map((field) => field.name));
  if (!names.has(base)) return base;
  let index = 2;
  while (names.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

function cellDisplayText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === 'object' && 'name' in item) {
          return String((item as { name: unknown }).name ?? '');
        }
        return String(item ?? '');
      })
      .filter(Boolean)
      .join(', ');
  }
  if (typeof value === 'object' && value && 'name' in value) {
    return String((value as { name: unknown }).name ?? '');
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function duplicateColumn(field: FieldDto): void {
  const options = { ...(field.options ?? {}) } as Record<string, unknown>;
  delete options.width;
  delete options.asParentField;
  emit('createField', {
    name: uniqueFieldName(`${field.name} 副本`),
    type: field.type as FieldType,
    options,
  });
  closeColumnMenu();
}

function autoFitColumnWidth(field: FieldDto): void {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return;
  context.font = '600 12px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  let max = context.measureText(field.name).width + 52;
  context.font = '13px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  for (const record of props.records) {
    const text = cellDisplayText(record.cells?.[field.id]);
    if (!text) continue;
    max = Math.max(max, context.measureText(text).width + 28);
  }
  const width = Math.min(480, Math.max(80, Math.ceil(max)));
  onColumnResize({ field, width });
  closeColumnMenu();
  toast(`已调整「${field.name}」列宽`);
}

function freezeToColumn(field: FieldDto): void {
  const visible = props.fields.filter((item) => !item.hidden);
  const index = visible.findIndex((item) => item.id === field.id);
  if (index < 0) return;
  setFreezeColumnCount(index + 1);
  closeColumnMenu();
  toast(`已冻结至「${field.name}」`);
}

function hideColumn(field: FieldDto): void {
  emit('toggleField', { field, hidden: true });
  closeColumnMenu();
}

function deleteColumn(field: FieldDto): void {
  closeColumnMenu();
  deletingField.value = field;
}

function sortColumn(field: FieldDto, direction: 'asc' | 'desc'): void {
  sorts.value = [{ fieldId: field.id, direction, mode: 'value' }];
  emitQuery();
  closeColumnMenu();
}

function editColumnFromMenu(field: FieldDto): void {
  const menu = columnMenu.value;
  closeColumnMenu();
  openFieldEditor({
    field,
    anchor: menu
      ? { top: menu.top, left: menu.left }
      : { top: 80, left: 200 },
  });
}

function currentQuery(): ViewQuery {
  return buildQuery();
}

type OverlayKind =
  | 'settings'
  | 'panel'
  | 'fieldPicker'
  | 'options'
  | 'search'
  | 'history'
  | 'columnMenu';

/** 工具栏弹层互斥：打开任一前关掉其它。 */
function closeOverlaysExcept(keep?: OverlayKind): void {
  if (keep !== 'settings') {
    settingsOpen.value = false;
    fieldMenuId.value = null;
  }
  if (keep !== 'panel') activePanel.value = null;
  if (keep !== 'fieldPicker') {
    fieldPickerOpen.value = false;
    editingField.value = null;
  }
  if (keep !== 'options') optionsField.value = null;
  if (keep !== 'search') searchOpen.value = false;
  if (keep !== 'history') historyOpen.value = false;
  if (keep !== 'columnMenu') {
    columnMenu.value = null;
    columnMenuSortOpen.value = false;
  }
}

function toggleSettings(): void {
  const next = !settingsOpen.value;
  closeOverlaysExcept(next ? 'settings' : undefined);
  settingsOpen.value = next;
}

function togglePanel(panel: typeof activePanel.value): void {
  if (!panel) return;
  const next = activePanel.value === panel ? null : panel;
  closeOverlaysExcept(next ? 'panel' : undefined);
  activePanel.value = next;
}

function toggleSearch(): void {
  const next = !searchOpen.value;
  closeOverlaysExcept(next ? 'search' : undefined);
  searchOpen.value = next;
}

function toggleHistory(): void {
  const next = !historyOpen.value;
  closeOverlaysExcept(next ? 'history' : undefined);
  historyOpen.value = next;
}

function toggleField(field: FieldDto): void {
  emit('toggleField', { field, hidden: !field.hidden });
}

function confirmDeleteField(): void {
  const field = deletingField.value;
  if (!field) return;
  deletingField.value = null;
  emit('deleteField', field);
}

function handleViewport(stats: GridStats): void {
  if (!props.nextCursor || props.loading) return;
  if (stats.rows.end >= props.records.length - 5) {
    emit('loadMore');
  }
}

function openFieldPicker(
  eventOrAnchor?: MouseEvent | { top: number; left: number },
): void {
  closeOverlaysExcept('fieldPicker');
  editingField.value = null;
  fieldPickerMode.value = 'create';
  if (eventOrAnchor && 'top' in eventOrAnchor && 'left' in eventOrAnchor) {
    fieldPickerAnchor.value = eventOrAnchor;
  } else {
    const el =
      (eventOrAnchor?.currentTarget as HTMLElement | null) ?? addFieldBtn.value;
    if (el) {
      const rect = el.getBoundingClientRect();
      fieldPickerAnchor.value = { top: rect.bottom + 6, left: rect.left };
    } else {
      fieldPickerAnchor.value = null;
    }
  }
  fieldPickerOpen.value = true;
}

function openFieldEditor(payload: {
  field: FieldDto;
  anchor: { top: number; left: number };
}): void {
  closeOverlaysExcept('fieldPicker');
  editingField.value = payload.field;
  fieldPickerMode.value = 'edit';
  fieldPickerAnchor.value = payload.anchor;
  fieldPickerOpen.value = true;
}

function openFieldEditorFromSettings(field: FieldDto): void {
  // 从表格设置进字段编辑：关掉设置，只留选择器
  closeOverlaysExcept('fieldPicker');
  editingField.value = field;
  fieldPickerMode.value = 'edit';
  const el = addFieldBtn.value;
  if (el) {
    const rect = el.getBoundingClientRect();
    fieldPickerAnchor.value = { top: rect.bottom + 6, left: rect.left };
  }
  fieldPickerOpen.value = true;
}

function openOptions(field: FieldDto): void {
  closeOverlaysExcept('options');
  optionsField.value = field;
}

function saveOptions(options: Record<string, unknown>): void {
  const field = optionsField.value;
  optionsField.value = null;
  if (!field) return;
  emit('updateField', {
    field,
    name: field.name,
    type: field.type as FieldType,
    options,
  });
}

function closeFieldPicker(): void {
  fieldPickerOpen.value = false;
  editingField.value = null;
  fieldPickerMode.value = 'create';
}

function onFieldConfirm(payload: {
  name: string;
  type: FieldType;
  options?: Record<string, unknown>;
}): void {
  const editing = editingField.value;
  closeFieldPicker();
  if (editing) {
    emit('updateField', {
      field: editing,
      name: payload.name,
      type: payload.type,
      options: payload.options,
    });
    return;
  }
  emit('createField', payload);
}

function onColumnResize(payload: { field: FieldDto; width: number }): void {
  emit('updateField', {
    field: payload.field,
    name: payload.field.name,
    type: payload.field.type as FieldType,
    options: { ...(payload.field.options ?? {}), width: Math.round(payload.width) },
  });
}

function onRowsSelected(recordIds: string[]): void {
  selectedRecordIds.value = recordIds;
}

function deleteSelected(): void {
  if (selectedRecordIds.value.length === 0) return;
  emit('deleteRecords', [...selectedRecordIds.value]);
  selectedRecordIds.value = [];
  gridRef.value?.clearRowSelection();
}

function cancelSelection(): void {
  selectedRecordIds.value = [];
  gridRef.value?.clearRowSelection();
}

async function loadAutomationButtons(): Promise<void> {
  try {
    automationButtons.value = await endpoints.listSheetAutomationButtons(
      props.sheetId,
    );
  } catch {
    automationButtons.value = [];
  }
}

async function runAutomationButton(buttonKey: string): Promise<void> {
  const recordId = selectedRecordIds.value[0];
  if (!recordId || runningButtonKey.value) return;
  runningButtonKey.value = buttonKey;
  try {
    const results = await endpoints.runSheetAutomationButton(
      props.sheetId,
      recordId,
      buttonKey,
    );
    const failed = results.find((item) => item.status === 'failed');
    if (failed) {
      toast('自动化按钮执行失败');
    } else if (!results.length) {
      toast('没有匹配的启用自动化');
    } else {
      toast('已触发自动化');
      emit('refresh');
    }
  } catch (error) {
    toast(error instanceof Error ? error.message : '触发失败');
  } finally {
    runningButtonKey.value = '';
  }
}

function openFieldOptions(field: FieldDto): void {
  optionsField.value = field;
}

watch(
  () => props.sheetId,
  () => {
    void loadAutomationButtons();
  },
);

defineExpose({
  applySavedQuery,
  clearView,
  currentQuery,
  openFieldOptions,
  clearRowSelection: () => gridRef.value?.clearRowSelection(),
});
</script>

<template>
  <section class="grid-panel">
    <div class="grid-toolbar">
      <button class="btn btn-primary" data-testid="add-row" @click="emit('addRow')">
        + 添加一行
      </button>
      <span class="toolbar-divider" />
      <button
        class="btn btn-ghost toolbar-filter"
        :class="{ 'btn-active': activePanel === 'filter' }"
        data-testid="filter-open"
        @click="togglePanel('filter')"
      >
        筛选<em v-if="activeFilterCount">{{ activeFilterCount }}</em>
      </button>
      <button
        class="btn btn-ghost"
        :class="{ 'btn-active': activePanel === 'group' }"
        data-testid="group-open"
        @click="togglePanel('group')"
      >
        分组<em v-if="activeGroupCount">{{ activeGroupCount }}</em>
      </button>
      <button
        class="btn btn-ghost"
        :class="{ 'btn-active': activePanel === 'sort' }"
        data-testid="sort-open"
        @click="togglePanel('sort')"
      >
        排序<em v-if="activeSortCount">{{ activeSortCount }}</em>
      </button>
      <button
        class="btn btn-ghost"
        :class="{ 'btn-active': activePanel === 'rowHeight' }"
        data-testid="row-height-open"
        @click="togglePanel('rowHeight')"
      >
        行高
      </button>
      <button
        class="btn btn-ghost"
        :class="{ 'btn-active': activePanel === 'freeze' || freezeColumnCount > 0 }"
        data-testid="freeze-open"
        @click="togglePanel('freeze')"
      >
        冻结<em v-if="freezeColumnCount">{{ freezeColumnCount }}</em>
      </button>
      <button
        class="btn btn-ghost"
        :class="{ 'btn-active': activePanel === 'color' }"
        data-testid="color-open"
        @click="togglePanel('color')"
      >
        填色<em v-if="activeColorCount">{{ activeColorCount }}</em>
      </button>
      <span class="toolbar-divider" />
      <button
        ref="addFieldBtn"
        class="btn btn-ghost"
        data-testid="add-field"
        @click="openFieldPicker"
      >
        + 字段
      </button>
      <button
        class="btn btn-ghost"
        data-testid="table-settings"
        :class="{ 'btn-active': settingsOpen }"
        @click="toggleSettings"
      >
        设置
      </button>
      <button
        v-if="activeConditionLabel"
        class="btn btn-ghost clear-view"
        data-testid="clear-view"
        @click="clearView"
      >
        清除
      </button>
      <span class="toolbar-spacer" />
      <div class="toolbar-right">
        <button
          class="btn btn-ghost icon-tool"
          title="历史"
          aria-label="历史"
          data-testid="grid-history"
          :class="{ 'btn-active': historyOpen }"
          @click="toggleHistory"
        >
          ⏱
        </button>
        <button
          class="btn btn-ghost icon-tool"
          title="刷新"
          aria-label="刷新"
          data-testid="grid-refresh"
          @click="emit('refresh')"
        >
          ⟳
        </button>
        <button
          class="btn btn-ghost icon-tool"
          :class="{ 'btn-active': searchOpen }"
          title="搜索"
          aria-label="搜索"
          data-testid="grid-search"
          @click="toggleSearch"
        >
          ⌕
        </button>
        <button
          class="btn btn-ghost icon-tool"
          title="撤销 (Ctrl+Z)"
          aria-label="撤销"
          data-testid="grid-undo"
          :disabled="!undoAvailable"
          @click="emit('undo')"
        >
          ↶
        </button>
        <button
          class="btn btn-ghost icon-tool"
          title="重做 (Ctrl+Y)"
          aria-label="重做"
          data-testid="grid-redo"
          :disabled="!redoAvailable"
          @click="emit('redo')"
        >
          ↻
        </button>
      </div>
    </div>

    <Transition name="search-bar">
      <div v-if="searchOpen" class="search-bar" data-testid="grid-search-bar">
        <span class="search-bar-label" aria-hidden="true">⌕</span>
        <input
          v-model="searchQuery"
          type="search"
          placeholder="搜索当前表格内容…"
          data-testid="grid-search-input"
          autofocus
        />
        <button
          class="btn btn-ghost small"
          type="button"
          @click="searchQuery = ''; searchOpen = false"
        >
          关闭
        </button>
      </div>
    </Transition>

    <div
      v-if="historyOpen"
      ref="historyRoot"
      class="history-panel"
      data-testid="grid-history-panel"
      :style="historyDragStyle"
    >
      <header class="panel-drag-handle" @pointerdown="onHistoryDrag">
        <strong>编辑历史</strong>
        <button class="icon-btn" @click="historyOpen = false">×</button>
      </header>
      <ul v-if="historyEntries.length">
        <li v-for="entry in historyEntries" :key="entry.id">
          <span class="history-label">{{ entry.label }}</span>
          <span class="history-time">{{
            new Date(entry.at).toLocaleTimeString('zh-CN', { hour12: false })
          }}</span>
        </li>
      </ul>
      <p v-else class="muted">暂无编辑记录。修改单元格后会出现在这里。</p>
    </div>

    <Transition name="selection-bar">
      <div v-if="selectedRecordIds.length" class="selection-bar">
        <strong class="selection-count">已选 {{ selectedRecordIds.length }} 行</strong>
        <template v-if="selectedRecordIds.length === 1 && automationButtons.length">
          <button
            v-for="btn in automationButtons"
            :key="btn.buttonKey"
            class="btn btn-ghost small"
            type="button"
            :data-testid="`automation-button-${btn.buttonKey}`"
            :disabled="runningButtonKey === btn.buttonKey"
            @click="runAutomationButton(btn.buttonKey)"
          >
            {{
              runningButtonKey === btn.buttonKey
                ? '执行中…'
                : btn.buttonLabel
            }}
          </button>
        </template>
        <span class="selection-spacer" />
        <button class="btn btn-danger small" data-testid="delete-selected" @click="deleteSelected">
          删除所选
        </button>
        <button class="btn btn-ghost small" type="button" @click="cancelSelection">取消</button>
      </div>
    </Transition>

    <FieldTypePicker
      :open="fieldPickerOpen"
      :anchor="fieldPickerAnchor"
      :mode="fieldPickerMode"
      :initial-name="editingField?.name ?? ''"
      :initial-type="(editingField?.type as FieldType) ?? 'text'"
      :initial-options="
        (editingField?.options as Record<string, unknown> | null) ?? null
      "
      @close="closeFieldPicker"
      @confirm="onFieldConfirm"
    />

    <FieldOptionsEditor
      :open="Boolean(optionsField)"
      :field="optionsField"
      :fields="fields"
      :sheets="sheets"
      :base-id="sheetId"
      @close="optionsField = null"
      @save="saveOptions"
    />

    <div
      v-if="settingsOpen"
      ref="settingsRoot"
      class="settings-popover"
      data-testid="table-settings-panel"
      :style="settingsDragStyle"
    >
      <header class="settings-head panel-drag-handle" @pointerdown="onSettingsDrag">
        <strong>表格设置</strong>
        <button class="icon-btn" @click="settingsOpen = false">×</button>
      </header>
      <div class="settings-sub">字段（{{ visibleFields.length }}/{{ fields.length }} 显示）</div>
      <div class="field-list">
        <div
          v-for="field in fields"
          :key="field.id"
          class="field-row"
          :data-testid="`settings-field-${field.name}`"
        >
          <span class="field-icon">{{ fieldTypeIcon(field.type) }}</span>
          <button class="field-name field-name-btn" @click="openFieldEditorFromSettings(field)">
            {{ field.name }}
          </button>
          <button
            class="icon-btn eye-btn"
            :class="{ off: field.hidden }"
            :title="field.hidden ? '显示字段' : '隐藏字段'"
            :data-testid="`toggle-field-visibility-${field.name}`"
            @click="toggleField(field)"
          >
            {{ field.hidden ? '👁‍🗨' : '👁' }}
          </button>
          <div class="field-more-wrap">
            <button
              class="icon-btn"
              title="更多"
              :data-testid="`field-more-${field.name}`"
              @click.stop="fieldMenuId = fieldMenuId === field.id ? null : field.id"
            >
              ···
            </button>
            <Transition name="menu-fade">
              <div
                v-if="fieldMenuId === field.id"
                class="field-more-menu"
                :data-testid="`field-more-menu-${field.name}`"
              >
              <button
                type="button"
                @click="
                  openFieldEditorFromSettings(field);
                  fieldMenuId = null;
                "
              >
                编辑字段
              </button>
              <button
                v-if="
                  field.type === 'select' ||
                  field.type === 'multiSelect' ||
                  field.type === 'ai' ||
                  field.type === 'formula' ||
                  field.type === 'relation' ||
                  field.type === 'lookup'
                "
                :data-testid="`edit-options-${field.name}`"
                @click="
                  openOptions(field);
                  fieldMenuId = null;
                "
              >
                {{
                  field.type === 'ai'
                    ? '编辑 AI 配置'
                    : field.type === 'formula'
                      ? '编辑公式'
                      : field.type === 'relation'
                        ? '编辑关联'
                        : field.type === 'lookup'
                          ? '编辑查找引用'
                          : '编辑选项'
                }}
              </button>
              <button
                @click="
                  toggleField(field);
                  fieldMenuId = null;
                "
              >
                {{ field.hidden ? '显示字段' : '隐藏字段' }}
              </button>
              <button
                type="button"
                class="danger"
                :data-testid="`delete-field-${field.name}`"
                @click="
                  deletingField = field;
                  fieldMenuId = null;
                "
              >
                删除字段
              </button>
              </div>
            </Transition>
          </div>
        </div>
      </div>
      <button class="btn settings-add-field" data-testid="settings-add-field" @click="openFieldPicker">
        + 新增字段
      </button>
      <div class="settings-footer">
        <span class="settings-footer-label" title="选择关联字段作为父子层级依据">
          父记录字段
        </span>
        <select
          class="settings-footer-select"
          data-testid="parent-field-select"
          :value="parentFieldId"
          @change="setParentField(($event.target as HTMLSelectElement).value)"
        >
          <option value="">请选择</option>
          <option
            v-for="field in relationFields"
            :key="field.id"
            :value="field.id"
          >
            {{ field.name }}
          </option>
        </select>
      </div>
    </div>

    <div
      v-if="activePanel"
      ref="viewPanelRoot"
      class="view-panel"
      :data-testid="`view-panel-${activePanel}`"
      :style="viewPanelDragStyle"
    >
      <header
        class="view-panel-title panel-drag-handle"
        @pointerdown="onViewPanelDrag"
      >
        {{
          activePanel === 'filter'
            ? '筛选'
            : activePanel === 'sort'
              ? '排序'
              : activePanel === 'group'
                ? '分组'
                : activePanel === 'rowHeight'
                  ? '行高'
                  : activePanel === 'freeze'
                    ? '冻结列'
                    : '填色'
        }}
        <button class="icon-btn" type="button" @click="activePanel = null">×</button>
      </header>

      <div v-if="activePanel === 'filter'" class="view-panel-body">
        <div class="filter-conjunction">
          <span>满足</span>
          <select v-model="filterConjunction" data-testid="filter-conjunction">
            <option value="and">全部条件</option>
            <option value="or">任一条件</option>
          </select>
          <span>的记录</span>
        </div>
        <div
          v-for="(row, index) in filters"
          :key="index"
          class="condition-row"
          data-testid="filter-condition"
        >
          <select
            v-model="row.fieldId"
            :data-testid="`filter-condition-${index}-field`"
          >
            <option value="">选择字段</option>
            <option v-for="field in fields" :key="field.id" :value="field.id">
              {{ field.name }}
            </option>
          </select>
          <select
            v-model="row.operator"
            :data-testid="`filter-condition-${index}-operator`"
          >
            <option v-for="item in operators" :key="item.value" :value="item.value">
              {{ item.label }}
            </option>
          </select>
          <input
            v-if="!isValueless(row.operator)"
            v-model="row.value"
            :data-testid="`filter-condition-${index}-value`"
            placeholder="输入值"
          />
          <button class="icon-btn danger" title="移除条件" @click="removeFilter(index)">
            ×
          </button>
        </div>
        <div class="panel-actions">
          <button class="btn" data-testid="filter-add" @click="addFilter">+ 添加条件</button>
          <div class="panel-actions-end">
            <button class="btn" data-testid="filter-preview" @click="previewFilters">
              预览
            </button>
            <button class="btn btn-primary" data-testid="filter-apply" @click="applyFilters">
              应用
            </button>
          </div>
        </div>
      </div>

      <div v-else-if="activePanel === 'sort'" class="view-panel-body">
        <div
          v-for="(row, index) in sorts"
          :key="index"
          class="condition-row"
          data-testid="sort-condition"
        >
          <span class="condition-index">{{ index + 1 }}</span>
          <select v-model="row.fieldId" :data-testid="`sort-condition-${index}-field`">
            <option value="">选择字段</option>
            <option v-for="field in fields" :key="field.id" :value="field.id">
              {{ field.name }}
            </option>
          </select>
          <select v-model="row.direction" :data-testid="`sort-condition-${index}-direction`">
            <option value="asc">升序</option>
            <option value="desc">降序</option>
          </select>
          <select v-model="row.mode" :data-testid="`sort-condition-${index}-mode`">
            <option value="value">按值</option>
            <option value="option">按选项</option>
            <option value="natural">自然语言序</option>
          </select>
          <button class="icon-btn danger" title="移除" @click="removeSort(index)">×</button>
        </div>
        <div class="panel-actions">
          <button class="btn" data-testid="sort-add" @click="addSort">+ 添加排序</button>
          <div class="panel-actions-end">
            <button class="btn" data-testid="sort-preview" @click="previewSorts">预览</button>
            <button class="btn btn-primary" data-testid="sort-apply" @click="applySorts">
              应用
            </button>
          </div>
        </div>
      </div>

      <div v-else-if="activePanel === 'group'" class="view-panel-body">
        <div
          v-for="(row, index) in groups"
          :key="index"
          class="condition-row"
          data-testid="group-condition"
        >
          <select v-model="row.fieldId" :data-testid="`group-condition-${index}-field`">
            <option value="">选择分组字段</option>
            <option v-for="field in fields" :key="field.id" :value="field.id">
              {{ field.name }}
            </option>
          </select>
          <button class="icon-btn danger" title="移除" @click="removeGroup(index)">×</button>
        </div>
        <div class="panel-actions">
          <button class="btn" @click="addGroup">+ 添加分组</button>
          <div class="panel-actions-end">
            <button class="btn" data-testid="group-preview" @click="previewGroups">预览</button>
            <button class="btn btn-primary" data-testid="group-apply" @click="applyGroups">
              应用
            </button>
          </div>
        </div>
      </div>

      <div v-else-if="activePanel === 'rowHeight'" class="view-panel-body">
        <div class="row-height-options">
          <button
            v-for="option in [
              { value: 'short', label: '紧凑', height: 28 },
              { value: 'medium', label: '中等', height: 36 },
              { value: 'tall', label: '宽松', height: 52 },
            ]"
            :key="option.value"
            class="height-option"
            :class="{ active: rowHeightChoice === option.value }"
            :data-testid="`row-height-${option.value}`"
            @click="setRowHeight(option.value as 'short' | 'medium' | 'tall')"
          >
            <i :style="{ height: `${option.height / 2}px` }"></i>
            {{ option.label }}
          </button>
        </div>
      </div>

      <div v-else-if="activePanel === 'freeze'" class="view-panel-body">
        <div class="row-height-options" data-testid="freeze-options">
          <button
            v-for="option in [
              { value: 0, label: '不冻结' },
              { value: 1, label: '冻结 1 列' },
              { value: 2, label: '冻结 2 列' },
              { value: 3, label: '冻结 3 列' },
            ]"
            :key="option.value"
            class="height-option"
            :class="{ active: freezeColumnCount === option.value }"
            :data-testid="`freeze-col-${option.value}`"
            @click="setFreezeColumnCount(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <div v-else class="view-panel-body">
        <div
          v-for="(row, index) in colorRules"
          :key="index"
          class="condition-row color-condition"
          data-testid="color-condition"
        >
          <select v-model="row.fieldId" :data-testid="`color-condition-${index}-field`">
            <option value="">选择字段</option>
            <option v-for="field in fields" :key="field.id" :value="field.id">
              {{ field.name }}
            </option>
          </select>
          <select v-model="row.operator">
            <option v-for="item in operators" :key="item.value" :value="item.value">
              {{ item.label }}
            </option>
          </select>
          <input
            v-if="!isValueless(row.operator)"
            v-model="row.value"
            :data-testid="`color-condition-${index}-value`"
            placeholder="输入值"
          />
          <div class="swatches">
            <button
              v-for="item in COLORS"
              :key="item.id"
              class="swatch"
              :class="{ active: row.color === item.id }"
              :style="{ background: item.id }"
              :title="item.label"
              @click="row.color = item.id"
            ></button>
          </div>
          <button class="icon-btn danger" title="移除" @click="removeColorRule(index)">×</button>
        </div>
        <div class="panel-actions">
          <button class="btn" data-testid="color-add" @click="addColorRule">+ 添加规则</button>
          <div class="panel-actions-end">
            <button class="btn" data-testid="color-preview" @click="previewColors">预览</button>
            <button class="btn btn-primary" data-testid="color-apply" @click="applyColors">
              应用
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="groupLabels.length" class="group-chips">
      <span v-for="group in groupLabels" :key="group.fieldId + group.key" class="group-chip">
        {{ group.fieldName }}：{{ group.label || '空' }}（{{ group.count }}）
      </span>
    </div>

    <div class="grid-stage">
      <CanvasGrid
        ref="gridRef"
        :fields="fields"
        :records="displayRecords"
        :row-height="rowHeight ?? 36"
        :freeze-column-count="freezeColumnCount"
        :row-colors="rowColors"
        :row-depths="rowDepths"
        :person-names="personNames"
        :members="members"
        :sheets="sheets"
        :upload-attachment="uploadAttachment"
        @commit="emit('commit', $event)"
        @viewport="handleViewport"
        @add-column="openFieldPicker"
        @header-click="openColumnMenu"
        @resize-field="onColumnResize"
        @rows-selected="onRowsSelected"
        @insert-rows="emit('insertRows', $event)"
        @insert-columns="emit('insertColumns', $event)"
        @delete-records="emit('deleteRecords', $event)"
        @delete-field="deletingField = $event"
      />
    </div>

    <!-- 底栏已画在 Canvas 内；保留测试钩子 -->
    <span class="sr-only" data-testid="record-count">
      记录数 {{ displayRecords.length }}
    </span>

    <div
      v-if="columnMenu"
      class="column-menu-mask"
      data-testid="column-menu-mask"
      @click="closeColumnMenu"
    ></div>
    <div
      v-if="columnMenu"
      class="column-menu"
      data-testid="column-menu"
      :style="{ top: `${columnMenu.top}px`, left: `${columnMenu.left}px` }"
      @click.stop
    >
      <div class="column-menu-tools">
        <button
          type="button"
          class="column-tool"
          title="创建副本"
          data-testid="column-menu-duplicate"
          @click="duplicateColumn(columnMenu.field)"
        >
          <span class="column-tool-icon" aria-hidden="true">⧉+</span>
        </button>
        <button
          type="button"
          class="column-tool"
          title="自动调整列宽"
          data-testid="column-menu-autofit"
          @click="autoFitColumnWidth(columnMenu.field)"
        >
          <span class="column-tool-icon" aria-hidden="true">⇔</span>
        </button>
        <button
          type="button"
          class="column-tool"
          title="冻结至此列"
          data-testid="column-menu-freeze"
          @click="freezeToColumn(columnMenu.field)"
        >
          <span class="column-tool-icon" aria-hidden="true">▣</span>
        </button>
        <button
          type="button"
          class="column-tool"
          title="隐藏"
          data-testid="column-menu-hide"
          @click="hideColumn(columnMenu.field)"
        >
          <span class="column-tool-icon" aria-hidden="true">👁‍🗨</span>
        </button>
        <span class="column-tool-sep" aria-hidden="true"></span>
        <button
          type="button"
          class="column-tool danger"
          title="删除"
          data-testid="column-menu-delete"
          @click="deleteColumn(columnMenu.field)"
        >
          <span class="column-tool-icon" aria-hidden="true">🗑</span>
        </button>
      </div>
      <button
        type="button"
        class="column-menu-row"
        data-testid="column-menu-edit"
        @click="editColumnFromMenu(columnMenu.field)"
      >
        <span class="column-menu-icon">✎</span>
        <span class="column-menu-label">编辑字段</span>
      </button>
      <div
        class="column-menu-row has-sub"
        :class="{ open: columnMenuSortOpen }"
        data-testid="column-menu-sort"
        @mouseenter="columnMenuSortOpen = true"
        @focusin="columnMenuSortOpen = true"
      >
        <span class="column-menu-icon">↕</span>
        <span class="column-menu-label">排序</span>
        <span class="column-menu-caret">›</span>
        <div v-if="columnMenuSortOpen" class="column-submenu" data-testid="column-menu-sort-sub">
          <button
            type="button"
            class="column-menu-row"
            data-testid="column-menu-sort-asc"
            @click="sortColumn(columnMenu.field, 'asc')"
          >
            A → Z
          </button>
          <button
            type="button"
            class="column-menu-row"
            data-testid="column-menu-sort-desc"
            @click="sortColumn(columnMenu.field, 'desc')"
          >
            Z → A
          </button>
        </div>
      </div>
    </div>

    <div v-if="deletingField" class="confirm-mask" @click.self="deletingField = null">
      <div class="confirm-card" data-testid="delete-field-confirm">
        <h4>删除字段「{{ deletingField.name }}」？</h4>
        <p>该列及其在所有记录中的值会被删除，此操作不可撤销。</p>
        <div class="confirm-actions">
          <button class="btn" @click="deletingField = null">取消</button>
          <button class="btn btn-danger" data-testid="delete-field-confirm-button" @click="confirmDeleteField">
            删除字段
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.grid-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #fff;
}
.grid-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  min-height: 44px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: #fff;
}
.grid-toolbar > .btn {
  height: 30px;
  padding: 0 10px;
  font-size: 13px;
}
.toolbar-divider {
  width: 1px;
  height: 18px;
  margin: 0 6px;
  background: var(--border);
  flex: none;
}
.toolbar-spacer {
  flex: 1;
  min-width: 8px;
}
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 2px;
}
.icon-tool {
  width: 30px;
  height: 30px;
  padding: 0;
  font-size: 14px;
  line-height: 1;
  border-radius: 6px;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}
.icon-tool:hover:not(:disabled) {
  background: #f2f3f5;
}
.icon-tool:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(45, 140, 240, 0.28);
}
.icon-tool:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  color: var(--text-tertiary);
}
.search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid #eef0f3;
  background: #f7faff;
}
.search-bar-label {
  flex: none;
  color: #1d6fdc;
  font-size: 14px;
  line-height: 1;
}
.search-bar input {
  flex: 1;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #91caff;
  border-radius: 8px;
  background: #fff;
  font-size: 13px;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}
.search-bar input:focus {
  outline: none;
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(45, 140, 240, 0.15);
}
.search-bar-enter-active,
.search-bar-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease,
    max-height 0.16s ease;
  overflow: hidden;
}
.search-bar-enter-from,
.search-bar-leave-to {
  opacity: 0;
  transform: translateY(-4px);
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}
.search-bar-enter-to,
.search-bar-leave-from {
  max-height: 56px;
}
.history-panel {
  position: absolute;
  right: 12px;
  top: 48px;
  z-index: 30;
  width: 280px;
  max-height: 320px;
  overflow: auto;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid #e5e6eb;
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(31, 35, 41, 0.14);
}
.history-panel header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.history-panel ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.history-panel li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #f2f3f5;
  font-size: 12px;
}
.history-label {
  color: #1f2329;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-time {
  color: #8f959e;
  flex: none;
}
.field-more-wrap {
  position: relative;
}
.field-more-menu {
  position: absolute;
  right: 0;
  top: 28px;
  z-index: 40;
  min-width: 140px;
  padding: 4px;
  background: #fff;
  border: 1px solid #e5e6eb;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(31, 35, 41, 0.12);
}
.field-more-menu button {
  display: block;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  font-size: 13px;
  cursor: pointer;
  color: #1f2329;
}
.field-more-menu button:hover {
  background: #f5f6f7;
}
.field-more-menu button.danger {
  color: #d4380d;
}
.settings-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #eef0f3;
}
.settings-footer-label {
  font-size: 12px;
  color: #8f959e;
}
.settings-footer-select {
  height: 28px;
  min-width: 120px;
  border: 1px solid #dee0e3;
  border-radius: 6px;
  background: #f7f8fa;
  color: #8f959e;
  font-size: 12px;
}
.btn-active {
  background: #e8f3ff !important;
  color: #1d6fdc !important;
  font-weight: 500;
}
.toolbar-filter em,
.grid-toolbar em {
  display: inline-block;
  margin-left: 4px;
  min-width: 16px;
  height: 16px;
  padding: 0 5px;
  border-radius: 8px;
  background: #1d6fdc;
  color: #fff;
  font-style: normal;
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  text-align: center;
  vertical-align: 1px;
}
.grid-toolbar .btn-active em {
  background: #1d6fdc;
  color: #fff;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.selection-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: #eef4ff;
  color: #1d4ed8;
  font-size: 13px;
  border-bottom: 1px solid #d6e4ff;
}
.selection-count {
  font-weight: 600;
  font-size: 13px;
}
.selection-spacer {
  flex: 1;
}
.selection-bar .btn {
  height: 28px;
}
.selection-bar-enter-active,
.selection-bar-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease,
    max-height 0.16s ease;
  overflow: hidden;
}
.selection-bar-enter-from,
.selection-bar-leave-to {
  opacity: 0;
  transform: translateY(-4px);
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}
.selection-bar-enter-to,
.selection-bar-leave-from {
  max-height: 48px;
}
.settings-popover {
  position: absolute;
  z-index: 40;
  top: 50px;
  left: 92px;
  width: 340px;
  max-height: 62vh;
  overflow: auto;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 12px 36px rgba(15, 23, 42, 0.14);
}
.settings-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.settings-head strong {
  font-size: 14px;
  color: #1f2329;
}
.settings-sub {
  color: #8f959e;
  font-size: 12px;
  margin-bottom: 8px;
}
.field-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 2px 6px;
  border-radius: 8px;
  transition: background 0.12s ease;
}
.field-row:hover {
  background: #f5f6f7;
}
.field-icon {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: #f2f3f5;
  color: #646a73;
  font-size: 11px;
  flex: none;
}
.field-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.field-name-btn {
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  padding: 0;
}
.icon-btn.danger {
  color: #d4380d;
}
.eye-btn {
  font-size: 14px;
  opacity: 1;
}
.eye-btn.off {
  opacity: 0.35;
}
.settings-add-field {
  width: 100%;
  margin-top: 8px;
  justify-content: flex-start;
}
.view-panel {
  position: absolute;
  z-index: 45;
  top: 50px;
  left: 200px;
  width: 560px;
  max-width: calc(100% - 32px);
  max-height: 64vh;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 12px 36px rgba(15, 23, 42, 0.14);
}
.view-panel-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  font-size: 14px;
  font-weight: 600;
  color: #1f2329;
  border-bottom: 1px solid #eef0f3;
  background: #fafbfc;
}
.panel-drag-handle {
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.panel-drag-handle:active {
  cursor: grabbing;
}
.view-panel-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
}
.condition-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.condition-row select,
.condition-row input {
  height: 32px;
  min-width: 0;
  padding: 0 8px;
  border: 1px solid #d0d3d9;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  box-sizing: border-box;
}
.condition-row select:focus,
.condition-row input:focus {
  outline: none;
  border-color: var(--brand, #2d8cf0);
  box-shadow: 0 0 0 2px rgba(45, 140, 240, 0.18);
}
.condition-row select {
  flex: 1 1 110px;
}
.condition-row input {
  flex: 1.2 1 120px;
}
.condition-row .icon-btn {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
}
.condition-index {
  width: 18px;
  color: #8f959e;
  font-size: 12px;
  flex: none;
}
.filter-conjunction {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #4e5969;
}
.filter-conjunction select {
  height: 30px;
  padding: 0 8px;
  border: 1px solid #d0d3d9;
  border-radius: 6px;
  background: #fff;
}
.panel-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px solid #f2f3f5;
}
.panel-actions-end {
  display: flex;
  gap: 8px;
  margin-left: auto;
}
.row-height-options {
  display: flex;
  gap: 10px;
}
.height-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  width: 80px;
  padding: 10px;
  border: 1px solid #e5e6eb;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
}
.height-option i {
  width: 36px;
  background: #e8f3ff;
  border: 1px solid #b2ccff;
  border-radius: 3px;
}
.height-option.active {
  border-color: #2d8cf0;
  color: #1d6fdc;
}
.swatches {
  display: flex;
  gap: 4px;
}
.swatch {
  width: 20px;
  height: 20px;
  border: 1px solid #d0d3d9;
  border-radius: 5px;
  cursor: pointer;
}
.swatch.active {
  outline: 2px solid #2d8cf0;
}
.grid-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}
.group-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px 14px;
  border-bottom: 1px solid #e5e6eb;
  background: #fff;
}
.group-chip {
  padding: 3px 9px;
  border-radius: 999px;
  background: #eef4ff;
  color: #1d6fdc;
  font-size: 12px;
}
.confirm-mask {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  justify-content: center;
  align-items: center;
  background: rgba(15, 23, 42, 0.34);
}
.confirm-card {
  width: min(380px, 92vw);
  padding: 18px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.24);
}
.confirm-card h4 {
  margin: 0 0 8px;
}
.confirm-card p {
  color: #646a73;
  font-size: 13px;
}
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.btn-danger {
  background: #d4380d;
  border-color: #d4380d;
  color: #fff;
}
.clear-view {
  color: #1d6fdc;
}
.column-menu-mask {
  position: fixed;
  inset: 0;
  z-index: 55;
}
.column-menu {
  position: fixed;
  z-index: 56;
  min-width: 200px;
  padding: 6px 0 8px;
  background: #fff;
  border: 1px solid #e5e6eb;
  border-radius: 10px;
  box-shadow: 0 10px 28px rgba(31, 35, 41, 0.14);
}
.column-menu-tools {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px 8px;
  border-bottom: 1px solid #eef0f3;
}
.column-tool {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #1f2329;
  cursor: pointer;
}
.column-tool:hover {
  background: #f2f3f5;
}
.column-tool.danger:hover {
  background: #fff1f0;
  color: #d4380d;
}
.column-tool-icon {
  font-size: 14px;
  line-height: 1;
}
.column-tool-sep {
  width: 1px;
  height: 18px;
  margin: 0 4px;
  background: #e5e6eb;
}
.column-menu-row {
  position: relative;
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
.column-menu-row:hover,
.column-menu-row.open {
  background: #f5f6f7;
}
.column-menu-icon {
  width: 18px;
  color: #646a73;
  text-align: center;
}
.column-menu-label {
  flex: 1;
}
.column-menu-caret {
  color: #8f959e;
  font-size: 16px;
}
.column-menu-row.has-sub {
  cursor: default;
}
.column-submenu {
  position: absolute;
  top: -4px;
  left: calc(100% - 4px);
  min-width: 96px;
  padding: 6px 0;
  background: #fff;
  border: 1px solid #e5e6eb;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(31, 35, 41, 0.12);
}
.column-submenu .column-menu-row {
  justify-content: center;
  padding: 0 12px;
}
</style>
