export type AggregateMode = 'sum' | 'count' | 'avg' | 'min' | 'max';

export interface AnalyticsQuery {
  sheetId: string;
  dimensionFieldId: string;
  metricFieldId?: string;
  aggregation: AggregateMode;
  limit?: number;
}

export interface AnalyticsRow {
  label: string;
  value: number;
}

export interface AnalyticsQueryPort {
  query(request: AnalyticsQuery): Promise<AnalyticsRow[]>;
}

export const ANALYTICS_QUERY_PORT = Symbol('ANALYTICS_QUERY_PORT');
