import type {
  FilterCondition,
  FilterGroup,
  FilterNode,
  FilterOperator,
} from './view-query';

function textOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((item) => String(item)).join(',');
  return String(value);
}

function isEmptyValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function compare(actual: unknown, expected: unknown): number {
  const left = numeric(actual);
  const right = numeric(expected);
  if (left !== null && right !== null) return left - right;
  return textOf(actual).localeCompare(textOf(expected), 'zh-Hans-CN');
}

export function evaluateFilterCondition(
  condition: FilterCondition,
  values: Record<string, unknown>,
): boolean {
  const actual = values[condition.fieldId];
  const expected = condition.value;
  const operator: FilterOperator = condition.operator;

  switch (operator) {
    case 'equals':
      return textOf(actual) === textOf(expected);
    case 'notEquals':
      return textOf(actual) !== textOf(expected);
    case 'contains':
      return textOf(actual).includes(textOf(expected));
    case 'notContains':
      return !textOf(actual).includes(textOf(expected));
    case 'isEmpty':
      return isEmptyValue(actual);
    case 'isNotEmpty':
      return !isEmptyValue(actual);
    case 'gt':
      return compare(actual, expected) > 0;
    case 'gte':
      return compare(actual, expected) >= 0;
    case 'lt':
      return compare(actual, expected) < 0;
    case 'lte':
      return compare(actual, expected) <= 0;
    case 'between': {
      if (!Array.isArray(expected) || expected.length !== 2) return false;
      return (
        compare(actual, expected[0]) >= 0 && compare(actual, expected[1]) <= 0
      );
    }
    case 'in':
      return Array.isArray(expected)
        ? expected.some((item) => textOf(item) === textOf(actual))
        : false;
    case 'notIn':
      return Array.isArray(expected)
        ? !expected.some((item) => textOf(item) === textOf(actual))
        : false;
    case 'isTrue':
      return actual === true || actual === 'true' || actual === '是';
    case 'isFalse':
      return actual === false || actual === 'false' || actual === '否';
    case 'before':
      return (
        new Date(textOf(actual)).getTime() < new Date(textOf(expected)).getTime()
      );
    case 'after':
      return (
        new Date(textOf(actual)).getTime() > new Date(textOf(expected)).getTime()
      );
    default:
      return false;
  }
}

function evaluateNode(
  node: FilterNode,
  values: Record<string, unknown>,
): boolean {
  if (Array.isArray((node as FilterGroup).conditions)) {
    return evaluateFilterGroup(node as FilterGroup, values);
  }
  return evaluateFilterCondition(node as FilterCondition, values);
}

export function evaluateFilterGroup(
  group: FilterGroup,
  values: Record<string, unknown>,
): boolean {
  if (!group.conditions || group.conditions.length === 0) return true;
  return group.conjunction === 'or'
    ? group.conditions.some((node) => evaluateNode(node, values))
    : group.conditions.every((node) => evaluateNode(node, values));
}
