import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { FastifyRequest } from 'fastify';

export interface JwtPayload {
  sub: string;
  email: string;
}

export type AuthenticatedRequest = FastifyRequest & { user?: JwtPayload };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('缺少访问令牌');
    }

    try {
      request.user = await this.jwt.verifyAsync<JwtPayload>(
        header.slice('Bearer '.length),
      );
      return true;
    } catch {
      throw new UnauthorizedException('访问令牌无效或已过期');
    }
  }
}
