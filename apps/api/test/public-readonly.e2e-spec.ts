import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Public read-only views (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();
  let token: string;
  let baseId: string;
  let sheetId: string;
  let openViewId: string;
  let openViewToken: string;
  let sheetToken: string | undefined;

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
        account: `pv${stamp}`,
        password: 'Ab12_cd34',
        securityQuestion: '你小学就读的学校名称是？',
        securityAnswer: 'demo',
      });
    expect(owner.status).toBe(201);
    token = owner.body.accessToken;
    const workspace = await http()
      .post('/workspaces')
      .set(auth())
      .send({ name: `公开视图${stamp}` });
    const base = await http()
      .post(`/workspaces/${workspace.body.id}/bases`)
      .set(auth())
      .send({ name: '公开只读 Base' });
    baseId = base.body.id;
    const sheet = await http()
      .post(`/bases/${baseId}/sheets`)
      .set(auth())
      .send({ name: '公开数据', seed: false });
    sheetId = sheet.body.id;
    const visible = await http()
      .post(`/sheets/${sheetId}/fields`)
      .set(auth())
      .send({ name: '名称', type: 'text' });
    const hidden = await http()
      .post(`/sheets/${sheetId}/fields`)
      .set(auth())
      .send({ name: '内部备注', type: 'text', hidden: true });
    expect(visible.status).toBe(201);
    expect(hidden.status).toBe(201);
    await http()
      .post(`/sheets/${sheetId}/records`)
      .set(auth())
      .send({
        cells: {
          [visible.body.id]: '公开行',
          [hidden.body.id]: '不该出现',
        },
      })
      .expect(201);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('exposes a read-only snapshot without authentication', async () => {
    const created = await http()
      .post(`/sheets/${sheetId}/public-views`)
      .set(auth())
      .send({ name: '对外数据' })
      .expect(201);
    openViewId = created.body.id;
    openViewToken = created.body.token;
    expect(created.body.url).toContain(`/view/${openViewToken}`);
    expect(created.body.passwordRequired).toBe(false);

    const view = await http()
      .get(`/public-views/${openViewToken}`)
      .expect(200);
    expect(view.body.readonly).toBe(true);
    expect(view.body.name).toBe('对外数据');
    expect(view.body.sheets).toHaveLength(1);
    expect(view.body.sheets[0].id).toBe(sheetId);
    expect(view.body.fields.map((field: { name: string }) => field.name)).toEqual([
      '名称',
    ]);
    expect(view.body.records[0].cells).not.toContain('不该出现');

    await http()
      .post(`/public-views/${openViewToken}/records`)
      .send({ cells: {} })
      .expect(403);
    const recordId = view.body.records[0].id;
    await http()
      .patch(`/public-views/${openViewToken}/records/${recordId}`)
      .send({ cells: {} })
      .expect(403);
    await http()
      .delete(`/public-views/${openViewToken}/records/${recordId}`)
      .expect(403);
  });

  it('accepts explicit multi-type scope and rejects empty/no-data picks', async () => {
    const options = await http()
      .get(`/sheets/${sheetId}/public-views/scope-options`)
      .set(auth())
      .expect(200);
    expect(
      options.body.sheets.some(
        (item: { id: string; hasData: boolean }) =>
          item.id === sheetId && item.hasData,
      ),
    ).toBe(true);

    const second = await http()
      .post(`/bases/${baseId}/sheets`)
      .set(auth())
      .send({ name: '第二张表', seed: false })
      .expect(201);
    const secondId = second.body.id as string;
    const field = await http()
      .post(`/sheets/${secondId}/fields`)
      .set(auth())
      .send({ name: '标题', type: 'text' })
      .expect(201);
    await http()
      .post(`/sheets/${secondId}/records`)
      .set(auth())
      .send({ cells: { [field.body.id]: 'B行' } })
      .expect(201);

    const dashboard = await http()
      .post(`/bases/${baseId}/dashboards`)
      .set(auth())
      .send({ name: '公开仪表盘' })
      .expect(201);
    await http()
      .post(`/dashboards/${dashboard.body.id}/widgets`)
      .set(auth())
      .send({
        type: 'metric',
        title: '行数',
        sheetId,
        config: { aggregation: 'count' },
      })
      .expect(201);

    const created = await http()
      .post(`/sheets/${sheetId}/public-views`)
      .set(auth())
      .send({
        name: '多类型公开',
        sheetIds: [sheetId, secondId],
        formSheetIds: [],
        dashboardIds: [dashboard.body.id],
        analysisReportIds: [],
      })
      .expect(201);
    expect(created.body.sheetIds).toEqual([sheetId, secondId]);
    expect(created.body.dashboardIds).toEqual([dashboard.body.id]);

    const view = await http()
      .get(`/public-views/${created.body.token}`)
      .expect(200);
    expect(view.body.sheets).toHaveLength(2);
    expect(view.body.dashboards).toHaveLength(1);
    expect(view.body.dashboards[0].widgets.length).toBeGreaterThan(0);

    await http()
      .post(`/sheets/${sheetId}/public-views`)
      .set(auth())
      .send({
        sheetIds: [],
        formSheetIds: [],
        dashboardIds: [],
        analysisReportIds: [],
      })
      .expect(400);
  });

  it('enforces password and expiry, then revokes', async () => {
    const protectedView = await http()
      .post(`/sheets/${sheetId}/public-views`)
      .set(auth())
      .send({ name: '密码视图', password: 'view-pass' })
      .expect(201);
    sheetToken = protectedView.body.token;
    expect(protectedView.body.passwordRequired).toBe(true);

    await http().get(`/public-views/${sheetToken}`).expect(401);
    await http()
      .get(`/public-views/${sheetToken}?password=wrong`)
      .expect(403);
    const verified = await http()
      .post(`/public-views/${sheetToken}/verify`)
      .send({ password: 'view-pass' })
      .expect(201);
    expect(verified.body.records).toHaveLength(1);

    await http()
      .post(`/sheets/${sheetId}/public-views`)
      .set(auth())
      .send({ password: 'x' })
      .expect(400);

    const prisma = app.get(PrismaService);
    await prisma.publicView.update({
      where: { id: openViewId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await http().get(`/public-views/${openViewToken}`).expect(410);

    await http().delete(`/public-views/${openViewId}`).set(auth()).expect(200);
    await http().get(`/public-views/${openViewToken}`).expect(404);
  });

  it('requires editor access to manage views', async () => {
    const outsider = await http()
      .post('/auth/register')
      .send({
        account: `pvo${stamp}`,
        password: 'Ab12_cd34',
        securityQuestion: '你小学就读的学校名称是？',
        securityAnswer: 'demo',
      })
      .expect(201);
    await http()
      .post(`/sheets/${sheetId}/public-views`)
      .set({ Authorization: `Bearer ${outsider.body.accessToken}` })
      .send({})
      .expect(403);
  });
});
