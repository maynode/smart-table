<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import CanvasGrid from './CanvasGrid.vue';
import FieldTypePicker from './FieldTypePicker.vue';
import FieldOptionsEditor from './FieldOptionsEditor.vue';
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
    payload: { name: string; type: FieldType; options?: Record<string, unknown> },
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

function syncHistoryState(): void {
  undoAvailable.value = canUndo();
  redoAvailable.value = canRedo();
  historyEntries.value = [...getUndoStack()].reverse().slice(0, 40);
}

let unsubscribeHistory: (() => void) | null = null;
onMounted(() => {
  syncHistoryState();
  unsubscribeHistory = subscribeEditHistory(syncHistoryState);
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

const displayRecords = computed<RecordDto[]>(() => {
  const base = hierarchy.value.records;
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return base;
  return base.filter((record) =>
    Object.values(record.cells).some((value) => {
      if (value === null || value === undefined) return false;
      if (typeof value === 'string') return value.toLowerCase().includes(q);
      if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value).toLowerCase().includes(q);
      }
      try {
        return JSON.stringify(value).toLowerCase().includes(q);
      } catch {
        return false;
      }
    }),
  );
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
  return query;
}

function emitQuery(): void {
  const query = buildQuery();
  emit('query', JSON.parse(JSON.stringify(query)) as ViewQuery);
  emit('queryChange', query);
}

function applyFilters(): void {
  if (activeFilterCount.value === 0) {
    guardError('请至少选择一个筛选字段');
    return;
  }
  emitQuery();
}

function applySorts(): void {
  if (activeSortCount.value === 0) {
    guardError('请至少选择一个排序字段');
    return;
  }
  emitQuery();
}

function applyGroups(): void {
  emitQuery();
}

function applyColors(): void {
  if (activeColorCount.value === 0) {
    guardError('请至少选择一条填色规则');
    return;
  }
  emitQuery();
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

function setFreezeColumnCount(count: number): void {
  freezeColumnCount.value = Math.max(0, Math.min(3, Math.floor(count)));
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
    Math.min(3, Number(cloned.freezeColumnCount) || 0),
  );
  emitQuery();
}

function currentQuery(): ViewQuery {
  return buildQuery();
}

function togglePanel(panel: typeof activePanel.value): void {
  activePanel.value = activePanel.value === panel ? null : panel;
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
  editingField.value = payload.field;
  fieldPickerMode.value = 'edit';
  fieldPickerAnchor.value = payload.anchor;
  fieldPickerOpen.value = true;
}

function openFieldEditorFromSettings(field: FieldDto): void {
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

function openFieldOptions(field: FieldDto): void {
  optionsField.value = field;
}

defineExpose({
  applySavedQuery,
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
      <button
        class="btn"
        data-testid="table-settings"
        @click="settingsOpen = !settingsOpen"
      >
        表格设置
      </button>
      <button
        ref="addFieldBtn"
        class="btn"
        data-testid="add-field"
        @click="openFieldPicker"
      >
        + 添加字段
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
          data-testid="grid-history"
          @click="historyOpen = !historyOpen; searchOpen = false"
        >
          历史
        </button>
        <button
          class="btn btn-ghost icon-tool"
          title="刷新"
          data-testid="grid-refresh"
          @click="emit('refresh')"
        >
          刷新
        </button>
        <button
          class="btn btn-ghost icon-tool"
          :class="{ 'btn-active': searchOpen }"
          title="搜索"
          data-testid="grid-search"
          @click="searchOpen = !searchOpen; historyOpen = false"
        >
          搜索
        </button>
        <button
          class="btn btn-ghost icon-tool"
          title="撤销 (Ctrl+Z)"
          data-testid="grid-undo"
          :disabled="!undoAvailable"
          @click="emit('undo')"
        >
          撤销
        </button>
        <button
          class="btn btn-ghost icon-tool"
          title="重做 (Ctrl+Y)"
          data-testid="grid-redo"
          :disabled="!redoAvailable"
          @click="emit('redo')"
        >
          重做
        </button>
        <span class="record-count" data-testid="record-count">
          记录数 {{ displayRecords.length }}{{ nextCursor ? '+' : '' }}
        </span>
      </div>
    </div>

    <div v-if="searchOpen" class="search-bar" data-testid="grid-search-bar">
      <input
        v-model="searchQuery"
        type="search"
        placeholder="搜索当前表格内容…"
        data-testid="grid-search-input"
        autofocus
      />
      <button
        class="btn btn-ghost small"
        @click="searchQuery = ''; searchOpen = false"
      >
        关闭
      </button>
    </div>

    <div v-if="historyOpen" class="history-panel" data-testid="grid-history-panel">
      <header>
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

    <div v-if="selectedRecordIds.length" class="selection-bar">
      <span>已选择 {{ selectedRecordIds.length }} 行</span>
      <button class="btn btn-danger small" data-testid="delete-selected" @click="deleteSelected">
        删除所选
      </button>
      <button class="btn btn-ghost small" @click="cancelSelection">取消</button>
    </div>

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

    <div v-if="settingsOpen" class="settings-popover" data-testid="table-settings-panel">
      <header class="settings-head">
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
            class="icon-btn"
            :title="field.hidden ? '显示字段' : '隐藏字段'"
            @click="toggleField(field)"
          >
            {{ field.hidden ? '隐藏' : '显' }}
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
            <div
              v-if="fieldMenuId === field.id"
              class="field-more-menu"
              :data-testid="`field-more-menu-${field.name}`"
            >
              <button
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
      class="view-panel"
      :data-testid="`view-panel-${activePanel}`"
    >
      <header class="view-panel-title">
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
          <button class="btn btn-primary" data-testid="filter-apply" @click="applyFilters">
            应用筛选
          </button>
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
          <select v-model="row.mode">
            <option value="value">按值</option>
            <option value="option">按选项</option>
          </select>
          <button class="icon-btn danger" title="移除" @click="removeSort(index)">×</button>
        </div>
        <div class="panel-actions">
          <button class="btn" data-testid="sort-add" @click="addSort">+ 添加排序</button>
          <button class="btn btn-primary" data-testid="sort-apply" @click="applySorts">
            应用排序
          </button>
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
          <button class="btn btn-primary" data-testid="group-apply" @click="applyGroups">
            应用分组
          </button>
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
          <button class="btn btn-primary" data-testid="color-apply" @click="applyColors">
            应用填色
          </button>
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
        @header-click="openFieldEditor"
        @resize-field="onColumnResize"
        @rows-selected="onRowsSelected"
      />
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
  gap: 6px;
  flex-wrap: wrap;
  min-height: 46px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border);
  background: #fff;
}
.toolbar-divider {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: var(--border);
}
.toolbar-spacer {
  flex: 1;
}
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}
.icon-tool {
  padding: 0 8px;
  height: 28px;
  font-size: 12px;
}
.icon-tool:disabled {
  opacity: 0.35;
  cursor: default;
}
.search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid #eef0f3;
  background: #fafbfc;
}
.search-bar input {
  flex: 1;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #3370ff;
  border-radius: 6px;
  font-size: 13px;
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
  background: #e8f3ff;
  color: #1d6fdc;
}
.toolbar-filter em,
.grid-toolbar em {
  margin-left: 4px;
  font-style: normal;
  font-size: 11px;
  background: #2d8cf0;
  color: #fff;
  border-radius: 8px;
  padding: 0 5px;
}
.record-count {
  color: #8f959e;
  font-size: 12px;
}
.selection-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  background: #eef4ff;
  color: #1d4ed8;
  font-size: 12px;
  border-bottom: 1px solid #d6e4ff;
}
.selection-bar .btn {
  height: 26px;
}
.settings-popover {
  position: absolute;
  z-index: 40;
  top: 50px;
  left: 92px;
  width: 320px;
  max-height: 62vh;
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 12px 36px rgba(15, 23, 42, 0.16);
}
.settings-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.settings-sub {
  color: #8f959e;
  font-size: 12px;
  margin-bottom: 6px;
}
.field-list {
  display: flex;
  flex-direction: column;
}
.field-row {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 5px;
  border-radius: 6px;
}
.field-row:hover {
  background: #f7f8fa;
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
  width: 520px;
  max-width: calc(100% - 32px);
  max-height: 64vh;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 16px 44px rgba(15, 23, 42, 0.18);
}
.view-panel-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  font-weight: 600;
  border-bottom: 1px solid #eef0f3;
}
.view-panel-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px 14px;
}
.condition-row {
  display: flex;
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
}
.condition-row select {
  flex: 1;
}
.condition-row input {
  flex: 1.1;
}
.condition-index {
  width: 18px;
  color: #8f959e;
  font-size: 12px;
}
.filter-conjunction {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #646a73;
}
.filter-conjunction select {
  height: 30px;
  border: 1px solid #d0d3d9;
  border-radius: 6px;
}
.panel-actions {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 2px;
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
</style>
