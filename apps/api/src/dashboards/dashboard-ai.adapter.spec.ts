import {
  hasExplicitDeleteIntent,
  localDashboardAgentReply,
  parseDashboardActions,
  validateDashboardActions,
  type DashboardWidgetCatalogItem,
} from './dashboard-ai.adapter';
import type { SheetDigest } from '../ai/sheet-digest.types';

const sheetId = '11111111-1111-1111-1111-111111111111';
const dimId = '22222222-2222-2222-2222-222222222222';
const metricId = '33333333-3333-3333-3333-333333333333';
const widgetId = '44444444-4444-4444-4444-444444444444';

const digests: SheetDigest[] = [
  {
    sheetId,
    sheetName: '销售',
    fieldCount: 2,
    recordCount: 10,
    fields: [
      {
        id: dimId,
        name: '区域',
        type: 'text',
        nonEmpty: 10,
        empty: 0,
        topValues: [{ value: '华东', count: 5 }],
      },
      {
        id: metricId,
        name: '金额',
        type: 'number',
        nonEmpty: 10,
        empty: 0,
        topValues: [],
      },
    ],
  },
];

const widgets: DashboardWidgetCatalogItem[] = [
  {
    id: widgetId,
    type: 'bar',
    title: '区域销售额',
    sheetId,
    config: { dimensionFieldId: dimId, metricFieldId: metricId },
    layout: { w: 6, h: 3 },
    order: 0,
  },
];

describe('dashboard-ai.adapter', () => {
  it('parses DASHBOARD_ACTIONS block', () => {
    const raw = [
      '好的，已添加柱状图。',
      '<<<DASHBOARD_ACTIONS>>>',
      JSON.stringify([
        {
          op: 'add_widget',
          type: 'bar',
          title: '按区域统计',
          sheetId,
          config: { dimensionFieldId: dimId, metricFieldId: metricId },
        },
      ]),
      '<<<END_ACTIONS>>>',
    ].join('\n');
    const parsed = parseDashboardActions(raw);
    expect(parsed.reply).toContain('已添加');
    expect(parsed.actions).toHaveLength(1);
    expect((parsed.actions[0] as { op: string }).op).toBe('add_widget');
  });

  it('validates add_widget and rejects unknown field ids', () => {
    const ok = validateDashboardActions(
      [
        {
          op: 'add_widget',
          type: 'bar',
          title: '图1',
          sheetId,
          config: { dimensionFieldId: dimId, metricFieldId: metricId },
        },
      ],
      { digests, widgets, userText: '加一张柱状图' },
    );
    expect(ok.errors).toEqual([]);
    expect(ok.actions).toHaveLength(1);

    const bad = validateDashboardActions(
      [
        {
          op: 'add_widget',
          type: 'bar',
          title: '图2',
          sheetId,
          config: {
            dimensionFieldId: '99999999-9999-9999-9999-999999999999',
            metricFieldId: metricId,
          },
        },
      ],
      { digests, widgets, userText: '加图' },
    );
    expect(bad.actions).toHaveLength(0);
    expect(bad.errors.some((e) => e.includes('字段'))).toBe(true);
  });

  it('rejects delete without explicit intent', () => {
    expect(hasExplicitDeleteIntent('看看数据')).toBe(false);
    const result = validateDashboardActions(
      [{ op: 'delete_widget', widgetId }],
      { digests, widgets, userText: '看看数据' },
    );
    expect(result.actions).toHaveLength(0);
    expect(result.errors.some((e) => e.includes('删除'))).toBe(true);
  });

  it('allows delete when user text has delete intent', () => {
    const result = validateDashboardActions(
      [{ op: 'delete_widget', widgetId }],
      { digests, widgets, userText: '删除区域销售额' },
    );
    expect(result.errors).toEqual([]);
    expect(result.actions).toEqual([
      { op: 'delete_widget', widgetId },
    ]);
  });

  it('rejects update for foreign widgetId', () => {
    const result = validateDashboardActions(
      [
        {
          op: 'update_widget',
          widgetId: '55555555-5555-5555-5555-555555555555',
          layout: { w: 8, h: 4 },
        },
      ],
      { digests, widgets, userText: '放大' },
    );
    expect(result.actions).toHaveLength(0);
  });

  it('local fallback adds a bar chart from digests', () => {
    const out = localDashboardAgentReply({
      baseName: 'Demo',
      digests,
      widgets: [],
      conversation: [{ role: 'user', content: '加一张柱状图' }],
      userText: '加一张柱状图',
    });
    expect(out.actions).toHaveLength(1);
    expect(out.actions[0]).toMatchObject({
      op: 'add_widget',
      type: 'bar',
      sheetId,
    });
  });

  it('local fallback deletes by title when intent present', () => {
    const out = localDashboardAgentReply({
      baseName: 'Demo',
      digests,
      widgets,
      conversation: [],
      userText: '删除区域销售额',
    });
    expect(out.actions).toEqual([
      { op: 'delete_widget', widgetId },
    ]);
  });
});
