export type FilterConjunction = 'and' | 'or';

/** Operators shown in the trigger / find-record condition editors. */
export type FilterOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'in'
  | 'notIn'
  | 'isTrue'
  | 'isFalse'
  | 'before'
  | 'after';

/** Operators that ignore the comparison value. */
export const VALUELESS_FILTER_OPERATORS: readonly FilterOperator[] = [
  'isEmpty',
  'isNotEmpty',
  'isTrue',
  'isFalse',
];

export interface FilterCondition {
  fieldId: string;
  operator: FilterOperator;
  value?: unknown;
}

export interface FilterGroup {
  conjunction: FilterConjunction;
  conditions: FilterNode[];
}

export type FilterNode = FilterCondition | FilterGroup;

export function isFilterGroup(node: FilterNode): node is FilterGroup {
  return Array.isArray((node as FilterGroup).conditions);
}

export type SortDirection = 'asc' | 'desc';
export type SortMode = 'value' | 'option' | 'natural';

export interface SortSpec {
  fieldId: string;
  direction: SortDirection;
  /** Match WeCom's "排序依据：横轴值 / 选项正序". Defaults to value sort. */
  mode?: SortMode;
}

export interface GroupSpec {
  fieldId: string;
  direction?: SortDirection;
}

export interface ColorRule {
  id?: string;
  fieldId: string;
  operator: FilterOperator;
  value?: unknown;
  color: string;
  scope?: 'row' | 'cell';
}

export type RowHeight = 'short' | 'medium' | 'tall' | { custom: number };

export interface ViewQuery {
  filters?: FilterGroup;
  groups?: GroupSpec[];
  sorts?: SortSpec[];
  rowHeight?: RowHeight;
  colorRules?: ColorRule[];
}

export const DEFAULT_RECORD_PAGE_LIMIT = 50;
export const MAX_RECORD_PAGE_LIMIT = 200;

export function resolveRecordPageLimit(limit?: number): number {
  if (limit === undefined || limit === null || !Number.isFinite(limit)) {
    return DEFAULT_RECORD_PAGE_LIMIT;
  }
  return Math.min(Math.max(Math.floor(limit), 1), MAX_RECORD_PAGE_LIMIT);
}
