import type { PrismaClient } from '@prisma/client';

/** 解析 INSTALL_ADMIN_ACCOUNTS / EMAILS（逗号分隔，小写） */
export function configuredInstallAdminAccounts(): string[] {
  return (
    process.env.INSTALL_ADMIN_ACCOUNTS ??
    process.env.INSTALL_ADMIN_EMAILS ??
    ''
  )
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * 系统管理员：
 * - 用户表 `installAdmin=true`（管理端可设）
 * - 或 `INSTALL_ADMIN_ACCOUNTS` / `EMAILS` 命中账号
 * - 若两者皆空：回退最早注册用户（单租户私有化默认）
 */
export async function isInstallAdmin(
  prisma: PrismaClient,
  userId: string,
): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return false;
  if (user.installAdmin) return true;

  const configured = configuredInstallAdminAccounts();
  if (configured.includes(user.account.toLowerCase())) return true;

  if (configured.length) return false;

  const anyDbAdmin = await prisma.user.findFirst({
    where: { installAdmin: true },
    select: { id: true },
  });
  if (anyDbAdmin) return false;

  const first = await prisma.user.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return first?.id === user.id;
}

export function isEnvInstallAdminAccount(account: string): boolean {
  return configuredInstallAdminAccounts().includes(account.toLowerCase());
}
