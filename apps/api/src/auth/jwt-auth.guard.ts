import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { FastifyRequest } from 'fastify';
import { PrismaService } from '../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  account: string;
  /** 管理员模拟登录时写入；有此字段则跳过目标账号黑名单拦截 */
  impersonatorId?: string;
}

export type AuthenticatedRequest = FastifyRequest & { user?: JwtPayload };

const BLACKLIST_MESSAGE = '账号已被限制登录';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('缺少访问令牌');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(
        header.slice('Bearer '.length),
      );
    } catch {
      throw new UnauthorizedException('访问令牌无效或已过期');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, blacklistedAt: true },
    });
    if (!user) {
      throw new UnauthorizedException('访问令牌无效或已过期');
    }
    if (user.blacklistedAt && !payload.impersonatorId) {
      throw new UnauthorizedException(BLACKLIST_MESSAGE);
    }

    request.user = payload;
    return true;
  }
}
