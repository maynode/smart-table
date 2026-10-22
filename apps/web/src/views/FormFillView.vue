<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import type { PublicFormDto, PublicFormFieldDto } from '../api/types';
import { isFormFieldVisible } from 'shared';
import FormFieldControl from '../components/FormFieldControl.vue';

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
  if (field.type === 'multiSelect' || field.type === 'groupChat') return [];
  if (field.type === 'checkbox') return false;
  if (field.type === 'progress') return 0;
  return '';
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const result = await endpoints.getPublicForm(token.value);
    form.value = result;
    for (const key of Object.keys(answers)) delete answers[key];
    for (const field of result.fields) {
      answers[field.fieldId] = initialValue(field);
    }
  } catch (caught) {
    error.value =
      caught instanceof ApiError ? caught.message : '表单加载失败，请稍后再试';
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
    const result = await endpoints.submitPublicForm(token.value, cells);
    successHtml.value = result.success.html;
  } catch (caught) {
    error.value =
      caught instanceof ApiError ? caught.message : '提交失败，请稍后再试';
  } finally {
    submitting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="fill-page">
    <div v-if="loading" class="empty-state">加载中…</div>
    <div v-else-if="!form" class="empty-state" data-testid="form-load-error">
      {{ error || '表单不存在' }}
    </div>
    <div v-else class="fill-card">
      <img
        v-if="form.coverUrl"
        :src="form.coverUrl"
        class="fill-cover"
        alt="表单封面"
      />
      <h1 class="fill-title">{{ form.name }}</h1>

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

        <p v-if="error" class="form-error" data-testid="form-error">
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
        <h2>已提交</h2>
        <div class="fill-success-body" v-html="successHtml"></div>
        <button class="btn fill-again" @click="successHtml = ''">
          再填一次
        </button>
      </section>

      <p class="fill-footnote">数据保存在企业内部数据库 · 智能表格</p>
    </div>
  </div>
</template>

<style scoped>
.fill-page {
  min-height: 100vh;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 48px 16px;
  background: #f2f4f7;
}
.fill-card {
  width: 100%;
  max-width: 480px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 12px 32px rgba(16, 24, 40, 0.08);
  padding: 28px;
}
.fill-cover {
  width: 100%;
  height: 160px;
  object-fit: cover;
  border-radius: 12px;
  margin-bottom: 16px;
}
.fill-title {
  font-size: 20px;
  margin: 0 0 20px;
}
.fill-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.fill-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fill-field label {
  font-size: 13px;
  color: #344054;
}
.required-mark {
  color: #d92d20;
  margin-right: 2px;
}
.fill-submit {
  width: 100%;
  padding: 11px;
  font-size: 15px;
}
.form-error {
  color: #d92d20;
  font-size: 13px;
  margin: 0;
}
.fill-success {
  text-align: center;
}
.success-check {
  width: 48px;
  height: 48px;
  margin: 8px auto 12px;
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
  margin: 0 0 12px;
  font-size: 18px;
}
.fill-success-body {
  font-size: 15px;
  line-height: 1.7;
  text-align: left;
}
.fill-again {
  margin-top: 18px;
}
.fill-footnote {
  text-align: center;
  color: #98a2b3;
  font-size: 12px;
  margin: 20px 0 0;
}
.empty-state {
  padding: 48px 16px;
  text-align: center;
  color: #667085;
}
</style>
