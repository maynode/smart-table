import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  scrape(@Req() request: FastifyRequest): string {
    this.assertAllowed(request);
    return this.metrics.render();
  }

  private assertAllowed(request: FastifyRequest): void {
    const token = (
      this.config.get<string>('METRICS_TOKEN') ??
      process.env.METRICS_TOKEN ??
      ''
    ).trim();
    const nodeEnv =
      this.config.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? '';
    const strict =
      nodeEnv === 'production' ||
      this.config.get<string>('STRICT_ENV') === '1';

    // Dev: open. Production without token: closed. With token: Bearer / query / header.
    if (!strict && !token) return;

    if (!token) {
      throw new ForbiddenException('metrics disabled without METRICS_TOKEN');
    }

    const header =
      request.headers['x-metrics-token'] ??
      request.headers.authorization ??
      '';
    const raw = Array.isArray(header) ? header[0] : header;
    const presented = raw.startsWith('Bearer ')
      ? raw.slice('Bearer '.length).trim()
      : String(raw).trim();
    const queryToken = String(
      (request.query as { token?: string } | undefined)?.token ?? '',
    ).trim();
    if (presented === token || queryToken === token) return;
    throw new UnauthorizedException('invalid metrics token');
  }
}
