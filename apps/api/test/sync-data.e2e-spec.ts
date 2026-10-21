import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { createServer, type Server } from 'node:http';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('External data sync (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();
  let token: string;
  let workspaceId: string;
  let baseId: string;
  let sheetId: string;
  let codeFieldId: string;
  let nameFieldId: string;
  let server: Server;
  let httpUrl: string;
  let httpRows = [
    { code: 'A1', name: 'HTTP 行 1' },
    { code: 'A2', name: 'HTTP 行 2' },
  ];

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
        email: `sync-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: '同步管理员',
      })
      .expect(201);
    token = owner.body.accessToken;
    const workspace = await http()
      .post('/workspaces')
      .set(auth())
      .send({ name: `同步工作区${stamp}` })
      .expect(201);
    workspaceId = workspace.body.id;
    const base = await http()
      .post(`/workspaces/${workspaceId}/bases`)
      .set(auth())
      .send({ name: '同步 Base' })
      .expect(201);
    baseId = base.body.id;
    const sheet = await http()
      .post(`/bases/${baseId}/sheets`)
      .set(auth())
      .send({ name: '同步表' })
      .expect(201);
    sheetId = sheet.body.id;
    const code = await http()
      .post(`/sheets/${sheetId}/fields`)
      .set(auth())
      .send({ name: '编号', type: 'text' })
      .expect(201);
    codeFieldId = code.body.id;
    const name = await http()
      .post(`/sheets/${sheetId}/fields`)
      .set(auth())
      .send({ name: '名称', type: 'text' })
      .expect(201);
    nameFieldId = name.body.id;

    server = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: httpRows }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    httpUrl = `http://127.0.0.1:${port}/rows`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (app) await app.close();
  });

  it('syncs HTTP JSON with upsert and field mapping', async () => {
    const sync = await http()
      .post(`/sheets/${sheetId}/data-syncs`)
      .set(auth())
      .send({
        name: 'HTTP 同步',
        sourceType: 'http',
        config: { url: httpUrl },
        mapping: { code: codeFieldId, name: nameFieldId },
        matchFieldId: codeFieldId,
        mode: 'upsert',
        cron: '0 * * * *',
      })
      .expect(201);
    expect(sync.body.nextRunAt).toBeTruthy();

    const run = await http()
      .post(`/data-syncs/${sync.body.id}/run`)
      .set(auth())
      .expect(201);
    expect(run.body.status).toBe('success');
    expect(run.body.rowsRead).toBe(2);
    expect(run.body.rowsWritten).toBe(2);

    httpRows = [
      { code: 'A1', name: 'HTTP 更新' },
      { code: 'A3', name: 'HTTP 行 3' },
    ];
    const second = await http()
      .post(`/data-syncs/${sync.body.id}/run`)
      .set(auth())
      .expect(201);
    expect(second.body.status).toBe('success');

    const records = await http()
      .get(`/sheets/${sheetId}/records?limit=100`)
      .set(auth())
      .expect(200);
    expect(records.body.records).toHaveLength(3);
    const names = records.body.records.map(
      (record: { cells: Record<string, unknown> }) =>
        record.cells[nameFieldId],
    );
    expect(names).toContain('HTTP 更新');
    expect(names).toContain('HTTP 行 3');

    const runs = await http()
      .get(`/data-syncs/${sync.body.id}/runs`)
      .set(auth())
      .expect(200);
    expect(runs.body[0].status).toBe('success');
  });

  it('syncs uploaded CSV with replace mode', async () => {
    const uploaded = await http()
      .post(`/sheets/${sheetId}/data-syncs/files`)
      .set(auth())
      .attach(
        'file',
        Buffer.from('code,name\nF1,文件行 1\nF2,文件行 2\n', 'utf8'),
        { filename: 'rows.csv', contentType: 'text/csv' },
      )
      .expect(201);

    const sync = await http()
      .post(`/sheets/${sheetId}/data-syncs`)
      .set(auth())
      .send({
        name: 'CSV 同步',
        sourceType: 'file',
        config: { fileId: uploaded.body.id },
        mapping: { code: codeFieldId, name: nameFieldId },
        mode: 'replace',
      })
      .expect(201);
    const run = await http()
      .post(`/data-syncs/${sync.body.id}/run`)
      .set(auth())
      .expect(201);
    expect(run.body.status).toBe('success');
    expect(run.body.rowsWritten).toBe(2);

    const records = await http()
      .get(`/sheets/${sheetId}/records?limit=100`)
      .set(auth())
      .expect(200);
    expect(records.body.records).toHaveLength(2);
    expect(
      records.body.records.map(
        (record: { cells: Record<string, unknown> }) =>
          record.cells[nameFieldId],
      ),
    ).toEqual(['文件行 1', '文件行 2']);

    const logs = await http()
      .get(`/workspaces/${workspaceId}/audit-logs?action=sync.run`)
      .set(auth())
      .expect(200);
    expect(logs.body.length).toBeGreaterThanOrEqual(3);
  });

  it('records failed runs instead of crashing', async () => {
    const sync = await http()
      .post(`/sheets/${sheetId}/data-syncs`)
      .set(auth())
      .send({
        name: '失败同步',
        sourceType: 'http',
        config: { url: 'http://127.0.0.1:1/unreachable' },
        mapping: { code: codeFieldId },
      })
      .expect(201);
    const run = await http()
      .post(`/data-syncs/${sync.body.id}/run`)
      .set(auth())
      .expect(201);
    expect(run.body.status).toBe('failed');
    expect(run.body.error).toBeTruthy();
  });
});
