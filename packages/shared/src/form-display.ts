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
