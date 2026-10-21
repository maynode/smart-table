<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  FIELD_TYPE_LABELS,
  SYSTEM_FIELD_TYPES,
  type FieldType,
} from 'shared';

const props = withDefaults(
  defineProps<{
    open: boolean;
    anchor?: { top: number; left: number } | null;
    initialName?: string;
    initialType?: FieldType;
    mode?: 'create' | 'edit';
  }>(),
  {
    anchor: null,
    initialName: '',
    initialType: 'text',
    mode: 'create',
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
const nameInput = ref<HTMLInputElement | null>(null);

/** WeCom menu order: AI first, then two-column grid with separators. */
const MENU_GROUPS: FieldType[][] = [
  ['ai'],
  [
    'text',
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

const flatTypes = computed(() => MENU_GROUPS.flat());

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    name.value = props.initialName;
    selected.value = props.initialType;
    await nextTick();
    nameInput.value?.focus();
    nameInput.value?.select();
  },
);

function defaultNameFor(type: FieldType): string {
  if (name.value.trim()) return name.value.trim();
  return FIELD_TYPE_LABELS[type];
}

function defaultOptions(type: FieldType): Record<string, unknown> | undefined {
  if (type === 'select' || type === 'multiSelect') {
    return {
      choices: [
        { id: 'opt1', name: '选项一', color: 'yellow' },
        { id: 'opt2', name: '选项二', color: 'green' },
        { id: 'opt3', name: '选项三', color: 'blue' },
      ],
    };
  }
  if (type === 'currency') {
    return { currency: 'CNY', precision: 2 };
  }
  if (type === 'formula') {
    return { formula: '1' };
  }
  if (type === 'autoNumber') {
    return { prefix: '', padding: 4, start: 1 };
  }
  if (type === 'progress') {
    return { min: 0, max: 100 };
  }
  return undefined;
}

function confirm(type: FieldType = selected.value): void {
  const fieldName = defaultNameFor(type);
  if (!fieldName) return;
  selected.value = type;
  const typeChanged = type !== props.initialType;
  emit('confirm', {
    name: fieldName,
    type,
    // Create always seeds defaults; edit only when the type changes.
    options:
      props.mode === 'create' || typeChanged
        ? defaultOptions(type)
        : undefined,
  });
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.open) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
    return;
  }
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
    confirm();
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));

const style = computed(() => {
  if (!props.anchor) {
    return { top: '72px', left: '50%', transform: 'translateX(-50%)' };
  }
  return {
    top: `${Math.min(props.anchor.top, window.innerHeight - 420)}px`,
    left: `${Math.min(props.anchor.left, window.innerWidth - 340)}px`,
  };
});

function iconFor(type: FieldType): string {
  const map: Partial<Record<FieldType, string>> = {
    ai: '✦',
    text: 'T',
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
          @keydown.enter.prevent="confirm()"
        />
        <p class="ftp-hint">选择字段类型</p>

        <div
          v-for="(group, groupIndex) in MENU_GROUPS"
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
            @click="confirm(type)"
          >
            <span class="ftp-icon" aria-hidden="true">{{ iconFor(type) }}</span>
            <span>{{ FIELD_TYPE_LABELS[type] }}</span>
          </button>
        </div>

        <footer class="ftp-footer">
          <span>↑↓ 选择</span>
          <span>↵ 完成</span>
        </footer>
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
  width: 320px;
  max-height: min(520px, 80vh);
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
.ftp-footer {
  display: flex;
  justify-content: center;
  gap: 16px;
  padding-top: 6px;
  font-size: 11px;
  color: #8f959e;
}
</style>
