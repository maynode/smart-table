import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

    const aggregation =
      mode === 'count'
        ? Prisma.sql`COUNT(*)::float8`
        : mode === 'sum'
          ? Prisma.sql`COALESCE(SUM(NULLIF(regexp_replace(cells->>${metric}, '[^0-9.\\-]', '', 'g'), '')::numeric), 0)::float8`
          : mode === 'avg'
            ? Prisma.sql`COALESCE(AVG(NULLIF(regexp_replace(cells->>${metric}, '[^0-9.\\-]', '', 'g'), '')::numeric), 0)::float8`
            : mode === 'min'
              ? Prisma.sql`COALESCE(MIN(NULLIF(regexp_replace(cells->>${metric}, '[^0-9.\\-]', '', 'g'), '')::numeric), 0)::float8`
              : Prisma.sql`COALESCE(MAX(NULLIF(regexp_replace(cells->>${metric}, '[^0-9.\\-]', '', 'g'), '')::numeric), 0)::float8`;

    const rows = await this.prisma.$queryRaw<
      Array<{ label: string | null; value: number | string | null }>
    >(
      Prisma.sql`
        SELECT COALESCE(NULLIF(cells->>${dimension}, ''), '(空)') AS label,
               ${aggregation} AS value
        FROM "records"
        WHERE "sheet_id" = ${request.sheetId}::uuid
        GROUP BY 1
        ORDER BY value DESC
        LIMIT ${limit}
      `,
    );

    return rows.map((row) => ({
      label: String(row.label ?? '(空)'),
      value: Number(row.value ?? 0),
    }));
  }
}
