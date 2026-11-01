<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { FieldDto, MemberDto, RecordDto } from '../api/types';
import MobileSheet from './MobileSheet.vue';
import { formatCellSummary } from '../composables/recordSummary';

const props = defineProps<{
  open: boolean;
  record: RecordDto | null;
  fields: FieldDto[];
  editable?: boolean;
  members?: MemberDto[];
}>();

const emit = defineEmits<{
  close: [];
  commit: [
    payload: {
      record: RecordDto;
      field: FieldDto;
      value: unknown;
      previous?: unknown;
    },
  ];
}>();

const draft = ref<Record<string, unknown>>({});

watch(
  () => props.record?.id,
  () => {
    draft.value = { ...(props.record?.cells ?? {}) };
  },
  { immediate: true },
);

const title = computed(() => {
  if (!props.record) return '记录';
  const titleField =
    props.fields.find((f) => f.type === 'title') ?? props.fields[0];
  if (!titleField) return '记录';
  return formatCellSummary(
    props.record.cells?.[titleField.id],
    titleField.type,
  );
});

const editableFields = computed(() =>
  props.fields.filter(
    (f) =>
      !['formula', 'lookup', 'createdTime', 'lastModifiedTime', 'createdBy', 'lastModifiedBy', 'autoNumber'].includes(
        f.type,
      ),
  ),
);

function choices(field: FieldDto): { id: string; name: string }[] {
  const opts = field.options as { choices?: { id: string; name: string }[] } | null;
  return opts?.choices ?? [];
}

function commitField(field: FieldDto): void {
  if (!props.editable || !props.record) return;
  const previous = props.record.cells?.[field.id];
  const value = draft.value[field.id];
  if (previous === value) return;
  emit('commit', {
    record: props.record,
    field,
    value,
    previous,
  });
}
</script>

<template>
  <MobileSheet
    :open="open"
    :title="String(title)"
    test-id="record-detail-sheet"
    @close="emit('close')"
  >
    <div v-if="record" class="detail-body">
      <div
        v-for="field in editableFields"
        :key="field.id"
        class="detail-field"
      >
        <label class="detail-label">{{ field.name }}</label>
        <select
          v-if="field.type === 'singleSelect' || field.type === 'select'"
          v-model="draft[field.id]"
          class="detail-input"
          :disabled="!editable"
          data-testid="record-detail-select"
          @change="commitField(field)"
        >
          <option :value="undefined">—</option>
          <option
            v-for="c in choices(field)"
            :key="c.id"
            :value="c.id"
          >
            {{ c.name }}
          </option>
        </select>
        <textarea
          v-else-if="
            field.type === 'text' ||
            field.type === 'title' ||
            field.type === 'longText'
          "
          v-model="draft[field.id] as string"
          class="detail-input"
          :rows="field.type === 'longText' ? 3 : 2"
          :disabled="!editable"
          data-testid="record-detail-text"
          @change="commitField(field)"
        />
        <input
          v-else-if="field.type === 'number' || field.type === 'currency' || field.type === 'percent'"
          v-model.number="draft[field.id] as number"
          type="number"
          class="detail-input"
          :disabled="!editable"
          @change="commitField(field)"
        />
        <input
          v-else-if="field.type === 'date' || field.type === 'datetime'"
          v-model="draft[field.id] as string"
          type="date"
          class="detail-input"
          :disabled="!editable"
          @change="commitField(field)"
        />
        <input
          v-else-if="field.type === 'phone' || field.type === 'email' || field.type === 'url'"
          v-model="draft[field.id] as string"
          class="detail-input"
          :type="field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : 'tel'"
          :disabled="!editable"
          data-testid="record-detail-phone"
          @change="commitField(field)"
        />
        <div v-else class="detail-readonly">
          {{
            formatCellSummary(
              draft[field.id] ?? record.cells?.[field.id],
              field.type,
              field.options,
            )
          }}
        </div>
      </div>
    </div>
  </MobileSheet>
</template>

<style scoped>
.detail-body {
  padding: 12px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.detail-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.detail-label {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 600;
}

.detail-input {
  min-height: var(--touch-min);
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font: inherit;
  background: var(--bg);
}

.detail-readonly {
  min-height: var(--touch-min);
  padding: 10px 12px;
  background: var(--bg-muted);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 14px;
}
</style>
