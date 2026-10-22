import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { ClickHouseEtlService } from './clickhouse-etl.service';

@Module({
  providers: [AnalyticsService, ClickHouseEtlService],
  exports: [AnalyticsService, ClickHouseEtlService],
})
export class AnalyticsModule {}
