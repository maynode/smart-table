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
  CanvasGridEngine,
  type CellRender,
  type GridColumn,
  type GridStats,
} from '../grid-canvas/engine';
import type { FieldDto, RecordDto } from '../api/types';

const props = withDefaults(
  defineProps<{
    fields: FieldDto[];
    records?: RecordDto[];
    rowCount?: number;
    provider?: ((row: number, col: number) => CellRender | null) | null;
    editable?: boolean;
    rowHeight?: number;
    rowColors?: Record<string, string>;
  }>(),
  {
    records: () => [],
    rowCount: undefined,
    provider: null,
    editable: true,
    rowHeight: 36,
    rowColors: () => ({}),
  },
);

const emit = defineEmits<{
  commit: [payload: { record: RecordDto; field: FieldDto; value: string }];
  viewport: [stats: GridStats];
}>();

const host = ref<HTMLDivElement | null>(null);
const editorInput = ref<HTMLInputElement | null>(null);
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

const columns = computed<GridColumn[]>(() =>
  visibleFields.value.map((field) => ({
    id: field.id,
    name: field.name,
    width: resizedWidths.get(field.id) ?? defaultWidth(field),
  })),
);

const isSelectEditor = computed(
  () => editing.value?.field.type === 'select',
);

const selectChoices = computed(
  () => editing.value?.field.options?.choices ?? [],
);

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
      return 120;
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
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
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

  if (field.type === 'checkbox') {
    return { text: value ? '是' : '否' };
  }

  return { text: textOf(value) };
}

function renderCell(row: number, col: number): CellRender | null {
  if (props.provider) return props.provider(row, col);
  const record = props.records[row];
  const field = visibleFields.value[col];
  if (!record || !field) return null;
  return formatCell(field, record.cells[field.id]);
}

function beginEdit(row: number, col: number): void {
  if (!props.editable || !engine) return;
  const record = props.records[row];
  const field = visibleFields.value[col];
  if (!record || !field) return;

  engine.ensureCellVisible(row, col);
  const rect = engine.cellRect(row, col);
  editing.value = {
    recordId: record.id,
    row,
    col,
    field,
    value: textOf(record.cells[field.id]),
    style: {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    },
  };

  nextTick(() => {
    editorInput.value?.focus();
    editorInput.value?.select();
  });
}

function commitEdit(save: boolean): void {
  const current = editing.value;
  editing.value = null;
  if (!save || !current) return;

  const record = props.records.find((item) => item.id === current.recordId);
  if (!record) return;
  if (current.value === textOf(record.cells[current.field.id])) return;

  emit('commit', { record, field: current.field, value: current.value });
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
    onCellDoubleClick: (selection) => beginEdit(selection.row, selection.col),
    onColumnResize: (columnIndex, width) => {
      const field = visibleFields.value[columnIndex];
      if (field) resizedWidths.set(field.id, width);
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
      v-if="editing && isSelectEditor"
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

    <input
      v-else-if="editing"
      ref="editorInput"
      v-model="editing.value"
      class="cell-editor"
      :style="editing.style"
      data-testid="cell-editor"
      @keydown.enter.prevent="commitEdit(true)"
      @keydown.esc.prevent="commitEdit(false)"
      @blur="commitEdit(true)"
    />
  </div>
</template>
