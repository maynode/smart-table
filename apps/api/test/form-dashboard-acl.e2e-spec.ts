import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('Form & dashboard object ACL (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();
  const password = 'Ab12_cd34';
  const ownerAccount = `fo${String(stamp).slice(-10)}`;
  const editorAccount = `fe${String(stamp).slice(-10)}`;
  let ownerToken: string;
  let editorToken: string;
  let editorId: string;
  let workspaceId: string;
  let baseId: string;
  let sheetId: string;
  let formId: string;
  let dashboardId: string;

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
        account: ownerAccount,
        password,
        securityQuestion: '你小学就读的学校名称是？',
        securityAnswer: 'demo',
      });
    expect(owner.status).toBeLessThan(400);
    ownerToken = owner.body.accessToken;

    const editor = await http()
      .post('/auth/register')
      .send({
        account: editorAccount,
        password,
        securityQuestion: '你小学就读的学校名称是？',
        securityAnswer: 'demo',
      });
    expect(editor.status).toBeLessThan(400);
    editorToken = editor.body.accessToken;
    editorId = editor.body.user.id;

    const workspace = await http()
      .post('/workspaces')
      .set(auth(ownerToken))
      .send({ name: `表单仪表盘ACL${stamp}` })
      .expect(201);
    workspaceId = workspace.body.id;

    await http()
      .post(`/workspaces/${workspaceId}/members`)
      .set(auth(ownerToken))
      .send({ account: editorAccount, role: 'editor' })
      .expect(201);

    const base = await http()
      .post(`/workspaces/${workspaceId}/bases`)
      .set(auth(ownerToken))
      .send({ name: 'ACL Base' })
      .expect(201);
    baseId = base.body.id;

    const sheet = await http()
      .post(`/bases/${baseId}/sheets`)
      .set(auth(ownerToken))
      .send({ name: '收集表单', seed: false })
      .expect(201);
    sheetId = sheet.body.id;

    const field = await http()
      .post(`/sheets/${sheetId}/fields`)
      .set(auth(ownerToken))
      .send({ name: '姓名', type: 'text' })
      .expect(201);

    formId = randomUUID();
    await http()
      .post(`/forms/${formId}`)
      .set(auth(ownerToken))
      .send({
        baseId,
        sheetId,
        name: '报名表',
        fields: [{ fieldId: field.body.id, required: true }],
      })
      .expect(201);

    const dashboard = await http()
      .post(`/bases/${baseId}/dashboards`)
      .set(auth(ownerToken))
      .send({ name: '销售看板' })
      .expect(201);
    dashboardId = dashboard.body.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('hides form when member level is none', async () => {
    const listed = await http()
      .get(`/forms?baseId=${baseId}`)
      .set(auth(editorToken))
      .expect(200);
    expect(listed.body.some((f: { id: string }) => f.id === formId)).toBe(true);

    await http()
      .put(`/permissions/form/${formId}`)
      .set(auth(ownerToken))
      .send({
        members: [{ userId: editorId, level: 'none' }],
      })
      .expect(200);

    const hidden = await http()
      .get(`/forms?baseId=${baseId}`)
      .set(auth(editorToken))
      .expect(200);
    expect(hidden.body.some((f: { id: string }) => f.id === formId)).toBe(
      false,
    );

    await http()
      .get(`/forms/${formId}`)
      .set(auth(editorToken))
      .expect(403);
  });

  it('hides dashboard when member level is none', async () => {
    const listed = await http()
      .get(`/bases/${baseId}/dashboards`)
      .set(auth(editorToken))
      .expect(200);
    expect(listed.body.some((d: { id: string }) => d.id === dashboardId)).toBe(
      true,
    );

    await http()
      .put(`/permissions/dashboard/${dashboardId}`)
      .set(auth(ownerToken))
      .send({
        members: [{ userId: editorId, level: 'none' }],
      })
      .expect(200);

    const hidden = await http()
      .get(`/bases/${baseId}/dashboards`)
      .set(auth(editorToken))
      .expect(200);
    expect(hidden.body.some((d: { id: string }) => d.id === dashboardId)).toBe(
      false,
    );

    await http()
      .get(`/dashboards/${dashboardId}`)
      .set(auth(editorToken))
      .expect(403);
  });

  it('rejects form/dashboard permission writes from non-admins', async () => {
    await http()
      .put(`/permissions/form/${formId}`)
      .set(auth(editorToken))
      .send({ everyone: { level: 'view' } })
      .expect(403);

    await http()
      .put(`/permissions/dashboard/${dashboardId}`)
      .set(auth(editorToken))
      .send({ everyone: { level: 'view' } })
      .expect(403);
  });
});
