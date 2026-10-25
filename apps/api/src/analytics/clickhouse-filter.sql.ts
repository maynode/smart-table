import type { FilterCondition, FilterGroup, FilterNode } from 'shared';

function textOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((item) => String(item)).join(',');
  return String(value);
}

function escapeLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function cellExpr(fieldId: string, escape: (s: string) => string): string {
  return `JSONExtractString(cells, '${escape(fieldId)}')`;
}

function numericExpr(fieldId: string, escape: (s: string) => string): string {
  return `toFloat64OrZero(${cellExpr(fieldId, escape)})`;
}

function nodeSql(
  node: FilterNode,
  escape: (s: string) => string,
): string {
  if (Array.isArray((node as FilterGroup).conditions)) {
    return buildClickHouseFilterSql(node as FilterGroup, escape);
  }

  const condition = node as FilterCondition;
  const value = cellExpr(condition.fieldId, escape);
  const expected = condition.value;

  switch (condition.operator) {
    case 'equals':
      return `${value} = '${escape(textOf(expected))}'`;
    case 'notEquals':
      return `${value} != '${escape(textOf(expected))}'`;
    case 'contains':
      return `positionCaseInsensitive(${value}, '${escape(textOf(expected))}') > 0`;
    case 'notContains':
      return `positionCaseInsensitive(${value}, '${escape(textOf(expected))}') = 0`;
    case 'isEmpty':
      return `(${value} = '' OR ${value} IS NULL)`;
    case 'isNotEmpty':
      return `(${value} != '' AND ${value} IS NOT NULL)`;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const op =
        { gt: '>', gte: '>=', lt: '<', lte: '<=' }[condition.operator] ?? '>';
      if (Number.isFinite(Number(expected))) {
        return `${numericExpr(condition.fieldId, escape)} ${op} ${Number(expected)}`;
      }
      return `${value} ${op} '${escape(textOf(expected))}'`;
    }
    case 'between': {
      if (!Array.isArray(expected) || expected.length !== 2) return '1';
      return `${numericExpr(condition.fieldId, escape)} BETWEEN ${Number(expected[0])} AND ${Number(expected[1])}`;
    }
    case 'in': {
      const items = Array.isArray(expected) ? expected : [expected];
      if (items.length === 0) return '0';
      return `${value} IN (${items
        .map((item) => `'${escape(textOf(item))}'`)
        .join(', ')})`;
    }
    case 'notIn': {
      const items = Array.isArray(expected) ? expected : [expected];
      if (items.length === 0) return '1';
      return `${value} NOT IN (${items
        .map((item) => `'${escape(textOf(item))}'`)
        .join(', ')})`;
    }
    case 'isTrue':
      return `${value} IN ('true', '1', '是')`;
    case 'isFalse':
      return `${value} IN ('false', '0', '否')`;
    case 'before':
      return `parseDateTimeBestEffortOrNull(${value}) < parseDateTimeBestEffortOrNull('${escape(textOf(expected))}')`;
    case 'after':
      return `parseDateTimeBestEffortOrNull(${value}) > parseDateTimeBestEffortOrNull('${escape(textOf(expected))}')`;
    default:
      return '1';
  }
}

/** Translates shared FilterGroup into a ClickHouse WHERE predicate (String cells JSON). */
export function buildClickHouseFilterSql(
  group: FilterGroup,
  escape: (s: string) => string = escapeLiteral,
): string {
  if (!group.conditions || group.conditions.length === 0) {
    return '1';
  }
  const parts = group.conditions.map((node) => nodeSql(node, escape));
  const joiner = group.conjunction === 'or' ? ' OR ' : ' AND ';
  return `(${parts.join(joiner)})`;
}
