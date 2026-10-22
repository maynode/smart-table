<script setup lang="ts">
import { computed, ref } from 'vue';
import type { FieldOptions } from '../api/types';

export interface FormControlMember {
  userId: string;
  name: string;
}

export interface FormControlRelationChoice {
  id: string;
  label: string;
}

export interface FormControlAttachment {
  url: string;
  name: string;
  mimetype: string;
  size: number;
}

const props = withDefaults(
  defineProps<{
    fieldId: string;
    name: string;
    type: string;
    options?: FieldOptions | null;
    required?: boolean;
    modelValue: unknown;
    members?: FormControlMember[];
    relationChoices?: FormControlRelationChoice[];
    uploadFile?: (file: File) => Promise<FormControlAttachment>;
    disabled?: boolean;
  }>(),
  {
    options: null,
    required: false,
    members: () => [],
    relationChoices: () => [],
    disabled: false,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: unknown];
}>();

const uploading = ref(false);
const uploadError = ref('');

const choices = computed(() => props.options?.choices ?? []);
const includeTime = computed(() => Boolean(props.options?.includeTime));
const currencySymbol = computed(() =>
  String(props.options?.currency ?? '¥'),
);

const locationText = computed({
  get: () => {
    const value = props.modelValue;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return String((value as { address?: string }).address ?? '');
    }
    return value == null ? '' : String(value);
  },
  set: (text: string) => {
    const trimmed = text.trim();
    emit('update:modelValue', trimmed ? { address: trimmed } : null);
  },
});

const personValue = computed({
  get: () => {
    const value = props.modelValue;
    if (Array.isArray(value)) return String(value[0] ?? '');
    return value == null ? '' : String(value);
  },
  set: (id: string) => emit('update:modelValue', id || null),
});

const groupChatIds = computed({
  get: () => {
    const value = props.modelValue;
    return Array.isArray(value) ? value.map(String) : [];
  },
  set: (ids: string[]) => emit('update:modelValue', ids),
});

const multiSelectIds = computed({
  get: () => {
    const value = props.modelValue;
    return Array.isArray(value) ? value.map(String) : [];
  },
  set: (ids: string[]) => emit('update:modelValue', ids),
});

const attachment = computed(() => {
  const value = props.modelValue;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Partial<FormControlAttachment>;
  if (!item.url) return null;
  return item as FormControlAttachment;
});

function setValue(value: unknown): void {
  emit('update:modelValue', value);
}

async function onFilePicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  uploadError.value = '';
  if (!file || !props.uploadFile || props.disabled) return;
  uploading.value = true;
  try {
    const uploaded = await props.uploadFile(file);
    setValue(uploaded);
  } catch (caught) {
    uploadError.value =
      caught instanceof Error ? caught.message : '上传失败，请重试';
  } finally {
    uploading.value = false;
  }
}

function clearAttachment(): void {
  setValue(null);
}
</script>

<template>
  <div class="form-control" :data-field-type="type">
    <!-- 单选 -->
    <select
      v-if="type === 'select'"
      :id="`field-${fieldId}`"
      :value="modelValue == null ? '' : String(modelValue)"
      :required="required"
      :disabled="disabled"
      data-testid="form-select"
      @change="setValue(($event.target as HTMLSelectElement).value || null)"
    >
      <option value="">请选择</option>
      <option v-for="choice in choices" :key="choice.id" :value="choice.id">
        {{ choice.name }}
      </option>
    </select>

    <!-- 多选 -->
    <div v-else-if="type === 'multiSelect'" class="fill-choices">
      <label v-for="choice in choices" :key="choice.id" class="fill-choice">
        <input
          v-model="multiSelectIds"
          type="checkbox"
          :value="choice.id"
          :disabled="disabled"
        />
        {{ choice.name }}
      </label>
    </div>

    <!-- 复选框 -->
    <label v-else-if="type === 'checkbox'" class="fill-choice">
      <input
        type="checkbox"
        :checked="modelValue === true || modelValue === 'true'"
        :disabled="disabled"
        @change="
          setValue(($event.target as HTMLInputElement).checked)
        "
      />
      是
    </label>

    <!-- 进度 -->
    <div v-else-if="type === 'progress'" class="progress-row">
      <input
        :id="`field-${fieldId}`"
        type="range"
        min="0"
        max="100"
        :value="Number(modelValue) || 0"
        :disabled="disabled"
        data-testid="form-progress"
        @input="
          setValue(Number(($event.target as HTMLInputElement).value) || 0)
        "
      />
      <span>{{ Number(modelValue) || 0 }}%</span>
    </div>

    <!-- 人员 -->
    <select
      v-else-if="type === 'person'"
      :id="`field-${fieldId}`"
      v-model="personValue"
      :required="required"
      :disabled="disabled"
      data-testid="form-person"
    >
      <option value="">请选择成员</option>
      <option
        v-for="member in members"
        :key="member.userId"
        :value="member.userId"
      >
        {{ member.name }}
      </option>
    </select>

    <!-- 群聊：与表格一致，选成员列表（非真实企微群） -->
    <div v-else-if="type === 'groupChat'" class="fill-choices">
      <label
        v-for="member in members"
        :key="member.userId"
        class="fill-choice"
      >
        <input
          v-model="groupChatIds"
          type="checkbox"
          :value="member.userId"
          :disabled="disabled"
        />
        {{ member.name }}
      </label>
      <p v-if="!members.length" class="hint">暂无工作区成员可选</p>
    </div>

    <!-- 关联 -->
    <select
      v-else-if="type === 'relation'"
      :id="`field-${fieldId}`"
      :value="modelValue == null ? '' : String(modelValue)"
      :required="required"
      :disabled="disabled"
      data-testid="form-relation"
      @change="setValue(($event.target as HTMLSelectElement).value || null)"
    >
      <option value="">请选择关联记录</option>
      <option
        v-for="choice in relationChoices"
        :key="choice.id"
        :value="choice.id"
      >
        {{ choice.label }}
      </option>
    </select>

    <!-- 图片 / 文件 -->
    <div v-else-if="type === 'image' || type === 'file'" class="attach-block">
      <input
        :id="`field-${fieldId}`"
        type="file"
        :accept="type === 'image' ? 'image/*' : undefined"
        :disabled="disabled || uploading || !uploadFile"
        :data-testid="type === 'image' ? 'form-image' : 'form-file'"
        @change="onFilePicked"
      />
      <p v-if="uploading" class="hint">上传中…</p>
      <p v-else-if="uploadError" class="error">{{ uploadError }}</p>
      <p v-else-if="!uploadFile" class="hint">当前环境无法上传附件</p>
      <div v-if="attachment" class="attach-preview">
        <img
          v-if="type === 'image'"
          :src="attachment.url"
          alt=""
          class="attach-thumb"
        />
        <a :href="attachment.url" target="_blank" rel="noreferrer">{{
          attachment.name
        }}</a>
        <button
          type="button"
          class="link-btn"
          :disabled="disabled"
          @click="clearAttachment"
        >
          清除
        </button>
      </div>
    </div>

    <!-- 地理位置：地址文本（无地图 SDK） -->
    <input
      v-else-if="type === 'location'"
      :id="`field-${fieldId}`"
      v-model="locationText"
      type="text"
      placeholder="输入地址"
      :required="required"
      :disabled="disabled"
      data-testid="form-location"
    />

    <!-- 文本：多行 -->
    <textarea
      v-else-if="type === 'text'"
      :id="`field-${fieldId}`"
      :value="modelValue == null ? '' : String(modelValue)"
      rows="3"
      :placeholder="`请输入${name}`"
      :required="required"
      :disabled="disabled"
      @input="setValue(($event.target as HTMLTextAreaElement).value)"
    />

    <!-- 货币 -->
    <div v-else-if="type === 'currency'" class="affix-row">
      <span class="affix">{{ currencySymbol }}</span>
      <input
        :id="`field-${fieldId}`"
        type="number"
        :value="modelValue == null || modelValue === '' ? '' : Number(modelValue)"
        :required="required"
        :disabled="disabled"
        placeholder="0"
        @input="
          setValue(
            ($event.target as HTMLInputElement).value === ''
              ? ''
              : Number(($event.target as HTMLInputElement).value),
          )
        "
      />
    </div>

    <!-- 百分数 -->
    <div v-else-if="type === 'percent'" class="affix-row">
      <input
        :id="`field-${fieldId}`"
        type="number"
        :value="modelValue == null || modelValue === '' ? '' : Number(modelValue)"
        :required="required"
        :disabled="disabled"
        placeholder="0"
        @input="
          setValue(
            ($event.target as HTMLInputElement).value === ''
              ? ''
              : Number(($event.target as HTMLInputElement).value),
          )
        "
      />
      <span class="affix">%</span>
    </div>

    <!-- 日期 / 日期时间 -->
    <input
      v-else-if="type === 'date'"
      :id="`field-${fieldId}`"
      :type="includeTime ? 'datetime-local' : 'date'"
      :value="modelValue == null ? '' : String(modelValue)"
      :required="required"
      :disabled="disabled"
      data-testid="form-date"
      @input="setValue(($event.target as HTMLInputElement).value)"
    />

    <!-- 电话 / 邮箱 / 链接 / 数字 / 标题 / 条码 等 -->
    <input
      v-else
      :id="`field-${fieldId}`"
      :type="
        type === 'phone'
          ? 'tel'
          : type === 'email'
            ? 'email'
            : type === 'url'
              ? 'url'
              : type === 'number'
                ? 'number'
                : 'text'
      "
      :value="modelValue == null ? '' : String(modelValue)"
      :placeholder="
        type === 'phone'
          ? '请输入电话号码'
          : type === 'barcode'
            ? '扫描或输入条码'
            : `请输入${name}`
      "
      :required="required"
      :disabled="disabled"
      :data-testid="type === 'phone' ? 'form-phone' : 'form-field'"
      @input="
        type === 'number'
          ? setValue(
              ($event.target as HTMLInputElement).value === ''
                ? ''
                : Number(($event.target as HTMLInputElement).value),
            )
          : setValue(($event.target as HTMLInputElement).value)
      "
    />
  </div>
</template>

<style scoped>
.form-control {
  width: 100%;
}
.form-control :is(input, select, textarea) {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #d0d5dd;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 14px;
  outline: none;
  background: #fff;
}
.form-control :is(input, select, textarea):focus {
  border-color: #2e6be6;
}
.fill-choices {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
}
.fill-choice {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #344054;
}
.progress-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.progress-row input[type='range'] {
  flex: 1;
  padding: 0;
  border: none;
}
.affix-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.affix-row input {
  flex: 1;
}
.affix {
  color: #667085;
  font-size: 14px;
}
.attach-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.attach-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
}
.attach-thumb {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid #eaecf0;
}
.link-btn {
  border: none;
  background: transparent;
  color: #d92d20;
  cursor: pointer;
  font-size: 13px;
  padding: 0;
}
.hint {
  margin: 0;
  font-size: 12px;
  color: #98a2b3;
}
.error {
  margin: 0;
  font-size: 12px;
  color: #d92d20;
}
</style>
