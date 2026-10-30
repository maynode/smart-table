import type { PrismaClient } from '@prisma/client';

/**
 * 系统管理员：`INSTALL_ADMIN_ACCOUNTS`（或旧名 EMAILS）逗号分隔账号；
 * 未配置时回退为最早注册用户。
 */
export async function isInstallAdmin(
  prisma: PrismaClient,
  userId: string,
): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return false;
  const configured = (
    process.env.INSTALL_ADMIN_ACCOUNTS ??
    process.env.INSTALL_ADMIN_EMAILS ??
    ''
  )
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (configured.length) {
    return configured.includes(user.account.toLowerCase());
  }
  const first = await prisma.user.findFirst({
    orderBy: { createdAt: 'asc' },
  });
  return first?.id === user.id;
}
