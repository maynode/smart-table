import { endpoints } from '../api/endpoints';

export type NotificationRoute = {
  path: string;
  query?: Record<string, string>;
};

export type NotificationLinkResult =
  | { status: 'ok'; route: NotificationRoute }
  | { status: 'unavailable'; message: string; fallback?: NotificationRoute }
  | { status: 'none'; message: string };

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function baseRoute(
  workspaceId: string,
  baseId: string,
  query?: Record<string, string>,
): NotificationRoute {
  return {
    path: `/workspaces/${workspaceId}/bases/${baseId}`,
    ...(query ? { query } : {}),
  };
}

/**
 * Resolve + lightly verify the notification target still exists.
 * Missing / no-access targets return `unavailable` with a user-facing message
 * (and optional fallback into the parent base when that still works).
 */
export async function resolveNotificationLink(
  data: Record<string, unknown> | null | undefined,
): Promise<NotificationLinkResult> {
  if (!data || typeof data !== 'object') {
    return { status: 'none', message: '这条消息没有可跳转的内容' };
  }

  const kind = asString(data.kind);

  if (kind === 'workspace_member_removed') {
    return { status: 'ok', route: { path: '/' } };
  }

  if (
    kind === 'workspace_member_added' ||
    kind === 'workspace_member_role_changed'
  ) {
    const ws = asString(data.workspaceId);
    return {
      status: 'ok',
      route: ws ? { path: '/', query: { ws } } : { path: '/' },
    };
  }

  const baseId = asString(data.baseId);
  if (!baseId) {
    return { status: 'none', message: '这条消息没有可跳转的内容' };
  }

  let workspaceId = asString(data.workspaceId);
  try {
    const base = await endpoints.getBase(baseId);
    workspaceId = base.workspaceId;
  } catch {
    return {
      status: 'unavailable',
      message: '相关表格已删除，或你已无权限访问',
    };
  }
  if (!workspaceId) {
    return {
      status: 'unavailable',
      message: '相关表格已删除，或你已无权限访问',
    };
  }

  const objectType = asString(data.objectType);
  const objectId = asString(data.objectId);
  const sheetId =
    asString(data.sheetId) ?? (objectType === 'sheet' ? objectId : null);
  const dashboardId =
    asString(data.dashboardId) ??
    (objectType === 'dashboard' ? objectId : null);
  const fallback = baseRoute(workspaceId, baseId);

  if (dashboardId) {
    try {
      await endpoints.getDashboard(dashboardId);
      return {
        status: 'ok',
        route: baseRoute(workspaceId, baseId, { dashboard: dashboardId }),
      };
    } catch {
      return {
        status: 'unavailable',
        message: '目标仪表盘已删除或无法访问，已打开所在表格',
        fallback,
      };
    }
  }

  if (sheetId) {
    try {
      await endpoints.getSheet(sheetId);
    } catch {
      return {
        status: 'unavailable',
        message: '目标工作表已删除或无法访问，已打开所在表格',
        fallback,
      };
    }
    if (kind === 'form_submit') {
      return {
        status: 'ok',
        route: baseRoute(workspaceId, baseId, {
          sheet: sheetId,
          view: 'form-results',
        }),
      };
    }
    const query: Record<string, string> = { sheet: sheetId };
    if (objectType === 'form' || kind === 'form_submit') {
      query.view = objectType === 'form' ? 'form' : 'form-results';
    }
    return {
      status: 'ok',
      route: baseRoute(workspaceId, baseId, query),
    };
  }

  if (
    kind === 'automation_message' ||
    kind === 'content_permission_assigned' ||
    kind === 'content_permission_changed' ||
    kind === 'content_permission_removed' ||
    kind === 'form_submit' ||
    kind === 'dashboard_schedule'
  ) {
    return { status: 'ok', route: fallback };
  }

  return { status: 'ok', route: fallback };
}
