export type DisplayConditionOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notEmpty'
  | 'isEmpty';

export interface DisplayCondition {
  fieldId: string;
  operator: DisplayConditionOperator;
  value?: unknown;
}

/** One form field: which sheet field, required rule, and field-level visibility. */
export interface FormFieldConfig {
  fieldId: string;
  required?: boolean;
  displayConditions?: DisplayCondition[];
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((item) => String(item)).join(',');
  return String(value);
}

export function evaluateDisplayConditions(
  conditions: DisplayCondition[] | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!conditions || conditions.length === 0) return true;

  return conditions.every((condition) => {
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
  });
}

export function isFormFieldVisible(
  field: FormFieldConfig,
  values: Record<string, unknown>,
): boolean {
  return evaluateDisplayConditions(field.displayConditions, values);
}

/** Trigger fieldId → form fieldIds that list it in displayConditions. */
export function dependentsByTrigger(
  fields: FormFieldConfig[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const field of fields) {
    for (const condition of field.displayConditions ?? []) {
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

/** Blue tag: one outbound condition on the controlled field. */
export function formatOutboundConditionLabel(
  condition: DisplayCondition,
  nameOf: (fieldId: string) => string,
  operatorLabels: Record<DisplayConditionOperator, string> = DEFAULT_OPERATOR_LABELS,
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

/** Fields to lightly highlight when `selectedFieldId` is active (excludes self). */
export function relatedDisplayFieldIds(
  selectedFieldId: string,
  fields: FormFieldConfig[],
): Set<string> {
  const related = new Set<string>();
  if (!selectedFieldId) return related;

  const selected = fields.find((item) => item.fieldId === selectedFieldId);
  for (const condition of selected?.displayConditions ?? []) {
    if (condition.fieldId) related.add(condition.fieldId);
  }

  const inbound = dependentsByTrigger(fields).get(selectedFieldId) ?? [];
  for (const fieldId of inbound) related.add(fieldId);

  related.delete(selectedFieldId);
  return related;
}
