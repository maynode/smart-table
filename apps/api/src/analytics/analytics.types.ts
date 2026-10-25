import type { FilterGroup } from 'shared';

export type AggregateMode = 'sum' | 'count' | 'avg' | 'min' | 'max';

export interface AnalyticsQuery {
  sheetId: string;
  /** 省略时返回单行总量（指标卡） */
  dimensionFieldId?: string;
  metricFieldId?: string;
  aggregation: AggregateMode;
  limit?: number;
  /** 默认按聚合值 */
  sortBy?: 'value' | 'label';
  /** 默认 desc（值大在前） */
  sortOrder?: 'asc' | 'desc';
  /** 可选：按 records.created_at 过滤（指标对比期） */
  createdAtFrom?: Date;
  createdAtTo?: Date;
  /** 可选：记录级筛选（与视图筛选同一套 FilterGroup） */
  filters?: FilterGroup;
}

export interface AnalyticsRow {
  label: string;
  value: number;
}

export interface AnalyticsQueryPort {
  query(request: AnalyticsQuery): Promise<AnalyticsRow[]>;
}

export const ANALYTICS_QUERY_PORT = Symbol('ANALYTICS_QUERY_PORT');
