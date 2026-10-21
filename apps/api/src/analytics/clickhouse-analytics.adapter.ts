import type {
  AggregateMode,
  AnalyticsQuery,
  AnalyticsQueryPort,
  AnalyticsRow,
} from './analytics.types';

type Fetcher = typeof fetch;

export interface ClickHouseOptions {
  url: string;
  database?: string;
  username?: string;
  password?: string;
  fetcher?: Fetcher;
}

const MODES: readonly AggregateMode[] = ['sum', 'count', 'avg', 'min', 'max'];

/**
 * ClickHouse adapter for the analytics port. The compose profile creates a
 * `records` table with `sheet_id` and JSON `cells`; this adapter keeps the SQL
 * shape identical to the Postgres adapter so switching is configuration only.
 */
export class ClickHouseAnalyticsAdapter implements AnalyticsQueryPort {
  private readonly fetcher: Fetcher;

  constructor(private readonly options: ClickHouseOptions) {
    this.fetcher = options.fetcher ?? fetch;
  }

  async query(request: AnalyticsQuery): Promise<AnalyticsRow[]> {
    const mode = MODES.includes(request.aggregation)
      ? request.aggregation
      : 'count';
    const metric = request.metricFieldId ?? request.dimensionFieldId;
    const aggregation =
      mode === 'count'
        ? 'count()'
        : `${mode}(toFloat64OrZero(JSONExtractString(cells, '${this.escape(metric)}')))`;
    const limit = Math.min(Math.max(request.limit ?? 20, 1), 100);
    const sql = [
      `SELECT JSONExtractString(cells, '${this.escape(request.dimensionFieldId)}') AS label,`,
      `${aggregation} AS value`,
      'FROM records',
      `WHERE sheet_id = '${this.escape(request.sheetId)}'`,
      'GROUP BY label',
      'ORDER BY value DESC',
      `LIMIT ${limit}`,
      'FORMAT JSON',
    ].join(' ');

    const params = new URLSearchParams();
    if (this.options.database) params.set('database', this.options.database);
    const url = `${this.options.url.replace(/\/$/, '')}/?${params.toString()}`;
    const headers: Record<string, string> = {
      'Content-Type': 'text/plain; charset=utf-8',
    };
    if (this.options.username) {
      headers['X-ClickHouse-User'] = this.options.username;
    }
    if (this.options.password) {
      headers['X-ClickHouse-Key'] = this.options.password;
    }

    const response = await this.fetcher(url, {
      method: 'POST',
      headers,
      body: sql,
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`ClickHouse query failed: ${response.status} ${message}`);
    }
    const payload = (await response.json()) as {
      data?: Array<{ label?: unknown; value?: unknown }>;
    };
    return (payload.data ?? []).map((row) => ({
      label: String(row.label ?? '(空)') || '(空)',
      value: Number(row.value ?? 0),
    }));
  }

  private escape(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }
}
