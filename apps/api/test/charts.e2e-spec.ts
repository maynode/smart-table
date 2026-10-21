import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('Dashboard charts and scheduled delivery (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();
  let token: string;
  let baseId: string;
  let dashboardId: string;
  let widgetId: string;
  let scheduleId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const owner = await http()
      .post('/auth/register')
      .send({
        email: `charts-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: '图表管理员',
      });
    token = owner.body.accessToken;

    const workspace = await http()
      .post('/workspaces')
      .set(auth())
      .send({ name: `图表工作区${stamp}` });
    const base = await http()
      .post(`/workspaces/${workspace.body.id}/bases`)
      .set(auth())
      .send({ name: '图表 Base' });
    baseId = base.body.id;

    const sheet = await http()
      .post(`/bases/${baseId}/sheets`)
      .set(auth())
      .send({ name: '销售数据' });
    const region = await http()
      .post(`/sheets/${sheet.body.id}/fields`)
      .set(auth())
      .send({ name: '区域', type: 'text' });
    const amount = await http()
      .post(`/sheets/${sheet.body.id}/fields`)
      .set(auth())
      .send({ name: '金额', type: 'number' });

    for (const [area, value] of [
      ['华东', 10],
      ['华东', 5],
      ['华南', 3],
    ] as const) {
      await http()
        .post(`/sheets/${sheet.body.id}/records`)
        .set(auth())
        .send({
          cells: { [region.body.id]: area, [amount.body.id]: value },
        })
        .expect(201);
    }

    const dashboard = await http()
      .post(`/bases/${baseId}/dashboards`)
      .set(auth())
      .send({ name: '销售仪表盘' })
      .expect(201);
    dashboardId = dashboard.body.id;

    const widget = await http()
      .post(`/dashboards/${dashboardId}/widgets`)
      .set(auth())
      .send({
        type: 'bar',
        title: '区域销售额',
        sheetId: sheet.body.id,
        config: {
          dimensionFieldId: region.body.id,
          metricFieldId: amount.body.id,
          aggregation: 'sum',
        },
      })
      .expect(201);
    widgetId = widget.body.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('aggregates a bar chart from Postgres JSONB records', async () => {
    const response = await http()
      .post(`/dashboards/${dashboardId}/widgets/${widgetId}/query`)
      .set(auth())
      .expect(201);

    expect(response.body.type).toBe('bar');
    expect(response.body.labels.sort()).toEqual(['华东', '华南']);
    expect(response.body.values.sort((a: number, b: number) => a - b)).toEqual([
      3, 15,
    ]);
    expect(response.body.driver).toBe('postgres');

    const data = await http()
      .get(`/dashboards/${dashboardId}/data`)
      .set(auth())
      .expect(200);
    expect(data.body.widgets).toHaveLength(1);
    expect(data.body.dashboard.name).toBe('销售仪表盘');
  });

  it('creates a scheduled dashboard push and records a run', async () => {
    const schedule = await http()
      .post(`/dashboards/${dashboardId}/schedules`)
      .set(auth())
      .send({ cron: '0 9 * * *', channel: 'notification' })
      .expect(201);
    scheduleId = schedule.body.id;

    await http()
      .post(`/dashboards/${dashboardId}/schedules`)
      .set(auth())
      .send({ cron: 'bad cron' })
      .expect(400);

    const run = await http()
      .post(`/dashboards/${dashboardId}/schedules/${scheduleId}/run`)
      .set(auth())
      .expect(201);
    expect(run.body.status).toBe('success');
    expect(run.body.notificationId).toBeTruthy();
    expect(run.body.payload.widgets[0].labels).toEqual(
      expect.arrayContaining(['华东', '华南']),
    );

    const schedules = await http()
      .get(`/dashboards/${dashboardId}/schedules`)
      .set(auth())
      .expect(200);
    const saved = schedules.body.find(
      (item: { id: string }) => item.id === scheduleId,
    );
    expect(saved.runs).toHaveLength(1);
    expect(saved.lastRunAt).toBeTruthy();
  });

  it('lists analysis reports separately and rejects invalid widgets', async () => {
    const report = await http()
      .post(`/bases/${baseId}/dashboards`)
      .set(auth())
      .send({ name: '销售分析报告', kind: 'report' })
      .expect(201);
    const reports = await http()
      .get(`/bases/${baseId}/dashboards?kind=report`)
      .set(auth())
      .expect(200);
    expect(reports.body.map((item: { id: string }) => item.id)).toEqual([
      report.body.id,
    ]);

    await http()
      .post(`/dashboards/${dashboardId}/widgets`)
      .set(auth())
      .send({ type: 'radar', title: '不支持' })
      .expect(400);
  });
});
