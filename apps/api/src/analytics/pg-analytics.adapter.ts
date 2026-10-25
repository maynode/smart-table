import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildFilterSql } from '../automations/automation-filter.sql';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AggregateMode,
  AnalyticsQuery,
  AnalyticsQueryPort,
  AnalyticsRow,
} from './analytics.types';

const MODES: readonly AggregateMode[] = ['sum', 'count', 'avg', 'min', 'max'];

@Injectable()
export class PgAnalyticsAdapter implements AnalyticsQueryPort {
  constructor(private readonly prisma: PrismaService) {}

  async query(request: AnalyticsQuery): Promise<AnalyticsRow[]> {
    const mode = MODES.includes(request.aggregation)
      ? request.aggregation
      : 'count';
    const dimension = request.dimensionFieldId;
    const metric = request.metricFieldId ?? request.dimensionFieldId;
    const limit = Math.min(Math.max(request.limit ?? 20, 1), 100);
    const sortBy = request.sortBy === 'label' ? 'label' : 'value';
    const sortAsc = request.sortOrder === 'asc';
    const orderClause =
      sortBy === 'label'
        ? sortAsc
          ? Prisma.sql`ORDER BY label ASC`
          : Prisma.sql`ORDER BY label DESC`
        : sortAsc
          ? Prisma.sql`ORDER BY value ASC`
          : Prisma.sql`ORDER BY value DESC`;

    const aggregation = this.aggregationSql(mode, metric);
    const from = request.createdAtFrom;
    const to = request.createdAtTo;
    const filterSql = request.filters
      ? buildFilterSql(request.filters)
      : Prisma.sql`TRUE`;
    const timeSql =
      from && to
        ? Prisma.sql`"created_at" >= ${from} AND "created_at" < ${to}`
        : Prisma.sql`TRUE`;

    if (!dimension) {
      const rows = await this.prisma.$queryRaw<
        Array<{ value: number | string | null }>
      >(Prisma.sql`
        SELECT ${aggregation} AS value
        FROM "records"
        WHERE "sheet_id" = ${request.sheetId}::uuid
          AND (${filterSql})
          AND (${timeSql})
      `);
      return [
        {
          label: '全部',
          value: Number(rows[0]?.value ?? 0),
        },
      ];
    }

    const rows = await this.prisma.$queryRaw<
      Array<{ label: string | null; value: number | string | null }>
    >(Prisma.sql`
      SELECT COALESCE(NULLIF(cells->>${dimension}, ''), '(空)') AS label,
             ${aggregation} AS value
      FROM "records"
      WHERE "sheet_id" = ${request.sheetId}::uuid
        AND (${filterSql})
        AND (${timeSql})
      GROUP BY 1
      ${orderClause}
      LIMIT ${limit}
    `);

    return rows.map((row) => ({
      label: String(row.label ?? '(空)'),
      value: Number(row.value ?? 0),
    }));
  }

  /** Daily buckets for metric sparkline (created_at). */
  async queryTrend(
    request: AnalyticsQuery & { days: number },
  ): Promise<AnalyticsRow[]> {
    const mode = MODES.includes(request.aggregation)
      ? request.aggregation
      : 'count';
    const metric = request.metricFieldId ?? request.dimensionFieldId;
    const days = Math.min(Math.max(request.days, 1), 90);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const aggregation = this.aggregationSql(mode, metric);

    const rows = await this.prisma.$queryRaw<
      Array<{ label: string; value: number | string | null }>
    >(
      Prisma.sql`
        SELECT to_char(date_trunc('day', "created_at"), 'MM-DD') AS label,
               ${aggregation} AS value
        FROM "records"
        WHERE "sheet_id" = ${request.sheetId}::uuid
          AND "created_at" >= ${from}
        GROUP BY date_trunc('day', "created_at")
        ORDER BY date_trunc('day', "created_at") ASC
      `,
    );

    return rows.map((row) => ({
      label: String(row.label),
      value: Number(row.value ?? 0),
    }));
  }

  private aggregationSql(
    mode: AggregateMode,
    metric: string | undefined,
  ): Prisma.Sql {
    if (mode === 'count' || !metric) {
      return Prisma.sql`COUNT(*)::float8`;
    }
    if (mode === 'sum') {
      return Prisma.sql`COALESCE(SUM(NULLIF(regexp_replace(cells->>${metric}, '[^0-9.\\-]', '', 'g'), '')::numeric), 0)::float8`;
    }
    if (mode === 'avg') {
      return Prisma.sql`COALESCE(AVG(NULLIF(regexp_replace(cells->>${metric}, '[^0-9.\\-]', '', 'g'), '')::numeric), 0)::float8`;
    }
    if (mode === 'min') {
      return Prisma.sql`COALESCE(MIN(NULLIF(regexp_replace(cells->>${metric}, '[^0-9.\\-]', '', 'g'), '')::numeric), 0)::float8`;
    }
    return Prisma.sql`COALESCE(MAX(NULLIF(regexp_replace(cells->>${metric}, '[^0-9.\\-]', '', 'g'), '')::numeric), 0)::float8`;
  }

}
