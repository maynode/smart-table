import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('Dashboard AI Agent (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();
  let ownerToken: string;
  let viewerToken: string;
  let baseId: string;
  let sheetId: string;
  let dashboardId: string;
  let regionFieldId: string;
  let amountFieldId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
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
        account: `dai${String(stamp).slice(-10)}`,
        password: 'Ab12_cd34',
        securityQuestion: '你小学就读的学校名称是？',
        securityAnswer: 'demo',
      });
    expect(owner.status).toBeLessThan(400);
    ownerToken = owner.body.accessToken;

    const workspace = await http()
      .post('/workspaces')
      .set(auth(ownerToken))
      .send({ name: `AI仪表盘工作区${stamp}` });
    const base = await http()
      .post(`/workspaces/${workspace.body.id}/bases`)
      .set(auth(ownerToken))
      .send({ name: 'AI 仪表盘 Base' });
    baseId = base.body.id;

    const viewerAccount = `daiv${String(stamp).slice(-9)}`;
    const viewerReg = await http()
      .post('/auth/register')
      .send({
        account: viewerAccount,
        password: 'Ab12_cd34',
        securityQuestion: '你小学就读的学校名称是？',
        securityAnswer: 'demo',
      });
    expect(viewerReg.status).toBeLessThan(400);
    viewerToken = viewerReg.body.accessToken;
    await http()
      .post(`/workspaces/${workspace.body.id}/members`)
      .set(auth(ownerToken))
      .send({ account: viewerAccount, role: 'viewer' })
      .expect(201);

    const sheet = await http()
      .post(`/bases/${baseId}/sheets`)
      .set(auth(ownerToken))
      .send({ name: '销售数据', seed: false });
    sheetId = sheet.body.id;
    const region = await http()
      .post(`/sheets/${sheetId}/fields`)
      .set(auth(ownerToken))
      .send({ name: '区域', type: 'text' });
    regionFieldId = region.body.id;
    const amount = await http()
      .post(`/sheets/${sheetId}/fields`)
      .set(auth(ownerToken))
      .send({ name: '金额', type: 'number' });
    amountFieldId = amount.body.id;
    await http()
      .post(`/sheets/${sheetId}/records`)
      .set(auth(ownerToken))
      .send({
        cells: { [regionFieldId]: '华东', [amountFieldId]: 10 },
      })
      .expect(201);

    const dashboard = await http()
      .post(`/bases/${baseId}/dashboards`)
      .set(auth(ownerToken))
      .send({ name: 'AI 销售盘' })
      .expect(201);
    dashboardId = dashboard.body.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('lazy-creates session and chats to add a bar widget (local fallback)', async () => {
    const session = await http()
      .get(`/dashboards/${dashboardId}/ai/session`)
      .set(auth(ownerToken))
      .expect(200);
    expect(session.body.messages?.length).toBeGreaterThan(0);
    expect(session.body.status).toBe('idle');

    const clientMessageId = `idem-${stamp}-add`;
    const chat = await http()
      .post(`/dashboards/${dashboardId}/ai/chat`)
      .set(auth(ownerToken))
      .send({ text: '加一张柱状图', clientMessageId })
      .expect(201);

    expect(chat.body.applied?.length).toBeGreaterThanOrEqual(1);
    expect(chat.body.applied[0].op).toBe('add_widget');
    expect(chat.body.widgets?.length).toBeGreaterThanOrEqual(1);
    const widgetId = chat.body.applied[0].widgetId as string;
    expect(widgetId).toBeTruthy();

    const again = await http()
      .post(`/dashboards/${dashboardId}/ai/chat`)
      .set(auth(ownerToken))
      .send({ text: '加一张柱状图', clientMessageId })
      .expect(201);
    expect(again.body.idempotent).toBe(true);
    expect(again.body.widgets.length).toBe(chat.body.widgets.length);

    const detail = await http()
      .get(`/dashboards/${dashboardId}`)
      .set(auth(ownerToken))
      .expect(200);
    expect(detail.body.widgets.some((w: { id: string }) => w.id === widgetId)).toBe(
      true,
    );
  });

  it('updates layout and deletes with explicit intent', async () => {
    const before = await http()
      .get(`/dashboards/${dashboardId}`)
      .set(auth(ownerToken))
      .expect(200);
    const widget = before.body.widgets[0];
    expect(widget).toBeTruthy();

    const resized = await http()
      .post(`/dashboards/${dashboardId}/ai/chat`)
      .set(auth(ownerToken))
      .send({ text: `放大${widget.title}` })
      .expect(201);
    expect(
      resized.body.applied?.some(
        (a: { op: string }) => a.op === 'update_widget',
      ),
    ).toBe(true);

    const afterResize = await http()
      .get(`/dashboards/${dashboardId}`)
      .set(auth(ownerToken))
      .expect(200);
    const updated = afterResize.body.widgets.find(
      (w: { id: string }) => w.id === widget.id,
    );
    expect(updated?.layout?.w).toBeGreaterThanOrEqual(6);

    const deleted = await http()
      .post(`/dashboards/${dashboardId}/ai/chat`)
      .set(auth(ownerToken))
      .send({ text: `删除${widget.title}` })
      .expect(201);
    expect(
      deleted.body.applied?.some(
        (a: { op: string; widgetId?: string }) =>
          a.op === 'delete_widget' && a.widgetId === widget.id,
      ),
    ).toBe(true);

    const afterDelete = await http()
      .get(`/dashboards/${dashboardId}`)
      .set(auth(ownerToken))
      .expect(200);
    expect(
      afterDelete.body.widgets.some((w: { id: string }) => w.id === widget.id),
    ).toBe(false);
  });

  it('forbids viewer from chatting', async () => {
    const res = await http()
      .post(`/dashboards/${dashboardId}/ai/chat`)
      .set(auth(viewerToken))
      .send({ text: '加一张柱状图' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('allows viewer to read session', async () => {
    await http()
      .get(`/dashboards/${dashboardId}/ai/session`)
      .set(auth(viewerToken))
      .expect(200);
  });
});
