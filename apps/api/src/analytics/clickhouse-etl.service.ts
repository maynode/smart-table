import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

type Fetcher = typeof fetch;

/**
 * Incremental PG → ClickHouse sync for dashboard analytics.
 * Enabled when ANALYTICS_ADAPTER=clickhouse and CLICKHOUSE_ETL_ENABLED!=false.
 */
@Injectable()
export class ClickHouseEtlService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClickHouseEtlService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private watermark = new Date(0);
  private readonly fetcher: Fetcher;
  private readonly enabled: boolean;
  private readonly url: string;
  private readonly database: string;
  private readonly username: string;
  private readonly password: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.fetcher = fetch;
    const adapter = config.get<string>('ANALYTICS_ADAPTER') ?? 'postgres';
    this.enabled =
      adapter === 'clickhouse' &&
      config.get<string>('CLICKHOUSE_ETL_ENABLED') !== 'false';
    this.url = config.get<string>('CLICKHOUSE_URL') ?? 'http://127.0.0.1:8123';
    this.database = config.get<string>('CLICKHOUSE_DATABASE') ?? 'default';
    this.username = config.get<string>('CLICKHOUSE_USER') ?? 'default';
    this.password = config.get<string>('CLICKHOUSE_PASSWORD') ?? '';
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('ClickHouse ETL disabled');
      return;
    }
    try {
      await this.ensureTable();
    } catch (error) {
      this.logger.warn(`ClickHouse ensureTable failed: ${String(error)}`);
      return;
    }
    this.timer = setInterval(() => {
      void this.syncBatch().catch((error: unknown) => {
        this.logger.warn(`ClickHouse ETL failed: ${String(error)}`);
      });
    }, 30_000);
    this.timer.unref?.();
    this.logger.log('ClickHouse ETL started (30s poll)');
    void this.syncBatch().catch(() => undefined);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Public for ops / tests. */
  async syncBatch(limit = 500): Promise<{ upserted: number }> {
    if (!this.enabled || this.ticking) return { upserted: 0 };
    this.ticking = true;
    try {
      const take = Math.min(Math.max(limit, 1), 2000);
      const rows = await this.prisma.recordRow.findMany({
        where: { updatedAt: { gt: this.watermark } },
        orderBy: { updatedAt: 'asc' },
        take,
        select: {
          id: true,
          sheetId: true,
          cells: true,
          version: true,
          updatedAt: true,
        },
      });
      if (rows.length === 0) return { upserted: 0 };

      const body = rows
        .map((row) =>
          JSON.stringify({
            id: row.id,
            sheet_id: row.sheetId,
            cells: JSON.stringify(row.cells ?? {}),
            version: row.version,
            updated_at: row.updatedAt
              .toISOString()
              .replace('T', ' ')
              .replace('Z', ''),
          }),
        )
        .join('\n');

      await this.exec(
        `INSERT INTO ${this.database}.records FORMAT JSONEachRow`,
        body,
      );

      this.watermark = rows[rows.length - 1].updatedAt;
      this.logger.log(
        `ClickHouse ETL upserted ${rows.length}, watermark=${this.watermark.toISOString()}`,
      );
      return { upserted: rows.length };
    } finally {
      this.ticking = false;
    }
  }

  private async ensureTable(): Promise<void> {
    await this.exec(`
      CREATE TABLE IF NOT EXISTS ${this.database}.records (
        id UUID,
        sheet_id UUID,
        cells String,
        version UInt32,
        updated_at DateTime64(3, 'UTC')
      ) ENGINE = ReplacingMergeTree(version)
      ORDER BY (sheet_id, id)
    `);
  }

  private async exec(sql: string, body?: string): Promise<void> {
    const params = new URLSearchParams();
    if (this.database) params.set('database', this.database);
    if (body !== undefined) params.set('query', sql);
    const url = `${this.url.replace(/\/$/, '')}/?${params.toString()}`;
    const headers: Record<string, string> = {
      'Content-Type': 'text/plain; charset=utf-8',
    };
    if (this.username) headers['X-ClickHouse-User'] = this.username;
    if (this.password) headers['X-ClickHouse-Key'] = this.password;
    const response = await this.fetcher(url, {
      method: 'POST',
      headers,
      body: body ?? sql,
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`ClickHouse ${response.status}: ${message}`);
    }
  }
}
