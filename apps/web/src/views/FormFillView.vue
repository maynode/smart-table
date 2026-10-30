<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import type { PublicFormDto, PublicFormFieldDto } from '../api/types';
import { isFormFieldVisible } from 'shared';
import FormFieldControl from '../components/FormFieldControl.vue';
import PageLoading from '../components/PageLoading.vue';
import { liveBus } from '../sync/live-bus';
import { liveSocket } from '../sync/live-socket';

const route = useRoute();
const token = computed(() => String(route.params.token));

const form = ref<PublicFormDto | null>(null);
const answers = reactive<Record<string, unknown>>({});
const loading = ref(true);
const submitting = ref(false);
const error = ref('');
const successHtml = ref('');

const visibleFields = computed<PublicFormFieldDto[]>(() => {
  if (!form.value) return [];
  return form.value.fields.filter((field) =>
    isFormFieldVisible(
      {
        fieldId: field.fieldId,
        required: field.required,
        displayConditions: field.displayConditions,
        displayRule: field.displayRule,
      },
      answers,
    ),
  );
});

const members = computed(() => form.value?.members ?? []);

function relationChoicesFor(fieldId: string) {
  return form.value?.relationChoices?.[fieldId] ?? [];
}

function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

function initialValue(field: PublicFormFieldDto): unknown {
  if (field.type === 'multiSelect') return [];
  if (field.type === 'checkbox') return false;
  if (field.type === 'progress') return 0;
  return '';
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  const cacheKey = `public-form:${token.value}`;
  try {
    const result = await endpoints.getPublicForm(token.value);
    form.value = result;
    for (const key of Object.keys(answers)) delete answers[key];
    for (const field of result.fields) {
      answers[field.fieldId] = initialValue(field);
    }
    const { localDb } = await import('../sync/local-db-client');
    void localDb.putObjectCache(cacheKey, 'public-form', result);
  } catch (caught) {
    try {
      const { localDb } = await import('../sync/local-db-client');
      const cached = await localDb.getObjectCache(cacheKey);
      if (cached && typeof cached === 'object') {
        form.value = cached as typeof form.value;
        for (const key of Object.keys(answers)) delete answers[key];
        for (const field of (form.value?.fields ?? [])) {
          answers[field.fieldId] = initialValue(field);
        }
        error.value = '';
      } else {
        error.value =
          caught instanceof ApiError ? caught.message : '表单加载失败，请稍后再试';
      }
    } catch {
      error.value =
        caught instanceof ApiError ? caught.message : '表单加载失败，请稍后再试';
    }
  } finally {
    loading.value = false;
  }
}

async function uploadFile(file: File) {
  return endpoints.uploadPublicFormAttachment(token.value, file);
}

async function submit(): Promise<void> {
  if (submitting.value || !form.value) return;
  error.value = '';

  const cells: Record<string, unknown> = {};
  for (const field of visibleFields.value) {
    const value = answers[field.fieldId];
    const checkboxMissing =
      field.type === 'checkbox' &&
      field.required &&
      value !== true &&
      value !== 'true';
    if (checkboxMissing || (field.required && isEmptyValue(value))) {
      error.value = `请填写「${field.name}」`;
      return;
    }
    if (field.type === 'checkbox') {
      cells[field.fieldId] = value === true || value === 'true';
      continue;
    }
    if (!isEmptyValue(value)) cells[field.fieldId] = value;
  }

  submitting.value = true;
  try {
    const { enqueuePublicFormSubmit } = await import(
      '../sync/public-form-outbox'
    );
    const outcome = await enqueuePublicFormSubmit(token.value, cells);
    if (outcome.queued) {
      successHtml.value =
        '<p>当前离线，提交已保存在本机。网络恢复后将自动提交（幂等防重复领取）。</p>';
    } else if (outcome.result?.success?.html != null) {
      const html = String(outcome.result.success.html).trim();
      successHtml.value = html || '<p>提交成功</p>';
    } else if (outcome.result?.status === 'completed') {
      successHtml.value = '<p>提交成功</p>';
    } else if (outcome.result?.status === 'queued') {
      // SUBMIT_MODE=queue：同步轮询直到完成
      const submissionId = outcome.result.submissionId;
      const started = Date.now();
      let html = '';
      while (Date.now() - started < 30_000) {
        await new Promise((r) => setTimeout(r, 400));
        const status = await endpoints.getPublicFormSubmission(
          token.value,
          submissionId,
        );
        if (status.status === 'completed' && status.success?.html) {
          html = status.success.html;
          break;
        }
        if (status.status === 'failed') {
          throw new Error(status.error || '提交失败');
        }
      }
      if (!html) throw new Error('提交处理超时，请稍后在消息中查看');
      successHtml.value = html;
    } else {
      error.value = '提交未返回结果，请稍后重试';
    }
  } catch (caught) {
    error.value =
      caught instanceof ApiError ? caught.message : '提交失败，请稍后再试';
  } finally {
    submitting.value = false;
  }
}

const liveUnsubs: Array<() => void> = [];

watch(
  token,
  (value) => {
    if (value) liveSocket.connect({ formToken: value });
    else liveSocket.disconnect();
  },
  { immediate: true },
);

onMounted(() => {
  // Public fill: keep first-load snapshot. Builder form.updated/published must
  // not wipe in-progress answers (select + display conditions).
  liveUnsubs.push(
    liveBus.on('form.deleted', () => {
      void load();
    }),
  );
  void load();
});

onBeforeUnmount(() => {
  while (liveUnsubs.length) liveUnsubs.pop()?.();
  liveSocket.disconnect();
});
</script>

<template>
  <div class="fill-page">
    <div v-if="loading" class="empty-state">
      <PageLoading label="加载表单…" />
    </div>
    <div v-else-if="!form" class="empty-state" data-testid="form-load-error">
      <p class="empty-state-title">无法打开表单</p>
      <p class="empty-state-hint">{{ error || '链接无效或表单已关闭' }}</p>
    </div>
    <div v-else class="fill-card">
      <img
        v-if="form.coverUrl"
        :src="form.coverUrl"
        class="fill-cover"
        alt=""
      />
      <header class="fill-header">
        <h1 class="fill-title">{{ form.name }}</h1>
      </header>

      <form v-if="!successHtml" class="fill-form" @submit.prevent="submit">
        <div
          v-for="field in visibleFields"
          :key="field.fieldId"
          class="fill-field"
          :data-field-name="field.name"
        >
          <label :for="`field-${field.fieldId}`">
            <span v-if="field.required" class="required-mark">*</span>
            {{ field.name }}
          </label>

          <FormFieldControl
            v-model="answers[field.fieldId]"
            :field-id="field.fieldId"
            :name="field.name"
            :type="field.type"
            :options="field.options"
            :required="field.required"
            :members="members"
            :relation-choices="relationChoicesFor(field.fieldId)"
            :upload-file="uploadFile"
          />
        </div>

        <p v-if="error" class="form-error" data-testid="form-error" role="alert">
          {{ error }}
        </p>

        <button
          class="btn btn-primary fill-submit"
          data-testid="form-submit"
          :disabled="submitting"
        >
          {{ submitting ? '提交中…' : '提交' }}
        </button>
      </form>

      <section v-else class="fill-success" data-testid="form-success">
        <div class="success-check" aria-hidden="true">✓</div>
        <h2>提交成功</h2>
        <div class="fill-success-body" v-html="successHtml"></div>
        <button class="btn fill-again" type="button" @click="successHtml = ''">
          再填一次
        </button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.fill-page {
  /* 相对 app-shell 剩余高度铺满，勿用 100vh（会叠测试版顶栏冒出幽灵滚动条） */
  box-sizing: border-box;
  height: 100%;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 40px 16px 64px;
  background:
    radial-gradient(ellipse 80% 50% at 50% -10%, #e8f3ff 0%, transparent 55%),
    #f2f4f7;
}
.fill-card {
  width: 100%;
  max-width: 520px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 8px 28px rgba(16, 24, 40, 0.08);
  padding: 28px;
}
.fill-cover {
  width: 100%;
  height: 168px;
  object-fit: cover;
  border-radius: 12px;
  margin-bottom: 20px;
}
.fill-header {
  margin-bottom: 22px;
  text-align: center;
}
.fill-title {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.3;
  color: #1f2329;
  margin: 0;
  text-align: center;
}
.fill-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.fill-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.fill-field label {
  font-size: 13px;
  font-weight: 500;
  color: #344054;
}
.required-mark {
  color: #d92d20;
  margin-right: 2px;
}
.fill-submit {
  display: block;
  width: auto;
  min-width: 140px;
  max-width: 220px;
  min-height: 40px;
  margin: 8px auto 0;
  padding: 10px 28px;
  font-size: 15px;
  font-weight: 600;
}
.fill-submit:disabled {
  opacity: 0.65;
  cursor: wait;
}
.form-error {
  color: #d92d20;
  font-size: 13px;
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #fff1f0;
}
.fill-success {
  text-align: center;
  padding: 8px 0 4px;
}
.success-check {
  width: 52px;
  height: 52px;
  margin: 4px auto 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #ecfdf3;
  color: #12b76a;
  font-size: 24px;
  font-weight: 700;
}
.fill-success h2 {
  margin: 0 0 14px;
  font-size: 18px;
  color: #1f2329;
}
.fill-success-body {
  font-size: 15px;
  line-height: 1.7;
  text-align: center;
  color: #344054;
}
.fill-success-body :deep(p),
.fill-success-body :deep(div),
.fill-success-body :deep(h1),
.fill-success-body :deep(h2),
.fill-success-body :deep(h3) {
  text-align: center;
  margin-left: auto;
  margin-right: auto;
}
.fill-again {
  display: inline-block;
  margin-top: 20px;
  min-width: 120px;
  min-height: 40px;
  padding: 0 24px;
}
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 64px 24px;
  text-align: center;
}
.empty-state-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #4e5969;
}
.empty-state-hint {
  margin: 0;
  font-size: 13px;
  color: #8a9099;
  max-width: 280px;
  line-height: 1.5;
}
</style>
