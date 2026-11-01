<script setup lang="ts">
import { computed, ref } from 'vue';
import type { FieldDto, RecordDto } from '../api/types';
import {
  formatCellSummary,
  pickSummaryFields,
  resolveRecordPrimaryText,
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

const summaryFields = computed(() =>
  layout.value.summaryFieldIds
    .map((id) => props.fields.find((f) => f.id === id))
    .filter((f): f is FieldDto => Boolean(f)),
);

function titleText(record: RecordDto): string {
  return resolveRecordPrimaryText(
    record.cells,
    props.fields,
    layout.value,
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
      class="record-card"
      :class="{ selected: selected.has(record.id) }"
      :data-testid="`record-card-${record.id}`"
      @click="onCardClick(record.id)"
    >
      <div class="record-card-title">{{ titleText(record) }}</div>
      <div v-if="summaryFields.length" class="record-card-meta">
        <template v-for="field in summaryFields" :key="field.id">
          <span
            v-if="
              formatCellSummary(
                record.cells?.[field.id],
                field.type,
                field.options,
              ) !== '—'
            "
            class="meta-chip"
          >
            <span class="meta-label">{{ field.name }}</span>
            <span class="meta-value">{{
              formatCellSummary(
                record.cells?.[field.id],
                field.type,
                field.options,
              )
            }}</span>
          </span>
        </template>
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
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  gap: 6px;
  width: 100%;
  min-height: var(--touch-min);
  height: auto;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  padding: 12px 14px;
  cursor: pointer;
  overflow: visible;
}

.record-card.selected {
  border-color: var(--brand);
  background: #f0f7ff;
}

.record-card-title {
  font-weight: 600;
  font-size: 15px;
  line-height: 1.35;
  word-break: break-word;
}

.record-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-secondary);
}

.meta-chip {
  display: inline-flex;
  align-items: baseline;
  max-width: 100%;
  min-width: 0;
}

.meta-label {
  flex-shrink: 0;
  color: var(--text-tertiary);
  margin-right: 4px;
}

.meta-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 140px;
}

.empty,
.muted {
  color: var(--text-tertiary);
  font-size: 13px;
  padding: 24px 8px;
}
</style>
