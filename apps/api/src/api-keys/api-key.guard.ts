import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiKeysService } from './api-keys.service';

export interface OpenApiKey {
  id: string;
  workspaceId: string;
  scopes: unknown;
  createdBy: string | null;
}

export interface OpenApiRequest extends FastifyRequest {
  apiKey?: OpenApiKey;
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OpenApiRequest>();
    const header = request.headers['x-api-key'];
    const authorization = request.headers.authorization ?? '';
    const raw = Array.isArray(header)
      ? header[0]
      : (header ??
        (authorization.startsWith('Bearer st_')
          ? authorization.slice('Bearer '.length)
          : ''));
    if (!raw) throw new UnauthorizedException('缺少 API Key');
    const key = await this.apiKeys.authenticate(raw);
    request.apiKey = {
      id: key.id,
      workspaceId: key.workspaceId,
      scopes: key.scopes,
      createdBy: key.createdBy,
    };
    return true;
  }
}
