<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { endpoints } from '../api/endpoints';
import type { FieldDto, FieldOptionChoice, SheetDto } from '../api/types';

const props = defineProps<{
  open: boolean;
  field: FieldDto | null;
  fields?: FieldDto[];
  /** Sheets in the same base — required for relation target picker. */
  sheets?: SheetDto[];
  baseId?: string;
}>();
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
const aiPrompt = ref('');
const aiSourceIds = ref<string[]>([]);
const formulaText = ref('=1');
const relationTargetSheetId = ref('');
const lookupRelationFieldId = ref('');
const lookupTargetFieldId = ref('');
const lookupAggregate = ref<'first' | 'count' | 'sum' | 'min' | 'max' | 'array'>(
  'first',
);
const targetFields = ref<FieldDto[]>([]);
const loadingTarget = ref(false);
const error = ref('');

const fieldType = computed(() => props.field?.type ?? '');
const isAi = computed(() => fieldType.value === 'ai');
const isChoice = computed(
  () => fieldType.value === 'select' || fieldType.value === 'multiSelect',
);
const isFormula = computed(() => fieldType.value === 'formula');
const isRelation = computed(() => fieldType.value === 'relation');
const isLookup = computed(() => fieldType.value === 'lookup');
const needsConfig = computed(
  () =>
    isAi.value ||
    isChoice.value ||
    isFormula.value ||
    isRelation.value ||
    isLookup.value,
);

const sourceCandidates = computed(() =>
  (props.fields ?? []).filter(
    (item) => item.id !== props.field?.id && item.type !== 'ai',
  ),
);
const relationCandidates = computed(() =>
  (props.fields ?? []).filter(
    (item) => item.type === 'relation' && item.id !== props.field?.id,
  ),
);
const sheetOptions = computed(() => props.sheets ?? []);

const title = computed(() => {
  if (isAi.value) return '编辑 AI 字段';
  if (isFormula.value) return '编辑公式';
  if (isRelation.value) return '编辑关联';
  if (isLookup.value) return '编辑查找引用';
  if (isChoice.value) return '编辑选项';
  return '字段配置';
});

async function loadTargetFields(sheetId: string): Promise<void> {
  if (!sheetId) {
    targetFields.value = [];
    return;
  }
  loadingTarget.value = true;
  try {
    const sheet = await endpoints.getSheet(sheetId);
    targetFields.value = sheet.fields ?? [];
  } catch {
    targetFields.value = [];
  } finally {
    loadingTarget.value = false;
  }
}

watch(
  () => props.open,
  async (open) => {
    if (!open || !props.field) return;
    error.value = '';
    const opts = props.field.options ?? {};

    if (isAi.value) {
      const ai = (opts.ai ?? {}) as {
        prompt?: string;
        sourceFieldIds?: string[];
      };
      aiPrompt.value = ai.prompt ?? '';
      aiSourceIds.value = Array.isArray(ai.sourceFieldIds)
        ? [...ai.sourceFieldIds]
        : [];
      return;
    }

    if (isFormula.value) {
      formulaText.value = String(opts.formula ?? '=1');
      return;
    }

    if (isRelation.value) {
      const relation = (opts.relation ?? {}) as { targetSheetId?: string };
      relationTargetSheetId.value =
        relation.targetSheetId ?? sheetOptions.value[0]?.id ?? '';
      return;
    }

    if (isLookup.value) {
      const lookup = (opts.lookup ?? {}) as {
        relationFieldId?: string;
        targetFieldId?: string;
        aggregate?: typeof lookupAggregate.value;
      };
      lookupRelationFieldId.value = lookup.relationFieldId ?? '';
      lookupTargetFieldId.value = lookup.targetFieldId ?? '';
      lookupAggregate.value = lookup.aggregate ?? 'first';
      const rel = (props.fields ?? []).find(
        (item) => item.id === lookupRelationFieldId.value,
      );
      const targetSheetId = (
        rel?.options as { relation?: { targetSheetId?: string } } | null
      )?.relation?.targetSheetId;
      if (targetSheetId) await loadTargetFields(targetSheetId);
      return;
    }

    choices.value = (opts.choices ?? []).map((choice) => ({
      id: choice.id,
      name: choice.name,
      color: choice.color ?? 'blue',
    }));
    if (choices.value.length === 0) addChoice();
  },
);

watch(lookupRelationFieldId, async (fieldId) => {
  if (!props.open || !isLookup.value) return;
  const rel = (props.fields ?? []).find((item) => item.id === fieldId);
  const targetSheetId = (
    rel?.options as { relation?: { targetSheetId?: string } } | null
  )?.relation?.targetSheetId;
  lookupTargetFieldId.value = '';
  await loadTargetFields(targetSheetId ?? '');
});

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

function toggleSource(fieldId: string): void {
  if (aiSourceIds.value.includes(fieldId)) {
    aiSourceIds.value = aiSourceIds.value.filter((id) => id !== fieldId);
  } else {
    aiSourceIds.value = [...aiSourceIds.value, fieldId];
  }
}

function insertFieldToken(name: string): void {
  const token = `[${name}]`;
  if (!formulaText.value.includes(token)) {
    formulaText.value = `${formulaText.value || '='}${token}`;
  }
}

function save(): void {
  const base = { ...(props.field?.options ?? {}) };

  if (isAi.value) {
    emit('save', {
      ...base,
      ai: {
        ...((props.field?.options?.ai as Record<string, unknown>) ?? {}),
        prompt: aiPrompt.value.trim(),
        sourceFieldIds: [...aiSourceIds.value],
        provider:
          ((props.field?.options?.ai as { provider?: string } | undefined)
            ?.provider ?? 'local'),
      },
    });
    return;
  }

  if (isFormula.value) {
    let formula = formulaText.value.trim();
    if (!formula) {
      error.value = '请输入公式';
      return;
    }
    if (!formula.startsWith('=')) formula = `=${formula}`;
    emit('save', { ...base, formula });
    return;
  }

  if (isRelation.value) {
    if (!relationTargetSheetId.value) {
      error.value = '请选择关联的工作表';
      return;
    }
    emit('save', {
      ...base,
      relation: {
        ...((props.field?.options?.relation as Record<string, unknown>) ?? {}),
        targetSheetId: relationTargetSheetId.value,
      },
    });
    return;
  }

  if (isLookup.value) {
    if (!lookupRelationFieldId.value || !lookupTargetFieldId.value) {
      error.value = '请选择关联字段与目标字段';
      return;
    }
    emit('save', {
      ...base,
      lookup: {
        relationFieldId: lookupRelationFieldId.value,
        targetFieldId: lookupTargetFieldId.value,
        aggregate: lookupAggregate.value,
      },
    });
    return;
  }

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
    ...base,
    choices: choices.value.map((choice) => ({
      ...choice,
      name: choice.name.trim(),
    })),
  });
}

onMounted(() => {
  /* sheets may arrive after open */
});
</script>

<template>
  <div v-if="open && needsConfig" class="options-mask" @click.self="emit('close')">
    <section
      class="options-modal"
      :data-testid="
        isAi
          ? 'ai-field-options-editor'
          : isFormula
            ? 'formula-field-options-editor'
            : isRelation
              ? 'relation-field-options-editor'
              : isLookup
                ? 'lookup-field-options-editor'
                : 'field-options-editor'
      "
    >
      <header>
        <div>
          <h3>{{ title }}</h3>
          <p class="muted">
            <template v-if="isAi">
              {{ field?.name }} · 提示词支持
              <code v-text="'{{字段名}}'"></code>
            </template>
            <template v-else-if="isFormula">
              {{ field?.name }} · 以
              <code>=</code>
              开头，可用
              <code>[字段名]</code>
              引用本表列
            </template>
            <template v-else-if="isRelation">
              {{ field?.name }} · 选择要关联的工作表，格子内可点选记录
            </template>
            <template v-else-if="isLookup">
              {{ field?.name }} · 经关联字段拉取目标表字段并聚合
            </template>
            <template v-else>
              {{ field?.name }} · 颜色会显示在表格和表单中
            </template>
          </p>
        </div>
        <button class="icon-btn" aria-label="关闭" @click="emit('close')">×</button>
      </header>

      <template v-if="isAi">
        <label class="ai-label" for="ai-prompt">提示词</label>
        <textarea
          id="ai-prompt"
          v-model="aiPrompt"
          rows="4"
          data-testid="ai-field-prompt"
          placeholder="例如：将以下内容总结成一句话：{{标题}}"
        />
        <div class="ai-label">引用字段</div>
        <div class="ai-sources" data-testid="ai-field-sources">
          <label
            v-for="candidate in sourceCandidates"
            :key="candidate.id"
            class="ai-source"
          >
            <input
              type="checkbox"
              :checked="aiSourceIds.includes(candidate.id)"
              @change="toggleSource(candidate.id)"
            />
            <span>{{ candidate.name }}</span>
          </label>
          <p v-if="sourceCandidates.length === 0" class="muted">
            暂无其它字段可引用
          </p>
        </div>
      </template>

      <template v-else-if="isFormula">
        <label class="ai-label" for="formula-input">公式</label>
        <textarea
          id="formula-input"
          v-model="formulaText"
          rows="3"
          data-testid="formula-field-input"
          placeholder="=数量*2"
        />
        <div class="ai-label">插入字段</div>
        <div class="token-row">
          <button
            v-for="candidate in sourceCandidates"
            :key="candidate.id"
            type="button"
            class="var-chip"
            @click="insertFieldToken(candidate.name)"
          >
            {{ candidate.name }}
          </button>
        </div>
      </template>

      <template v-else-if="isRelation">
        <label class="ai-label">关联工作表</label>
        <select
          v-model="relationTargetSheetId"
          class="full-select"
          data-testid="relation-target-sheet"
        >
          <option value="">请选择</option>
          <option v-for="sheet in sheetOptions" :key="sheet.id" :value="sheet.id">
            {{ sheet.name }}
          </option>
        </select>
        <p v-if="sheetOptions.length === 0" class="muted">当前 Base 没有其它工作表</p>
      </template>

      <template v-else-if="isLookup">
        <label class="ai-label">关联字段</label>
        <select
          v-model="lookupRelationFieldId"
          class="full-select"
          data-testid="lookup-relation-field"
        >
          <option value="">请选择</option>
          <option
            v-for="candidate in relationCandidates"
            :key="candidate.id"
            :value="candidate.id"
          >
            {{ candidate.name }}
          </option>
        </select>
        <label class="ai-label">目标字段</label>
        <select
          v-model="lookupTargetFieldId"
          class="full-select"
          data-testid="lookup-target-field"
          :disabled="!lookupRelationFieldId || loadingTarget"
        >
          <option value="">{{ loadingTarget ? '加载中…' : '请选择' }}</option>
          <option v-for="tf in targetFields" :key="tf.id" :value="tf.id">
            {{ tf.name }}
          </option>
        </select>
        <label class="ai-label">聚合方式</label>
        <select
          v-model="lookupAggregate"
          class="full-select"
          data-testid="lookup-aggregate"
        >
          <option value="first">取第一条</option>
          <option value="count">计数</option>
          <option value="sum">求和</option>
          <option value="min">最小</option>
          <option value="max">最大</option>
          <option value="array">全部列表</option>
        </select>
      </template>

      <template v-else>
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
              :style="{
                background: colorOf(choice.color).bg,
                color: colorOf(choice.color).color,
              }"
            >
              ●
            </span>
            <input v-model="choice.name" data-testid="field-option-name" />
            <select v-model="choice.color">
              <option v-for="color in COLORS" :key="color.id" :value="color.id">
                {{ color.label }}
              </option>
            </select>
            <button class="icon-btn" type="button" @click="moveChoice(index, -1)">↑</button>
            <button class="icon-btn" type="button" @click="moveChoice(index, 1)">↓</button>
            <button class="icon-btn danger" type="button" @click="removeChoice(index)">
              ×
            </button>
          </div>
        </div>
        <button class="btn small" type="button" data-testid="field-option-add" @click="addChoice">
          + 添加选项
        </button>
      </template>

      <p v-if="error" class="error">{{ error }}</p>
      <footer>
        <button class="btn" type="button" @click="emit('close')">取消</button>
        <button
          class="btn btn-primary"
          type="button"
          :data-testid="isAi ? 'ai-field-option-save' : 'field-option-save'"
          @click="save"
        >
          保存
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.options-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.35);
}
.options-modal {
  width: min(480px, 92vw);
  max-height: 86vh;
  overflow: auto;
  padding: 16px 18px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.2);
}
.options-modal header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.options-modal h3 {
  margin: 0 0 4px;
  font-size: 16px;
}
.muted {
  margin: 0;
  color: #8f959e;
  font-size: 12px;
  line-height: 1.45;
}
.ai-label {
  display: block;
  margin: 10px 0 6px;
  font-size: 12px;
  color: #646a73;
}
textarea,
.full-select {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid #d0d5dd;
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
}
.ai-sources {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
}
.ai-source {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.token-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.var-chip {
  height: 26px;
  padding: 0 10px;
  border: 1px solid #d6e4ff;
  border-radius: 999px;
  background: #f5f8ff;
  color: #1d6fdc;
  font-size: 12px;
  cursor: pointer;
}
.choices {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
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
  padding: 0 8px;
  border: 1px solid #d0d5dd;
  border-radius: 7px;
}
.choice-row select {
  height: 32px;
  border: 1px solid #d0d5dd;
  border-radius: 7px;
}
.choice-dot {
  width: 22px;
  text-align: center;
  font-size: 12px;
}
.drag-handle {
  color: #c0c4cc;
  font-size: 11px;
}
.error {
  color: #d92d20;
  font-size: 12px;
}
footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
.icon-btn.danger {
  color: #d4380d;
}
</style>
