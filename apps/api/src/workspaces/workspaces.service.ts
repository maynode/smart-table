import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WorkspaceRole } from '@prisma/client';
import { normalizeAccount, validateAccount } from 'shared';
import {
  actorDisplayName,
  notifyUser,
  workspaceRoleLabel,
} from '../notifications/user-notify';
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
  avatarSeed?: string;
  avatarUrl?: string | null;
  role: WorkspaceRole;
  createdAt: Date;
  /** false = ???????????????????? */
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
      throw new BadRequestException('??????????????');
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
      throw new NotFoundException('????????????');
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
      throw new BadRequestException('??????????????');
    }
    await this.assertNameAvailableForUser(userId, trimmed, workspaceId);
    const workspace = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { name: trimmed },
    });
    return this.toWorkspaceDto(workspace, membership);
  }

  /** ????????????????????????????????????????????????? */
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
      throw new ConflictException(`??????????????????${clash.workspace.name}???`);
    }
  }

  async remove(workspaceId: string, userId: string): Promise<void> {
    await this.requireMember(workspaceId, userId, 'owner');
    const existing = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('????????????');
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
      throw new ForbiddenException('????????????????');
    }
    if (!roleAtLeast(membership.role, minimum)) {
      throw new ForbiddenException('???????');
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
      avatarSeed: member.user.avatarSeed || member.user.account,
      avatarUrl: member.user.avatarUrl ?? null,
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
      throw new BadRequestException('????????????????????????');
    }
    if (role === 'admin' && actor.role !== 'owner') {
      throw new ForbiddenException('?????????????????????????');
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
        if (user.id !== actorId) {
          const [workspace, actorName] = await Promise.all([
            this.prisma.workspace.findUnique({
              where: { id: workspaceId },
              select: { name: true },
            }),
            actorDisplayName(this.prisma, actorId),
          ]);
          const wsName = workspace?.name ?? '???';
          const roleName = workspaceRoleLabel(role);
          await notifyUser(this.prisma, {
            userId: user.id,
            title: '?????????',
            body: `${actorName} ?????${wsName}?????${roleName}`,
            data: {
              kind: 'workspace_member_added',
              workspaceId,
              role,
              actorId,
            },
          });
        }
        return {
          userId: user.id,
          account: user.account,
          name: user.name,
          avatarSeed: user.avatarSeed || user.account,
          avatarUrl: user.avatarUrl ?? null,
          role: member.role,
          createdAt: member.createdAt,
          registered: true,
        };
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException('??????????????????');
        }
        throw error;
      }
    }

    const existingInvite = await this.prisma.workspaceInvite.findUnique({
      where: { workspaceId_account: { workspaceId, account } },
    });
    if (existingInvite) {
      throw new ConflictException('?????????????????????????');
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
        throw new ConflictException('?????????????????????????');
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
          throw new ForbiddenException('?????????????????????????????');
        }
        if (target.role === 'admin') {
          throw new ForbiddenException('??????????????????????????');
        }
      }
      if (role === 'owner' && actor.role !== 'owner') {
        throw new ForbiddenException('??????????????????????????????????');
      }

      const previousRole = target.role;
      const updated = await this.prisma.workspaceMember.update({
        where: { id: target.id },
        data: { role },
      });
      const user = await this.prisma.user.findUnique({
        where: { id: targetId },
      });
      if (targetId !== actorId && previousRole !== role) {
        const [workspace, actorName] = await Promise.all([
          this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { name: true },
          }),
          actorDisplayName(this.prisma, actorId),
        ]);
        const wsName = workspace?.name ?? '???';
        await notifyUser(this.prisma, {
          userId: targetId,
          title: '??????????',
          body: `${actorName} ????${wsName}?????${workspaceRoleLabel(previousRole)}???${workspaceRoleLabel(role)}`,
          data: {
            kind: 'workspace_member_role_changed',
            workspaceId,
            previousRole,
            role,
            actorId,
          },
        });
      }
      return {
        userId: updated.userId,
        account: user?.account ?? '',
        name: user?.name ?? '',
        avatarSeed: user?.avatarSeed || user?.account || '',
        avatarUrl: user?.avatarUrl ?? null,
        role: updated.role,
        createdAt: updated.createdAt,
        registered: true,
      };
    }

    const invite = await this.prisma.workspaceInvite.findFirst({
      where: { id: targetId, workspaceId },
    });
    if (!invite) {
      throw new NotFoundException('????????????');
    }
    if (role === 'owner') {
      throw new BadRequestException('???????????????????????????????');
    }
    if (role === 'admin' && actor.role !== 'owner') {
      throw new ForbiddenException('??????????????????????????');
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
        throw new BadRequestException('???????????????????????');
      }
      if (actor.role !== 'owner' && target.role === 'admin') {
        throw new ForbiddenException('?????????????????????????');
      }
      await this.prisma.workspaceMember.delete({ where: { id: target.id } });
      if (targetId !== actorId) {
        const [workspace, actorName] = await Promise.all([
          this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { name: true },
          }),
          actorDisplayName(this.prisma, actorId),
        ]);
        const wsName = workspace?.name ?? '???';
        await notifyUser(this.prisma, {
          userId: targetId,
          title: '??????????',
          body: `${actorName} ??????${wsName}?`,
          data: {
            kind: 'workspace_member_removed',
            workspaceId,
            actorId,
          },
        });
      }
      return;
    }

    const invite = await this.prisma.workspaceInvite.findFirst({
      where: { id: targetId, workspaceId },
    });
    if (!invite) {
      throw new NotFoundException('????????????');
    }
    await this.prisma.workspaceInvite.delete({ where: { id: invite.id } });
  }

  /** ??????????????????????????????????????????????????????? */
  async claimInvitesForAccount(userId: string, account: string): Promise<void> {
    const invites = await this.prisma.workspaceInvite.findMany({
      where: { account },
    });
    if (invites.length === 0) return;

    const claimed: typeof invites = [];
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
          claimed.push(invite);
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
    for (const invite of claimed) {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: invite.workspaceId },
        select: { name: true },
      });
      const actorName = invite.invitedById
        ? await actorDisplayName(this.prisma, invite.invitedById)
        : '???';
      const wsName = workspace?.name ?? '???';
      await notifyUser(this.prisma, {
        userId,
        title: '?????????',
        body: `${actorName} ?????${wsName}?????${workspaceRoleLabel(invite.role)}`,
        data: {
          kind: 'workspace_member_added',
          workspaceId: invite.workspaceId,
          role: invite.role,
          actorId: invite.invitedById ?? null,
        },
      });
    }
  }
}
