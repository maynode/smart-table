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
  /**
   * WeCom-aligned sort basis (defaults to `value`):
   * - `value` — cell text / numeric value
   * - `option` — index in field.options.choices（选项正序）
   * - `natural` — alphanumeric natural order（自然语言序，如 a2 < a10）
   */
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
  /** Number of leading data columns kept fixed while scrolling horizontally. */
  freezeColumnCount?: number;
  /** 全表关键字检索（服务端 cells JSON 文本匹配，非仅已加载行）. */
  search?: string;
}

/** 首屏批次；后续由前端静默续拉，不暴露分页 UI（对齐表格全量滚动模型）. */
export const DEFAULT_RECORD_PAGE_LIMIT = 200;
/** 单次 HTTP 批次上限（内部续拉用，不是「第 N 页」）. */
export const MAX_RECORD_PAGE_LIMIT = 2000;

export function resolveRecordPageLimit(limit?: number): number {
  if (limit === undefined || limit === null || !Number.isFinite(limit)) {
    return DEFAULT_RECORD_PAGE_LIMIT;
  }
  return Math.min(Math.max(Math.floor(limit), 1), MAX_RECORD_PAGE_LIMIT);
}
