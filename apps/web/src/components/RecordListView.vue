<script setup lang="ts">
import { computed, ref } from 'vue';
import type { FieldDto, RecordDto } from '../api/types';
import {
  formatCellSummary,
  pickSummaryFields,
} from '../composables/recordSummary';

const props = defineProps<{
  fields: FieldDto[];
  records: RecordDto[];
  editable?: boolean;
  loading?: boolean;
  /** Visible column ids from current view; optional */
  viewFieldIds?: string[] | null;
}>();

const emit = defineEmits<{
  openRecord: [recordId: string];
  addRow: [];
  toggleSelect: [recordId: string];
}>();

const multi = ref(false);
const selected = ref<Set<string>>(new Set());

const layout = computed(() =>
  pickSummaryFields(props.fields, props.viewFieldIds ?? null, 3),
);

const titleField = computed(() =>
  props.fields.find((f) => f.id === layout.value.titleFieldId) ?? null,
);

const summaryFields = computed(() =>
  layout.value.summaryFieldIds
    .map((id) => props.fields.find((f) => f.id === id))
    .filter((f): f is FieldDto => Boolean(f)),
);

function titleText(record: RecordDto): string {
  const id = layout.value.titleFieldId;
  if (!id) return record.id.slice(0, 8);
  return formatCellSummary(
    record.cells?.[id],
    titleField.value?.type ?? 'text',
  );
}

function toggle(id: string): void {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
  emit('toggleSelect', id);
}

function onCardClick(id: string): void {
  if (multi.value) {
    toggle(id);
    return;
  }
  emit('openRecord', id);
}
</script>

<template>
  <div class="record-list" data-testid="record-list">
    <div class="record-list-toolbar">
      <button
        v-if="editable"
        type="button"
        class="btn touch-target"
        data-testid="record-list-add"
        @click="emit('addRow')"
      >
        新增
      </button>
      <button
        type="button"
        class="btn touch-target"
        data-testid="record-list-multi"
        @click="multi = !multi"
      >
        {{ multi ? '完成' : '多选' }}
      </button>
      <span v-if="loading" class="muted">加载中…</span>
    </div>
    <div v-if="!records.length && !loading" class="empty">暂无记录</div>
    <button
      v-for="record in records"
      :key="record.id"
      type="button"
      class="record-card touch-target"
      :class="{ selected: selected.has(record.id) }"
      :data-testid="`record-card-${record.id}`"
      @click="onCardClick(record.id)"
    >
      <div class="record-card-title">{{ titleText(record) }}</div>
      <div class="record-card-meta">
        <span
          v-for="field in summaryFields"
          :key="field.id"
          class="meta-chip"
        >
          <span class="meta-label">{{ field.name }}</span>
          {{ formatCellSummary(record.cells?.[field.id], field.type) }}
        </span>
      </div>
    </button>
  </div>
</template>

<style scoped>
.record-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  height: 100%;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}

.record-list-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}

.record-card {
  display: block;
  width: 100%;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  padding: 12px 14px;
  cursor: pointer;
}

.record-card.selected {
  border-color: var(--brand);
  background: #f0f7ff;
}

.record-card-title {
  font-weight: 600;
  font-size: 15px;
}

.record-card-meta {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  font-size: 12px;
  color: var(--text-secondary);
}

.meta-label {
  color: var(--text-tertiary);
  margin-right: 4px;
}

.empty,
.muted {
  color: var(--text-tertiary);
  font-size: 13px;
  padding: 24px 8px;
}
</style>
