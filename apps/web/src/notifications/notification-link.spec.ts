import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/endpoints', () => ({
  endpoints: {
    getBase: vi.fn(),
    getSheet: vi.fn(),
    getDashboard: vi.fn(),
  },
}));

import { endpoints } from '../api/endpoints';
import { resolveNotificationLink } from './notification-link';

describe('resolveNotificationLink', () => {
  beforeEach(() => {
    vi.mocked(endpoints.getBase).mockReset();
    vi.mocked(endpoints.getSheet).mockReset();
    vi.mocked(endpoints.getDashboard).mockReset();
  });

  it('opens form results for form_submit', async () => {
    vi.mocked(endpoints.getBase).mockResolvedValue({
      id: 'b1',
      workspaceId: 'ws1',
      name: 'Demo',
      createdAt: '',
      updatedAt: '',
    });
    vi.mocked(endpoints.getSheet).mockResolvedValue({
      id: 's1',
      baseId: 'b1',
      name: '收集',
      createdAt: '',
      updatedAt: '',
    });
    const result = await resolveNotificationLink({
      kind: 'form_submit',
      workspaceId: 'ws1',
      baseId: 'b1',
      sheetId: 's1',
    });
    expect(result).toEqual({
      status: 'ok',
      route: {
        path: '/workspaces/ws1/bases/b1',
        query: { sheet: 's1', view: 'form-results' },
      },
    });
  });

  it('falls back with toast message when sheet gone', async () => {
    vi.mocked(endpoints.getBase).mockResolvedValue({
      id: 'b1',
      workspaceId: 'ws1',
      name: 'Demo',
      createdAt: '',
      updatedAt: '',
    });
    vi.mocked(endpoints.getSheet).mockRejectedValue(new Error('gone'));
    const result = await resolveNotificationLink({
      kind: 'form_submit',
      baseId: 'b1',
      sheetId: 's1',
    });
    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') return;
    expect(result.message).toContain('工作表');
    expect(result.fallback).toEqual({
      path: '/workspaces/ws1/bases/b1',
    });
  });

  it('reports when whole base is gone', async () => {
    vi.mocked(endpoints.getBase).mockRejectedValue(new Error('404'));
    const result = await resolveNotificationLink({
      kind: 'automation_message',
      baseId: 'b1',
    });
    expect(result).toEqual({
      status: 'unavailable',
      message: '相关表格已删除，或你已无权限访问',
    });
  });

  it('opens home workspace for invite', async () => {
    const result = await resolveNotificationLink({
      kind: 'workspace_member_added',
      workspaceId: 'ws1',
    });
    expect(result).toEqual({
      status: 'ok',
      route: { path: '/', query: { ws: 'ws1' } },
    });
  });
});
