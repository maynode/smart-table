import { api } from './client';
import type {
  AuthResult,
  AutomationDto,
  AutomationRunDto,
  BaseDto,
  CommentDto,
  FieldDto,
  FormDto,
  FormSubmitResult,
  MemberDto,
  PublicFormDto,
  RecordDto,
  RecordPage,
  SheetDto,
  UpsertFormPayload,
  WorkspaceDto,
} from './types';

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

  updateField: (
    fieldId: string,
    patch: { hidden?: boolean; name?: string },
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
};
