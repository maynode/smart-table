<script setup lang="ts">
import { computed } from 'vue';
import {
  DISPLAY_RULE_MAX_DEPTH,
  emptyDisplayCondition,
  emptyDisplayGroup,
  isDisplayConditionRule,
  type DisplayConditionOperator,
  type DisplayConjunction,
} from 'shared';
import type {
  DisplayConditionDto,
  DisplayConditionRuleDto,
} from '../api/types';

const props = withDefaults(
  defineProps<{
    modelValue: DisplayConditionRuleDto;
    depth?: number;
    candidates: Array<{ fieldId: string; label: string }>;
    operators: Array<{ value: DisplayConditionOperator; label: string }>;
  }>(),
  { depth: 0 },
);

const emit = defineEmits<{
  'update:modelValue': [value: DisplayConditionRuleDto];
}>();

const depth = computed(() => props.depth ?? 0);

function patch(partial: Partial<DisplayConditionRuleDto>): void {
  emit('update:modelValue', { ...props.modelValue, ...partial });
}

function setConjunction(conjunction: DisplayConjunction): void {
  patch({ conjunction });
}

function updateNode(
  index: number,
  node: DisplayConditionDto | DisplayConditionRuleDto,
): void {
  const conditions = [...props.modelValue.conditions];
  conditions[index] = node;
  patch({ conditions });
}

function removeNode(index: number): void {
  patch({
    conditions: props.modelValue.conditions.filter((_, i) => i !== index),
  });
}

function addLeaf(): void {
  patch({
    conditions: [...props.modelValue.conditions, emptyDisplayCondition()],
  });
}

function addGroup(): void {
  if (depth.value >= DISPLAY_RULE_MAX_DEPTH) return;
  patch({
    conditions: [...props.modelValue.conditions, emptyDisplayGroup('or')],
  });
}

function isValueVisible(operator: DisplayConditionOperator): boolean {
  return operator !== 'notEmpty' && operator !== 'isEmpty';
}

function asLeaf(
  node: DisplayConditionDto | DisplayConditionRuleDto,
): DisplayConditionDto | null {
  return isDisplayConditionRule(node) ? null : (node as DisplayConditionDto);
}

function asGroup(
  node: DisplayConditionDto | DisplayConditionRuleDto,
): DisplayConditionRuleDto | null {
  return isDisplayConditionRule(node) ? (node as DisplayConditionRuleDto) : null;
}
</script>

<template>
  <div
    class="rule-editor"
    :class="{ nested: depth > 0 }"
    :data-testid="depth === 0 ? 'form-display-rule' : 'form-display-rule-group'"
  >
    <div class="rule-toolbar">
      <span class="rule-label">{{ depth === 0 ? '显示当' : '子组' }}</span>
      <select
        :value="modelValue.conjunction"
        data-testid="form-rule-conjunction"
        @change="
          setConjunction(
            ($event.target as HTMLSelectElement).value as DisplayConjunction,
          )
        "
      >
        <option value="and">全部满足（且）</option>
        <option value="or">满足任一（或）</option>
      </select>
    </div>

    <div
      v-for="(node, index) in modelValue.conditions"
      :key="index"
      class="rule-node"
    >
      <div
        v-if="index > 0"
        class="rule-joiner"
        :data-testid="`form-rule-joiner-${index}`"
      >
        {{ modelValue.conjunction === 'or' ? '或' : '且' }}
      </div>

      <div v-if="asLeaf(node)" class="condition-row" data-testid="form-condition-row">
        <select
          :value="asLeaf(node)!.fieldId"
          data-testid="form-condition-field"
          @change="
            updateNode(index, {
              ...asLeaf(node)!,
              fieldId: ($event.target as HTMLSelectElement).value,
            })
          "
        >
          <option value="">触发字段</option>
          <option
            v-for="candidate in candidates"
            :key="candidate.fieldId"
            :value="candidate.fieldId"
          >
            {{ candidate.label }}
          </option>
        </select>
        <select
          :value="asLeaf(node)!.operator"
          data-testid="form-condition-operator"
          @change="
            updateNode(index, {
              ...asLeaf(node)!,
              operator: ($event.target as HTMLSelectElement)
                .value as DisplayConditionOperator,
            })
          "
        >
          <option v-for="op in operators" :key="op.value" :value="op.value">
            {{ op.label }}
          </option>
        </select>
        <input
          v-if="isValueVisible(asLeaf(node)!.operator)"
          :value="String(asLeaf(node)!.value ?? '')"
          placeholder="比较值"
          data-testid="form-condition-value"
          @input="
            updateNode(index, {
              ...asLeaf(node)!,
              value: ($event.target as HTMLInputElement).value,
            })
          "
        />
        <button
          class="icon-btn danger"
          type="button"
          title="删除条件"
          @click="removeNode(index)"
        >
          ×
        </button>
      </div>

      <div v-else-if="asGroup(node)" class="nested-wrap">
        <DisplayRuleEditor
          :model-value="asGroup(node)!"
          :depth="depth + 1"
          :candidates="candidates"
          :operators="operators"
          @update:model-value="updateNode(index, $event)"
        />
        <button
          class="icon-btn danger nest-remove"
          type="button"
          title="删除条件组"
          @click="removeNode(index)"
        >
          ×
        </button>
      </div>
    </div>

    <div class="rule-actions">
      <button
        class="btn small"
        type="button"
        data-testid="form-add-condition"
        @click="addLeaf"
      >
        + 添加条件
      </button>
      <button
        v-if="depth < DISPLAY_RULE_MAX_DEPTH"
        class="btn small"
        type="button"
        data-testid="form-add-condition-group"
        @click="addGroup"
      >
        + 添加条件组
      </button>
    </div>
  </div>
</template>

<style scoped>
.rule-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 4px;
}
.rule-editor.nested {
  margin-top: 4px;
  padding: 10px;
  border: 1px dashed #b7d0f5;
  border-radius: 8px;
  background: #fbfdff;
}
.rule-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.rule-label {
  font-size: 12px;
  color: #667085;
  white-space: nowrap;
}
.rule-toolbar select {
  flex: 1;
  min-width: 140px;
  height: 30px;
  padding: 0 8px;
  border: 1px solid #d0d5dd;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
}
.rule-joiner {
  font-size: 12px;
  font-weight: 600;
  color: #1677ff;
  padding: 2px 0;
}
.condition-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.condition-row select,
.condition-row input {
  flex: 1 1 96px;
  height: 30px;
  min-width: 0;
  padding: 0 7px;
  border: 1px solid #d0d5dd;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  box-sizing: border-box;
}
.condition-row .icon-btn {
  flex: 0 0 auto;
}
.nested-wrap {
  position: relative;
}
.nest-remove {
  position: absolute;
  top: 8px;
  right: 8px;
}
.rule-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
.icon-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 2px 6px;
}
.icon-btn.danger {
  color: #d4380d;
}
.btn.small {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
}
</style>
