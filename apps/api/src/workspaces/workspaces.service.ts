import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QuotasService } from '../quotas/quotas.service';
import { roleAtLeast } from './workspace-roles';

export interface WorkspaceWithRole {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  role: WorkspaceRole;
}

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotas: QuotasService,
  ) {}

  async create(userId: string, name: string): Promise<WorkspaceWithRole> {
    const workspace = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workspace.create({ data: { name: name.trim() } });
      await tx.workspaceMember.create({
        data: { workspaceId: created.id, userId, role: 'owner' },
      });
      return created;
    });

    return { ...workspace, role: 'owner' };
  }

  async listMine(userId: string): Promise<WorkspaceWithRole[]> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((membership) => ({
      ...membership.workspace,
      role: membership.role,
    }));
  }

  async getDetail(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceWithRole> {
    const membership = await this.requireMember(workspaceId, userId, 'viewer');
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) {
      throw new NotFoundException('工作区不存在');
    }
    return { ...workspace, role: membership.role };
  }

  async requireMember(
    workspaceId: string,
    userId: string,
    minimum: WorkspaceRole = 'viewer',
  ) {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });

    if (!membership) {
      throw new ForbiddenException('无权访问该工作区');
    }
    if (!roleAtLeast(membership.role, minimum)) {
      throw new ForbiddenException('权限不足');
    }
    return membership;
  }

  async listMembers(workspaceId: string, userId: string) {
    await this.requireMember(workspaceId, userId, 'viewer');

    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });

    return members.map((member) => ({
      userId: member.userId,
      email: member.user.email,
      name: member.user.name,
      role: member.role,
      createdAt: member.createdAt,
    }));
  }

  async invite(
    workspaceId: string,
    actorId: string,
    email: string,
    role: WorkspaceRole,
  ) {
    const actor = await this.requireMember(workspaceId, actorId, 'admin');

    if (role === 'owner' && actor.role !== 'owner') {
      throw new ForbiddenException('只有所有者可以授予所有者角色');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!user) {
      throw new NotFoundException('该邮箱尚未注册');
    }

    await this.quotas.assertSeats(workspaceId);

    try {
      const member = await this.prisma.workspaceMember.create({
        data: { workspaceId, userId: user.id, role },
      });
      return {
        userId: user.id,
        email: user.email,
        name: user.name,
        role: member.role,
        createdAt: member.createdAt,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('该成员已在工作区中');
      }
      throw error;
    }
  }

  async changeRole(
    workspaceId: string,
    actorId: string,
    targetUserId: string,
    role: WorkspaceRole,
  ) {
    const actor = await this.requireMember(workspaceId, actorId, 'admin');

    const target = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    if (!target) {
      throw new NotFoundException('成员不存在');
    }

    if (actor.role !== 'owner') {
      if (role === 'owner' || target.role === 'owner') {
        throw new ForbiddenException('只有所有者可以调整所有者');
      }
      if (target.role === 'admin') {
        throw new ForbiddenException('只有所有者可以调整管理员');
      }
    }

    const updated = await this.prisma.workspaceMember.update({
      where: { id: target.id },
      data: { role },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });

    return {
      userId: updated.userId,
      email: user?.email ?? '',
      name: user?.name ?? '',
      role: updated.role,
      createdAt: updated.createdAt,
    };
  }

  async removeMember(
    workspaceId: string,
    actorId: string,
    targetUserId: string,
  ): Promise<void> {
    const actor = await this.requireMember(workspaceId, actorId, 'admin');

    const target = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    if (!target) {
      throw new NotFoundException('成员不存在');
    }
    if (target.role === 'owner') {
      throw new BadRequestException('不能移除工作区所有者');
    }
    if (actor.role !== 'owner' && target.role === 'admin') {
      throw new ForbiddenException('只有所有者可以移除管理员');
    }

    await this.prisma.workspaceMember.delete({ where: { id: target.id } });
  }
}
