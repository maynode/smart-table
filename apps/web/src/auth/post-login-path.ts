/** 登录后回跳：有合法 redirect 则回去；管理页无权限则回首页 */
export function resolvePostLoginPath(
  redirectRaw: unknown,
  user?: { installAdmin?: boolean } | null,
): string {
  const redirect = typeof redirectRaw === 'string' ? redirectRaw.trim() : '';
  if (!isSafeInternalPath(redirect)) return '/';

  if (redirect.startsWith('/admin/') && !user?.installAdmin) {
    return '/';
  }
  return redirect;
}

function isSafeInternalPath(path: string): boolean {
  if (!path.startsWith('/')) return false;
  if (path.startsWith('//')) return false;
  if (path.startsWith('/login')) return false;
  if (/[\s\\]/.test(path)) return false;
  try {
    const url = new URL(path, 'http://local.invalid');
    if (url.origin !== 'http://local.invalid') return false;
    return Boolean(url.pathname);
  } catch {
    return false;
  }
}
