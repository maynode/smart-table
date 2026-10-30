export type ActivityOp = 'create' | 'update' | 'delete' | 'read' | 'other';

export type ActivityDescribeInput = {
  method: string;
  path: string;
  account: string;
  params?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
};

export type ActivityDescribeResult = {
  action: string;
  op: ActivityOp;
  summary: string;
  resourceType: string;
  resourceId?: string | null;
  workspaceId?: string | null;
  baseId?: string | null;
  sheetId?: string | null;
};

type Rule = {
  method: string | '*';
  match: RegExp;
  action: string;
  op: ActivityOp;
  resourceType: string;
  summary: (ctx: {
    who: string;
    p: Record<string, string>;
    name?: string;
  }) => string;
  ids?: (p: Record<string, string>) => {
    resourceId?: string | null;
    workspaceId?: string | null;
    baseId?: string | null;
    sheetId?: string | null;
  };
};

function whoLabel(account: string): string {
  const a = account.trim();
  return a || '匿名用户';
}

function bodyName(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const name = (body as { name?: unknown }).name;
  return typeof name === 'string' && name.trim() ? name.trim() : undefined;
}

function named(prefix: string, name?: string): string {
  return name ? `${prefix}「${name}」` : prefix;
}

const RULES: Rule[] = [
  {
    method: 'POST',
    match: /^\/auth\/register$/,
    action: 'auth.register',
    op: 'create',
    resourceType: 'user',
    summary: ({ who }) => `${who} 注册了账号`,
  },
  {
    method: 'POST',
    match: /^\/auth\/login$/,
    action: 'auth.login',
    op: 'other',
    resourceType: 'user',
    summary: ({ who }) => `${who} 登录了系统`,
  },
  {
    method: 'POST',
    match: /^\/auth\/username$/,
    action: 'auth.username.update',
    op: 'update',
    resourceType: 'user',
    summary: ({ who }) => `${who} 修改了用户名`,
  },
  {
    method: 'POST',
    match: /^\/auth\/avatar(\/upload)?$/,
    action: 'auth.avatar.update',
    op: 'update',
    resourceType: 'user',
    summary: ({ who }) => `${who} 更新了头像`,
  },
  {
    method: 'POST',
    match: /^\/auth\/change-password$/,
    action: 'auth.password.change',
    op: 'update',
    resourceType: 'user',
    summary: ({ who }) => `${who} 修改了密码`,
  },
  {
    method: 'POST',
    match: /^\/auth\/delete-account$/,
    action: 'auth.account.delete',
    op: 'delete',
    resourceType: 'user',
    summary: ({ who }) => `${who} 注销了账号`,
  },

  {
    method: 'POST',
    match: /^\/workspaces$/,
    action: 'workspace.create',
    op: 'create',
    resourceType: 'workspace',
    summary: ({ who, name }) => `${who} 创建了${named('工作区', name)}`,
  },
  {
    method: 'PATCH',
    match: /^\/workspaces\/([^/]+)$/,
    action: 'workspace.update',
    op: 'update',
    resourceType: 'workspace',
    summary: ({ who, name }) => `${who} 更新了${named('工作区', name)}`,
    ids: (p) => ({ resourceId: p['0'], workspaceId: p['0'] }),
  },
  {
    method: 'DELETE',
    match: /^\/workspaces\/([^/]+)$/,
    action: 'workspace.delete',
    op: 'delete',
    resourceType: 'workspace',
    summary: ({ who }) => `${who} 删除了工作区`,
    ids: (p) => ({ resourceId: p['0'], workspaceId: p['0'] }),
  },
  {
    method: 'PATCH',
    match: /^\/workspaces\/([^/]+)\/pin$/,
    action: 'workspace.pin',
    op: 'update',
    resourceType: 'workspace',
    summary: ({ who }) => `${who} 置顶/取消置顶了工作区`,
    ids: (p) => ({ workspaceId: p['0'], resourceId: p['0'] }),
  },
  {
    method: 'POST',
    match: /^\/workspaces\/([^/]+)\/members/,
    action: 'workspace.member.invite',
    op: 'create',
    resourceType: 'workspace_member',
    summary: ({ who }) => `${who} 邀请/添加了工作区成员`,
    ids: (p) => ({ workspaceId: p['0'] }),
  },
  {
    method: 'PATCH',
    match: /^\/workspaces\/([^/]+)\/members/,
    action: 'workspace.member.update',
    op: 'update',
    resourceType: 'workspace_member',
    summary: ({ who }) => `${who} 修改了工作区成员`,
    ids: (p) => ({ workspaceId: p['0'] }),
  },
  {
    method: 'DELETE',
    match: /^\/workspaces\/([^/]+)\/members/,
    action: 'workspace.member.remove',
    op: 'delete',
    resourceType: 'workspace_member',
    summary: ({ who }) => `${who} 移除了工作区成员`,
    ids: (p) => ({ workspaceId: p['0'] }),
  },

  {
    method: 'POST',
    match: /^\/workspaces\/([^/]+)\/bases$/,
    action: 'base.create',
    op: 'create',
    resourceType: 'base',
    summary: ({ who, name }) => `${who} 创建了${named('智能表', name)}`,
    ids: (p) => ({ workspaceId: p['0'] }),
  },
  {
    method: 'POST',
    match: /^\/workspaces\/([^/]+)\/bases\/reorder$/,
    action: 'base.reorder',
    op: 'update',
    resourceType: 'base',
    summary: ({ who }) => `${who} 调整了智能表顺序`,
    ids: (p) => ({ workspaceId: p['0'] }),
  },
  {
    method: 'POST',
    match: /^\/bases\/([^/]+)\/move$/,
    action: 'base.move',
    op: 'update',
    resourceType: 'base',
    summary: ({ who }) => `${who} 移动了智能表`,
    ids: (p) => ({ baseId: p['0'], resourceId: p['0'] }),
  },
  {
    method: 'PATCH',
    match: /^\/bases\/([^/]+)$/,
    action: 'base.update',
    op: 'update',
    resourceType: 'base',
    summary: ({ who, name }) => `${who} 更新了${named('智能表', name)}`,
    ids: (p) => ({ resourceId: p['0'], baseId: p['0'] }),
  },
  {
    method: 'DELETE',
    match: /^\/bases\/([^/]+)$/,
    action: 'base.delete',
    op: 'delete',
    resourceType: 'base',
    summary: ({ who }) => `${who} 删除了智能表`,
    ids: (p) => ({ resourceId: p['0'], baseId: p['0'] }),
  },
  {
    method: 'POST',
    match: /^\/bases\/([^/]+)\/sheets$/,
    action: 'sheet.create',
    op: 'create',
    resourceType: 'sheet',
    summary: ({ who, name }) => `${who} 新建了${named('数据表', name)}`,
    ids: (p) => ({ baseId: p['0'] }),
  },
  {
    method: 'PATCH',
    match: /^\/sheets\/([^/]+)$/,
    action: 'sheet.update',
    op: 'update',
    resourceType: 'sheet',
    summary: ({ who, name }) => `${who} 重命名了${named('数据表', name)}`,
    ids: (p) => ({ resourceId: p['0'], sheetId: p['0'] }),
  },
  {
    method: 'DELETE',
    match: /^\/sheets\/([^/]+)$/,
    action: 'sheet.delete',
    op: 'delete',
    resourceType: 'sheet',
    summary: ({ who }) => `${who} 删除了数据表`,
    ids: (p) => ({ resourceId: p['0'], sheetId: p['0'] }),
  },

  {
    method: 'POST',
    match: /^\/sheets\/([^/]+)\/fields$/,
    action: 'field.create',
    op: 'create',
    resourceType: 'field',
    summary: ({ who, name }) => `${who} 新增了${named('字段', name)}`,
    ids: (p) => ({ sheetId: p['0'] }),
  },
  {
    method: 'PATCH',
    match: /^\/fields\/([^/]+)$/,
    action: 'field.update',
    op: 'update',
    resourceType: 'field',
    summary: ({ who, name }) => `${who} 修改了${named('字段', name)}`,
    ids: (p) => ({ resourceId: p['0'] }),
  },
  {
    method: 'DELETE',
    match: /^\/fields\/([^/]+)$/,
    action: 'field.delete',
    op: 'delete',
    resourceType: 'field',
    summary: ({ who }) => `${who} 删除了字段`,
    ids: (p) => ({ resourceId: p['0'] }),
  },

  {
    method: 'POST',
    match: /^\/sheets\/([^/]+)\/records$/,
    action: 'record.create',
    op: 'create',
    resourceType: 'record',
    summary: ({ who }) => `${who} 新增了记录`,
    ids: (p) => ({ sheetId: p['0'] }),
  },
  {
    method: 'PATCH',
    match: /^\/records\/([^/]+)$/,
    action: 'record.update',
    op: 'update',
    resourceType: 'record',
    summary: ({ who }) => `${who} 修改了记录`,
    ids: (p) => ({ resourceId: p['0'] }),
  },
  {
    method: 'DELETE',
    match: /^\/records\/([^/]+)$/,
    action: 'record.delete',
    op: 'delete',
    resourceType: 'record',
    summary: ({ who }) => `${who} 删除了记录`,
    ids: (p) => ({ resourceId: p['0'] }),
  },
  {
    method: 'POST',
    match: /^\/sheets\/([^/]+)\/commitchanges$/,
    action: 'sheet.commit',
    op: 'update',
    resourceType: 'sheet',
    summary: ({ who }) => `${who} 提交了表格变更`,
    ids: (p) => ({ sheetId: p['0'], resourceId: p['0'] }),
  },
  {
    method: 'POST',
    match: /^\/sheets\/([^/]+)\/import$/,
    action: 'sheet.import',
    op: 'create',
    resourceType: 'sheet',
    summary: ({ who }) => `${who} 导入了表格数据`,
    ids: (p) => ({ sheetId: p['0'] }),
  },
  {
    method: 'GET',
    match: /^\/sheets\/([^/]+)\/export$/,
    action: 'sheet.export',
    op: 'read',
    resourceType: 'sheet',
    summary: ({ who }) => `${who} 导出了表格数据`,
    ids: (p) => ({ sheetId: p['0'] }),
  },

  {
    method: 'POST',
    match: /^\/sheets\/([^/]+)\/comments$/,
    action: 'comment.create',
    op: 'create',
    resourceType: 'comment',
    summary: ({ who }) => `${who} 发表了评论`,
    ids: (p) => ({ sheetId: p['0'] }),
  },

  {
    method: 'POST',
    match: /^\/forms\/([^/]+)\/cover$/,
    action: 'form.cover',
    op: 'update',
    resourceType: 'form',
    summary: ({ who }) => `${who} 更新了表单封面`,
    ids: (p) => ({ resourceId: p['0'] }),
  },
  {
    method: 'POST',
    match: /^\/forms\/([^/]+)$/,
    action: 'form.upsert',
    op: 'update',
    resourceType: 'form',
    summary: ({ who, name }) => `${who} 保存了${named('表单', name)}`,
    ids: (p) => ({ resourceId: p['0'] }),
  },
  {
    method: 'POST',
    match: /^\/public\/forms\/([^/]+)\/submit$/,
    action: 'form.submit',
    op: 'create',
    resourceType: 'form',
    summary: ({ who }) => `${who} 提交了表单`,
    ids: (p) => ({ resourceId: p['0'] }),
  },

  {
    method: 'POST',
    match: /^\/automations\/sheet-buttons\/run$/,
    action: 'automation.button.run',
    op: 'other',
    resourceType: 'automation',
    summary: ({ who }) => `${who} 点击运行了按钮自动化`,
  },
  {
    method: 'POST',
    match: /^\/automations\/([^/]+)\/run$/,
    action: 'automation.run',
    op: 'other',
    resourceType: 'automation',
    summary: ({ who }) => `${who} 手动运行了自动化`,
    ids: (p) => ({ resourceId: p['0'] }),
  },
  {
    method: 'POST',
    match: /^\/automations$/,
    action: 'automation.write',
    op: 'create',
    resourceType: 'automation',
    summary: ({ who, name }) => `${who} 创建了${named('自动化', name)}`,
  },
  {
    method: 'PATCH',
    match: /^\/automations\/([^/]+)$/,
    action: 'automation.update',
    op: 'update',
    resourceType: 'automation',
    summary: ({ who }) => `${who} 更新了自动化`,
    ids: (p) => ({ resourceId: p['0'] }),
  },
  {
    method: 'DELETE',
    match: /^\/automations\/([^/]+)$/,
    action: 'automation.delete',
    op: 'delete',
    resourceType: 'automation',
    summary: ({ who }) => `${who} 删除了自动化`,
    ids: (p) => ({ resourceId: p['0'] }),
  },

  {
    method: 'POST',
    match: /^\/bases\/([^/]+)\/dashboards$/,
    action: 'dashboard.create',
    op: 'create',
    resourceType: 'dashboard',
    summary: ({ who, name }) => `${who} 创建了${named('仪表盘', name)}`,
    ids: (p) => ({ baseId: p['0'] }),
  },
  {
    method: 'POST',
    match: /^\/dashboards\/([^/]+)\/widgets$/,
    action: 'dashboard.widget.create',
    op: 'create',
    resourceType: 'dashboard',
    summary: ({ who }) => `${who} 新增了仪表盘组件`,
    ids: (p) => ({ resourceId: p['0'] }),
  },
  {
    method: 'PATCH',
    match: /^\/dashboards\/([^/]+)\/widgets\/([^/]+)$/,
    action: 'dashboard.widget.update',
    op: 'update',
    resourceType: 'dashboard',
    summary: ({ who }) => `${who} 修改了仪表盘组件`,
    ids: (p) => ({ resourceId: p['0'] }),
  },
  {
    method: 'DELETE',
    match: /^\/dashboards\/([^/]+)\/widgets\/([^/]+)$/,
    action: 'dashboard.widget.delete',
    op: 'delete',
    resourceType: 'dashboard',
    summary: ({ who }) => `${who} 删除了仪表盘组件`,
    ids: (p) => ({ resourceId: p['0'] }),
  },
  {
    method: 'POST',
    match: /^\/dashboards\/([^/]+)\/schedules$/,
    action: 'dashboard.schedule.create',
    op: 'create',
    resourceType: 'dashboard',
    summary: ({ who }) => `${who} 创建了仪表盘定时任务`,
    ids: (p) => ({ resourceId: p['0'] }),
  },
  {
    method: 'POST',
    match: /^\/dashboards\/([^/]+)\/schedules\/([^/]+)\/run$/,
    action: 'dashboard.schedule.run',
    op: 'other',
    resourceType: 'dashboard',
    summary: ({ who }) => `${who} 手动运行了仪表盘定时任务`,
    ids: (p) => ({ resourceId: p['0'] }),
  },
  {
    method: 'POST',
    match: /^\/dashboards\/([^/]+)\/ai\/chat$/,
    action: 'dashboard.ai.chat',
    op: 'other',
    resourceType: 'dashboard',
    summary: ({ who }) => `${who} 使用了仪表盘 AI 对话`,
    ids: (p) => ({ resourceId: p['0'] }),
  },
  {
    method: 'PATCH',
    match: /^\/dashboards\/([^/]+)$/,
    action: 'dashboard.update',
    op: 'update',
    resourceType: 'dashboard',
    summary: ({ who, name }) => `${who} 更新了${named('仪表盘', name)}`,
    ids: (p) => ({ resourceId: p['0'] }),
  },
  {
    method: 'DELETE',
    match: /^\/dashboards\/([^/]+)$/,
    action: 'dashboard.delete',
    op: 'delete',
    resourceType: 'dashboard',
    summary: ({ who }) => `${who} 删除了仪表盘`,
    ids: (p) => ({ resourceId: p['0'] }),
  },

  {
    method: 'POST',
    match: /^\/sheets\/([^/]+)\/saved-views$/,
    action: 'view.create',
    op: 'create',
    resourceType: 'view',
    summary: ({ who, name }) => `${who} 创建了${named('视图', name)}`,
    ids: (p) => ({ sheetId: p['0'] }),
  },
  {
    method: 'PATCH',
    match: /^\/saved-views\/([^/]+)$/,
    action: 'view.update',
    op: 'update',
    resourceType: 'view',
    summary: ({ who, name }) => `${who} 更新了${named('视图', name)}`,
    ids: (p) => ({ resourceId: p['0'] }),
  },
  {
    method: 'DELETE',
    match: /^\/saved-views\/([^/]+)$/,
    action: 'view.delete',
    op: 'delete',
    resourceType: 'view',
    summary: ({ who }) => `${who} 删除了视图`,
    ids: (p) => ({ resourceId: p['0'] }),
  },

  {
    method: 'POST',
    match: /^\/sheets\/([^/]+)\/public-views$/,
    action: 'public_view.create',
    op: 'create',
    resourceType: 'public_view',
    summary: ({ who, name }) => `${who} 创建了${named('公开视图', name)}`,
    ids: (p) => ({ sheetId: p['0'] }),
  },
  {
    method: 'PATCH',
    match: /^\/public-views\/([^/]+)$/,
    action: 'public_view.update',
    op: 'update',
    resourceType: 'public_view',
    summary: ({ who }) => `${who} 更新了公开视图`,
    ids: (p) => ({ resourceId: p['0'] }),
  },
  {
    method: 'DELETE',
    match: /^\/public-views\/([^/]+)$/,
    action: 'public_view.delete',
    op: 'delete',
    resourceType: 'public_view',
    summary: ({ who }) => `${who} 删除了公开视图`,
    ids: (p) => ({ resourceId: p['0'] }),
  },
  {
    method: 'POST',
    match: /^\/public-views\/([^/]+)\/records$/,
    action: 'public_view.record.create',
    op: 'create',
    resourceType: 'record',
    summary: ({ who }) => `${who} 在公开视图中新增了记录`,
  },
  {
    method: 'PATCH',
    match: /^\/public-views\/([^/]+)\/records\/([^/]+)$/,
    action: 'public_view.record.update',
    op: 'update',
    resourceType: 'record',
    summary: ({ who }) => `${who} 在公开视图中修改了记录`,
    ids: (p) => ({ resourceId: p['1'] }),
  },
  {
    method: 'DELETE',
    match: /^\/public-views\/([^/]+)\/records\/([^/]+)$/,
    action: 'public_view.record.delete',
    op: 'delete',
    resourceType: 'record',
    summary: ({ who }) => `${who} 在公开视图中删除了记录`,
    ids: (p) => ({ resourceId: p['1'] }),
  },

  {
    method: 'POST',
    match: /^\/bases\/([^/]+)\/analysis-reports$/,
    action: 'analysis.create',
    op: 'create',
    resourceType: 'analysis_report',
    summary: ({ who, name }) => `${who} 创建了${named('分析报告', name)}`,
    ids: (p) => ({ baseId: p['0'] }),
  },
  {
    method: 'PATCH',
    match: /^\/analysis-reports\/([^/]+)$/,
    action: 'analysis.update',
    op: 'update',
    resourceType: 'analysis_report',
    summary: ({ who, name }) => `${who} 更新了${named('分析报告', name)}`,
    ids: (p) => ({ resourceId: p['0'] }),
  },
  {
    method: 'DELETE',
    match: /^\/analysis-reports\/([^/]+)$/,
    action: 'analysis.delete',
    op: 'delete',
    resourceType: 'analysis_report',
    summary: ({ who }) => `${who} 删除了分析报告`,
    ids: (p) => ({ resourceId: p['0'] }),
  },
  {
    method: 'POST',
    match: /^\/analysis-reports\/([^/]+)\/(chat|answer|generate)$/,
    action: 'analysis.ai',
    op: 'other',
    resourceType: 'analysis_report',
    summary: ({ who }) => `${who} 使用了分析报告 AI`,
    ids: (p) => ({ resourceId: p['0'] }),
  },

  {
    method: 'PUT',
    match: /^\/permissions\//,
    action: 'permission.write',
    op: 'update',
    resourceType: 'permission',
    summary: ({ who }) => `${who} 修改了权限设置`,
  },
  {
    method: 'DELETE',
    match: /^\/permissions\//,
    action: 'permission.member.remove',
    op: 'delete',
    resourceType: 'permission',
    summary: ({ who }) => `${who} 移除了权限成员`,
  },

  {
    method: 'POST',
    match: /^\/templates\/([^/]+)\/instantiate$/,
    action: 'template.use',
    op: 'create',
    resourceType: 'template',
    summary: ({ who }) => `${who} 使用模板创建了内容`,
    ids: (p) => ({ resourceId: p['0'] }),
  },

  {
    method: 'POST',
    match: /^\/auth\/recovery\/reset$/,
    action: 'auth.password.reset',
    op: 'update',
    resourceType: 'user',
    summary: ({ who }) => `${who} 通过密保重置了密码`,
  },

  {
    method: 'POST',
    match: /^\/feedback$/,
    action: 'feedback.create',
    op: 'create',
    resourceType: 'feedback',
    summary: ({ who }) => `${who} 提交了产品反馈`,
  },
  {
    method: 'POST',
    match: /^\/feedback\/attachments$/,
    action: 'feedback.attachment',
    op: 'create',
    resourceType: 'feedback',
    summary: ({ who }) => `${who} 上传了反馈图片`,
  },

  {
    method: 'POST',
    match: /^\/files/,
    action: 'file.upload',
    op: 'create',
    resourceType: 'file',
    summary: ({ who }) => `${who} 上传了文件`,
  },
  {
    method: 'POST',
    match: /\/attachments$/,
    action: 'file.upload',
    op: 'create',
    resourceType: 'file',
    summary: ({ who }) => `${who} 上传了附件`,
  },
];

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * GET 默认不记（列表/轮询/详情会刷屏）；「查」主要靠前端 page.view。
 * 仅白名单导出等有明确业务语义的只读写操作。
 */
const READ_ALLOW = /^\/sheets\/[^/]+\/export$/i;

/** 名义上是写接口，实际是查询/已读/预览，记了只会刷屏 */
function isNoisyWritePath(path: string): boolean {
  if (path.startsWith('/notifications')) return true;
  if (/^\/sheets\/[^/]+\/query$/i.test(path)) return true;
  if (/^\/dashboards\/[^/]+\/widgets\/[^/]+\/query$/i.test(path)) return true;
  if (path === '/auth/recovery/question') return true;
  if (/^\/public-views\/[^/]+\/verify$/i.test(path)) return true;
  if (/^\/forms\/[^/]+\/success-preview$/i.test(path)) return true;
  return false;
}

export function shouldSkipActivity(method: string, path: string): boolean {
  const m = method.toUpperCase();
  const p = normalizePath(path);
  if (m === 'OPTIONS' || m === 'HEAD') return true;
  if (p.startsWith('/admin')) return true;
  if (p === '/health' || p.startsWith('/health/')) return true;
  if (p === '/metrics' || p.startsWith('/metrics/')) return true;
  if (p.startsWith('/activity')) return true;
  if (/\/live(\/|$)/i.test(p)) return true;
  if (m === 'GET' && !READ_ALLOW.test(p)) return true;
  if (WRITE_METHODS.has(m) && isNoisyWritePath(p)) return true;
  return false;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function asUuidOrNull(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  return UUID_RE.test(value) ? value : null;
}

export function normalizePath(raw: string): string {
  const noQuery = raw.split('?')[0] ?? raw;
  let path = noQuery.startsWith('/api/')
    ? noQuery.slice(4)
    : noQuery === '/api'
      ? '/'
      : noQuery;
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

export function describeActivity(
  input: ActivityDescribeInput,
): ActivityDescribeResult {
  const method = input.method.toUpperCase();
  const path = normalizePath(input.path);
  const who = whoLabel(input.account);
  const name = bodyName(input.body);

  for (const rule of RULES) {
    if (rule.method !== '*' && rule.method !== method) continue;
    const matched = rule.match.exec(path);
    if (!matched) continue;
    const p: Record<string, string> = { ...(input.params ?? {}) };
    matched.slice(1).forEach((v, i) => {
      if (v) p[String(i)] = v;
    });
    const ids = rule.ids?.(p) ?? {};
    return {
      action: rule.action,
      op: rule.op,
      summary: rule.summary({ who, p, name }),
      resourceType: rule.resourceType,
      resourceId: ids.resourceId ?? null,
      workspaceId: asUuidOrNull(ids.workspaceId),
      baseId: asUuidOrNull(ids.baseId),
      sheetId: asUuidOrNull(ids.sheetId),
    };
  }

  const op: ActivityOp = WRITE_METHODS.has(method)
    ? method === 'POST'
      ? 'create'
      : method === 'DELETE'
        ? 'delete'
        : 'update'
    : method === 'GET'
      ? 'read'
      : 'other';
  const verb =
    op === 'create'
      ? '创建/提交'
      : op === 'update'
        ? '修改'
        : op === 'delete'
          ? '删除'
          : op === 'read'
            ? '查看'
            : '操作';
  return {
    action: `http.${method.toLowerCase()}`,
    op,
    summary: `${who} ${verb}了 ${method} ${path}`,
    resourceType: 'http',
    resourceId: null,
  };
}

export const CLIENT_EVENT_SUMMARIES: Record<
  string,
  (ctx: { who: string; path?: string; title?: string }) => {
    action: string;
    op: ActivityOp;
    summary: string;
    resourceType: string;
  }
> = {
  'page.view': ({ who, path, title }) => ({
    action: 'client.page.view',
    op: 'read',
    summary: `${who} 打开了页面${title ? `「${title}」` : path ? ` ${path}` : ''}`,
    resourceType: 'page',
  }),
  'panel.open': ({ who, title }) => ({
    action: 'client.panel.open',
    op: 'read',
    summary: `${who} 打开了${title ? `「${title}」` : '面板'}`,
    resourceType: 'panel',
  }),
};
