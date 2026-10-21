import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

export type ApiScope = 'read' | 'write';

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async create(
    workspaceId: string,
    userId: string,
    body: { name: string; scopes?: ApiScope[] },
  ) {
    await this.workspaces.requireMember(workspaceId, userId, 'admin');
    const name = (body.name ?? '').trim();
    if (!name) throw new BadRequestException('API Key 名称不能为空');
    const scopes = body.scopes?.length ? body.scopes : ['read', 'write'];
    for (const scope of scopes) {
      if (!['read', 'write'].includes(scope)) {
        throw new BadRequestException('API Key 权限范围无效');
      }
    }
    const prefix = randomBytes(4).toString('hex');
    const raw = `st_${prefix}_${randomBytes(24).toString('base64url')}`;
    const key = await this.prisma.apiKey.create({
      data: {
        workspaceId,
        name,
        prefix,
        tokenHash: this.hash(raw),
        scopes: scopes as unknown as Prisma.InputJsonValue,
        createdBy: userId,
      },
    });
    return {
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      scopes,
      createdAt: key.createdAt,
      token: raw,
    };
  }

  async list(workspaceId: string, userId: string) {
    await this.workspaces.requireMember(workspaceId, userId, 'viewer');
    const keys = await this.prisma.apiKey.findMany({
      where: { workspaceId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map((key) => ({
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      scopes: key.scopes,
      lastUsedAt: key.lastUsedAt,
      createdAt: key.createdAt,
    }));
  }

  async revoke(keyId: string, userId: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { id: keyId } });
    if (!key) throw new NotFoundException('API Key 不存在');
    await this.workspaces.requireMember(
      key.workspaceId,
      userId,
      'admin',
    );
    await this.prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
    return { id: keyId, revoked: true };
  }

  async authenticate(raw: string) {
    if (!raw.startsWith('st_')) {
      throw new UnauthorizedException('API Key 无效');
    }
    const key = await this.prisma.apiKey.findUnique({
      where: { tokenHash: this.hash(raw) },
    });
    if (!key || key.revokedAt) {
      throw new UnauthorizedException('API Key 无效或已撤销');
    }
    await this.prisma.apiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    });
    return key;
  }

  assertScope(scopes: unknown, required: ApiScope): void {
    const list = Array.isArray(scopes) ? scopes.map(String) : ['read', 'write'];
    if (!list.includes(required)) {
      throw new ForbiddenException(`API Key 缺少 ${required} 权限`);
    }
  }

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
