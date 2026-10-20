<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { toast } from '../ui/toast';
import type { FormDto, SheetDto } from '../api/types';

const props = defineProps<{ baseId: string; sheet: SheetDto | null }>();
const emit = defineEmits<{ close: [] }>();

const form = ref<FormDto | null>(null);
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const name = ref('');
const template = ref('');
const rejectDuplicatePhone = ref(true);
const shareEnabled = ref(true);
const requiredMap = reactive<Record<string, boolean>>({});

const sheetFields = computed(() => props.sheet?.fields ?? []);
const shareUrl = computed(() => form.value?.share.qrUrl ?? '');

function errorOf(caught: unknown): string {
  return caught instanceof ApiError ? caught.message : '保存失败，请稍后再试';
}

async function load(): Promise<void> {
  if (!props.sheet) return;
  loading.value = true;
  error.value = '';
  try {
    const forms = await endpoints.listForms(props.baseId);
    form.value = forms.find((item) => item.sheetId === props.sheet?.id) ?? null;
    name.value =
      form.value?.name ?? `${props.sheet.name}收集表`;
    template.value =
      form.value?.successPage.templateHtml ??
      '提交成功！\n\n你的序列号是 {{序列号}}';
    rejectDuplicatePhone.value = form.value?.rejectDuplicatePhone ?? true;
    shareEnabled.value = form.value?.share.enabled ?? true;

    for (const field of sheetFields.value) {
      const config = form.value?.fields.find(
        (item) => item.fieldId === field.id,
      );
      requiredMap[field.id] = config?.required ?? field.required;
    }
  } catch (caught) {
    error.value = errorOf(caught);
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  if (!props.sheet || saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    const fields = sheetFields.value.map((field) => {
      const existing = form.value?.fields.find(
        (item) => item.fieldId === field.id,
      );
      return {
        ...(existing ?? { fieldId: field.id }),
        required: requiredMap[field.id] ?? field.required,
      };
    });

    form.value = await endpoints.upsertForm(
      form.value?.id ?? crypto.randomUUID(),
      {
        baseId: props.baseId,
        sheetId: props.sheet.id,
        name: name.value.trim() || `${props.sheet.name}收集表`,
        fields,
        share: {
          enabled: shareEnabled.value,
          audience: 'anyone',
          expiresAt: form.value?.share.expiresAt ?? null,
        },
        successPage: { templateHtml: template.value },
        rejectDuplicatePhone: rejectDuplicatePhone.value,
      },
    );
    toast('表单已保存，分享链接已更新');
  } catch (caught) {
    error.value = errorOf(caught);
  } finally {
    saving.value = false;
  }
}

async function copyShareUrl(): Promise<void> {
  if (!shareUrl.value) return;
  try {
    await navigator.clipboard.writeText(shareUrl.value);
    toast('分享链接已复制');
  } catch {
    toast('复制失败，请手动复制');
  }
}

onMounted(load);
</script>

<template>
  <div class="form-builder" data-testid="form-builder">
    <header class="panel-header">
      <div>
        <h3>收集表单</h3>
        <p class="muted">
          字段来自「{{ sheet?.name }}」，填写后自动触发绑定到该表的自动化。
        </p>
      </div>
      <button class="icon-btn" aria-label="关闭" @click="emit('close')">×</button>
    </header>

    <p v-if="loading" class="muted">加载中…</p>
    <template v-else>
      <label class="builder-field">
        <span>表单名称</span>
        <input v-model="name" data-testid="form-name-input" maxlength="100" />
      </label>

      <div class="builder-field">
        <span>字段与必填</span>
        <ul class="builder-fields">
          <li v-for="field in sheetFields" :key="field.id">
            <span class="field-type">{{ field.type }}</span>
            <span class="field-name">{{ field.name }}</span>
            <label class="inline-check">
              <input
                v-model="requiredMap[field.id]"
                type="checkbox"
                :data-testid="`form-required-${field.id}`"
              />
              必填
            </label>
          </li>
          <li v-if="sheetFields.length === 0" class="muted">
            当前工作表还没有字段。
          </li>
        </ul>
      </div>

      <label class="builder-field">
        <span>
          成功页模板（支持 <code v-pre>{{序列号}}</code> 等变量）
        </span>
        <textarea
          v-model="template"
          data-testid="form-template-input"
          rows="4"
        ></textarea>
      </label>

      <div class="builder-row">
        <label class="inline-check">
          <input
            v-model="rejectDuplicatePhone"
            type="checkbox"
            data-testid="form-reject-duplicate"
          />
          同手机号不可重复领取
        </label>
        <label class="inline-check">
          <input
            v-model="shareEnabled"
            type="checkbox"
            data-testid="form-share-enabled"
          />
          开启公开分享
        </label>
      </div>

      <p v-if="error" class="form-error" data-testid="form-builder-error">
        {{ error }}
      </p>

      <button
        class="btn btn-primary"
        data-testid="form-builder-save"
        :disabled="saving || !sheet"
        @click="save"
      >
        {{ saving ? '保存中…' : '保存表单' }}
      </button>

      <section v-if="form" class="share-box">
        <div>
          <span class="muted small-text">分享链接</span>
          <p class="share-url" data-testid="form-share-url">{{ shareUrl }}</p>
          <div class="share-actions">
            <button class="btn small" @click="copyShareUrl">复制链接</button>
            <a class="btn small" :href="shareUrl" target="_blank" rel="noreferrer">
              打开填写页
            </a>
          </div>
        </div>
        <img
          v-if="form.share.qrCodeDataUrl"
          :src="form.share.qrCodeDataUrl"
          class="share-qr"
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
.builder-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: #344054;
}
.builder-field input[type='text'],
.builder-field input:not([type]),
.builder-field textarea {
  border: 1px solid #d0d5dd;
  border-radius: 8px;
  padding: 9px 11px;
  font-size: 13px;
  font-family: inherit;
}
.builder-fields {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid #eaecf0;
  border-radius: 10px;
  max-height: 200px;
  overflow: auto;
}
.builder-fields li {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border-bottom: 1px solid #f2f4f7;
  font-size: 12px;
}
.builder-fields li:last-child {
  border-bottom: none;
}
.field-type {
  color: #667085;
  background: #f2f4f7;
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 10px;
}
.field-name {
  flex: 1;
}
.inline-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #475467;
}
.builder-row {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
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
.small-text {
  font-size: 12px;
}
.muted {
  color: #667085;
}
</style>
