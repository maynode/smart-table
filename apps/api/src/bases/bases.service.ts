import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

@Injectable()
export class BasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  async create(workspaceId: string, userId: string, name: string) {
    await this.workspacesService.requireMember(workspaceId, userId, 'editor');
    return this.prisma.base.create({
      data: { workspaceId, name: name.trim() },
    });
  }

  async list(workspaceId: string, userId: string) {
    await this.workspacesService.requireMember(workspaceId, userId, 'viewer');
    return this.prisma.base.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getDetail(baseId: string, userId: string) {
    const base = await this.prisma.base.findUnique({ where: { id: baseId } });
    if (!base) {
      throw new NotFoundException('Base 不存在');
    }
    await this.workspacesService.requireMember(
      base.workspaceId,
      userId,
      'viewer',
    );
    return base;
  }
}
