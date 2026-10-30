import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import {
  configuredInstallAdminAccounts,
  isEnvInstallAdminAccount,
  isInstallAdmin,
} from '../auth/install-admin';
import { LiveBusService } from '../live/live-bus.service';
import { notifyUser } from '../notifications/user-notify';
import { PrismaService } from '../prisma/prisma.service';

export type AdminUserRow = {
  id: string;
  account: string;
  createdAt: Date;
  blacklistedAt: Date | null;
  loginLockedUntil: Date | null;
  loginFailedCount: number;
  workspaceCount: number;
  baseCount: number;
  installAdmin: boolean;
};

type UserAdminSelect = {
  id: string;
  account: string;
  createdAt: Date;
  blacklistedAt: Date | null;
  loginLockedUntil: Date | null;
  loginFailedCount: number;
  installAdmin: boolean;
  _count?: { memberships: number };
};

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly live: LiveBusService,
  ) {}

  async list(
    adminUserId: string,
    q?: string,
    identity?: string,
  ): Promise<{ items: AdminUserRow[] }> {
    await this.assertInstallAdmin(adminUserId);
    const keyword = q?.trim() ?? '';
    const identityKey = normalizeIdentity(identity);
    const where: Prisma.UserWhereInput = keyword
      ? {
          account: { contains: keyword, mode: 'insensitive' },
        }
      : {};

    const users = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true,
        account: true,
        createdAt: true,
        blacklistedAt: true,
        loginLockedUntil: true,
        loginFailedCount: true,
        installAdmin: true,
        _count: { select: { memberships: true } },
      },
    });

    const ids = users.map((u) => u.id);
    const baseCountByUser = await this.countBasesByUser(ids);
    const flags = await this.resolveInstallAdminFlags(users);
    const now = Date.now();

    let items: AdminUserRow[] = users.map((user) =>
      this.toRow(user, {
        workspaceCount: user._count.memberships,
        baseCount: baseCountByUser.get(user.id) ?? 0,
        installAdmin: flags.get(user.id) ?? false,
      }),
    );

    if (identityKey) {
      items = items.filter((row) =>
        matchesIdentity(row, identityKey, now),
      );
    }
    return { items };
  }

  async unlockLogin(adminUserId: string, targetUserId: string) {
    await this.assertInstallAdmin(adminUserId);
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('用户不存在');
    await this.auth.clearLoginLock(targetUserId);
    return this.loadRow(targetUserId);
  }

  async impersonate(adminUserId: string, targetUserId: string) {
    await this.assertInstallAdmin(adminUserId);
    if (adminUserId === targetUserId) {
      throw new BadRequestException('无需模拟登录自己');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });
    if (!user) throw new NotFoundException('用户不存在');
    // 黑名单仅拦正常登录；管理员模拟登录仍可进入排查
    return this.auth.issueForUser(user, { impersonatorId: adminUserId });
  }

  async setBlacklisted(
    adminUserId: string,
    targetUserId: string,
    blacklisted: boolean,
  ) {
    await this.assertInstallAdmin(adminUserId);
    if (adminUserId === targetUserId) {
      throw new BadRequestException('不能禁止自己登录');
    }
    if (await isInstallAdmin(this.prisma, targetUserId)) {
      throw new BadRequestException('不能禁止系统管理员登录');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('用户不存在');

    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { blacklistedAt: blacklisted ? new Date() : null },
    });
    return this.loadRow(targetUserId);
  }

  async setInstallAdmin(
    adminUserId: string,
    targetUserId: string,
    installAdmin: boolean,
  ) {
    await this.assertInstallAdmin(adminUserId);
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        account: true,
        installAdmin: true,
        blacklistedAt: true,
      },
    });
    if (!user) throw new NotFoundException('用户不存在');

    if (installAdmin) {
      if (user.blacklistedAt) {
        throw new BadRequestException(
          '已禁止登录的用户不能设为系统管理员，请先允许登录',
        );
      }
      if (user.installAdmin || isEnvInstallAdminAccount(user.account)) {
        return this.loadRow(targetUserId);
      }
      await this.prisma.user.update({
        where: { id: targetUserId },
        data: { installAdmin: true },
      });
      return this.loadRow(targetUserId);
    }

    if (adminUserId === targetUserId) {
      throw new BadRequestException('不能取消自己的系统管理员身份');
    }
    if (isEnvInstallAdminAccount(user.account)) {
      throw new BadRequestException(
        '该账号由环境变量 INSTALL_ADMIN_ACCOUNTS 指定，无法在此取消',
      );
    }
    if (!user.installAdmin) {
      return this.loadRow(targetUserId);
    }

    const remaining = await this.countEffectiveAdminsExcluding(targetUserId);
    if (remaining < 1) {
      throw new BadRequestException('至少保留一名系统管理员');
    }

    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { installAdmin: false },
    });
    return this.loadRow(targetUserId);
  }

  async sendMessage(
    adminUserId: string,
    targetUserId: string,
    bodyRaw: string,
  ) {
    await this.assertInstallAdmin(adminUserId);
    const body = bodyRaw.trim();
    if (!body) throw new BadRequestException('请填写消息内容');
    if (body.length > 2000) {
      throw new BadRequestException('消息内容不超过 2000 字');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('用户不存在');

    await notifyUser(
      this.prisma,
      {
        userId: targetUserId,
        title: '系统消息',
        body,
        data: { kind: 'admin.message', actorId: adminUserId },
      },
      this.live,
    );
    return { ok: true as const };
  }

  private async loadRow(userId: string): Promise<AdminUserRow> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        account: true,
        createdAt: true,
        blacklistedAt: true,
        loginLockedUntil: true,
        loginFailedCount: true,
        installAdmin: true,
        _count: { select: { memberships: true } },
      },
    });
    const baseCountByUser = await this.countBasesByUser([user.id]);
    const flags = await this.resolveInstallAdminFlags([user]);
    return this.toRow(user, {
      workspaceCount: user._count.memberships,
      baseCount: baseCountByUser.get(user.id) ?? 0,
      installAdmin: flags.get(user.id) ?? false,
    });
  }

  private toRow(
    user: UserAdminSelect,
    extra: {
      workspaceCount: number;
      baseCount: number;
      installAdmin: boolean;
    },
  ): AdminUserRow {
    return {
      id: user.id,
      account: user.account,
      createdAt: user.createdAt,
      blacklistedAt: user.blacklistedAt,
      loginLockedUntil: user.loginLockedUntil,
      loginFailedCount: user.loginFailedCount,
      workspaceCount: extra.workspaceCount,
      baseCount: extra.baseCount,
      installAdmin: extra.installAdmin,
    };
  }

  /** 批量判定列表展示用的系统管理员标记（含 env / 首用户回退） */
  private async resolveInstallAdminFlags(
    users: Array<{ id: string; account: string; installAdmin: boolean }>,
  ): Promise<Map<string, boolean>> {
    const map = new Map<string, boolean>();
    if (!users.length) return map;

    const configured = configuredInstallAdminAccounts();
    let firstUserId: string | null = null;
    let anyDbAdmin = false;
    if (!configured.length) {
      anyDbAdmin = Boolean(
        await this.prisma.user.findFirst({
          where: { installAdmin: true },
          select: { id: true },
        }),
      );
      if (!anyDbAdmin) {
        const first = await this.prisma.user.findFirst({
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        firstUserId = first?.id ?? null;
      }
    }

    for (const user of users) {
      const byDb = user.installAdmin;
      const byEnv = configured.includes(user.account.toLowerCase());
      const byFirst =
        !configured.length && !anyDbAdmin && user.id === firstUserId;
      map.set(user.id, byDb || byEnv || byFirst);
    }
    return map;
  }

  /** 取消某人后，系统是否仍至少有一名有效管理员 */
  private async countEffectiveAdminsExcluding(
    excludeUserId: string,
  ): Promise<number> {
    const configured = configuredInstallAdminAccounts();
    const dbAdmins = await this.prisma.user.findMany({
      where: {
        installAdmin: true,
        id: { not: excludeUserId },
      },
      select: { id: true, account: true },
    });
    const ids = new Set(dbAdmins.map((u) => u.id));

    if (configured.length) {
      const envUsers = await this.prisma.user.findMany({
        where: {
          account: { in: configured, mode: 'insensitive' },
          id: { not: excludeUserId },
        },
        select: { id: true },
      });
      for (const u of envUsers) ids.add(u.id);
    }

    return ids.size;
  }

  private async countBasesByUser(
    userIds: string[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!userIds.length) return map;

    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, workspaceId: true },
    });
    if (!memberships.length) return map;

    const workspaceIds = [
      ...new Set(memberships.map((item) => item.workspaceId)),
    ];
    const baseGroups = await this.prisma.base.groupBy({
      by: ['workspaceId'],
      where: { workspaceId: { in: workspaceIds } },
      _count: { _all: true },
    });
    const basesByWorkspace = new Map(
      baseGroups.map((row) => [row.workspaceId, row._count._all]),
    );

    for (const userId of userIds) map.set(userId, 0);
    for (const membership of memberships) {
      const add = basesByWorkspace.get(membership.workspaceId) ?? 0;
      map.set(membership.userId, (map.get(membership.userId) ?? 0) + add);
    }
    return map;
  }

  private async assertInstallAdmin(userId: string): Promise<void> {
    if (!(await isInstallAdmin(this.prisma, userId))) {
      throw new ForbiddenException({
        code: 'INSTALL_ADMIN_REQUIRED',
        message: '仅系统管理员可访问',
      });
    }
  }
}

export type AdminUserIdentity =
  | 'admin'
  | 'user'
  | 'blacklisted'
  | 'locked';

function normalizeIdentity(raw?: string): AdminUserIdentity | null {
  const value = raw?.trim().toLowerCase();
  if (
    value === 'admin' ||
    value === 'user' ||
    value === 'blacklisted' ||
    value === 'locked'
  ) {
    return value;
  }
  return null;
}

function matchesIdentity(
  row: AdminUserRow,
  identity: AdminUserIdentity,
  nowMs: number,
): boolean {
  const locked =
    row.loginLockedUntil != null &&
    row.loginLockedUntil.getTime() > nowMs;
  switch (identity) {
    case 'admin':
      return row.installAdmin;
    case 'user':
      return !row.installAdmin;
    case 'blacklisted':
      return row.blacklistedAt != null;
    case 'locked':
      return locked;
    default:
      return true;
  }
}
