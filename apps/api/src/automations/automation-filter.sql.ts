import { Prisma } from '@prisma/client';
import type {
  FilterCondition,
  FilterGroup,
  FilterNode,
  SortSpec,
} from 'shared';

/** Minimal field shape needed to resolve option / natural sort keys. */
export interface SortFieldMeta {
  id: string;
  type?: string;
  options?: {
    choices?: Array<{ id?: unknown; name?: unknown }>;
    aiComponent?: {
      gridContract?: {
        sortKey?: { path?: string; type?: string };
        filter?: { path?: string; valueType?: string };
      };
    };
  } | null;
}

function textOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((item) => String(item)).join(',');
  return String(value);
}

function expression(fieldId: string, field?: SortFieldMeta): Prisma.Sql {
  if (field?.type === 'aiComponent') {
    const path =
      field.options?.aiComponent?.gridContract?.filter?.path ??
      field.options?.aiComponent?.gridContract?.sortKey?.path ??
      '';
    if (path.trim()) {
      return Prisma.sql`(cells->${fieldId}->>${path})`;
    }
  }
  return Prisma.sql`(cells->>${fieldId})`;
}

function numericExpression(fieldId: string, field?: SortFieldMeta): Prisma.Sql {
  if (field?.type === 'aiComponent') {
    const path =
      field.options?.aiComponent?.gridContract?.filter?.path ??
      field.options?.aiComponent?.gridContract?.sortKey?.path ??
      '';
    const valueType =
      field.options?.aiComponent?.gridContract?.filter?.valueType ??
      field.options?.aiComponent?.gridContract?.sortKey?.type;
    if (path.trim() && valueType === 'number') {
      return Prisma.sql`NULLIF(cells->${fieldId}->>${path}, '')::numeric`;
    }
  }
  return Prisma.sql`NULLIF(cells->>${fieldId}, '')::numeric`;
}

/**
 * Cell sort key: single-select / text use `->>`; multiSelect JSON arrays use
 * the first element so option-order matches the primary pill.
 */
function cellSortKey(fieldId: string): Prisma.Sql {
  return Prisma.sql`COALESCE(
    CASE
      WHEN jsonb_typeof(cells->${fieldId}) = 'array' THEN cells->${fieldId}->>0
      ELSE NULL
    END,
    cells->>${fieldId}
  )`;
}

function directionRaw(direction: SortSpec['direction']): Prisma.Sql {
  return Prisma.raw(direction === 'desc' ? 'DESC' : 'ASC');
}

/**
 * WeCom「选项正序」: order by index in field.options.choices.
 * Matches choice id or display name; unknowns / empty sort last on ASC.
 */
function optionOrderExpression(
  fieldId: string,
  field?: SortFieldMeta,
): Prisma.Sql {
  const choices = field?.options?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return cellSortKey(fieldId);
  }

  const key = cellSortKey(fieldId);
  const whens: Prisma.Sql[] = [];
  choices.forEach((choice, index) => {
    const id = textOf(choice.id);
    const name = textOf(choice.name);
    if (id) {
      whens.push(Prisma.sql`WHEN ${key} = ${id} THEN ${index}`);
    }
    if (name && name !== id) {
      whens.push(Prisma.sql`WHEN ${key} = ${name} THEN ${index}`);
    }
  });

  if (whens.length === 0) {
    return cellSortKey(fieldId);
  }

  return Prisma.sql`(CASE ${Prisma.join(whens, ' ')} ELSE 2147483647 END)`;
}

/**
 * Natural / alphanumeric order: digit runs zero-padded so a2 < a10.
 * Uses regexp_matches (not split_to_table) so digit captures are kept.
 * Empty values sort last via ASC NULLS LAST.
 */
function naturalOrderExpression(fieldId: string): Prisma.Sql {
  const key = cellSortKey(fieldId);
  return Prisma.sql`(
    SELECT string_agg(
      CASE
        WHEN m[1] IS NOT NULL AND m[1] <> '' THEN lpad(m[1], 20, '0')
        ELSE lower(COALESCE(m[2], ''))
      END,
      ''
      ORDER BY ord
    )
    FROM regexp_matches(COALESCE(${key}, ''), '([0-9]+)|([^0-9]+)', 'g')
      WITH ORDINALITY AS t(m, ord)
  )`;
}

function valueOrderExpression(
  fieldId: string,
  field?: SortFieldMeta,
): Prisma.Sql {
  if (field?.type === 'aiComponent') {
    const path = field.options?.aiComponent?.gridContract?.sortKey?.path ?? '';
    const sortType =
      field.options?.aiComponent?.gridContract?.sortKey?.type ?? 'string';
    if (path.trim()) {
      if (sortType === 'number') {
        return Prisma.sql`NULLIF(cells->${fieldId}->>${path}, '')::numeric`;
      }
      if (sortType === 'boolean') {
        return Prisma.sql`(CASE
          WHEN cells->${fieldId}->>${path} IN ('true','1','是') THEN 1
          WHEN cells->${fieldId}->>${path} IN ('false','0','否') THEN 0
          ELSE NULL END)`;
      }
      return Prisma.sql`(cells->${fieldId}->>${path})`;
    }
  }
  const numericTypes = new Set([
    'number',
    'percent',
    'currency',
    'progress',
    'autoNumber',
  ]);
  if (field?.type && numericTypes.has(field.type)) {
    return numericExpression(fieldId, field);
  }
  return cellSortKey(fieldId);
}

function sortClause(
  sort: SortSpec,
  fieldsById?: Map<string, SortFieldMeta>,
): Prisma.Sql {
  const field = fieldsById?.get(sort.fieldId);
  const mode = sort.mode ?? 'value';
  const dir = directionRaw(sort.direction);

  let expr: Prisma.Sql;
  if (mode === 'option') {
    expr = optionOrderExpression(sort.fieldId, field);
  } else if (mode === 'natural') {
    expr = naturalOrderExpression(sort.fieldId);
  } else {
    expr = valueOrderExpression(sort.fieldId, field);
  }

  return Prisma.sql`${expr} ${dir} NULLS LAST`;
}

function nodeSql(
  node: FilterNode,
  fieldsById?: Map<string, SortFieldMeta>,
): Prisma.Sql {
  if (Array.isArray((node as FilterGroup).conditions)) {
    return buildFilterSql(node as FilterGroup, fieldsById);
  }

  const condition = node as FilterCondition;
  const field = fieldsById?.get(condition.fieldId);
  const value = expression(condition.fieldId, field);
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
      const numeric = numericExpression(condition.fieldId, field);
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
      return Prisma.sql`${numericExpression(condition.fieldId, field)} BETWEEN ${Number(expected[0])} AND ${Number(expected[1])}`;
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
export function buildFilterSql(
  group: FilterGroup,
  fields?: SortFieldMeta[] | Map<string, SortFieldMeta>,
): Prisma.Sql {
  if (!group.conditions || group.conditions.length === 0) {
    return Prisma.sql`TRUE`;
  }
  const fieldsById = Array.isArray(fields)
    ? new Map(fields.map((field) => [field.id, field]))
    : fields;
  const parts = group.conditions.map((node) => nodeSql(node, fieldsById));
  const joiner = group.conjunction === 'or' ? ' OR ' : ' AND ';
  return Prisma.sql`(${Prisma.join(parts, joiner)})`;
}

/**
 * Builds ORDER BY for view / findRecords.
 * @param fields optional field metadata — required for accurate `option` mode
 *   (choice index) and numeric `value` mode.
 */
export function buildSortSql(
  sorts?: SortSpec[],
  fields?: SortFieldMeta[],
): Prisma.Sql {
  if (!sorts || sorts.length === 0) {
    return Prisma.sql`ORDER BY id ASC`;
  }
  const fieldsById = fields
    ? new Map(fields.map((field) => [field.id, field]))
    : undefined;
  const parts = sorts.map((sort) => sortClause(sort, fieldsById));
  return Prisma.sql`ORDER BY ${Prisma.join(parts, ', ')}, id ASC`;
}
