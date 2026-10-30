import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('Template library (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();
  let token: string;
  let workspaceId: string;
  let templateBaseId: string;
  let serialBaseId: string;

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
        account: `templates${stamp}`,
        password: 'Passw0rd!123',
                securityQuestion: '你小学就读的学校名称是？', securityAnswer: 'demo',
        });
    token = owner.body.accessToken;
    const workspace = await http()
      .post('/workspaces')
      .set(auth())
      .send({ name: `模板工作区${stamp}` });
    workspaceId = workspace.body.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('lists templates and instantiates the serial claim template', async () => {
    const catalog = await http().get('/templates').set(auth()).expect(200);
    const keys = catalog.body.map((item: { key: string }) => item.key);
    expect(keys).toEqual(
      expect.arrayContaining(['serial-claim', 'customer-crm', 'project-tasks']),
    );

    const created = await http()
      .post('/templates/serial-claim/instantiate')
      .set(auth())
      .send({ workspaceId, name: '领取演示' })
      .expect(201);
    serialBaseId = created.body.baseId;
    expect(created.body.codes).toBe(100);
    expect(
      created.body.sheets.map((sheet: { name: string }) => sheet.name),
    ).toEqual(['码库', '收集表单']);
    expect(created.body.shareUrl).toContain('/fill/');

    const base = await http()
      .get(`/bases/${serialBaseId}`)
      .set(auth())
      .expect(200);
    expect(base.body.name).toBe('领取演示');
    expect(base.body.workspaceId).toBe(workspaceId);

    const sheets = await http()
      .get(`/bases/${serialBaseId}/sheets`)
      .set(auth())
      .expect(200);
    const codeSheet = sheets.body.find(
      (sheet: { name: string }) => sheet.name === '码库',
    );
    const records = await http()
      .get(`/sheets/${codeSheet.id}/records?limit=200`)
      .set(auth())
      .expect(200);
    expect(records.body.records).toHaveLength(100);
    expect(records.body.records[0].claimStatus).toBe('unclaimed');
  });

  it('instantiates with custom name and supports base rename', async () => {
    const customer = await http()
      .post('/templates/customer-crm/instantiate')
      .set(auth())
      .send({ workspaceId, name: '我的客户库' })
      .expect(201);
    templateBaseId = customer.body.baseId;
    const renamed = await http()
      .get(`/bases/${templateBaseId}`)
      .set(auth())
      .expect(200);
    expect(renamed.body.name).toBe('我的客户库');
    await http()
      .patch(`/bases/${templateBaseId}`)
      .set(auth())
      .send({ name: '客户库改名' })
      .expect(200);
    const customerSheets = await http()
      .get(`/bases/${templateBaseId}/sheets`)
      .set(auth())
      .expect(200);
    const customerRecords = await http()
      .get(`/sheets/${customerSheets.body[0].id}/records`)
      .set(auth())
      .expect(200);
    expect(customerRecords.body.records).toHaveLength(2);
  });

  it('rejects unknown templates', async () => {
    await http()
      .post('/templates/nope/instantiate')
      .set(auth())
      .send({ workspaceId })
      .expect(400);
  });
});
