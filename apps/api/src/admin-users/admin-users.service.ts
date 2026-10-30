import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { isInstallAdmin } from '../auth/install-admin';
import { LiveBusService } from '../live/live-bus.service';
import { notifyUser } from '../notifications/user-notify';
import { PrismaService } from '../prisma/prisma.service';

export type AdminUserRow = {
  id: string;
  account: string;
  name: string;
  createdAt: Date;
  blacklistedAt: Date | null;
  workspaceCount: number;
  baseCount: number;
  installAdmin: boolean;
};

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly live: LiveBusService,
  ) {}

  async list(adminUserId: string, q?: string): Promise<{ items: AdminUserRow[] }> {
    await this.assertInstallAdmin(adminUserId);
    const keyword = q?.trim() ?? '';
    const where: Prisma.UserWhereInput = keyword
      ? {
          OR: [
            { account: { contains: keyword, mode: 'insensitive' } },
            { name: { contains: keyword, mode: 'insensitive' } },
          ],
        }
      : {};

    const users = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true,
        account: true,
        name: true,
        createdAt: true,
        blacklistedAt: true,
        _count: { select: { memberships: true } },
      },
    });

    const ids = users.map((u) => u.id);
    const baseCountByUser = await this.countBasesByUser(ids);

    const adminAccounts = (
      process.env.INSTALL_ADMIN_ACCOUNTS ??
      process.env.INSTALL_ADMIN_EMAILS ??
      ''
    )
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    let firstUserId: string | null = null;
    if (!adminAccounts.length) {
      const first = await this.prisma.user.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      firstUserId = first?.id ?? null;
    }

    const items: AdminUserRow[] = users.map((user) => ({
      id: user.id,
      account: user.account,
      name: user.name,
      createdAt: user.createdAt,
      blacklistedAt: user.blacklistedAt,
      workspaceCount: user._count.memberships,
      baseCount: baseCountByUser.get(user.id) ?? 0,
      installAdmin: adminAccounts.length
        ? adminAccounts.includes(user.account.toLowerCase())
        : user.id === firstUserId,
    }));
    return { items };
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
    if (user.blacklistedAt) {
      throw new BadRequestException('该用户在黑名单中，请先移出后再模拟登录');
    }
    return this.auth.issueForUser(user);
  }

  async setBlacklisted(
    adminUserId: string,
    targetUserId: string,
    blacklisted: boolean,
  ) {
    await this.assertInstallAdmin(adminUserId);
    if (adminUserId === targetUserId) {
      throw new BadRequestException('不能将自己加入黑名单');
    }
    if (await isInstallAdmin(this.prisma, targetUserId)) {
      throw new BadRequestException('不能将系统管理员加入黑名单');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('用户不存在');

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { blacklistedAt: blacklisted ? new Date() : null },
      select: {
        id: true,
        account: true,
        name: true,
        createdAt: true,
        blacklistedAt: true,
        _count: { select: { memberships: true } },
      },
    });
    const baseCountByUser = await this.countBasesByUser([updated.id]);
    return {
      id: updated.id,
      account: updated.account,
      name: updated.name,
      createdAt: updated.createdAt,
      blacklistedAt: updated.blacklistedAt,
      workspaceCount: updated._count.memberships,
      baseCount: baseCountByUser.get(updated.id) ?? 0,
      installAdmin: false,
    } satisfies AdminUserRow;
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
