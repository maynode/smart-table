import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Observable, tap } from 'rxjs';
import type { JwtPayload } from '../auth/jwt-auth.guard';
import { ActivityLogService } from './activity-log.service';
import { normalizePath, shouldSkipActivity } from './activity-summary';

type AuthedRequest = FastifyRequest & {
  user?: JwtPayload;
  body?: unknown;
};

function clientIp(req: FastifyRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]?.trim() || '';
  }
  return req.ip || '';
}

function accountFromBody(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '';
  const account = (body as { account?: unknown }).account;
  return typeof account === 'string' ? account : '';
}

@Injectable()
export class ActivityInterceptor implements NestInterceptor {
  constructor(private readonly activity: ActivityLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const http = context.switchToHttp();
    const req = http.getRequest<AuthedRequest>();
    const res = http.getResponse<FastifyReply>();
    const method = (req.method || 'GET').toUpperCase();
    const path = normalizePath(req.url || '/');

    if (shouldSkipActivity(method, path)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: () => {
          const status = res.statusCode || 200;
          if (status >= 400) return;
          const user = req.user;
          const account = user?.account || accountFromBody(req.body) || '';
          const params =
            req.params && typeof req.params === 'object'
              ? (req.params as Record<string, string>)
              : undefined;
          this.activity.recordFromHttp({
            method,
            path,
            account,
            actorId: user?.sub ?? null,
            params,
            body: req.body,
            ip: clientIp(req),
            source: 'api',
          });
        },
      }),
    );
  }
}
