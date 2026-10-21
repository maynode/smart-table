import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { SharingService } from '../sharing/sharing.service';

@Injectable()
export class BasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspacesService: WorkspacesService,
    private readonly sharing: SharingService,
  ) {}

  async create(workspaceId: string, userId: string, name: string) {
    await this.workspacesService.requireMember(workspaceId, userId, 'editor');
    return this.prisma.base.create({
      data: { workspaceId, name: name.trim() },
    });
  }

  async list(workspaceId: string, userId: string) {
    await this.workspacesService.requireMember(workspaceId, userId, 'viewer');
    const [own, shared] = await Promise.all([
      this.prisma.base.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'asc' },
      }),
      this.sharing.sharedBases(workspaceId, userId),
    ]);
    const seen = new Set(own.map((base) => base.id));
    return [...own, ...shared.filter((base) => !seen.has(base.id))];
  }

  async getDetail(baseId: string, userId: string) {
    const base = await this.prisma.base.findUnique({ where: { id: baseId } });
    if (!base) {
      throw new NotFoundException('Base 不存在');
    }
    try {
      await this.workspacesService.requireMember(
        base.workspaceId,
        userId,
        'viewer',
      );
    } catch (error) {
      await this.sharing.assertAccess('base', baseId, userId, 'viewer');
    }
    return base;
  }
}
