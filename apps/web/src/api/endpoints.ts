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
  TemplateDto,
  TemplateInstantiateResult,
  PublicViewDto,
  PublicViewData,
  SavedViewDto,
  NotificationDto,
  AnalysisReportDto,
  AnalysisReportListItemDto,
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

  inviteMember: (
    workspaceId: string,
    email: string,
    role: 'owner' | 'admin' | 'editor' | 'viewer',
  ) =>
    api<MemberDto>(`/workspaces/${workspaceId}/members`, {
      method: 'POST',
      body: { email, role },
    }),

  updateMemberRole: (
    workspaceId: string,
    userId: string,
    role: 'owner' | 'admin' | 'editor' | 'viewer',
  ) =>
    api<MemberDto>(`/workspaces/${workspaceId}/members/${userId}`, {
      method: 'PATCH',
      body: { role },
    }),

  removeMember: (workspaceId: string, userId: string) =>
    api<void>(`/workspaces/${workspaceId}/members/${userId}`, {
      method: 'DELETE',
    }),

  listBases: (workspaceId: string) =>
    api<BaseDto[]>(`/workspaces/${workspaceId}/bases`),

  createBase: (
    workspaceId: string,
    name: string,
    description?: string | null,
  ) =>
    api<BaseDto>(`/workspaces/${workspaceId}/bases`, {
      body: { name, description: description ?? null },
    }),

  getBase: (baseId: string) => api<BaseDto>(`/bases/${baseId}`),

  renameBase: (baseId: string, name: string) =>
    api<BaseDto>(`/bases/${baseId}`, {
      method: 'PATCH',
      body: { name },
    }),

  updateBase: (
    baseId: string,
    body: { name?: string; description?: string | null },
  ) =>
    api<BaseDto>(`/bases/${baseId}`, {
      method: 'PATCH',
      body,
    }),

  deleteBase: (baseId: string) =>
    api<{ id: string; deleted: boolean }>(`/bases/${baseId}`, {
      method: 'DELETE',
    }),

  moveBase: (baseId: string, workspaceId: string) =>
    api<BaseDto>(`/bases/${baseId}/move`, {
      method: 'POST',
      body: { workspaceId },
    }),

  reorderBases: (workspaceId: string, orderedIds: string[]) =>
    api<BaseDto[]>(`/workspaces/${workspaceId}/bases/reorder`, {
      method: 'POST',
      body: { orderedIds },
    }),

  listSheets: (baseId: string) =>
    api<SheetDto[]>(`/bases/${baseId}/sheets`),

  createSheet: (baseId: string, name: string) =>
    api<SheetDto>(`/bases/${baseId}/sheets`, { body: { name } }),

  getSheet: (sheetId: string) => api<SheetDto>(`/sheets/${sheetId}`),

  updateSheet: (sheetId: string, name: string) =>
    api<SheetDto>(`/sheets/${sheetId}`, {
      method: 'PATCH',
      body: { name },
    }),

  deleteSheet: (sheetId: string) =>
    api<{ id: string; deleted: boolean }>(`/sheets/${sheetId}`, {
      method: 'DELETE',
    }),

  deleteField: (fieldId: string) =>
    api<{ id: string; deleted: boolean }>(`/fields/${fieldId}`, {
      method: 'DELETE',
    }),

  deleteRecord: (recordId: string) =>
    api<{ id: string; deleted: boolean }>(`/records/${recordId}`, {
      method: 'DELETE',
    }),

  uploadAttachment: async (sheetId: string, file: File) => {
    const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
    const form = new FormData();
    form.append('file', file);
    const token = getToken();
    const response = await fetch(`${base}/sheets/${sheetId}/attachments`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (!response.ok) throw new ApiError(response.status, data);
    return data as {
      url: string;
      name: string;
      mimetype: string;
      size: number;
    };
  },

  listSavedViews: (sheetId: string) =>
    api<SavedViewDto[]>(`/sheets/${sheetId}/saved-views`),

  createSavedView: (
    sheetId: string,
    body: { name: string; query: ViewQuery },
  ) =>
    api<SavedViewDto>(`/sheets/${sheetId}/saved-views`, {
      method: 'POST',
      body,
    }),

  updateSavedView: (
    viewId: string,
    body: { name?: string; query?: ViewQuery },
  ) =>
    api<SavedViewDto>(`/saved-views/${viewId}`, {
      method: 'PATCH',
      body,
    }),

  deleteSavedView: (viewId: string) =>
    api<{ deleted: boolean }>(`/saved-views/${viewId}`, {
      method: 'DELETE',
    }),

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

  createComment: (
    sheetId: string,
    body: string,
    mentionedUserIds: string[] = [],
  ) =>
    api<CommentDto>(`/sheets/${sheetId}/comments`, {
      body: { body, mentionedUserIds },
    }),

  listForms: (baseId: string) =>
    api<FormDto[]>(`/forms?baseId=${encodeURIComponent(baseId)}`),

  getForm: (formId: string) => api<FormDto>(`/forms/${formId}`),

  upsertForm: (formId: string, body: UpsertFormPayload) =>
    api<FormDto>(`/forms/${formId}`, { body }),

  uploadFormCover: async (formId: string, file: File) => {
    const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
    const form = new FormData();
    form.append('file', file);
    const token = getToken();
    const response = await fetch(`${base}/forms/${formId}/cover`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (!response.ok) throw new ApiError(response.status, data);
    return data as { coverUrl: string };
  },

  previewFormSuccess: (
    formId: string,
    body: {
      formCells?: Record<string, unknown>;
      stepOutputs?: Record<string, unknown>;
    },
  ) =>
    api<{ html: string }>(`/forms/${formId}/success-preview`, {
      method: 'POST',
      body,
    }),

  getPublicForm: (token: string) =>
    api<PublicFormDto>(`/public/forms/${encodeURIComponent(token)}`, {
      token: null,
    }),

  uploadPublicFormAttachment: async (token: string, file: File) => {
    const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
    const body = new FormData();
    body.append('file', file);
    const response = await fetch(
      `${base}/public/forms/${encodeURIComponent(token)}/attachments`,
      { method: 'POST', body },
    );
    const text = await response.text();
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (!response.ok) throw new ApiError(response.status, data);
    return data as {
      url: string;
      name: string;
      mimetype: string;
      size: number;
    };
  },

  submitPublicForm: (token: string, cells: Record<string, unknown>) =>
    api<FormSubmitResult>(
      `/public/forms/${encodeURIComponent(token)}/submit`,
      { body: { cells }, token: null },
    ),

  listAutomations: (baseId: string) =>
    api<AutomationDto[]>(`/automations?baseId=${encodeURIComponent(baseId)}`),

  getAutomation: (automationId: string) =>
    api<AutomationDto>(`/automations/${automationId}`),

  createAutomation: (body: {
    baseId: string;
    name: string;
    enabled?: boolean;
    trigger: Record<string, unknown>;
    steps: Array<Record<string, unknown>>;
    onFindEmpty?: 'continue' | 'stop';
    monthlyQuota?: number | null;
  }) =>
    api<AutomationDto>('/automations', {
      method: 'POST',
      body,
    }),

  updateAutomation: (
    automationId: string,
    body: {
      name?: string;
      enabled?: boolean;
      trigger?: Record<string, unknown>;
      steps?: Array<Record<string, unknown>>;
      onFindEmpty?: 'continue' | 'stop';
      monthlyQuota?: number | null;
    },
  ) =>
    api<AutomationDto>(`/automations/${automationId}`, {
      method: 'PATCH',
      body,
    }),

  deleteAutomation: (automationId: string) =>
    api<{ deleted: boolean }>(`/automations/${automationId}`, {
      method: 'DELETE',
    }),

  runAutomation: (automationId: string) =>
    api<{
      runId: string;
      status: string;
      outputs?: unknown[];
      stepOutputs?: Record<string, string>;
    }>(`/automations/${automationId}/run`, {
      method: 'POST',
      body: {},
    }),

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

  updateDashboardWidget: (
    dashboardId: string,
    widgetId: string,
    body: Record<string, unknown>,
  ) =>
    api<DashboardWidgetDto>(`/dashboards/${dashboardId}/widgets/${widgetId}`, {
      method: 'PATCH',
      body,
    }),

  deleteDashboardWidget: (dashboardId: string, widgetId: string) =>
    api<{ id: string; deleted: boolean }>(
      `/dashboards/${dashboardId}/widgets/${widgetId}`,
      { method: 'DELETE' },
    ),

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

  listTemplates: () => api<TemplateDto[]>('/templates'),

  instantiateTemplate: (
    key: string,
    body: {
      workspaceId: string;
      name?: string;
    },
  ) =>
    api<TemplateInstantiateResult>(`/templates/${key}/instantiate`, {
      method: 'POST',
      body,
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

  listNotifications: (limit = 50) =>
    api<{ notifications: NotificationDto[] }>(
      `/notifications?limit=${limit}`,
    ),

  markNotificationRead: (id: string) =>
    api<{ read: boolean }>(`/notifications/${id}/read`, { method: 'POST' }),

  listAnalysisReports: (baseId: string) =>
    api<AnalysisReportListItemDto[]>(`/bases/${baseId}/analysis-reports`),

  createAnalysisReport: (baseId: string, name?: string) =>
    api<AnalysisReportDto>(`/bases/${baseId}/analysis-reports`, {
      method: 'POST',
      body: { name },
    }),

  getAnalysisReport: (id: string) =>
    api<AnalysisReportDto>(`/analysis-reports/${id}`),

  answerAnalysisReport: (
    id: string,
    body: { optionId?: string; text?: string; skip?: boolean },
  ) =>
    api<AnalysisReportDto>(`/analysis-reports/${id}/answer`, {
      method: 'POST',
      body,
    }),

  generateAnalysisReport: (id: string) =>
    api<AnalysisReportDto>(`/analysis-reports/${id}/generate`, {
      method: 'POST',
    }),
};
