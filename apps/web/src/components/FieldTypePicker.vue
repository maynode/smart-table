<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  FIELD_TYPE_LABELS,
  SYSTEM_FIELD_TYPES,
  isFormFillableFieldType,
  type FieldType,
} from 'shared';
import { newId } from '../ui/id';

interface ChoiceDraft {
  id: string;
  name: string;
  color: string;
}

const COLORS = [
  { id: 'blue', label: '蓝', bg: '#e8f3ff', color: '#1d6fdc' },
  { id: 'green', label: '绿', bg: '#e8fff3', color: '#0f9d58' },
  { id: 'yellow', label: '黄', bg: '#fff7e6', color: '#d46b08' },
  { id: 'red', label: '红', bg: '#fff1f0', color: '#d4380d' },
  { id: 'purple', label: '紫', bg: '#f5f0ff', color: '#7b3ff2' },
  { id: 'gray', label: '灰', bg: '#f2f3f5', color: '#646a73' },
];

const props = withDefaults(
  defineProps<{
    open: boolean;
    anchor?: { top: number; left: number } | null;
    initialName?: string;
    initialType?: FieldType;
    initialOptions?: Record<string, unknown> | null;
    mode?: 'create' | 'edit';
    /** Hide formula/system/AI etc. when adding fields into a collect form. */
    fillableOnly?: boolean;
  }>(),
  {
    anchor: null,
    initialName: '',
    initialType: 'text',
    initialOptions: null,
    mode: 'create',
    fillableOnly: false,
  },
);

const emit = defineEmits<{
  close: [];
  confirm: [
    payload: { name: string; type: FieldType; options?: Record<string, unknown> },
  ];
}>();

const name = ref(props.initialName);
const selected = ref<FieldType>(props.initialType);
/** create: pick type first; select types then configure. edit: config/type. */
const phase = ref<'types' | 'config'>('types');
const typeMenuOpen = ref(false);
const choices = ref<ChoiceDraft[]>([]);
const choiceError = ref('');
const nameInput = ref<HTMLInputElement | null>(null);

const MENU_GROUPS: FieldType[][] = [
  ['ai'],
  [
    'text',
    'title',
    'select',
    'multiSelect',
    'number',
    'percent',
    'currency',
    'progress',
    'date',
  ],
  ['person', 'groupChat', 'image', 'file'],
  ['relation', 'url', 'phone', 'email', 'location', 'checkbox', 'barcode'],
  ['formula', 'lookup', 'autoNumber'],
  [...SYSTEM_FIELD_TYPES],
];

const menuGroups = computed(() =>
  MENU_GROUPS.map((group) =>
    props.fillableOnly
      ? group.filter((type) => isFormFillableFieldType(type))
      : group,
  ).filter((group) => group.length > 0),
);
const flatTypes = computed(() => menuGroups.value.flat());
const isChoiceType = computed(
  () => selected.value === 'select' || selected.value === 'multiSelect',
);

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    name.value = props.initialName;
    selected.value = props.initialType;
    choiceError.value = '';
    seedChoices(props.initialOptions);
    if (props.mode === 'edit') {
      phase.value = 'config';
      typeMenuOpen.value = !isChoiceType.value;
    } else {
      phase.value = 'types';
      typeMenuOpen.value = true;
    }
    await nextTick();
    nameInput.value?.focus();
    nameInput.value?.select();
  },
);

function seedChoices(options: Record<string, unknown> | null | undefined): void {
  const raw = (options?.choices as ChoiceDraft[] | undefined) ?? [];
  choices.value = raw.map((choice) => ({
    id: choice.id,
    name: choice.name,
    color: choice.color || 'blue',
  }));
  if (choices.value.length === 0) {
    choices.value = [
      { id: 'opt1', name: '选项一', color: 'yellow' },
      { id: 'opt2', name: '选项二', color: 'green' },
      { id: 'opt3', name: '选项三', color: 'blue' },
    ];
  }
}

function defaultNameFor(type: FieldType): string {
  if (name.value.trim()) return name.value.trim();
  return FIELD_TYPE_LABELS[type];
}

function defaultOptions(type: FieldType): Record<string, unknown> | undefined {
  if (type === 'select' || type === 'multiSelect') {
    return {
      choices: choices.value.map((choice) => ({
        id: choice.id,
        name: choice.name.trim(),
        color: choice.color,
      })),
    };
  }
  if (type === 'currency') return { currency: 'CNY', precision: 2 };
  if (type === 'formula') return { formula: '=1' };
  if (type === 'relation') return { relation: { targetSheetId: '' } };
  if (type === 'lookup') {
    return {
      lookup: {
        relationFieldId: '',
        targetFieldId: '',
        aggregate: 'first',
      },
    };
  }
  if (type === 'autoNumber') return { prefix: '', padding: 4, start: 1 };
  if (type === 'ai') {
    return {
      ai: { prompt: '', sourceFieldIds: [] as string[], provider: 'local' },
    };
  }
  if (type === 'progress') return { min: 0, max: 100 };
  if (type === 'location') return { location: { mode: 'address' } };
  if (type === 'barcode') return { barcode: { format: 'code128' } };
  return undefined;
}

function pickType(type: FieldType): void {
  selected.value = type;
  if (type === 'select' || type === 'multiSelect') {
    if (choices.value.length === 0) seedChoices(null);
    phase.value = 'config';
    typeMenuOpen.value = false;
    return;
  }
  // Non-choice types: finish immediately (WeCom-like quick pick).
  finish(type);
}

function finish(type: FieldType = selected.value): void {
  const fieldName = defaultNameFor(type);
  if (!fieldName) return;
  if (type === 'select' || type === 'multiSelect') {
    const names = choices.value.map((choice) => choice.name.trim());
    if (names.some((item) => !item)) {
      choiceError.value = '选项名称不能为空';
      return;
    }
    if (new Set(names).size !== names.length) {
      choiceError.value = '选项名称不能重复';
      return;
    }
    if (choices.value.length === 0) {
      choiceError.value = '至少保留一个选项';
      return;
    }
  }
  const typeChanged = type !== props.initialType;
  emit('confirm', {
    name: fieldName,
    type,
    options:
      type === 'select' || type === 'multiSelect'
        ? {
            ...(props.initialOptions ?? {}),
            ...defaultOptions(type),
          }
        : props.mode === 'create' || typeChanged
          ? defaultOptions(type)
          : undefined,
  });
}

function addChoice(): void {
  choices.value = [
    ...choices.value,
    {
      id: `opt-${newId().slice(0, 8)}`,
      name: `选项${choices.value.length + 1}`,
      color: COLORS[choices.value.length % COLORS.length].id,
    },
  ];
}

function removeChoice(index: number): void {
  if (choices.value.length <= 1) return;
  choices.value = choices.value.filter((_, i) => i !== index);
}

function colorOf(id?: string) {
  return COLORS.find((item) => item.id === id) ?? COLORS[0];
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.open) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    if (typeMenuOpen.value && phase.value === 'config') {
      typeMenuOpen.value = false;
      return;
    }
    emit('close');
    return;
  }
  if (phase.value === 'types' || typeMenuOpen.value) {
    const types = flatTypes.value;
    const index = types.indexOf(selected.value);
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      selected.value =
        types[Math.min(index + 1, types.length - 1)] ?? selected.value;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      selected.value = types[Math.max(index - 1, 0)] ?? selected.value;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      pickType(selected.value);
    }
  } else if (event.key === 'Enter' && !(event.target instanceof HTMLInputElement)) {
    event.preventDefault();
    finish();
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));

const style = computed(() => {
  if (!props.anchor) {
    return { top: '72px', left: '50%', transform: 'translateX(-50%)' };
  }
  return {
    top: `${Math.min(props.anchor.top, window.innerHeight - 480)}px`,
    left: `${Math.min(props.anchor.left, window.innerWidth - 360)}px`,
  };
});

function iconFor(type: FieldType): string {
  const map: Partial<Record<FieldType, string>> = {
    ai: '✦',
    text: 'T',
    title: '题',
    select: '◉',
    multiSelect: '▣',
    number: '#',
    percent: '%',
    currency: '¥',
    progress: '▮',
    date: '日',
    person: '人',
    groupChat: '群',
    image: '图',
    file: '件',
    relation: '关',
    url: '链',
    phone: '电',
    email: '@',
    location: '地',
    checkbox: '☑',
    barcode: '码',
    autoNumber: '№',
    formula: 'ƒ',
    lookup: '引',
    createdBy: '创',
    lastEditedBy: '编',
    createdAt: '时',
    lastEditedAt: '改',
  };
  return map[type] ?? '·';
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="ftp-mask"
      data-testid="field-type-picker-mask"
      @click.self="emit('close')"
    >
      <div
        class="ftp-popover"
        data-testid="field-type-picker"
        :style="style"
        @click.stop
      >
        <input
          ref="nameInput"
          v-model="name"
          class="ftp-name"
          data-testid="field-name-input"
          maxlength="100"
          placeholder="字段名称"
          @keydown.enter.prevent="isChoiceType ? finish() : pickType(selected)"
        />

        <!-- WeCom: type chip opens type menu; select fields configure options here -->
        <template v-if="phase === 'config'">
          <button
            type="button"
            class="ftp-type-chip"
            data-testid="field-type-chip"
            @click="typeMenuOpen = !typeMenuOpen"
          >
            <span class="ftp-icon">{{ iconFor(selected) }}</span>
            <span>{{ FIELD_TYPE_LABELS[selected] }}</span>
            <span class="ftp-caret">{{ typeMenuOpen ? '▴' : '▾' }}</span>
          </button>

          <div v-if="isChoiceType && !typeMenuOpen" class="ftp-choices">
            <div class="ftp-choices-title">选项</div>
            <div
              v-for="(choice, index) in choices"
              :key="choice.id"
              class="ftp-choice-row"
              data-testid="field-option-row"
            >
              <span
                class="ftp-choice-dot"
                :style="{
                  background: colorOf(choice.color).bg,
                  color: colorOf(choice.color).color,
                }"
              >
                ●
              </span>
              <input
                v-model="choice.name"
                :data-testid="`field-option-name-${index}`"
                placeholder="选项名"
              />
              <select v-model="choice.color" class="ftp-color">
                <option v-for="color in COLORS" :key="color.id" :value="color.id">
                  {{ color.label }}
                </option>
              </select>
              <button
                type="button"
                class="ftp-remove"
                title="删除"
                :disabled="choices.length <= 1"
                @click="removeChoice(index)"
              >
                ×
              </button>
            </div>
            <button
              type="button"
              class="ftp-add-choice"
              data-testid="field-option-add"
              @click="addChoice"
            >
              + 添加选项
            </button>
            <p v-if="choiceError" class="ftp-error">{{ choiceError }}</p>
            <footer class="ftp-actions">
              <button type="button" class="btn" @click="emit('close')">取消</button>
              <button
                type="button"
                class="btn btn-primary"
                data-testid="field-config-save"
                @click="finish()"
              >
                确定
              </button>
            </footer>
          </div>
        </template>

        <template v-if="phase === 'types' || typeMenuOpen">
          <p class="ftp-hint">选择字段类型</p>
          <div
            v-for="(group, groupIndex) in menuGroups"
            :key="groupIndex"
            class="ftp-group"
            :class="{ 'ftp-group-ai': groupIndex === 0 && group[0] === 'ai' }"
          >
            <button
              v-for="type in group"
              :key="type"
              type="button"
              class="ftp-item"
              :class="{
                active: selected === type,
                'ftp-item-ai': type === 'ai',
              }"
              :data-testid="`field-type-${type}`"
              @mouseenter="selected = type"
              @click="pickType(type)"
            >
              <span class="ftp-icon" aria-hidden="true">{{ iconFor(type) }}</span>
              <span>{{ FIELD_TYPE_LABELS[type] }}</span>
            </button>
          </div>
          <footer class="ftp-footer">
            <span>↑↓ 选择</span>
            <span>↵ 完成</span>
          </footer>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ftp-mask {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: transparent;
}
.ftp-popover {
  position: fixed;
  width: 340px;
  max-height: min(560px, 84vh);
  overflow: auto;
  padding: 12px 12px 8px;
  background: #fff;
  border: 1px solid #e5e6eb;
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(31, 35, 41, 0.16);
}
.ftp-name {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid #3370ff;
  border-radius: 6px;
  outline: none;
  font-size: 14px;
  box-sizing: border-box;
}
.ftp-type-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 34px;
  margin-top: 8px;
  padding: 0 10px;
  border: 1px solid #dee0e3;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  color: #1f2329;
}
.ftp-type-chip:hover {
  background: #f7f8fa;
}
.ftp-caret {
  margin-left: auto;
  color: #8f959e;
}
.ftp-hint {
  margin: 10px 2px 6px;
  font-size: 12px;
  color: #8f959e;
}
.ftp-group {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  padding: 4px 0 8px;
  border-bottom: 1px solid #f0f1f2;
}
.ftp-group:last-of-type {
  border-bottom: none;
}
.ftp-group-ai {
  grid-template-columns: 1fr;
}
.ftp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
  color: #1f2329;
}
.ftp-item:hover,
.ftp-item.active {
  background: #f2f3f5;
}
.ftp-item-ai {
  color: #6b4eff;
  font-weight: 500;
}
.ftp-icon {
  width: 18px;
  text-align: center;
  font-size: 12px;
  opacity: 0.85;
  flex: none;
}
.ftp-choices {
  margin-top: 10px;
}
.ftp-choices-title {
  margin-bottom: 6px;
  font-size: 12px;
  color: #8f959e;
}
.ftp-choice-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.ftp-choice-dot {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 9px;
  flex: none;
}
.ftp-choice-row input {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 8px;
  border: 1px solid #d0d3d9;
  border-radius: 6px;
  font-size: 13px;
}
.ftp-choice-row input:focus {
  outline: none;
  border-color: #3370ff;
}
.ftp-color {
  width: 52px;
  height: 30px;
  border: 1px solid #d0d3d9;
  border-radius: 6px;
  background: #fff;
}
.ftp-remove {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #8f959e;
  cursor: pointer;
  font-size: 16px;
}
.ftp-remove:hover:not(:disabled) {
  color: #d4380d;
  background: #fff1f0;
}
.ftp-remove:disabled {
  opacity: 0.35;
  cursor: default;
}
.ftp-add-choice {
  width: 100%;
  height: 32px;
  margin-top: 2px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #1d6fdc;
  text-align: left;
  padding: 0 8px;
  cursor: pointer;
  font-size: 13px;
}
.ftp-add-choice:hover {
  background: #f0f7ff;
}
.ftp-error {
  margin: 6px 0 0;
  color: #d92d20;
  font-size: 12px;
}
.ftp-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #eef0f3;
}
.ftp-footer {
  display: flex;
  justify-content: center;
  gap: 16px;
  padding-top: 6px;
  font-size: 11px;
  color: #8f959e;
}
</style>
