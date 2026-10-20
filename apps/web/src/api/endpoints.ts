import { api } from './client';
import type {
  AuthResult,
  BaseDto,
  CommentDto,
  FieldDto,
  MemberDto,
  RecordDto,
  RecordPage,
  SheetDto,
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
};
