import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRedisConnection } from './queue/redis-connection';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Liveness: process is up. */
  @Get('health')
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: DB required; Redis required in production when REDIS_URL is set. */
  @Get('ready')
  async ready(): Promise<{ status: 'ok'; db: true; redis: boolean }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        db: false,
        redis: false,
      });
    }

    const url = this.config.get<string>('REDIS_URL');
    if (!url) {
      return { status: 'ok', db: true, redis: false };
    }

    const nodeEnv =
      this.config.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? '';
    const strict =
      nodeEnv === 'production' ||
      this.config.get<string>('STRICT_ENV') === '1';

    const redis = createRedisConnection(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeoutMs: 2_000,
    });
    try {
      const pong = await redis.ping();
      if (pong !== 'PONG') {
        throw new Error('redis ping failed');
      }
      return { status: 'ok', db: true, redis: true };
    } catch {
      if (strict) {
        throw new ServiceUnavailableException({
          status: 'not_ready',
          db: true,
          redis: false,
        });
      }
      // Local/dev: locks/rate-limit fall back to memory; do not block readiness.
      return { status: 'ok', db: true, redis: false };
    } finally {
      try {
        await redis.quit();
      } catch {
        redis.disconnect();
      }
    }
  }
}
