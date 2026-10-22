export type DisplayConditionOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notEmpty'
  | 'isEmpty';

export type DisplayConjunction = 'and' | 'or';

export interface DisplayCondition {
  fieldId: string;
  operator: DisplayConditionOperator;
  value?: unknown;
}

/** Nested AND/OR group — same shape as view FilterGroup, form-operator subset. */
export interface DisplayConditionRule {
  conjunction: DisplayConjunction;
  conditions: DisplayConditionNode[];
}

export type DisplayConditionNode = DisplayCondition | DisplayConditionRule;

/** One form field: which sheet field, required rule, and field-level visibility. */
export interface FormFieldConfig {
  fieldId: string;
  required?: boolean;
  /** @deprecated flat AND list; prefer `displayRule`. Still evaluated as AND. */
  displayConditions?: DisplayCondition[];
  /** Nested 与/或 rule (arbitrary combination). */
  displayRule?: DisplayConditionRule;
}

export function isDisplayConditionRule(
  node: DisplayConditionNode | null | undefined,
): node is DisplayConditionRule {
  return Boolean(
    node &&
      typeof node === 'object' &&
      Array.isArray((node as DisplayConditionRule).conditions),
  );
}

export function isDisplayConditionLeaf(
  node: DisplayConditionNode,
): node is DisplayCondition {
  return !isDisplayConditionRule(node);
}

/** Empty rule → null (always visible). Legacy flat list → AND group. */
export function normalizeDisplayRule(
  field: Pick<FormFieldConfig, 'displayRule' | 'displayConditions'>,
): DisplayConditionRule | null {
  if (field.displayRule && field.displayRule.conditions.length > 0) {
    return field.displayRule;
  }
  if (field.displayConditions && field.displayConditions.length > 0) {
    return {
      conjunction: 'and',
      conditions: field.displayConditions.map((item) => ({ ...item })),
    };
  }
  return null;
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((item) => String(item)).join(',');
  return String(value);
}

export function evaluateDisplayConditionLeaf(
  condition: DisplayCondition,
  values: Record<string, unknown>,
): boolean {
  const actual = asText(values[condition.fieldId]);
  const expected = asText(condition.value);

  switch (condition.operator) {
    case 'equals':
      return actual === expected;
    case 'notEquals':
      return actual !== expected;
    case 'contains':
      return actual.includes(expected);
    case 'notEmpty':
      return actual !== '';
    case 'isEmpty':
      return actual === '';
    default:
      return false;
  }
}

export function evaluateDisplayRule(
  rule: DisplayConditionRule | null | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!rule || rule.conditions.length === 0) return true;
  const evaluateNode = (node: DisplayConditionNode): boolean => {
    if (isDisplayConditionRule(node)) {
      return evaluateDisplayRule(node, values);
    }
    return evaluateDisplayConditionLeaf(node, values);
  };
  return rule.conjunction === 'or'
    ? rule.conditions.some(evaluateNode)
    : rule.conditions.every(evaluateNode);
}

/** @deprecated Prefer evaluateDisplayRule; flat list is AND. */
export function evaluateDisplayConditions(
  conditions: DisplayCondition[] | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!conditions || conditions.length === 0) return true;
  return evaluateDisplayRule(
    { conjunction: 'and', conditions },
    values,
  );
}

export function isFormFieldVisible(
  field: FormFieldConfig,
  values: Record<string, unknown>,
): boolean {
  return evaluateDisplayRule(normalizeDisplayRule(field), values);
}

/** Walk every leaf condition (for reverse index / tags). */
export function walkDisplayConditionLeaves(
  field: Pick<FormFieldConfig, 'displayRule' | 'displayConditions'>,
): DisplayCondition[] {
  const rule = normalizeDisplayRule(field);
  if (!rule) return [];
  const leaves: DisplayCondition[] = [];
  const walk = (node: DisplayConditionNode): void => {
    if (isDisplayConditionRule(node)) {
      for (const child of node.conditions) walk(child);
      return;
    }
    leaves.push(node);
  };
  walk(rule);
  return leaves;
}

/** Trigger fieldId → form fieldIds that reference it in display rules. */
export function dependentsByTrigger(
  fields: FormFieldConfig[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const field of fields) {
    for (const condition of walkDisplayConditionLeaves(field)) {
      if (!condition.fieldId) continue;
      const list = map.get(condition.fieldId) ?? [];
      if (!list.includes(field.fieldId)) list.push(field.fieldId);
      map.set(condition.fieldId, list);
    }
  }
  return map;
}

const DEFAULT_OPERATOR_LABELS: Record<DisplayConditionOperator, string> = {
  equals: '等于',
  notEquals: '不等于',
  contains: '包含',
  notEmpty: '不为空',
  isEmpty: '为空',
};

/** Blue tag: one outbound leaf condition. */
export function formatOutboundConditionLabel(
  condition: DisplayCondition,
  nameOf: (fieldId: string) => string,
  operatorLabels: Record<
    DisplayConditionOperator,
    string
  > = DEFAULT_OPERATOR_LABELS,
): string {
  const name = condition.fieldId ? nameOf(condition.fieldId) : '（未选字段）';
  const op = operatorLabels[condition.operator] ?? condition.operator;
  if (condition.operator === 'notEmpty' || condition.operator === 'isEmpty') {
    return `依赖 · ${name} ${op}`;
  }
  const value = asText(condition.value);
  return value ? `依赖 · ${name} ${op} ${value}` : `依赖 · ${name} ${op}`;
}

/**
 * Orange tag: who depends on this field.
 * ≤3 names joined with 、; more → first 2 + `等 N 个`.
 */
export function formatInboundDependentsLabel(
  dependentNames: string[],
): string | null {
  if (dependentNames.length === 0) return null;
  if (dependentNames.length <= 3) {
    return `被依赖 · ${dependentNames.join('、')}`;
  }
  return `被依赖 · ${dependentNames.slice(0, 2).join('、')} 等 ${dependentNames.length} 个`;
}

/** Short conjunction chip for tags, e.g. `且` / `或`. */
export function formatDisplayRuleConjunctionLabel(
  field: Pick<FormFieldConfig, 'displayRule' | 'displayConditions'>,
): string | null {
  const rule = normalizeDisplayRule(field);
  if (!rule || rule.conditions.length < 2) return null;
  return rule.conjunction === 'or' ? '满足任一' : '全部满足';
}

/** Fields to lightly highlight when `selectedFieldId` is active (excludes self). */
export function relatedDisplayFieldIds(
  selectedFieldId: string,
  fields: FormFieldConfig[],
): Set<string> {
  const related = new Set<string>();
  if (!selectedFieldId) return related;

  const selected = fields.find((item) => item.fieldId === selectedFieldId);
  if (selected) {
    for (const condition of walkDisplayConditionLeaves(selected)) {
      if (condition.fieldId) related.add(condition.fieldId);
    }
  }

  const inbound = dependentsByTrigger(fields).get(selectedFieldId) ?? [];
  for (const fieldId of inbound) related.add(fieldId);

  related.delete(selectedFieldId);
  return related;
}

export function emptyDisplayRule(
  conjunction: DisplayConjunction = 'and',
): DisplayConditionRule {
  return { conjunction, conditions: [] };
}

export function emptyDisplayCondition(): DisplayCondition {
  return { fieldId: '', operator: 'equals', value: '' };
}

export function emptyDisplayGroup(
  conjunction: DisplayConjunction = 'or',
): DisplayConditionRule {
  return {
    conjunction,
    conditions: [emptyDisplayCondition()],
  };
}

/** Max nesting depth for editor (root = 0). */
export const DISPLAY_RULE_MAX_DEPTH = 2;
