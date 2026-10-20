<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import type { PublicFormDto, PublicFormFieldDto } from '../api/types';
import { isFormFieldVisible } from 'shared';

const route = useRoute();
const token = computed(() => String(route.params.token));

const form = ref<PublicFormDto | null>(null);
const answers = reactive<Record<string, any>>({});
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
      },
      answers,
    ),
  );
});

function inputType(type: string): string {
  if (type === 'phone') return 'tel';
  if (type === 'email') return 'email';
  if (['number', 'percent', 'currency', 'progress'].includes(type)) {
    return 'number';
  }
  if (type === 'date') return 'date';
  if (type === 'url') return 'url';
  return 'text';
}

function isMultiSelect(field: PublicFormFieldDto): boolean {
  return field.type === 'multiSelect';
}

function choicesOf(field: PublicFormFieldDto) {
  return field.options?.choices ?? [];
}

function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const result = await endpoints.getPublicForm(token.value);
    form.value = result;
    for (const field of result.fields) {
      if (field.type === 'multiSelect') answers[field.fieldId] = [];
      else if (field.type === 'checkbox') answers[field.fieldId] = false;
      else answers[field.fieldId] = '';
    }
  } catch (caught) {
    error.value =
      caught instanceof ApiError ? caught.message : '表单加载失败，请稍后再试';
  } finally {
    loading.value = false;
  }
}

async function submit(): Promise<void> {
  if (submitting.value || !form.value) return;
  error.value = '';

  const cells: Record<string, unknown> = {};
  for (const field of visibleFields.value) {
    const value = answers[field.fieldId];
    if (field.required && isEmptyValue(value)) {
      error.value = `请填写「${field.name}」`;
      return;
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
            {{ field.name }}
            <span v-if="field.required" class="required-mark">*</span>
          </label>

          <select
            v-if="field.type === 'select'"
            :id="`field-${field.fieldId}`"
            v-model="answers[field.fieldId]"
            :required="field.required"
            data-testid="form-select"
          >
            <option value="">请选择</option>
            <option
              v-for="choice in choicesOf(field)"
              :key="choice.id"
              :value="choice.id"
            >
              {{ choice.name }}
            </option>
          </select>

          <div v-else-if="isMultiSelect(field)" class="fill-choices">
            <label
              v-for="choice in choicesOf(field)"
              :key="choice.id"
              class="fill-choice"
            >
              <input
                v-model="answers[field.fieldId]"
                type="checkbox"
                :value="choice.id"
              />
              {{ choice.name }}
            </label>
          </div>

          <input
            v-else-if="field.type === 'checkbox'"
            :id="`field-${field.fieldId}`"
            v-model="answers[field.fieldId]"
            type="checkbox"
          />

          <textarea
            v-else-if="field.type === 'text' && field.name.includes('备注')"
            :id="`field-${field.fieldId}`"
            v-model="answers[field.fieldId]"
            rows="3"
            :placeholder="`请输入${field.name}`"
            :required="field.required"
          ></textarea>

          <input
            v-else
            :id="`field-${field.fieldId}`"
            v-model="answers[field.fieldId]"
            :type="inputType(field.type)"
            :placeholder="`请输入${field.name}`"
            :required="field.required"
            :data-testid="field.type === 'phone' ? 'form-phone' : 'form-field'"
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
        <h2>提交成功</h2>
        <div class="fill-success-body" v-html="successHtml"></div>
        <button class="btn fill-again" @click="successHtml = ''">
          再填一份
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
  margin-left: 2px;
}
.fill-field input,
.fill-field select,
.fill-field textarea {
  border: 1px solid #d0d5dd;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 14px;
  outline: none;
}
.fill-field input:focus,
.fill-field select:focus,
.fill-field textarea:focus {
  border-color: #2e6be6;
}
.fill-choices {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.fill-choice {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
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
.fill-success h2 {
  margin: 0 0 12px;
  font-size: 18px;
}
.fill-success-body {
  font-size: 15px;
  line-height: 1.7;
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
</style>
