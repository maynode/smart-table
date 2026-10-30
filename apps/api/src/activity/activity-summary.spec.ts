import {
  asUuidOrNull,
  describeActivity,
  normalizePath,
  shouldSkipActivity,
} from './activity-summary';

describe('activity-summary', () => {
  it('normalizes /api prefix', () => {
    expect(normalizePath('/api/sheets/abc')).toBe('/sheets/abc');
    expect(normalizePath('/sheets/abc?x=1')).toBe('/sheets/abc');
  });

  it('skips admin, live polls, query-like writes, and non-allowlisted GETs', () => {
    expect(shouldSkipActivity('GET', '/admin/users')).toBe(true);
    expect(shouldSkipActivity('POST', '/admin/users/x/message')).toBe(true);
    expect(shouldSkipActivity('GET', '/auth/me')).toBe(true);
    expect(shouldSkipActivity('GET', '/notifications')).toBe(true);
    expect(shouldSkipActivity('GET', '/bases/b1/live/since')).toBe(true);
    expect(shouldSkipActivity('GET', '/workspaces/w1/live/since')).toBe(true);
    expect(shouldSkipActivity('GET', '/sheets/s1/records')).toBe(true);
    expect(shouldSkipActivity('GET', '/sheets/s1')).toBe(true);
    expect(shouldSkipActivity('GET', '/sheets/s1/export')).toBe(false);
    expect(shouldSkipActivity('POST', '/sheets/a/commitchanges')).toBe(false);
    expect(shouldSkipActivity('POST', '/sheets/s1/query')).toBe(true);
    expect(
      shouldSkipActivity('POST', '/dashboards/d1/widgets/w1/query'),
    ).toBe(true);
    expect(shouldSkipActivity('POST', '/notifications/read-all')).toBe(true);
  });

  it('describes dashboard and public view writes', () => {
    expect(
      describeActivity({
        method: 'POST',
        path: '/bases/11111111-1111-4111-8111-111111111111/dashboards',
        account: 'carol',
        body: { name: '销售看板' },
      }).summary,
    ).toBe('carol 创建了仪表盘「销售看板」');
    expect(
      describeActivity({
        method: 'DELETE',
        path: '/public-views/pv1',
        account: 'carol',
      }).summary,
    ).toBe('carol 删除了公开视图');
  });

  it('describes sheet create in Chinese', () => {
    const r = describeActivity({
      method: 'POST',
      path: '/bases/11111111-1111-4111-8111-111111111111/sheets',
      account: 'alice',
      body: { name: '销售明细' },
    });
    expect(r.action).toBe('sheet.create');
    expect(r.op).toBe('create');
    expect(r.summary).toBe('alice 新建了数据表「销售明细」');
    expect(r.baseId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('describes real auth routes', () => {
    expect(
      describeActivity({
        method: 'POST',
        path: '/auth/username',
        account: 'bob',
      }).summary,
    ).toBe('bob 修改了用户名');
    expect(
      describeActivity({
        method: 'POST',
        path: '/auth/delete-account',
        account: 'bob',
      }).summary,
    ).toBe('bob 注销了账号');
    expect(
      describeActivity({
        method: 'POST',
        path: '/auth/login',
        account: 'bob',
      }).summary,
    ).toBe('bob 登录了系统');
  });

  it('nulls non-uuid context ids', () => {
    expect(asUuidOrNull('not-a-uuid')).toBeNull();
    expect(asUuidOrNull('11111111-1111-4111-8111-111111111111')).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
    const r = describeActivity({
      method: 'POST',
      path: '/bases/not-uuid/sheets',
      account: 'alice',
      body: { name: 'T' },
    });
    expect(r.baseId).toBeNull();
  });
});
