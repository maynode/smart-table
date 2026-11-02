<script setup lang="ts">
import type { AiComponentOptions } from 'shared';
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
  openAiComponent: [payload: { record: RecordDto; field: FieldDto }];
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

function aiComponentReady(field: FieldDto): boolean {
  const opts = (field.options?.aiComponent ?? {}) as AiComponentOptions;
  return opts.status === 'published' && Boolean(opts.bundle?.html);
}

function openAiComponent(field: FieldDto): void {
  if (!props.record) return;
  emit('openAiComponent', { record: props.record, field });
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
        <select
          v-else-if="field.type === 'multiSelect'"
          multiple
          class="detail-input detail-multi"
          :disabled="!editable"
          data-testid="record-detail-multi-select"
          :value="Array.isArray(draft[field.id]) ? (draft[field.id] as string[]) : []"
          @change="
            (ev) => {
              const el = ev.target as HTMLSelectElement;
              draft[field.id] = Array.from(el.selectedOptions).map((o) => o.value);
              commitField(field);
            }
          "
        >
          <option
            v-for="c in choices(field)"
            :key="c.id"
            :value="c.id"
          >
            {{ c.name }}
          </option>
        </select>
        <select
          v-else-if="field.type === 'person'"
          v-model="draft[field.id]"
          class="detail-input"
          :disabled="!editable"
          data-testid="record-detail-person"
          @change="commitField(field)"
        >
          <option :value="undefined">未指定</option>
          <option
            v-for="m in members ?? []"
            :key="m.userId"
            :value="m.userId"
          >
            {{ m.account }}
          </option>
        </select>
        <label
          v-else-if="field.type === 'checkbox'"
          class="detail-check touch-target"
        >
          <input
            type="checkbox"
            :checked="Boolean(draft[field.id])"
            :disabled="!editable"
            data-testid="record-detail-checkbox"
            @change="
              (ev) => {
                draft[field.id] = (ev.target as HTMLInputElement).checked;
                commitField(field);
              }
            "
          />
          {{ draft[field.id] ? '已勾选' : '未勾选' }}
        </label>
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
        <div
          v-else-if="field.type === 'aiComponent'"
          class="detail-ai"
          data-testid="record-detail-ai-component"
        >
          <div class="detail-ai-summary">
            {{
              formatCellSummary(
                draft[field.id] ?? record.cells?.[field.id],
                field.type,
                field.options,
              )
            }}
          </div>
          <button
            type="button"
            class="btn btn-primary touch-target"
            data-testid="record-detail-ai-open"
            :disabled="!aiComponentReady(field)"
            @click="openAiComponent(field)"
          >
            {{ aiComponentReady(field) ? '打开组件' : '尚未发布' }}
          </button>
        </div>
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
  padding: 12px 16px calc(24px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.detail-multi {
  min-height: 88px;
}
.detail-check {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
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

.detail-ai {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-ai-summary {
  min-height: var(--touch-min);
  padding: 10px 12px;
  background: var(--bg-muted);
  border-radius: 8px;
  color: var(--text);
  font-size: 14px;
  line-height: 1.4;
}
</style>
