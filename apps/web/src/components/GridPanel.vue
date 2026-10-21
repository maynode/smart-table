<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import CanvasGrid from './CanvasGrid.vue';
import FieldTypePicker from './FieldTypePicker.vue';
import { toast } from '../ui/toast';
import type { FieldDto, RecordDto } from '../api/types';
import type { GridStats } from '../grid-canvas/engine';
import type { FieldType, FilterOperator, ViewQuery } from 'shared';
import { evaluateFormulaRows, FIELD_TYPE_LABELS } from 'shared';
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
}>();

const emit = defineEmits<{
  addRow: [];
  loadMore: [];
  commit: [payload: { record: RecordDto; field: FieldDto; value: string }];
  toggleField: [payload: { field: FieldDto; hidden: boolean }];
  query: [query: ViewQuery];
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
}>();

const settingsOpen = ref(false);
const fieldPickerOpen = ref(false);
const fieldPickerMode = ref<'create' | 'edit'>('create');
const fieldPickerAnchor = ref<{ top: number; left: number } | null>(null);
const editingField = ref<FieldDto | null>(null);
const addFieldBtn = ref<HTMLButtonElement | null>(null);
const activePanel = ref<
  'filter' | 'sort' | 'group' | 'rowHeight' | 'color' | null
>(null);

const viewQuery = reactive<ViewQuery>({});
const filterField = ref('');
const filterOperator = ref<FilterOperator>('equals');
const filterValue = ref('');
const sortField = ref('');
const sortDirection = ref<'asc' | 'desc'>('asc');
const sortMode = ref<'value' | 'option'>('value');
const groupField = ref('');
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

const valueless = computed(() =>
  ['isEmpty', 'isNotEmpty', 'isTrue', 'isFalse'].includes(
    filterOperator.value,
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

function togglePanel(panel: typeof activePanel.value): void {
  activePanel.value = activePanel.value === panel ? null : panel;
}

function emitQuery(): void {
  emit('query', JSON.parse(JSON.stringify(viewQuery)) as ViewQuery);
}

function applyFilters(): void {
  if (!filterField.value) {
    toast('请选择筛选字段');
    return;
  }
  viewQuery.filters = {
    conjunction: 'and',
    conditions: [
      {
        fieldId: filterField.value,
        operator: filterOperator.value,
        value: valueless.value ? undefined : filterValue.value,
      },
    ],
  };
  emitQuery();
}

function applySort(): void {
  if (!sortField.value) {
    toast('请选择排序字段');
    return;
  }
  viewQuery.sorts = [
    {
      fieldId: sortField.value,
      direction: sortDirection.value,
      mode: sortMode.value,
    },
  ];
  emitQuery();
}

function applyGroup(): void {
  viewQuery.groups = groupField.value
    ? [{ fieldId: groupField.value }]
    : [];
  emitQuery();
}

function setRowHeight(height: 'short' | 'medium' | 'tall'): void {
  rowHeightChoice.value = height;
  viewQuery.rowHeight = height;
  emitQuery();
}

function applyColor(): void {
  if (!colorField.value) {
    toast('请选择填色字段');
    return;
  }
  viewQuery.colorRules = [
    {
      fieldId: colorField.value,
      operator: colorOperator.value,
      value: colorValue.value,
      color: color.value,
      scope: 'row',
    },
  ];
  emitQuery();
}

function clearView(): void {
  delete viewQuery.filters;
  delete viewQuery.sorts;
  delete viewQuery.groups;
  delete viewQuery.colorRules;
  delete viewQuery.rowHeight;
  emitQuery();
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
        class="btn btn-ghost"
        :class="{ 'btn-active': activePanel === 'filter' }"
        data-testid="filter-open"
        @click="togglePanel('filter')"
      >
        筛选
      </button>
      <button
        class="btn btn-ghost"
        :class="{ 'btn-active': activePanel === 'group' }"
        data-testid="group-open"
        @click="togglePanel('group')"
      >
        分组
      </button>
      <button
        class="btn btn-ghost"
        :class="{ 'btn-active': activePanel === 'sort' }"
        data-testid="sort-open"
        @click="togglePanel('sort')"
      >
        排序
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
        填色
      </button>
      <button class="btn btn-ghost" @click="clearView">清除视图</button>
      <span class="toolbar-spacer" />
      <span class="record-count" data-testid="record-count">
        记录数 {{ records.length }}{{ nextCursor ? '+' : '' }}
      </span>
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
      <div class="view-panel-body">
        <template v-if="activePanel === 'filter'">
          <label>
            字段
            <select v-model="filterField" data-testid="filter-field">
              <option value="">请选择</option>
              <option v-for="field in fields" :key="field.id" :value="field.id">
                {{ field.name }}
              </option>
            </select>
          </label>
          <label>
            条件
            <select v-model="filterOperator" data-testid="filter-operator">
              <option v-for="item in operators" :key="item.value" :value="item.value">
                {{ item.label }}
              </option>
            </select>
          </label>
          <label v-if="!valueless">
            值
            <input v-model="filterValue" data-testid="filter-value" />
          </label>
          <button class="btn btn-primary" data-testid="filter-apply" @click="applyFilters">
            应用筛选
          </button>
        </template>

        <template v-else-if="activePanel === 'sort'">
          <label>
            字段
            <select v-model="sortField" data-testid="sort-field">
              <option value="">请选择</option>
              <option v-for="field in fields" :key="field.id" :value="field.id">
                {{ field.name }}
              </option>
            </select>
          </label>
          <label>
            方向
            <select v-model="sortDirection" data-testid="sort-direction">
              <option value="asc">升序</option>
              <option value="desc">降序</option>
            </select>
          </label>
          <label>
            依据
            <select v-model="sortMode">
              <option value="value">按值</option>
              <option value="option">按选项顺序</option>
            </select>
          </label>
          <button class="btn btn-primary" data-testid="sort-apply" @click="applySort">
            应用排序
          </button>
        </template>

        <template v-else-if="activePanel === 'group'">
          <label>
            分组字段
            <select v-model="groupField" data-testid="group-field">
              <option value="">不分组</option>
              <option v-for="field in fields" :key="field.id" :value="field.id">
                {{ field.name }}
              </option>
            </select>
          </label>
          <button class="btn btn-primary" data-testid="group-apply" @click="applyGroup">
            应用分组
          </button>
        </template>

        <template v-else-if="activePanel === 'rowHeight'">
          <button
            v-for="height in (['short', 'medium', 'tall'] as const)"
            :key="height"
            class="btn"
            :class="{ 'btn-primary': rowHeightChoice === height }"
            :data-testid="`row-height-${height}`"
            @click="setRowHeight(height)"
          >
            {{ height === 'short' ? '紧凑' : height === 'medium' ? '中等' : '宽松' }}
          </button>
        </template>

        <template v-else-if="activePanel === 'color'">
          <label>
            字段
            <select v-model="colorField" data-testid="color-field">
              <option value="">请选择</option>
              <option v-for="field in fields" :key="field.id" :value="field.id">
                {{ field.name }}
              </option>
            </select>
          </label>
          <label>
            条件
            <select v-model="colorOperator">
              <option v-for="item in operators" :key="item.value" :value="item.value">
                {{ item.label }}
              </option>
            </select>
          </label>
          <label>
            值
            <input v-model="colorValue" data-testid="color-value" />
          </label>
          <label>
            颜色
            <input v-model="color" type="color" data-testid="color-value-input" />
          </label>
          <button class="btn btn-primary" data-testid="color-apply" @click="applyColor">
            应用填色
          </button>
        </template>
      </div>
    </div>

    <div v-if="groupLabels.length" class="group-chips" data-testid="group-chips">
      <span v-for="group in groupLabels" :key="`${group.fieldId}-${group.key}`" class="group-chip">
        {{ group.fieldName }} · {{ group.label }} ({{ group.count }})
      </span>
    </div>

    <div class="grid-body">
      <CanvasGrid
        :fields="fields"
        :records="displayRecords"
        :row-height="rowHeight ?? 36"
        :row-colors="rowColors ?? {}"
        @commit="(payload) => emit('commit', payload)"
        @viewport="handleViewport"
        @add-column="openFieldPicker"
        @header-click="openFieldEditor"
      />

      <aside v-if="settingsOpen" class="settings-panel" data-testid="table-settings-panel">
        <header class="settings-header">
          <strong>表格设置</strong>
          <button class="icon-btn" @click="settingsOpen = false">×</button>
        </header>
        <ul class="field-list">
          <li v-for="field in fields" :key="field.id" class="field-row">
            <span class="field-icon" :title="FIELD_TYPE_LABELS[field.type as FieldType] ?? field.type">
              {{ fieldTypeIcon(field.type) }}
            </span>
            <span class="field-name" :class="{ 'field-hidden': field.hidden }">
              {{ field.name }}
            </span>
            <button
              class="icon-btn"
              :data-testid="`toggle-field-${field.id}`"
              :title="field.hidden ? '显示字段' : '隐藏字段'"
              @click="emit('toggleField', { field, hidden: !field.hidden })"
            >
              {{ field.hidden ? '◌' : '◉' }}
            </button>
          </li>
        </ul>
        <button
          class="btn btn-ghost settings-add-field"
          data-testid="settings-add-field"
          @click="openFieldPicker"
        >
          + 新增字段
        </button>
        <p class="settings-hint">隐藏字段不显示在表格中，数据仍保留。</p>
      </aside>
    </div>

    <footer class="grid-footer">
      <button
        v-if="nextCursor"
        class="btn btn-ghost"
        :disabled="loading"
        @click="emit('loadMore')"
      >
        {{ loading ? '加载中…' : '加载更多' }}
      </button>
      <span class="muted">{{ sheetName }}</span>
      <span class="toolbar-spacer" />
      <span class="record-count">记录数 {{ records.length }}{{ nextCursor ? '+' : '' }}</span>
    </footer>
  </section>
</template>

<style scoped>
.record-count {
  font-size: 12px;
  color: #8f959e;
}
.btn-active {
  background: #eef3ff !important;
  color: #3370ff !important;
}
.view-panel {
  margin: 0 12px 8px;
  border: 1px solid #e5e6eb;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 6px 20px rgba(31, 35, 41, 0.08);
}
.view-panel-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 0;
  font-size: 13px;
  font-weight: 600;
}
.view-panel-body {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
  padding: 10px 12px 12px;
}
.view-panel-body label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #646a73;
}
.view-panel-body select,
.view-panel-body input {
  min-width: 120px;
  height: 30px;
  padding: 0 8px;
  border: 1px solid #d0d3d9;
  border-radius: 6px;
  background: #fff;
}
.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 4px;
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
.settings-add-field {
  width: 100%;
  margin-top: 8px;
  justify-content: flex-start;
}
.group-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid #e5e6eb;
  background: #fff;
}
.group-chip {
  padding: 4px 10px;
  border-radius: 999px;
  background: #eef4ff;
  color: #1d6fdc;
  font-size: 12px;
}
</style>
