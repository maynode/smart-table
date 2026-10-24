import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WorkspaceRole } from '@prisma/client';
import { normalizeAccount, validateAccount } from 'shared';
import { PrismaService } from '../prisma/prisma.service';
import { QuotasService } from '../quotas/quotas.service';
import { roleAtLeast } from './workspace-roles';

export interface WorkspaceWithRole {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  role: WorkspaceRole;
  pinned: boolean;
  pinnedAt: Date | null;
}

export interface MemberView {
  userId: string;
  inviteId?: string;
  account: string;
  name: string;
  role: WorkspaceRole;
  createdAt: Date;
  /** false = 已邀请但对方尚未注册 */
  registered: boolean;
}

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotas: QuotasService,
  ) {}

  async create(userId: string, name: string): Promise<WorkspaceWithRole> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException('工作区名称不能为空');
    }
    await this.assertNameAvailableForUser(userId, trimmed);
    const workspace = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workspace.create({ data: { name: trimmed } });
      await tx.workspaceMember.create({
        data: { workspaceId: created.id, userId, role: 'owner' },
      });
      return created;
    });
    return { ...workspace, role: 'owner', pinned: false, pinnedAt: null };
  }

  async listMine(userId: string): Promise<WorkspaceWithRole[]> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
    });

    memberships.sort((a, b) => {
      const aPin = a.pinnedAt?.getTime() ?? 0;
      const bPin = b.pinnedAt?.getTime() ?? 0;
      if (aPin !== bPin) return bPin - aPin;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    return memberships.map((membership) =>
      this.toWorkspaceDto(membership.workspace, membership),
    );
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
    return this.toWorkspaceDto(workspace, membership);
  }

  async rename(
    workspaceId: string,
    userId: string,
    name: string,
  ): Promise<WorkspaceWithRole> {
    const membership = await this.requireMember(workspaceId, userId, 'admin');
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException('工作区名称不能为空');
    }
    await this.assertNameAvailableForUser(userId, trimmed, workspaceId);
    const workspace = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { name: trimmed },
    });
    return this.toWorkspaceDto(workspace, membership);
  }

  /** 当前用户可见的工作区名称不可重复（大小写不敏感）。 */
  private async assertNameAvailableForUser(
    userId: string,
    name: string,
    excludeWorkspaceId?: string,
  ): Promise<void> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: { select: { id: true, name: true } } },
    });
    const needle = name.toLowerCase();
    const clash = memberships.find(
      (item) =>
        item.workspace.id !== excludeWorkspaceId &&
        item.workspace.name.trim().toLowerCase() === needle,
    );
    if (clash) {
      throw new ConflictException(`已存在同名工作区「${clash.workspace.name}」`);
    }
  }

  async remove(workspaceId: string, userId: string): Promise<void> {
    await this.requireMember(workspaceId, userId, 'owner');
    const existing = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('工作区不存在');
    }
    await this.prisma.workspace.delete({ where: { id: workspaceId } });
  }

  async setPinned(
    workspaceId: string,
    userId: string,
    pinned: boolean,
  ): Promise<WorkspaceWithRole> {
    const membership = await this.requireMember(workspaceId, userId, 'viewer');
    const updated = await this.prisma.workspaceMember.update({
      where: { id: membership.id },
      data: { pinnedAt: pinned ? new Date() : null },
      include: { workspace: true },
    });
    return this.toWorkspaceDto(updated.workspace, updated);
  }

  private toWorkspaceDto(
    workspace: { id: string; name: string; createdAt: Date; updatedAt: Date },
    membership: { role: WorkspaceRole; pinnedAt: Date | null },
  ): WorkspaceWithRole {
    return {
      ...workspace,
      role: membership.role,
      pinned: membership.pinnedAt != null,
      pinnedAt: membership.pinnedAt,
    };
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

  async listMembers(workspaceId: string, userId: string): Promise<MemberView[]> {
    await this.requireMember(workspaceId, userId, 'viewer');

    const [members, invites] = await Promise.all([
      this.prisma.workspaceMember.findMany({
        where: { workspaceId },
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.workspaceInvite.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const active: MemberView[] = members.map((member) => ({
      userId: member.userId,
      account: member.user.account,
      name: member.user.name,
      role: member.role,
      createdAt: member.createdAt,
      registered: true,
    }));

    const pending: MemberView[] = invites.map((invite) => ({
      userId: '',
      inviteId: invite.id,
      account: invite.account,
      name: invite.account,
      role: invite.role,
      createdAt: invite.createdAt,
      registered: false,
    }));

    return [...active, ...pending];
  }

  async invite(
    workspaceId: string,
    actorId: string,
    accountRaw: string,
    role: WorkspaceRole,
  ): Promise<MemberView> {
    const actor = await this.requireMember(workspaceId, actorId, 'admin');

    if (role === 'owner') {
      throw new BadRequestException('不能直接邀请为所有者');
    }
    if (role === 'admin' && actor.role !== 'owner') {
      throw new ForbiddenException('只有所有者可以邀请管理员');
    }

    const accountError = validateAccount(accountRaw);
    if (accountError) throw new BadRequestException(accountError);
    const account = normalizeAccount(accountRaw);

    const user = await this.prisma.user.findUnique({
      where: { account },
    });

    await this.quotas.assertSeats(workspaceId);

    if (user) {
      try {
        const member = await this.prisma.workspaceMember.create({
          data: { workspaceId, userId: user.id, role },
        });
        return {
          userId: user.id,
          account: user.account,
          name: user.name,
          role: member.role,
          createdAt: member.createdAt,
          registered: true,
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

    const existingInvite = await this.prisma.workspaceInvite.findUnique({
      where: { workspaceId_account: { workspaceId, account } },
    });
    if (existingInvite) {
      throw new ConflictException('该账号已在待加入列表中');
    }

    try {
      const invite = await this.prisma.workspaceInvite.create({
        data: {
          workspaceId,
          account,
          role,
          invitedById: actorId,
        },
      });
      return {
        userId: '',
        inviteId: invite.id,
        account: invite.account,
        name: invite.account,
        role: invite.role,
        createdAt: invite.createdAt,
        registered: false,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('该账号已在待加入列表中');
      }
      throw error;
    }
  }

  async changeRole(
    workspaceId: string,
    actorId: string,
    targetId: string,
    role: WorkspaceRole,
  ): Promise<MemberView> {
    const actor = await this.requireMember(workspaceId, actorId, 'admin');

    const target = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetId } },
    });
    if (target) {
      if (actor.role !== 'owner') {
        if (role === 'owner' || target.role === 'owner') {
          throw new ForbiddenException('只有所有者可以调整所有者');
        }
        if (target.role === 'admin') {
          throw new ForbiddenException('只有所有者可以调整管理员');
        }
      }
      if (role === 'owner' && actor.role !== 'owner') {
        throw new ForbiddenException('只有所有者可以授予所有者角色');
      }

      const updated = await this.prisma.workspaceMember.update({
        where: { id: target.id },
        data: { role },
      });
      const user = await this.prisma.user.findUnique({
        where: { id: targetId },
      });
      return {
        userId: updated.userId,
        account: user?.account ?? '',
        name: user?.name ?? '',
        role: updated.role,
        createdAt: updated.createdAt,
        registered: true,
      };
    }

    const invite = await this.prisma.workspaceInvite.findFirst({
      where: { id: targetId, workspaceId },
    });
    if (!invite) {
      throw new NotFoundException('成员不存在');
    }
    if (role === 'owner') {
      throw new BadRequestException('不能将待加入成员设为所有者');
    }
    if (role === 'admin' && actor.role !== 'owner') {
      throw new ForbiddenException('只有所有者可以调整管理员');
    }
    const updatedInvite = await this.prisma.workspaceInvite.update({
      where: { id: invite.id },
      data: { role },
    });
    return {
      userId: '',
      inviteId: updatedInvite.id,
      account: updatedInvite.account,
      name: updatedInvite.account,
      role: updatedInvite.role,
      createdAt: updatedInvite.createdAt,
      registered: false,
    };
  }

  async removeMember(
    workspaceId: string,
    actorId: string,
    targetId: string,
  ): Promise<void> {
    const actor = await this.requireMember(workspaceId, actorId, 'admin');

    const target = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetId } },
    });
    if (target) {
      if (target.role === 'owner') {
        throw new BadRequestException('不能移除工作区所有者');
      }
      if (actor.role !== 'owner' && target.role === 'admin') {
        throw new ForbiddenException('只有所有者可以移除管理员');
      }
      await this.prisma.workspaceMember.delete({ where: { id: target.id } });
      return;
    }

    const invite = await this.prisma.workspaceInvite.findFirst({
      where: { id: targetId, workspaceId },
    });
    if (!invite) {
      throw new NotFoundException('成员不存在');
    }
    await this.prisma.workspaceInvite.delete({ where: { id: invite.id } });
  }

  /** 用户注册成功后，把针对该账号的待加入邀请转为正式成员 */
  async claimInvitesForAccount(userId: string, account: string): Promise<void> {
    const invites = await this.prisma.workspaceInvite.findMany({
      where: { account },
    });
    if (invites.length === 0) return;

    await this.prisma.$transaction(async (tx) => {
      for (const invite of invites) {
        try {
          await tx.workspaceMember.create({
            data: {
              workspaceId: invite.workspaceId,
              userId,
              role: invite.role,
            },
          });
        } catch (error) {
          if (
            !(
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === 'P2002'
            )
          ) {
            throw error;
          }
        }
        await tx.workspaceInvite.delete({ where: { id: invite.id } });
      }
    });
  }
}
