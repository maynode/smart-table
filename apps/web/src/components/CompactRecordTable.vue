<script setup lang="ts">
import { computed } from 'vue';
import type { FieldDto, RecordDto } from '../api/types';
import { formatCellSummary } from '../composables/recordSummary';

const props = defineProps<{
  fields: FieldDto[];
  records: RecordDto[];
  maxCols?: number;
}>();

const emit = defineEmits<{
  openRecord: [recordId: string];
  openCell: [payload: { recordId: string; fieldId: string }];
}>();

const cols = computed(() =>
  props.fields
    .filter(
      (f) =>
        !['createdTime', 'lastModifiedTime', 'createdBy', 'lastModifiedBy'].includes(
          f.type,
        ),
    )
    .slice(0, props.maxCols ?? 8),
);
</script>

<template>
  <div class="compact-wrap" data-testid="compact-record-table">
    <table class="compact-table">
      <thead>
        <tr>
          <th v-for="field in cols" :key="field.id">{{ field.name }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="record in records"
          :key="record.id"
          @click="emit('openRecord', record.id)"
        >
          <td
            v-for="field in cols"
            :key="field.id"
            @click.stop="emit('openCell', { recordId: record.id, fieldId: field.id })"
          >
            {{
              formatCellSummary(
                record.cells?.[field.id],
                field.type,
                field.options,
              )
            }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.compact-wrap {
  height: 100%;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}

.compact-table {
  border-collapse: collapse;
  min-width: 100%;
  font-size: 13px;
}

.compact-table th,
.compact-table td {
  border-bottom: 1px solid var(--border);
  padding: 10px 12px;
  white-space: nowrap;
  text-align: left;
  min-width: 96px;
  min-height: var(--touch-min);
}

.compact-table th {
  position: sticky;
  top: 0;
  background: var(--bg-muted);
  z-index: 1;
  font-weight: 600;
  color: var(--text-secondary);
}

.compact-table tr:active td {
  background: var(--bg-hover);
}
</style>
