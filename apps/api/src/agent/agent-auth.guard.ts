import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { FastifyRequest } from 'fastify';
import type { ToolActor } from 'agent-tools';
import { isInstallAdmin } from '../auth/install-admin';
import type { JwtPayload } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AgentTokenService } from './agent-token.service';

export type AgentActorRequest = FastifyRequest & {
  agentActor?: ToolActor;
  user?: JwtPayload;
};

@Injectable()
export class AgentAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly tokens: AgentTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AgentActorRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('缺少访问令牌');
    }
    const raw = header.slice('Bearer '.length).trim();

    if (raw.startsWith('st_agt_')) {
      const actor = await this.tokens.resolveBearer(raw);
      request.agentActor = actor;
      request.user = { sub: actor.userId, account: actor.account };
      return true;
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(raw);
    } catch {
      throw new UnauthorizedException('访问令牌无效或已过期');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, account: true, blacklistedAt: true },
    });
    if (!user) throw new UnauthorizedException('访问令牌无效或已过期');
    if (user.blacklistedAt && !payload.impersonatorId) {
      throw new UnauthorizedException('账号已被限制登录');
    }
    request.user = payload;
    request.agentActor = {
      userId: user.id,
      account: user.account,
      installAdmin: await isInstallAdmin(this.prisma, user.id),
    };
    return true;
  }
}
