import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('CommitChanges MessageCenter (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();
  const account = `cc${String(stamp).slice(-10)}`;
  const password = 'Ab12_cd34';
  let token: string;
  let sheetId: string;
  let fieldId: string;
  let recordId: string;

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
        account,
        password,
        securityQuestion: '你小学就读的学校名称是？',
        securityAnswer: 'demo',
      });
    expect(owner.status).toBeLessThan(400);
    token = owner.body.accessToken;

    const workspace = await http()
      .post('/workspaces')
      .set(auth())
      .send({ name: `CC工作区${stamp}` });
    const base = await http()
      .post(`/workspaces/${workspace.body.id}/bases`)
      .set(auth())
      .send({ name: 'CC Base' });
    const sheet = await http()
      .post(`/bases/${base.body.id}/sheets`)
      .set(auth())
      .send({ name: '离线表', seed: false });
    sheetId = sheet.body.id;
    const field = await http()
      .post(`/sheets/${sheetId}/fields`)
      .set(auth())
      .send({ name: '标题', type: 'text' });
    fieldId = field.body.id;
    const record = await http()
      .post(`/sheets/${sheetId}/records`)
      .set(auth())
      .send({ cells: { [fieldId]: '初值' } });
    recordId = record.body.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('applies setRecord and is idempotent on clientOpId', async () => {
    const clientOpId = randomUUID();
    const batch = {
      clientBatchId: randomUUID(),
      mutations: [
        {
          clientOpId,
          type: 'setRecord',
          recordId,
          cells: { [fieldId]: '离线改' },
          baseVersion: 1,
        },
      ],
    };
    const first = await http()
      .post(`/sheets/${sheetId}/commitchanges`)
      .set(auth())
      .send(batch)
      .expect(200);
    expect(first.body.results[0].status).toBe('ok');
    expect(first.body.results[0].record.cells[fieldId]).toBe('离线改');

    const second = await http()
      .post(`/sheets/${sheetId}/commitchanges`)
      .set(auth())
      .send(batch)
      .expect(200);
    expect(second.body.results[0].status).toBe('duplicate');
    expect(second.body.results[0].record.cells[fieldId]).toBe('离线改');
  });

  it('returns VERSION_CONFLICT when baseVersion is stale', async () => {
    const res = await http()
      .post(`/sheets/${sheetId}/commitchanges`)
      .set(auth())
      .send({
        clientBatchId: randomUUID(),
        mutations: [
          {
            clientOpId: randomUUID(),
            type: 'setRecord',
            recordId,
            cells: { [fieldId]: '冲突' },
            baseVersion: 1,
          },
        ],
      })
      .expect(200);
    expect(res.body.results[0].status).toBe('error');
    expect(res.body.results[0].code).toBe('COMMIT_VERSION_CONFLICT');
  });

  it('createRecord maps clientRecordId', async () => {
    const clientRecordId = randomUUID();
    const res = await http()
      .post(`/sheets/${sheetId}/commitchanges`)
      .set(auth())
      .send({
        clientBatchId: randomUUID(),
        mutations: [
          {
            clientOpId: randomUUID(),
            type: 'createRecord',
            clientRecordId,
            cells: { [fieldId]: '新行' },
          },
        ],
      })
      .expect(200);
    expect(res.body.results[0].status).toBe('ok');
    expect(res.body.results[0].recordIdMap[clientRecordId]).toBeTruthy();
  });
});
