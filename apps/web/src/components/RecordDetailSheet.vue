<script setup lang="ts">
import {
  isComputedFieldType,
  isSystemFieldType,
  type AiComponentOptions,
  type FieldType,
} from 'shared';
import { computed, reactive, ref, watch } from 'vue';
import { endpoints } from '../api/endpoints';
import { messageOf } from '../api/error-message';
import type { FieldDto, MemberDto, RecordDto } from '../api/types';
import { toast } from '../ui/toast';
import MobileSheet from './MobileSheet.vue';
import { formatCellSummary } from '../composables/recordSummary';

const props = defineProps<{
  open: boolean;
  record: RecordDto | null;
  fields: FieldDto[];
  editable?: boolean;
  members?: MemberDto[];
  uploadAttachment?: (file: File) => Promise<{
    url: string;
    name: string;
    mimetype?: string;
    size?: number;
  }>;
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
const uploadingFieldId = ref<string | null>(null);
const relationChoices = reactive<
  Record<string, Array<{ id: string; label: string }>>
>({});
const relationLoading = reactive<Record<string, boolean>>({});

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

/** Legacy aliases once used in phone UI — still treat as non-editable. */
const LEGACY_READONLY = new Set([
  'createdTime',
  'lastModifiedTime',
  'lastModifiedBy',
]);

const editableFields = computed(() =>
  props.fields.filter((f) => {
    const t = f.type as FieldType;
    if (LEGACY_READONLY.has(f.type)) return false;
    if (isSystemFieldType(t) || isComputedFieldType(t)) return false;
    return true;
  }),
);

function progressValue(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function attachmentUrl(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && raw !== null) {
    const o = raw as { url?: string; name?: string };
    return typeof o.url === 'string' ? o.url : null;
  }
  return null;
}

function attachmentName(raw: unknown): string {
  if (raw && typeof raw === 'object' && raw !== null) {
    const o = raw as { name?: string };
    if (typeof o.name === 'string' && o.name.trim()) return o.name.trim();
  }
  return '附件';
}

function relationValue(raw: unknown): string {
  if (raw == null || raw === '') return '';
  if (Array.isArray(raw)) return String(raw[0] ?? '');
  return String(raw);
}

async function ensureRelationChoices(field: FieldDto): Promise<void> {
  if (relationChoices[field.id]?.length || relationLoading[field.id]) return;
  const targetSheetId = (
    field.options as { relation?: { targetSheetId?: string } } | null
  )?.relation?.targetSheetId;
  if (!targetSheetId) {
    relationChoices[field.id] = [];
    return;
  }
  relationLoading[field.id] = true;
  try {
    const sheet = await endpoints.getSheet(targetSheetId);
    const page = await endpoints.listRecords(targetSheetId, null, 100);
    const titleField =
      sheet.fields?.find((item) => item.type === 'title') ??
      sheet.fields?.find((item) => item.type === 'text') ??
      sheet.fields?.[0] ??
      null;
    relationChoices[field.id] = page.records.map((rec) => {
      const raw = titleField ? rec.cells[titleField.id] : null;
      const label =
        raw === null || raw === undefined || raw === ''
          ? rec.id.slice(0, 8)
          : String(raw);
      return { id: rec.id, label };
    });
  } catch {
    relationChoices[field.id] = [];
  } finally {
    relationLoading[field.id] = false;
  }
}

watch(
  () =>
    [
      props.open,
      props.record?.id,
      props.fields.map((f) => f.id).join(','),
    ] as const,
  () => {
    if (!props.open || !props.record) return;
    for (const field of editableFields.value) {
      if (field.type === 'relation') void ensureRelationChoices(field);
    }
  },
  { immediate: true },
);

async function onAttachmentPicked(
  field: FieldDto,
  event: Event,
): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || !props.editable || !props.record || !props.uploadAttachment) {
    return;
  }
  uploadingFieldId.value = field.id;
  try {
    const uploaded = await props.uploadAttachment(file);
    const previous = props.record.cells?.[field.id];
    draft.value[field.id] = uploaded;
    emit('commit', {
      record: props.record,
      field,
      value: uploaded,
      previous,
    });
  } catch (error) {
    toast(messageOf(error) || '上传失败');
  } finally {
    uploadingFieldId.value = null;
  }
}

function clearAttachment(field: FieldDto): void {
  if (!props.editable || !props.record) return;
  const previous = props.record.cells?.[field.id];
  draft.value[field.id] = null;
  emit('commit', {
    record: props.record,
    field,
    value: null,
    previous,
  });
}

function onRelationChange(field: FieldDto, event: Event): void {
  const select = event.target as HTMLSelectElement;
  const v = select.value;
  draft.value[field.id] = v ? v : null;
  commitField(field);
}

function toDateInput(raw: unknown): string {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'number') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }
  const s = String(raw);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function toDateTimeLocal(raw: unknown): string {
  if (raw == null || raw === '') return '';
  const d =
    typeof raw === 'number' ? new Date(raw) : new Date(String(raw));
  if (Number.isNaN(d.getTime())) {
    const s = String(raw);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.slice(0, 16);
    return '';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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
          v-else-if="field.type === 'date'"
          class="detail-input"
          type="date"
          :disabled="!editable"
          data-testid="record-detail-date"
          :value="toDateInput(draft[field.id])"
          @change="
            (ev) => {
              draft[field.id] = (ev.target as HTMLInputElement).value || null;
              commitField(field);
            }
          "
        />
        <input
          v-else-if="field.type === 'datetime'"
          class="detail-input"
          type="datetime-local"
          :disabled="!editable"
          data-testid="record-detail-datetime"
          :value="toDateTimeLocal(draft[field.id])"
          @change="
            (ev) => {
              const v = (ev.target as HTMLInputElement).value;
              draft[field.id] = v ? new Date(v).toISOString() : null;
              commitField(field);
            }
          "
        />
        <div
          v-else-if="field.type === 'progress'"
          class="detail-progress"
          data-testid="record-detail-progress"
        >
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            class="detail-progress-range"
            :disabled="!editable"
            :value="progressValue(draft[field.id])"
            @input="
              (ev) => {
                draft[field.id] = Number((ev.target as HTMLInputElement).value);
              }
            "
            @change="commitField(field)"
          />
          <input
            type="number"
            min="0"
            max="100"
            class="detail-input detail-progress-num"
            :disabled="!editable"
            :value="progressValue(draft[field.id])"
            @change="
              (ev) => {
                draft[field.id] = progressValue(
                  (ev.target as HTMLInputElement).value,
                );
                commitField(field);
              }
            "
          />
          <span class="detail-progress-unit">%</span>
        </div>
        <input
          v-else-if="field.type === 'barcode' || field.type === 'location'"
          v-model="draft[field.id] as string"
          class="detail-input"
          type="text"
          :disabled="!editable"
          :placeholder="
            field.type === 'barcode' ? '扫描或输入条码' : '输入地址'
          "
          :data-testid="
            field.type === 'barcode'
              ? 'record-detail-barcode'
              : 'record-detail-location'
          "
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
          v-else-if="field.type === 'image' || field.type === 'file'"
          class="detail-attachment"
          data-testid="record-detail-attachment"
        >
          <template v-if="attachmentUrl(draft[field.id] ?? record.cells?.[field.id])">
            <a
              class="detail-attachment-link"
              :href="attachmentUrl(draft[field.id] ?? record.cells?.[field.id])!"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{
                field.type === 'image'
                  ? '查看图片'
                  : attachmentName(draft[field.id] ?? record.cells?.[field.id])
              }}
            </a>
            <button
              v-if="editable"
              type="button"
              class="btn btn-ghost touch-target"
              data-testid="record-detail-attachment-clear"
              @click="clearAttachment(field)"
            >
              清除
            </button>
          </template>
          <span v-else class="detail-readonly">未上传</span>
          <label
            v-if="editable && uploadAttachment"
            class="btn btn-secondary touch-target detail-upload-btn"
            :class="{ 'is-busy': uploadingFieldId === field.id }"
          >
            {{
              uploadingFieldId === field.id
                ? '上传中…'
                : attachmentUrl(draft[field.id] ?? record.cells?.[field.id])
                  ? '重新上传'
                  : '上传'
            }}
            <input
              class="sr-only"
              type="file"
              :accept="field.type === 'image' ? 'image/*' : undefined"
              :disabled="uploadingFieldId === field.id"
              data-testid="record-detail-attachment-input"
              @change="onAttachmentPicked(field, $event)"
            />
          </label>
        </div>
        <select
          v-else-if="field.type === 'relation'"
          class="detail-input"
          :disabled="!editable || relationLoading[field.id]"
          data-testid="record-detail-relation"
          :value="relationValue(draft[field.id] ?? record.cells?.[field.id])"
          @focus="ensureRelationChoices(field)"
          @change="onRelationChange(field, $event)"
        >
          <option value="">
            {{ relationLoading[field.id] ? '加载中…' : '选择关联记录' }}
          </option>
          <option
            v-for="choice in relationChoices[field.id] ?? []"
            :key="choice.id"
            :value="choice.id"
          >
            {{ choice.label }}
          </option>
        </select>
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
        <div
          v-else-if="field.type === 'groupChat'"
          class="detail-readonly"
          data-testid="record-detail-group-chat"
        >
          群聊字段已停用，仅保留历史展示
          <template
            v-if="formatCellSummary(draft[field.id] ?? record.cells?.[field.id], field.type) !== '—'"
          >
            ：{{
              formatCellSummary(
                draft[field.id] ?? record.cells?.[field.id],
                field.type,
              )
            }}
          </template>
        </div>
        <div v-else class="detail-readonly" data-testid="record-detail-readonly">
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

.detail-progress {
  display: flex;
  align-items: center;
  gap: 10px;
}

.detail-progress-range {
  flex: 1;
  min-width: 0;
  height: var(--touch-min);
}

.detail-progress-num {
  width: 72px;
  flex: none;
  text-align: center;
}

.detail-progress-unit {
  flex: none;
  color: var(--text-secondary);
  font-size: 13px;
}

.detail-attachment {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-height: var(--touch-min);
}

.detail-attachment-link {
  color: var(--brand-strong);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  padding: 10px 0;
  word-break: break-all;
}

.detail-attachment-link:hover {
  text-decoration: underline;
}

.detail-upload-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  margin: 0;
}

.detail-upload-btn.is-busy {
  opacity: 0.7;
  pointer-events: none;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
