<script setup lang="ts">
import { computed, ref } from 'vue';
import CanvasGrid from './CanvasGrid.vue';
import FieldTypePicker from './FieldTypePicker.vue';
import FieldOptionsEditor from './FieldOptionsEditor.vue';
import { toast } from '../ui/toast';
import type { FieldDto, MemberDto, RecordDto } from '../api/types';
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
  commit: [payload: { record: RecordDto; field: FieldDto; value: unknown }];
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
  'filter' | 'sort' | 'group' | 'rowHeight' | 'color' | null
>(null);
const optionsField = ref<FieldDto | null>(null);
const deletingField = ref<FieldDto | null>(null);
const selectedRecordIds = ref<string[]>([]);

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

const displayRecords = computed<RecordDto[]>(() => {
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

defineExpose({ applySavedQuery, currentQuery, clearRowSelection: () => gridRef.value?.clearRowSelection() });
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
      <span class="record-count" data-testid="record-count">
        记录数 {{ displayRecords.length }}{{ nextCursor ? '+' : '' }}
      </span>
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
      @close="closeFieldPicker"
      @confirm="onFieldConfirm"
    />

    <FieldOptionsEditor
      :open="Boolean(optionsField)"
      :field="optionsField"
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
            {{ field.hidden ? '🙈' : '👁' }}
          </button>
          <button
            v-if="field.type === 'select' || field.type === 'multiSelect'"
            class="icon-btn"
            title="编辑选项"
            :data-testid="`edit-options-${field.name}`"
            @click="openOptions(field)"
          >
            ⚙
          </button>
          <button
            class="icon-btn danger"
            title="删除字段"
            :data-testid="`delete-field-${field.name}`"
            @click="deletingField = field"
          >
            🗑
          </button>
        </div>
      </div>
      <button class="btn settings-add-field" data-testid="settings-add-field" @click="openFieldPicker">
        + 新增字段
      </button>
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
        :row-colors="rowColors"
        :person-names="personNames"
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
