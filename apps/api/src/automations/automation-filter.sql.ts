import { Prisma } from '@prisma/client';
import type {
  FilterCondition,
  FilterGroup,
  FilterNode,
  SortSpec,
} from 'shared';

function textOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((item) => String(item)).join(',');
  return String(value);
}

function expression(fieldId: string): Prisma.Sql {
  return Prisma.sql`(cells->>${fieldId})`;
}

function numericExpression(fieldId: string): Prisma.Sql {
  return Prisma.sql`NULLIF(cells->>${fieldId}, '')::numeric`;
}

function nodeSql(node: FilterNode): Prisma.Sql {
  if (Array.isArray((node as FilterGroup).conditions)) {
    return buildFilterSql(node as FilterGroup);
  }

  const condition = node as FilterCondition;
  const value = expression(condition.fieldId);
  const expected = condition.value;

  switch (condition.operator) {
    case 'equals':
      return Prisma.sql`${value} = ${textOf(expected)}`;
    case 'notEquals':
      return Prisma.sql`(${value} IS DISTINCT FROM ${textOf(expected)})`;
    case 'contains':
      return Prisma.sql`${value} ILIKE ${`%${textOf(expected)}%`}`;
    case 'notContains':
      return Prisma.sql`(${value} IS NULL OR ${value} NOT ILIKE ${`%${textOf(expected)}%`})`;
    case 'isEmpty':
      return Prisma.sql`(${value} IS NULL OR ${value} = '')`;
    case 'isNotEmpty':
      return Prisma.sql`(${value} IS NOT NULL AND ${value} <> '')`;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const numeric = numericExpression(condition.fieldId);
      if (Number.isFinite(Number(expected))) {
        const operator = Prisma.raw(
          { gt: '>', gte: '>=', lt: '<', lte: '<=' }[condition.operator],
        );
        return Prisma.sql`${numeric} ${operator} ${Number(expected)}`;
      }
      const operator = Prisma.raw(
        { gt: '>', gte: '>=', lt: '<', lte: '<=' }[condition.operator],
      );
      return Prisma.sql`${value} ${operator} ${textOf(expected)}`;
    }
    case 'between': {
      if (!Array.isArray(expected) || expected.length !== 2) {
        return Prisma.sql`TRUE`;
      }
      return Prisma.sql`${numericExpression(condition.fieldId)} BETWEEN ${Number(expected[0])} AND ${Number(expected[1])}`;
    }
    case 'in': {
      const items = Array.isArray(expected) ? expected : [expected];
      if (items.length === 0) return Prisma.sql`FALSE`;
      return Prisma.sql`${value} IN (${Prisma.join(
        items.map((item) => Prisma.sql`${textOf(item)}`),
      )})`;
    }
    case 'notIn': {
      const items = Array.isArray(expected) ? expected : [expected];
      if (items.length === 0) return Prisma.sql`TRUE`;
      return Prisma.sql`(${value} IS NULL OR ${value} NOT IN (${Prisma.join(
        items.map((item) => Prisma.sql`${textOf(item)}`),
      )}))`;
    }
    case 'isTrue':
      return Prisma.sql`${value} IN ('true', '1', '是')`;
    case 'isFalse':
      return Prisma.sql`${value} IN ('false', '0', '否')`;
    case 'before':
      return Prisma.sql`${value}::timestamptz < ${new Date(textOf(expected))}`;
    case 'after':
      return Prisma.sql`${value}::timestamptz > ${new Date(textOf(expected))}`;
    default:
      return Prisma.sql`TRUE`;
  }
}

/** Translates a shared FilterGroup into a parameterized JSONB predicate. */
export function buildFilterSql(group: FilterGroup): Prisma.Sql {
  if (!group.conditions || group.conditions.length === 0) {
    return Prisma.sql`TRUE`;
  }
  const parts = group.conditions.map((node) => nodeSql(node));
  const joiner = group.conjunction === 'or' ? ' OR ' : ' AND ';
  return Prisma.sql`(${Prisma.join(parts, joiner)})`;
}

export function buildSortSql(sorts?: SortSpec[]): Prisma.Sql {
  if (!sorts || sorts.length === 0) {
    return Prisma.sql`ORDER BY id ASC`;
  }
  const parts = sorts.map(
    (sort) =>
      Prisma.sql`cells->>${sort.fieldId} ${Prisma.raw(
        sort.direction === 'desc' ? 'DESC' : 'ASC',
      )}`,
  );
  return Prisma.sql`ORDER BY ${Prisma.join(parts, ', ')}, id ASC`;
}
