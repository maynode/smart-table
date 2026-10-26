import { Logger } from '@nestjs/common';
import { Prisma, WorkspaceRole } from '@prisma/client';
import { LiveBusService } from '../live/live-bus.service';
import { PrismaService } from '../prisma/prisma.service';

const logger = new Logger('UserNotify');

const WORKSPACE_ROLE_LABEL: Record<string, string> = {
  owner: '所有者',
  admin: '管理员',
  editor: '可编辑',
  viewer: '只读',
};

const ACL_LEVEL_LABEL: Record<string, string> = {
  full: '可管理',
  edit: '可编辑',
  view: '可查看',
  none: '无权限',
};

const OBJECT_KIND_LABEL: Record<string, string> = {
  sheet: '工作表',
  form: '表单',
  dashboard: '仪表盘',
};

export function workspaceRoleLabel(role: WorkspaceRole | string): string {
  return WORKSPACE_ROLE_LABEL[role] ?? role;
}

export function aclLevelLabel(level: string): string {
  return ACL_LEVEL_LABEL[level] ?? level;
}

export function objectKindLabel(objectType: string): string {
  return OBJECT_KIND_LABEL[objectType] ?? objectType;
}

export async function actorDisplayName(
  prisma: PrismaService,
  userId: string,
): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, account: true },
  });
  return user?.name?.trim() || user?.account || '管理员';
}

/**
 * Persist an in-app notification and push Live Bus `notification.created`
 * when a LiveBusService is provided.
 */
export async function notifyUser(
  prisma: PrismaService,
  input: {
    userId: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
  },
  live?: LiveBusService,
): Promise<void> {
  try {
    const row = await prisma.notification.create({
      data: {
        userId: input.userId,
        title: input.title,
        body: input.body,
        data: (input.data ?? {}) as Prisma.InputJsonValue,
      },
    });
    if (live) {
      await live.emit({
        baseId:
          typeof input.data?.baseId === 'string' ? input.data.baseId : null,
        workspaceId:
          typeof input.data?.workspaceId === 'string'
            ? input.data.workspaceId
            : null,
        actorId:
          typeof input.data?.actorId === 'string' ? input.data.actorId : null,
        kind: 'notification.created',
        entityId: row.id,
        userId: input.userId,
        meta: {
          ...(input.data ?? {}),
          notificationId: row.id,
        },
      });
    }
  } catch (error) {
    logger.warn(
      `notify failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
