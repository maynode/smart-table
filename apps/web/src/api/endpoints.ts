import { ApiError, api, getToken } from './client';
import type {
  AuthResult,
  AutomationDto,
  AutomationRunDto,
  BaseDto,
  CommentDto,
  FieldDto,
  FormDto,
  FormSubmitResult,
  ImportResult,
  MemberDto,
  PublicFormDto,
  RecordDto,
  RecordPage,
  SheetDto,
  UpsertFormPayload,
  ViewQueryResult,
  WorkspaceDto,
  PermissionObjectDto,
  PermissionSettingsDto,
  DashboardDto,
  DashboardDataDto,
  DashboardScheduleDto,
  DashboardWidgetDto,
  FolderTreeDto,
  TemplateDto,
  TemplateInstantiateResult,
  CrossWorkspaceShareDto,
  PublicViewDto,
  PublicViewData,
  ApiKeyDto,
  WebhookDto,
  WebhookDeliveryDto,
  QuotaSnapshot,
  DataSyncDto,
  DataSyncRunDto,
} from './types';
import type { ViewQuery } from 'shared';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

async function importSheetFile(
  sheetId: string,
  file: File,
): Promise<ImportResult> {
  const body = new FormData();
  body.append('file', file);
  const token = getToken();
  const response = await fetch(`${API_BASE}/sheets/${sheetId}/import`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body,
  });
  const data = (await response.json()) as unknown;
  if (!response.ok) throw new ApiError(response.status, data);
  return data as ImportResult;
}

async function exportSheetFile(
  sheetId: string,
  filename: string,
): Promise<void> {
  const token = getToken();
  const response = await fetch(`${API_BASE}/sheets/${sheetId}/export`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as unknown;
    throw new ApiError(response.status, data);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export const endpoints = {
  login: (email: string, password: string) =>
    api<AuthResult>('/auth/login', { body: { email, password }, token: null }),

  register: (email: string, password: string, name: string) =>
    api<AuthResult>('/auth/register', {
      body: { email, password, name },
      token: null,
    }),

  listWorkspaces: () => api<WorkspaceDto[]>('/workspaces'),

  createWorkspace: (name: string) =>
    api<WorkspaceDto>('/workspaces', { body: { name } }),

  getWorkspace: (workspaceId: string) =>
    api<WorkspaceDto>(`/workspaces/${workspaceId}`),

  listMembers: (workspaceId: string) =>
    api<MemberDto[]>(`/workspaces/${workspaceId}/members`),

  listBases: (workspaceId: string) =>
    api<BaseDto[]>(`/workspaces/${workspaceId}/bases`),

  createBase: (workspaceId: string, name: string) =>
    api<BaseDto>(`/workspaces/${workspaceId}/bases`, { body: { name } }),

  getBase: (baseId: string) => api<BaseDto>(`/bases/${baseId}`),

  listSheets: (baseId: string) =>
    api<SheetDto[]>(`/bases/${baseId}/sheets`),

  createSheet: (baseId: string, name: string) =>
    api<SheetDto>(`/bases/${baseId}/sheets`, { body: { name } }),

  getSheet: (sheetId: string) => api<SheetDto>(`/sheets/${sheetId}`),

  listRecords: (sheetId: string, cursor?: string | null, limit = 100) => {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);
    return api<RecordPage>(`/sheets/${sheetId}/records?${params.toString()}`);
  },

  createRecord: (sheetId: string, cells: Record<string, unknown>) =>
    api<RecordDto>(`/sheets/${sheetId}/records`, { body: { cells } }),

  updateRecord: (
    recordId: string,
    cells: Record<string, unknown>,
    expectedVersion?: number,
  ) =>
    api<RecordDto>(`/records/${recordId}`, {
      method: 'PATCH',
      body: { cells, expectedVersion },
    }),

  createField: (
    sheetId: string,
    body: {
      name: string;
      type: string;
      options?: Record<string, unknown>;
      required?: boolean;
      hidden?: boolean;
      order?: number;
    },
  ) =>
    api<FieldDto>(`/sheets/${sheetId}/fields`, {
      body,
    }),

  updateField: (
    fieldId: string,
    patch: {
      hidden?: boolean;
      name?: string;
      type?: string;
      options?: Record<string, unknown>;
      required?: boolean;
      order?: number;
    },
  ) =>
    api<FieldDto>(`/fields/${fieldId}`, { method: 'PATCH', body: patch }),

  listComments: (sheetId: string) =>
    api<CommentDto[]>(`/sheets/${sheetId}/comments`),

  createComment: (sheetId: string, body: string) =>
    api<CommentDto>(`/sheets/${sheetId}/comments`, { body: { body } }),

  listForms: (baseId: string) =>
    api<FormDto[]>(`/forms?baseId=${encodeURIComponent(baseId)}`),

  getForm: (formId: string) => api<FormDto>(`/forms/${formId}`),

  upsertForm: (formId: string, body: UpsertFormPayload) =>
    api<FormDto>(`/forms/${formId}`, { body }),

  getPublicForm: (token: string) =>
    api<PublicFormDto>(`/public/forms/${encodeURIComponent(token)}`, {
      token: null,
    }),

  submitPublicForm: (token: string, cells: Record<string, unknown>) =>
    api<FormSubmitResult>(
      `/public/forms/${encodeURIComponent(token)}/submit`,
      { body: { cells }, token: null },
    ),

  listAutomations: (baseId: string) =>
    api<AutomationDto[]>(`/automations?baseId=${encodeURIComponent(baseId)}`),

  listAutomationRuns: (automationId: string, limit = 20) =>
    api<AutomationRunDto[]>(
      `/automations/${automationId}/runs?limit=${limit}`,
    ),

  importSheet: importSheetFile,
  exportSheet: exportSheetFile,

  querySheet: (sheetId: string, query: ViewQuery) =>
    api<ViewQueryResult>(`/sheets/${sheetId}/query`, {
      method: 'POST',
      body: query as unknown as Record<string, unknown>,
    }),

  listPermissionObjects: (baseId: string) =>
    api<{ baseId: string; objects: PermissionObjectDto[] }>(
      `/permissions?baseId=${baseId}`,
    ),

  getPermissionSettings: (objectType: string, objectId: string) =>
    api<PermissionSettingsDto>(`/permissions/${objectType}/${objectId}`),

  updatePermissionSettings: (
    objectType: string,
    objectId: string,
    body: {
      everyone?: Record<string, unknown>;
      members?: Array<Record<string, unknown>>;
    },
  ) =>
    api<PermissionSettingsDto>(`/permissions/${objectType}/${objectId}`, {
      method: 'PUT',
      body,
    }),

  listDashboards: (baseId: string, kind?: 'dashboard' | 'report') =>
    api<DashboardDto[]>(
      `/bases/${baseId}/dashboards${kind ? `?kind=${kind}` : ''}`,
    ),

  createDashboard: (
    baseId: string,
    body: { name: string; kind?: 'dashboard' | 'report' },
  ) =>
    api<DashboardDto>(`/bases/${baseId}/dashboards`, {
      method: 'POST',
      body,
    }),

  getDashboard: (dashboardId: string) =>
    api<DashboardDto>(`/dashboards/${dashboardId}`),

  getDashboardData: (dashboardId: string) =>
    api<DashboardDataDto>(`/dashboards/${dashboardId}/data`),

  addDashboardWidget: (
    dashboardId: string,
    body: {
      type: string;
      title: string;
      sheetId?: string;
      config?: Record<string, unknown>;
      layout?: Record<string, unknown>;
    },
  ) =>
    api<DashboardWidgetDto>(`/dashboards/${dashboardId}/widgets`, {
      method: 'POST',
      body,
    }),

  listDashboardSchedules: (dashboardId: string) =>
    api<DashboardScheduleDto[]>(`/dashboards/${dashboardId}/schedules`),

  createDashboardSchedule: (
    dashboardId: string,
    body: { cron: string; channel?: string },
  ) =>
    api<DashboardScheduleDto>(`/dashboards/${dashboardId}/schedules`, {
      method: 'POST',
      body,
    }),

  runDashboardSchedule: (
    dashboardId: string,
    scheduleId: string,
  ) =>
    api<{ id: string; status: string; notificationId: string }>(
      `/dashboards/${dashboardId}/schedules/${scheduleId}/run`,
      { method: 'POST' },
    ),

  listFolderTree: (workspaceId: string) =>
    api<FolderTreeDto>(`/workspaces/${workspaceId}/folders`),

  createFolder: (
    workspaceId: string,
    body: { name: string; parentId?: string | null },
  ) =>
    api<FolderTreeDto['folders'][number]>(`/workspaces/${workspaceId}/folders`, {
      method: 'POST',
      body,
    }),

  updateFolder: (
    folderId: string,
    body: { name?: string; parentId?: string | null },
  ) =>
    api<FolderTreeDto['folders'][number]>(`/folders/${folderId}`, {
      method: 'PATCH',
      body,
    }),

  deleteFolder: (folderId: string) =>
    api<{ id: string; deleted: boolean }>(`/folders/${folderId}`, {
      method: 'DELETE',
    }),

  moveBaseToFolder: (baseId: string, folderId: string | null) =>
    api<{ id: string; name: string; folderId: string | null }>(
      `/bases/${baseId}/move`,
      { method: 'POST', body: { folderId } },
    ),

  listTemplates: () => api<TemplateDto[]>('/templates'),

  instantiateTemplate: (
    key: string,
    body: { workspaceId: string; folderId?: string | null },
  ) =>
    api<TemplateInstantiateResult>(`/templates/${key}/instantiate`, {
      method: 'POST',
      body,
    }),

  listShares: (workspaceId: string, direction: 'in' | 'out' = 'out') =>
    api<CrossWorkspaceShareDto[]>(
      `/workspaces/${workspaceId}/shares?direction=${direction}`,
    ),

  createShare: (
    workspaceId: string,
    body: {
      targetWorkspaceId: string;
      objectType: 'base' | 'sheet';
      objectId: string;
      role: 'view' | 'edit';
    },
  ) =>
    api<CrossWorkspaceShareDto>(`/workspaces/${workspaceId}/shares`, {
      method: 'POST',
      body,
    }),

  revokeShare: (shareId: string) =>
    api<{ id: string; revoked: boolean }>(`/shares/${shareId}`, {
      method: 'DELETE',
    }),

  listPublicViews: (sheetId: string) =>
    api<PublicViewDto[]>(`/sheets/${sheetId}/public-views`),

  createPublicView: (
    sheetId: string,
    body: { name?: string; password?: string; expiresAt?: string | null },
  ) =>
    api<PublicViewDto>(`/sheets/${sheetId}/public-views`, {
      method: 'POST',
      body,
    }),

  revokePublicView: (viewId: string) =>
    api<{ id: string; revoked: boolean }>(`/public-views/${viewId}`, {
      method: 'DELETE',
    }),

  getPublicView: (token: string, password?: string) =>
    api<PublicViewData>(
      `/public-views/${token}${
        password ? `?password=${encodeURIComponent(password)}` : ''
      }`,
    ),

  listApiKeys: (workspaceId: string) =>
    api<ApiKeyDto[]>(`/workspaces/${workspaceId}/api-keys`),

  createApiKey: (
    workspaceId: string,
    body: { name: string; scopes?: Array<'read' | 'write'> },
  ) =>
    api<ApiKeyDto>(`/workspaces/${workspaceId}/api-keys`, {
      method: 'POST',
      body,
    }),

  revokeApiKey: (keyId: string) =>
    api<{ id: string; revoked: boolean }>(`/api-keys/${keyId}`, {
      method: 'DELETE',
    }),

  listWebhooks: (workspaceId: string) =>
    api<WebhookDto[]>(`/workspaces/${workspaceId}/webhooks`),

  createWebhook: (
    workspaceId: string,
    body: { url: string; events?: string[] },
  ) =>
    api<WebhookDto>(`/workspaces/${workspaceId}/webhooks`, {
      method: 'POST',
      body,
    }),

  deleteWebhook: (webhookId: string) =>
    api<{ id: string; deleted: boolean }>(`/webhooks/${webhookId}`, {
      method: 'DELETE',
    }),

  listWebhookDeliveries: (webhookId: string, status?: string) =>
    api<WebhookDeliveryDto[]>(
      `/webhooks/${webhookId}/deliveries${status ? `?status=${status}` : ''}`,
    ),

  retryWebhookDelivery: (deliveryId: string) =>
    api<WebhookDeliveryDto>(`/webhook-deliveries/${deliveryId}/retry`, {
      method: 'POST',
    }),

  getQuota: (workspaceId: string) =>
    api<QuotaSnapshot>(`/workspaces/${workspaceId}/quota`),

  updateInstallationQuota: (body: {
    maxSeats?: number;
    maxStorageBytes?: number;
    maxAutomationRunsPerMonth?: number;
  }) =>
    api<{ key: string; maxSeats: number }>('/admin/quotas', {
      method: 'PUT',
      body: { scope: 'installation', ...body },
    }),

  listDataSyncs: (sheetId: string) =>
    api<DataSyncDto[]>(`/sheets/${sheetId}/data-syncs`),

  createDataSync: (
    sheetId: string,
    body: {
      name: string;
      sourceType: 'http' | 'file';
      config: { url?: string; headers?: Record<string, string>; fileId?: string };
      mapping: Record<string, string>;
      matchFieldId?: string;
      mode?: 'upsert' | 'replace';
      cron?: string;
    },
  ) =>
    api<DataSyncDto>(`/sheets/${sheetId}/data-syncs`, {
      method: 'POST',
      body,
    }),

  runDataSync: (syncId: string) =>
    api<DataSyncRunDto>(`/data-syncs/${syncId}/run`, { method: 'POST' }),

  listDataSyncRuns: (syncId: string) =>
    api<DataSyncRunDto[]>(`/data-syncs/${syncId}/runs`),

  deleteDataSync: (syncId: string) =>
    api<{ id: string; deleted: boolean }>(`/data-syncs/${syncId}`, {
      method: 'DELETE',
    }),

  uploadSyncFile: async (sheetId: string, file: File) => {
    const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
    const form = new FormData();
    form.append('file', file);
    const token = getToken();
    const response = await fetch(`${base}/sheets/${sheetId}/data-syncs/files`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (!response.ok) throw new ApiError(response.status, data);
    return data as { id: string; filename: string; size: number };
  },

  getWecomConfig: () =>
    api<{ enabled: boolean; authorizeUrl: string; redirectUri: string }>(
      '/auth/wecom/config',
    ),

  loginWithWecom: (code: string) =>
    api<AuthResult>('/auth/wecom/callback', {
      method: 'POST',
      body: { code },
    }),
};
