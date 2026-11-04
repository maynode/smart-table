import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { isInstallAdmin } from '../auth/install-admin';

const TOKEN_PREFIX = 'st_agt_';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AgentTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, name: string) {
    const trimmed = name.trim() || 'MCP Token';
    const secret = randomBytes(24).toString('hex');
    const token = `${TOKEN_PREFIX}${secret}`;
    const prefix = token.slice(0, 12);
    const row = await this.prisma.agentApiToken.create({
      data: {
        userId,
        name: trimmed,
        tokenHash: hashToken(token),
        prefix,
      },
    });
    return {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      createdAt: row.createdAt,
      /** 仅创建时返回一次 */
      token,
    };
  }

  async list(userId: string) {
    const rows = await this.prisma.agentApiToken.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
    return { tokens: rows };
  }

  async revoke(userId: string, tokenId: string) {
    const row = await this.prisma.agentApiToken.findFirst({
      where: { id: tokenId, userId },
    });
    if (!row) throw new NotFoundException('令牌不存在');
    if (row.revokedAt) return { revoked: true };
    await this.prisma.agentApiToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
    return { revoked: true };
  }

  async resolveBearer(
    raw: string,
  ): Promise<{ userId: string; account: string; installAdmin: boolean }> {
    const token = raw.trim();
    if (!token.startsWith(TOKEN_PREFIX)) {
      throw new UnauthorizedException('访问令牌无效或已过期');
    }
    const row = await this.prisma.agentApiToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!row || row.revokedAt) {
      throw new UnauthorizedException('访问令牌无效或已过期');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: { id: true, account: true, blacklistedAt: true },
    });
    if (!user || user.blacklistedAt) {
      throw new UnauthorizedException('访问令牌无效或已过期');
    }
    await this.prisma.agentApiToken.update({
      where: { id: row.id },
      data: { lastUsedAt: new Date() },
    });
    return {
      userId: user.id,
      account: user.account,
      installAdmin: await isInstallAdmin(this.prisma, user.id),
    };
  }
}
