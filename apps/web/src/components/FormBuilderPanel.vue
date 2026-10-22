<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { toast } from '../ui/toast';
import type {
  DisplayConditionDto,
  DisplayConditionOperator,
  FormDto,
  FormFieldConfigDto,
  SheetDto,
} from '../api/types';
import { fieldTypeIcon } from '../ui/field-icons';

const props = defineProps<{ baseId: string; sheet: SheetDto | null }>();
const emit = defineEmits<{ close: [] }>();

const form = ref<FormDto | null>(null);
const draftId = ref(crypto.randomUUID());
const loading = ref(true);
const saving = ref(false);
const uploadingCover = ref(false);
const error = ref('');
const name = ref('');
const coverUrl = ref('');
const template = ref('');
const rejectDuplicatePhone = ref(true);
const shareEnabled = ref(true);
const audience = ref<'anyone' | 'workspace'>('anyone');
const expiresAt = ref('');
const items = ref<FormFieldConfigDto[]>([]);
const selectedFieldId = ref('');
const conditionOwnerId = ref('');
const addFieldId = ref('');
const previewTab = ref<'design' | 'preview'>('design');
const successPreviewHtml = ref('');
const previewValues = ref<Record<string, unknown>>({});
const coverInput = ref<HTMLInputElement | null>(null);
const showConditionsFor = ref<Record<string, boolean>>({});

const sheetFields = computed(() => props.sheet?.fields ?? []);
const fieldById = computed(
  () => new Map(sheetFields.value.map((field) => [field.id, field])),
);
const configuredIds = computed(() => new Set(items.value.map((item) => item.fieldId)));
const availableFields = computed(() =>
  sheetFields.value.filter((field) => !configuredIds.value.has(field.id)),
);
const selectedConfig = computed(
  () => items.value.find((item) => item.fieldId === selectedFieldId.value) ?? null,
);
const selectedSheetField = computed(
  () => fieldById.value.get(selectedFieldId.value) ?? null,
);
const formId = computed(() => form.value?.id ?? draftId.value);
const shareUrl = computed(() => form.value?.share.qrUrl ?? '');
const qrDataUrl = computed(() => form.value?.share.qrCodeDataUrl ?? '');
const expiresAtInput = computed({
  get: () => (expiresAt.value ? expiresAt.value.slice(0, 10) : ''),
  set: (value: string) => {
    expiresAt.value = value ? new Date(`${value}T23:59:59`).toISOString() : '';
  },
});
const previewFields = computed(() =>
  items.value
    .map((config) => ({
      config,
      field: fieldById.value.get(config.fieldId),
    }))
    .filter(
      (
        item,
      ): item is {
        config: FormFieldConfigDto;
        field: NonNullable<ReturnType<typeof fieldById.value.get>>;
      } => Boolean(item.field),
    ),
);
const activeConditionCount = computed(
  () =>
    items.value.reduce(
      (total, item) => total + (item.displayConditions?.length ?? 0),
      0,
    ),
);

const conditionOperators: Array<{
  value: DisplayConditionOperator;
  label: string;
}> = [
  { value: 'equals', label: '等于' },
  { value: 'notEquals', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'notEmpty', label: '不为空' },
  { value: 'isEmpty', label: '为空' },
];

function errorOf(caught: unknown): string {
  return caught instanceof ApiError ? caught.message : '保存失败，请稍后再试';
}

function fieldName(fieldId: string): string {
  return fieldById.value.get(fieldId)?.name ?? fieldId;
}

async function load(): Promise<void> {
  if (!props.sheet) return;
  loading.value = true;
  error.value = '';
  try {
    const forms = await endpoints.listForms(props.baseId);
    form.value = forms.find((item) => item.sheetId === props.sheet?.id) ?? null;
    name.value = form.value?.name ?? `${props.sheet.name}收集表`;
    coverUrl.value = form.value?.coverUrl ?? '';
    template.value =
      form.value?.successPage.templateHtml ??
      '<h2>提交成功！</h2><p>你的序列号是 <strong>{{序列号}}</strong></p>';
    rejectDuplicatePhone.value = form.value?.rejectDuplicatePhone ?? true;
    shareEnabled.value = form.value?.share.enabled ?? true;
    audience.value = form.value?.share.audience ?? 'anyone';
    expiresAt.value = form.value?.share.expiresAt ?? '';

    const existing = form.value?.fields ?? [];
    items.value =
      existing.length > 0
        ? existing.map((item) => ({
            ...item,
            displayConditions: (item.displayConditions ?? []).map((condition) => ({
              ...condition,
            })),
          }))
        : sheetFields.value.map((field) => ({
            fieldId: field.id,
            required: field.required,
          }));
    if (!selectedFieldId.value) {
      selectedFieldId.value = items.value[0]?.fieldId ?? '';
    }
  } catch (caught) {
    error.value = errorOf(caught);
  } finally {
    loading.value = false;
  }
}

function savePayload() {
  if (!props.sheet) throw new Error('请先选择工作表');
  return {
    baseId: props.baseId,
    sheetId: props.sheet.id,
    name: name.value.trim() || `${props.sheet.name}收集表`,
    coverUrl: coverUrl.value || undefined,
    fields: items.value.map((item) => ({
      fieldId: item.fieldId,
      required: Boolean(item.required),
      displayConditions: item.displayConditions ?? [],
    })),
    share: {
      enabled: shareEnabled.value,
      audience: audience.value,
      expiresAt: expiresAt.value || null,
    },
    successPage: { templateHtml: template.value },
    rejectDuplicatePhone: rejectDuplicatePhone.value,
  };
}

async function save(showToast = true): Promise<FormDto | null> {
  if (!props.sheet || saving.value) return form.value;
  saving.value = true;
  error.value = '';
  try {
    form.value = await endpoints.upsertForm(formId.value, savePayload());
    if (showToast) toast('表单已保存');
    return form.value;
  } catch (caught) {
    error.value = errorOf(caught);
    return null;
  } finally {
    saving.value = false;
  }
}

function move(index: number, direction: -1 | 1): void {
  const target = index + direction;
  if (target < 0 || target >= items.value.length) return;
  const list = [...items.value];
  [list[index], list[target]] = [list[target], list[index]];
  items.value = list;
}

function removeItem(index: number): void {
  const removed = items.value[index];
  items.value = items.value.filter((_, itemIndex) => itemIndex !== index);
  if (removed?.fieldId === selectedFieldId.value) {
    selectedFieldId.value = items.value[0]?.fieldId ?? '';
  }
}

function addField(): void {
  const field = availableFields.value.find(
    (candidate) => candidate.id === addFieldId.value,
  ) ?? availableFields.value[0];
  if (!field) return;
  items.value = [
    ...items.value,
    { fieldId: field.id, required: field.required, displayConditions: [] },
  ];
  selectedFieldId.value = field.id;
  addFieldId.value = '';
}

function addCondition(config: FormFieldConfigDto): void {
  const condition: DisplayConditionDto = {
    fieldId: '',
    operator: 'equals',
    value: '',
  };
  config.displayConditions = [...(config.displayConditions ?? []), condition];
  showConditionsFor.value[config.fieldId] = true;
}

function removeCondition(
  config: FormFieldConfigDto,
  index: number,
): void {
  config.displayConditions = (config.displayConditions ?? []).filter(
    (_, itemIndex) => itemIndex !== index,
  );
}

function isConditionValueVisible(operator: DisplayConditionOperator): boolean {
  return operator !== 'notEmpty' && operator !== 'isEmpty';
}

async function uploadCover(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  uploadingCover.value = true;
  try {
    if (!form.value) {
      const saved = await save(false);
      if (!saved) return;
    }
    const result = await endpoints.uploadFormCover(formId.value, file);
    coverUrl.value = result.coverUrl;
    await save(false);
    toast('封面已更新');
  } catch (caught) {
    error.value = errorOf(caught);
  } finally {
    uploadingCover.value = false;
  }
}

async function copyShareUrl(): Promise<void> {
  if (!shareUrl.value) {
    toast('请先保存表单，生成分享链接');
    return;
  }
  try {
    await navigator.clipboard.writeText(shareUrl.value);
    toast('分享链接已复制');
  } catch {
    toast('复制失败，请手动复制');
  }
}

function insertVariable(variable: string): void {
  template.value = `${template.value}{{${variable}}}`;
}

async function previewSuccess(): Promise<void> {
  if (!form.value) {
    const saved = await save(false);
    if (!saved) return;
  }
  try {
    const sampleCells = Object.fromEntries(
      items.value.map((item) => [
        fieldName(item.fieldId),
        previewValues.value[item.fieldId] ??
          ({
            phone: '13800000000',
            email: 'demo@example.com',
            number: 1,
            date: '2026-10-22',
            checkbox: true,
          }[fieldById.value.get(item.fieldId)?.type ?? ''] ?? `示例${fieldName(item.fieldId)}`),
      ]),
    );
    const response = await endpoints.previewFormSuccess(formId.value, {
      formCells: sampleCells,
      stepOutputs: { 序列号: 'SN-000123' },
    });
    successPreviewHtml.value = response.html;
    previewTab.value = 'preview';
  } catch (caught) {
    error.value = errorOf(caught);
  }
}

onMounted(load);
</script>

<template>
  <div class="form-builder" data-testid="form-builder">
    <input
      ref="coverInput"
      type="file"
      accept="image/*"
      class="hidden-cover-input"
      data-testid="form-cover-input"
      @change="uploadCover"
    />
    <header class="panel-header">
      <div>
        <h3>收集表单</h3>
        <p class="muted">
          字段来自「{{ sheet?.name }}」，提交后自动触发该表的自动化并展示成功页。
        </p>
      </div>
      <div class="header-actions">
        <div class="tabs">
          <button :class="{ active: previewTab === 'design' }" @click="previewTab = 'design'">
            设计
          </button>
          <button :class="{ active: previewTab === 'preview' }" @click="previewTab = 'preview'">
            预览
          </button>
        </div>
        <button class="icon-btn" aria-label="关闭" @click="emit('close')">×</button>
      </div>
    </header>

    <p v-if="loading" class="muted">加载中…</p>
    <template v-else>
      <p v-if="error" class="form-error" data-testid="form-builder-error">{{ error }}</p>

      <div v-if="previewTab === 'design'" class="builder-layout">
        <div class="builder-settings">
          <label class="builder-field">
            <span>表单名称</span>
            <input v-model="name" data-testid="form-name-input" maxlength="100" />
          </label>

          <div class="builder-field">
            <span>封面图</span>
            <div class="cover-editor">
              <img v-if="coverUrl" :src="coverUrl" alt="表单封面" class="cover-preview" />
              <div v-else class="cover-empty">未设置封面</div>
              <div class="cover-actions">
                <button class="btn small" :disabled="uploadingCover" @click="coverInput?.click()">
                  {{ uploadingCover ? '上传中…' : coverUrl ? '更换封面' : '上传封面' }}
                </button>
                <button v-if="coverUrl" class="btn small" @click="coverUrl = ''">移除</button>
              </div>
            </div>
          </div>

          <div class="builder-field">
            <div class="field-heading">
              <span>表单字段</span>
              <small>拖动排序用箭头按钮，隐藏字段不会出现在填写页</small>
            </div>
            <div class="builder-fields" data-testid="form-fields">
              <div
                v-for="(item, index) in items"
                :key="item.fieldId"
                class="field-row"
                :class="{ selected: selectedFieldId === item.fieldId }"
                :data-testid="`form-field-${item.fieldId}`"
                @click="selectedFieldId = item.fieldId"
              >
                <span class="field-icon">{{ fieldTypeIcon(fieldById.get(item.fieldId)?.type ?? 'text') }}</span>
                <span class="field-name">{{ fieldName(item.fieldId) }}</span>
                <label class="inline-check" @click.stop>
                  <input
                    v-model="item.required"
                    type="checkbox"
                    :data-testid="`form-required-${item.fieldId}`"
                  />
                  必填
                </label>
                <span v-if="item.displayConditions?.length" class="condition-count">
                  {{ item.displayConditions.length }} 条件
                </span>
                <button class="icon-btn" title="上移" :disabled="index === 0" @click.stop="move(index, -1)">↑</button>
                <button
                  class="icon-btn"
                  title="下移"
                  :disabled="index === items.length - 1"
                  @click.stop="move(index, 1)"
                >
                  ↓
                </button>
                <button
                  class="icon-btn danger"
                  title="从表单移除"
                  :data-testid="`form-remove-${item.fieldId}`"
                  @click.stop="removeItem(index)"
                >
                  ×
                </button>
              </div>
              <p v-if="items.length === 0" class="muted empty-tip">尚未添加字段。</p>
            </div>
            <div v-if="availableFields.length" class="add-field-row">
              <select v-model="addFieldId" data-testid="form-add-field-select">
                <option value="">选择要添加的字段</option>
                <option v-for="field in availableFields" :key="field.id" :value="field.id">
                  {{ field.name }}
                </option>
              </select>
              <button class="btn" data-testid="form-add-field" @click="addField">+ 添加字段</button>
            </div>
          </div>

          <section v-if="selectedConfig" class="field-settings" data-testid="form-field-settings">
            <header>
              <strong>{{ selectedSheetField?.name }} · 显示条件</strong>
              <button
                class="btn small"
                data-testid="form-add-condition"
                @click="addCondition(selectedConfig)"
              >
                + 添加条件
              </button>
            </header>
            <p class="muted tiny">
              全部条件满足时才显示该字段（例如：仅当「是否到访」等于「是」时显示「到访时间」）。
            </p>
            <div
              v-for="(condition, index) in selectedConfig.displayConditions ?? []"
              :key="index"
              class="condition-row"
              data-testid="form-condition-row"
            >
              <select v-model="condition.fieldId" data-testid="form-condition-field">
                <option value="">触发字段</option>
                <option
                  v-for="candidate in items.filter((item) => item.fieldId !== selectedConfig?.fieldId)"
                  :key="candidate.fieldId"
                  :value="candidate.fieldId"
                >
                  {{ fieldName(candidate.fieldId) }}
                </option>
              </select>
              <select v-model="condition.operator" data-testid="form-condition-operator">
                <option v-for="op in conditionOperators" :key="op.value" :value="op.value">
                  {{ op.label }}
                </option>
              </select>
              <input
                v-if="isConditionValueVisible(condition.operator)"
                v-model="condition.value"
                placeholder="比较值"
                data-testid="form-condition-value"
              />
              <button class="icon-btn danger" @click="removeCondition(selectedConfig, index)">×</button>
            </div>
            <p v-if="!(selectedConfig.displayConditions ?? []).length" class="muted tiny">
              无条件，始终显示。
            </p>
          </section>

          <label class="builder-field">
            <span>成功页模板（支持 <code v-pre>{{序列号}}</code> 等变量和 HTML）</span>
            <textarea v-model="template" data-testid="form-template-input" rows="5"></textarea>
            <div class="variable-actions">
              <span class="muted tiny">插入变量：</span>
              <button
                v-for="candidate in items.slice(0, 5)"
                :key="candidate.fieldId"
                class="var-chip"
                @click="insertVariable(fieldName(candidate.fieldId))"
              >
                {{ fieldName(candidate.fieldId) }}
              </button>
              <button class="var-chip" @click="insertVariable('序列号')">序列号（自动化）</button>
            </div>
          </label>

          <div class="share-settings">
            <label class="inline-check">
              <input v-model="shareEnabled" type="checkbox" data-testid="form-share-enabled" />
              开启公开分享
            </label>
            <label class="inline-check">
              <input
                v-model="rejectDuplicatePhone"
                type="checkbox"
                data-testid="form-reject-duplicate"
              />
              同手机号不可重复提交
            </label>
            <label class="builder-inline">
              可见范围
              <select v-model="audience" data-testid="form-audience">
                <option value="anyone">任何人（持有链接）</option>
                <option value="workspace">仅工作区成员</option>
              </select>
            </label>
            <label class="builder-inline">
              截止日期
              <input v-model="expiresAtInput" type="date" data-testid="form-expires-at" />
            </label>
          </div>

          <div class="builder-actions">
            <button class="btn" @click="previewSuccess" :disabled="saving">预览成功页</button>
            <button
              class="btn btn-primary"
              data-testid="form-builder-save"
              :disabled="saving || uploadingCover || !sheet"
              @click="save()"
            >
              {{ saving ? '保存中…' : '保存表单' }}
            </button>
          </div>
        </div>

        <aside class="phone-frame">
          <div class="phone-top"></div>
          <div class="phone-body">
            <img v-if="coverUrl" :src="coverUrl" class="phone-cover" alt="封面" />
            <h2>{{ name || '未命名表单' }}</h2>
            <p class="muted tiny">共 {{ items.length }} 个字段 · {{ activeConditionCount }} 条显示条件</p>
            <label
              v-for="item in previewFields"
              :key="item.config.fieldId"
              class="preview-field"
            >
              <span>
                {{ item.field.name }}
                <em v-if="item.config.required" class="required-star">*</em>
              </span>
              <textarea
                v-if="item.field.type === 'text' || item.field.type === 'longText'"
                :rows="item.field.type === 'longText' ? 3 : 1"
                disabled
                placeholder="填写内容"
              ></textarea>
              <select v-else disabled>
                <option>请选择</option>
              </select>
            </label>
            <button class="preview-submit" disabled>提交</button>
          </div>
          <div class="phone-tip">
            <span v-if="qrDataUrl"><img :src="qrDataUrl" alt="二维码" /></span>
            <span>移动端填写预览</span>
          </div>
        </aside>
      </div>

      <div v-else class="preview-pane">
        <section class="live-preview">
          <h4>表单预览</h4>
          <div v-for="item in previewFields" :key="item.config.fieldId" class="preview-field">
            <span>{{ item.field.name }}<em v-if="item.config.required" class="required-star">*</em></span>
            <input v-if="item.field.type === 'phone'" v-model="previewValues[item.config.fieldId]" placeholder="手机号" />
            <input v-else v-model="previewValues[item.config.fieldId]" placeholder="填写内容" />
          </div>
        </section>
        <section class="success-preview">
          <h4>成功页预览</h4>
          <div
            class="success-html"
            data-testid="form-success-preview"
            v-html="successPreviewHtml || '<p class=muted>点击「刷新预览」查看插值结果。</p>'"
          ></div>
          <button class="btn" @click="previewSuccess">刷新预览</button>
        </section>
      </div>

      <section v-if="form" class="share-box">
        <div>
          <span class="muted small-text">分享链接</span>
          <p class="share-url" data-testid="form-share-url">{{ shareUrl }}</p>
          <div class="share-actions">
            <button class="btn small" @click="copyShareUrl">复制链接</button>
            <a class="btn small" :href="shareUrl" target="_blank" rel="noreferrer">打开填写页</a>
          </div>
          <p class="muted tiny" data-testid="form-share-status">
            {{ form.share.enabled ? '公开分享已开启' : '公开分享已关闭' }} ·
            {{ form.share.audience === 'workspace' ? '仅工作区成员' : '任何人可填写' }}
            <template v-if="form.share.expiresAt">
              · 截止 {{ new Date(form.share.expiresAt).toLocaleDateString('zh-CN') }}
            </template>
          </p>
        </div>
        <img
          v-if="form.share.qrCodeDataUrl"
          :src="form.share.qrCodeDataUrl"
          class="share-qr"
          data-testid="form-share-qr"
          alt="表单二维码"
        />
      </section>
    </template>
  </div>
</template>

<style scoped>
.form-builder {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.panel-header h3 {
  margin: 0 0 4px;
}
.panel-header p {
  margin: 0;
  font-size: 12px;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.tabs {
  display: flex;
  padding: 2px;
  border-radius: 8px;
  background: #f2f4f7;
}
.tabs button {
  height: 28px;
  padding: 0 13px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #646a73;
  font-size: 12px;
  cursor: pointer;
}
.tabs button.active {
  background: #fff;
  color: #1d6fdc;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
}
.builder-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 20px;
  min-height: 0;
}
.builder-settings {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.builder-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: #344054;
}
.builder-field > input,
.builder-field textarea {
  border: 1px solid #d0d5dd;
  border-radius: 8px;
  padding: 9px 11px;
  font-size: 13px;
  font-family: inherit;
}
.field-heading {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: baseline;
}
.field-heading small {
  color: #98a2b3;
  font-size: 11px;
}
.builder-fields {
  border: 1px solid #eaecf0;
  border-radius: 10px;
  overflow: hidden;
}
.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid #f2f4f7;
  cursor: pointer;
}
.field-row:last-child {
  border-bottom: none;
}
.field-row.selected {
  background: #f5f8ff;
  box-shadow: inset 3px 0 #2d8cf0;
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
}
.field-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inline-check {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #475467;
  cursor: pointer;
}
.condition-count {
  padding: 1px 6px;
  border-radius: 999px;
  background: #fff7e6;
  color: #d46b08;
  font-size: 10px;
}
.icon-btn.danger {
  color: #d4380d;
}
.add-field-row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.add-field-row select {
  flex: 1;
  height: 32px;
  border: 1px solid #d0d5dd;
  border-radius: 7px;
}
.empty-tip {
  padding: 14px;
  text-align: center;
}
.field-settings {
  padding: 12px;
  border: 1px solid #d6e4ff;
  border-radius: 10px;
  background: #f7faff;
}
.field-settings header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.condition-row {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.condition-row select,
.condition-row input {
  flex: 1;
  height: 30px;
  min-width: 0;
  padding: 0 7px;
  border: 1px solid #d0d5dd;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
}
.variable-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}
.var-chip {
  height: 24px;
  padding: 0 8px;
  border: 1px solid #d6e4ff;
  border-radius: 999px;
  background: #f5f8ff;
  color: #1d6fdc;
  font-size: 11px;
  cursor: pointer;
}
.share-settings {
  display: flex;
  flex-wrap: wrap;
  gap: 14px 20px;
  padding: 12px;
  border: 1px solid #eaecf0;
  border-radius: 10px;
}
.builder-inline {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #475467;
}
.builder-inline select,
.builder-inline input {
  height: 30px;
  border: 1px solid #d0d5dd;
  border-radius: 6px;
}
.builder-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.phone-frame {
  align-self: start;
  position: sticky;
  top: 0;
  width: 300px;
  border: 8px solid #1f2329;
  border-radius: 28px;
  background: #f7f8fa;
  overflow: hidden;
}
.phone-top {
  height: 16px;
  background: #1f2329;
}
.phone-body {
  height: 480px;
  overflow: auto;
  padding: 14px;
  background: #fff;
}
.phone-cover {
  width: 100%;
  height: 100px;
  object-fit: cover;
  border-radius: 10px;
  margin-bottom: 10px;
}
.phone-body h2 {
  margin: 4px 0;
  font-size: 17px;
}
.preview-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 12px 0;
  font-size: 12px;
  color: #344054;
}
.preview-field textarea,
.preview-field input,
.preview-field select {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 9px;
  border: 1px solid #e5e6eb;
  border-radius: 7px;
  background: #fafbfc;
  color: #98a2b3;
  font-size: 12px;
  resize: none;
}
.required-star {
  color: #d4380d;
  font-style: normal;
}
.preview-submit {
  width: 100%;
  height: 36px;
  margin-top: 8px;
  border: none;
  border-radius: 8px;
  background: #2d8cf0;
  color: #fff;
}
.phone-tip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px;
  background: #fff;
  border-top: 1px solid #eef0f3;
  color: #98a2b3;
  font-size: 11px;
}
.phone-tip img {
  width: 34px;
  height: 34px;
}
.preview-pane {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.live-preview,
.success-preview {
  padding: 14px;
  border: 1px solid #eaecf0;
  border-radius: 10px;
}
.live-preview h4,
.success-preview h4 {
  margin: 0 0 10px;
}
.success-html {
  min-height: 150px;
  padding: 12px;
  border: 1px dashed #d0d5dd;
  border-radius: 8px;
  background: #fafbfc;
}
.cover-editor {
  display: flex;
  align-items: center;
  gap: 12px;
}
.cover-preview,
.cover-empty {
  width: 160px;
  height: 72px;
  border-radius: 8px;
  object-fit: cover;
}
.cover-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed #d0d5dd;
  color: #98a2b3;
  font-size: 12px;
}
.cover-actions {
  display: flex;
  gap: 6px;
}
.form-error {
  color: #d92d20;
  font-size: 13px;
  margin: 0;
}
.share-box {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  border: 1px dashed #b2ccff;
  background: #f5f8ff;
  border-radius: 10px;
  padding: 12px;
}
.share-url {
  margin: 4px 0 8px;
  font-size: 12px;
  word-break: break-all;
  color: #1849a9;
}
.share-actions {
  display: flex;
  gap: 8px;
}
.share-qr {
  width: 104px;
  height: 104px;
  border-radius: 6px;
  background: #fff;
}
.hidden-cover-input {
  display: none;
}
.small-text,
.tiny {
  font-size: 12px;
}
.tiny {
  font-size: 11px;
}
.muted {
  color: #667085;
}
@media (max-width: 960px) {
  .builder-layout {
    grid-template-columns: 1fr;
  }
  .phone-frame {
    display: none;
  }
  .preview-pane {
    grid-template-columns: 1fr;
  }
}
</style>
