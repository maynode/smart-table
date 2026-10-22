<script setup lang="ts">
import { ref, watch } from 'vue';
import type { FieldDto, FieldOptionChoice } from '../api/types';

const props = defineProps<{ open: boolean; field: FieldDto | null }>();
const emit = defineEmits<{
  close: [];
  save: [options: Record<string, unknown>];
}>();

const COLORS = [
  { id: 'blue', label: '蓝', bg: '#e8f3ff', color: '#1d6fdc' },
  { id: 'green', label: '绿', bg: '#e8fff3', color: '#0f9d58' },
  { id: 'yellow', label: '黄', bg: '#fff7e6', color: '#d46b08' },
  { id: 'red', label: '红', bg: '#fff1f0', color: '#d4380d' },
  { id: 'purple', label: '紫', bg: '#f5f0ff', color: '#7b3ff2' },
  { id: 'gray', label: '灰', bg: '#f2f3f5', color: '#646a73' },
];

const choices = ref<FieldOptionChoice[]>([]);
const error = ref('');

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    error.value = '';
    choices.value = (props.field?.options?.choices ?? []).map((choice) => ({
      id: choice.id,
      name: choice.name,
      color: choice.color ?? 'blue',
    }));
    if (choices.value.length === 0) addChoice();
  },
);

function addChoice(): void {
  choices.value = [
    ...choices.value,
    {
      id: `opt-${crypto.randomUUID().slice(0, 8)}`,
      name: `选项${choices.value.length + 1}`,
      color: COLORS[choices.value.length % COLORS.length].id,
    },
  ];
}

function removeChoice(index: number): void {
  choices.value = choices.value.filter((_, itemIndex) => itemIndex !== index);
}

function moveChoice(index: number, direction: -1 | 1): void {
  const target = index + direction;
  if (target < 0 || target >= choices.value.length) return;
  const list = [...choices.value];
  [list[index], list[target]] = [list[target], list[index]];
  choices.value = list;
}

function colorOf(id?: string) {
  return COLORS.find((item) => item.id === id) ?? COLORS[0];
}

function save(): void {
  const names = choices.value.map((choice) => choice.name.trim());
  if (names.some((name) => !name)) {
    error.value = '选项名称不能为空';
    return;
  }
  if (new Set(names).size !== names.length) {
    error.value = '选项名称不能重复';
    return;
  }
  if (choices.value.length === 0) {
    error.value = '至少保留一个选项';
    return;
  }
  emit('save', {
    ...(props.field?.options ?? {}),
    choices: choices.value.map((choice) => ({
      ...choice,
      name: choice.name.trim(),
    })),
  });
}
</script>

<template>
  <div v-if="open" class="options-mask" @click.self="emit('close')">
    <section class="options-modal" data-testid="field-options-editor">
      <header>
        <div>
          <h3>编辑选项</h3>
          <p class="muted">{{ field?.name }} · 颜色会显示在表格和表单中</p>
        </div>
        <button class="icon-btn" aria-label="关闭" @click="emit('close')">×</button>
      </header>

      <div class="choices">
        <div
          v-for="(choice, index) in choices"
          :key="choice.id"
          class="choice-row"
          data-testid="field-option-row"
        >
          <span class="drag-handle">⋮⋮</span>
          <span
            class="choice-dot"
            :style="{ background: colorOf(choice.color).bg, color: colorOf(choice.color).color }"
          >
            ●
          </span>
          <input
            v-model="choice.name"
            :aria-label="`选项 ${index + 1} 名称`"
            :data-testid="`field-option-name-${index}`"
          />
          <select
            v-model="choice.color"
            class="color-select"
            :aria-label="`选项 ${index + 1} 颜色`"
            :style="{ color: colorOf(choice.color).color }"
          >
            <option v-for="color in COLORS" :key="color.id" :value="color.id">
              {{ color.label }}
            </option>
          </select>
          <button
            class="icon-btn"
            title="上移"
            :disabled="index === 0"
            @click="moveChoice(index, -1)"
          >
            ↑
          </button>
          <button
            class="icon-btn"
            title="下移"
            :disabled="index === choices.length - 1"
            @click="moveChoice(index, 1)"
          >
            ↓
          </button>
          <button
            class="icon-btn danger"
            title="删除选项"
            :data-testid="`field-option-remove-${index}`"
            @click="removeChoice(index)"
          >
            ×
          </button>
        </div>
      </div>

      <button class="btn add-choice" data-testid="field-option-add" @click="addChoice">
        + 添加选项
      </button>
      <p v-if="error" class="option-error">{{ error }}</p>

      <footer>
        <button class="btn" @click="emit('close')">取消</button>
        <button class="btn btn-primary" data-testid="field-option-save" @click="save">
          保存选项
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.options-mask {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.34);
}
.options-modal {
  width: min(460px, 94vw);
  max-height: 84vh;
  overflow: auto;
  padding: 18px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 24px 72px rgba(15, 23, 42, 0.24);
}
.options-modal header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 14px;
}
.options-modal h3 {
  margin: 0 0 4px;
  font-size: 16px;
}
.options-modal p {
  margin: 0;
}
.choices {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.choice-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.choice-row input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 9px;
  border: 1px solid #d0d3d9;
  border-radius: 6px;
}
.choice-row input:focus {
  outline: none;
  border-color: #2d8cf0;
}
.drag-handle {
  color: #b0b5bd;
  cursor: grab;
  letter-spacing: -2px;
}
.choice-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 9px;
  flex: none;
}
.color-select {
  width: 54px;
  height: 32px;
  border: 1px solid #d0d3d9;
  border-radius: 6px;
  background: #fff;
}
.icon-btn.danger {
  color: #d4380d;
}
.add-choice {
  width: 100%;
  margin-top: 10px;
  justify-content: flex-start;
  color: #1d6fdc;
}
.option-error {
  margin-top: 8px;
  color: #d92d20;
  font-size: 12px;
}
footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid #eef0f3;
}
</style>
