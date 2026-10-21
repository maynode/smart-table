import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ClickHouseAnalyticsAdapter } from './clickhouse-analytics.adapter';
import { PgAnalyticsAdapter } from './pg-analytics.adapter';
import type {
  AnalyticsQuery,
  AnalyticsQueryPort,
  AnalyticsRow,
} from './analytics.types';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly adapter: AnalyticsQueryPort;
  readonly driver: 'postgres' | 'clickhouse';

  constructor(config: ConfigService, prisma: PrismaService) {
    const configured = config.get<string>('ANALYTICS_ADAPTER') ?? 'postgres';
    if (configured === 'clickhouse') {
      this.driver = 'clickhouse';
      this.adapter = new ClickHouseAnalyticsAdapter({
        url: config.get<string>('CLICKHOUSE_URL') ?? 'http://127.0.0.1:8123',
        database: config.get<string>('CLICKHOUSE_DATABASE') ?? 'default',
        username: config.get<string>('CLICKHOUSE_USER') ?? 'default',
        password: config.get<string>('CLICKHOUSE_PASSWORD') ?? '',
      });
    } else {
      this.driver = 'postgres';
      this.adapter = new PgAnalyticsAdapter(prisma);
    }
    this.logger.log(`analytics adapter: ${this.driver}`);
  }

  query(request: AnalyticsQuery): Promise<AnalyticsRow[]> {
    return this.adapter.query(request);
  }
}
