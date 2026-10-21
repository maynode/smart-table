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
import type { FieldDto, RecordDto } from '../api/types';
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
    rowColors?: Record<string, string>;
  }>(),
  {
    records: () => [],
    rowCount: undefined,
    provider: null,
    editable: true,
    showAddColumn: true,
    rowHeight: 36,
    rowColors: () => ({}),
  },
);

const emit = defineEmits<{
  commit: [payload: { record: RecordDto; field: FieldDto; value: string }];
  viewport: [stats: GridStats];
  addColumn: [anchor: { top: number; left: number }];
  headerClick: [
    payload: { field: FieldDto; anchor: { top: number; left: number } },
  ];
}>();

const host = ref<HTMLDivElement | null>(null);
const editorInput = ref<HTMLInputElement | HTMLSelectElement | null>(null);
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
    cols.push({ id: ADD_FIELD_COLUMN_ID, name: '+', width: 44 });
  }
  return cols;
});

const editorKind = computed(() => {
  const type = editing.value?.field.type;
  if (!type) return 'text';
  if (type === 'select') return 'select';
  if (type === 'multiSelect') return 'multiSelect';
  if (type === 'checkbox') return 'checkbox';
  if (type === 'date') return 'date';
  if (
    type === 'number' ||
    type === 'currency' ||
    type === 'percent' ||
    type === 'progress'
  ) {
    return 'number';
  }
  if (type === 'email') return 'email';
  if (type === 'phone') return 'tel';
  if (type === 'url') return 'url';
  return 'text';
});

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

function formatCell(field: FieldDto, value: unknown): CellRender | null {
  if (value === null || value === undefined || value === '') return null;

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

  return { text: textOf(value) };
}

function renderCell(row: number, col: number): CellRender | null {
  if (props.provider) return props.provider(row, col);
  const field = visibleFields.value[col];
  if (!field) return null;
  const record = props.records[row];
  if (!record) return null;
  return formatCell(field, record.cells[field.id]);
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
    field.type === 'autoNumber'
  ) {
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
  const current = record.cells[field.id];
  const next = !(current === true || current === 'true');
  emit('commit', {
    record,
    field,
    value: next ? 'true' : 'false',
  });
}

function onCellClick(selection: { row: number; col: number }): void {
  const field = visibleFields.value[selection.col];
  if (field?.type === 'checkbox') {
    toggleCheckbox(selection.row, selection.col);
  }
}

function commitEdit(save: boolean): void {
  const current = editing.value;
  editing.value = null;
  if (!save || !current) return;

  const record = props.records.find((item) => item.id === current.recordId);
  if (!record) return;

  let nextValue = current.value;
  if (current.field.type === 'checkbox') {
    nextValue =
      current.value === 'true' || current.value === '1' ? 'true' : 'false';
  }

  const previous = textOf(record.cells[current.field.id]);
  if (current.field.type === 'checkbox') {
    const prevBool =
      record.cells[current.field.id] === true ||
      record.cells[current.field.id] === 'true'
        ? 'true'
        : 'false';
    if (nextValue === prevBool) return;
  } else if (nextValue === previous) {
    return;
  }

  emit('commit', { record, field: current.field, value: nextValue });
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

function createEngine(): void {
  if (!host.value) return;
  engine = new CanvasGridEngine(host.value, {
    columns: columns.value,
    rowCount: props.rowCount ?? props.records.length,
    rowHeight: props.rowHeight,
    getCell: renderCell,
    getRowColor: (row) => {
      const record = props.records[row];
      return record ? (props.rowColors[record.id] ?? null) : null;
    },
    onCellClick: onCellClick,
    onCellDoubleClick: (selection) => beginEdit(selection.row, selection.col),
    onColumnResize: (columnIndex, width) => {
      const field = visibleFields.value[columnIndex];
      if (field) resizedWidths.set(field.id, width);
    },
    onAddColumnClick: (anchor) => emit('addColumn', anchor),
    onHeaderClick: (columnIndex, anchor) => {
      const field = visibleFields.value[columnIndex];
      if (field) emit('headerClick', { field, anchor });
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
  () => props.rowColors,
  () => engine?.invalidate(),
  { deep: true },
);

onBeforeUnmount(() => {
  engine?.destroy();
  engine = null;
});

defineExpose({
  getEngine: () => engine,
});
</script>

<template>
  <div class="canvas-grid-wrap">
    <div ref="host" class="canvas-grid-host" data-testid="canvas-grid"></div>

    <select
      v-if="editing && editorKind === 'select'"
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
      data-testid="cell-editor"
      @keydown.enter.prevent="commitEdit(true)"
      @keydown.esc.prevent="commitEdit(false)"
      @blur="commitEdit(true)"
    />
  </div>
</template>

<style scoped>
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
.multi-done {
  align-self: flex-end;
  height: 28px;
  margin-top: 4px;
}
</style>
