import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('Cross-workspace sharing (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();
  let ownerToken: string;
  let targetToken: string;
  let sourceWorkspaceId: string;
  let targetWorkspaceId: string;
  let baseId: string;
  let sheetId: string;
  let recordId: string;
  let shareId: string;
  let baseShareId: string;

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const http = () => request(app.getHttpServer());
  const owner = () => as(ownerToken);
  const target = () => as(targetToken);

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

    const source = await http()
      .post('/auth/register')
      .send({
        email: `share-owner-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: '共享所有者',
      });
    ownerToken = source.body.accessToken;
    const targetUser = await http()
      .post('/auth/register')
      .send({
        email: `share-target-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: '共享接受者',
      });
    targetToken = targetUser.body.accessToken;

    const sourceWorkspace = await http()
      .post('/workspaces')
      .set(owner())
      .send({ name: `共享源${stamp}` });
    sourceWorkspaceId = sourceWorkspace.body.id;
    const targetWorkspace = await http()
      .post('/workspaces')
      .set(target())
      .send({ name: `共享目标${stamp}` });
    targetWorkspaceId = targetWorkspace.body.id;

    const base = await http()
      .post(`/workspaces/${sourceWorkspaceId}/bases`)
      .set(owner())
      .send({ name: '跨区 Base' });
    baseId = base.body.id;
    const sheet = await http()
      .post(`/bases/${baseId}/sheets`)
      .set(owner())
      .send({ name: '跨区工作表' });
    sheetId = sheet.body.id;
    const hidden = await http()
      .post(`/bases/${baseId}/sheets`)
      .set(owner())
      .send({ name: '未共享工作表' });
    expect(hidden.status).toBe(201);
    await http()
      .post(`/sheets/${sheetId}/fields`)
      .set(owner())
      .send({ name: '文本', type: 'text' })
      .expect(201);
    const record = await http()
      .post(`/sheets/${sheetId}/records`)
      .set(owner())
      .send({ cells: {} })
      .expect(201);
    recordId = record.body.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('shares a sheet as view-only and hides sibling sheets', async () => {
    const created = await http()
      .post(`/workspaces/${sourceWorkspaceId}/shares`)
      .set(owner())
      .send({
        targetWorkspaceId,
        objectType: 'sheet',
        objectId: sheetId,
        role: 'view',
      })
      .expect(201);
    shareId = created.body.id;

    const records = await http()
      .get(`/sheets/${sheetId}/records`)
      .set(target())
      .expect(200);
    expect(records.body.records).toHaveLength(1);

    const sheets = await http()
      .get(`/bases/${baseId}/sheets`)
      .set(target())
      .expect(200);
    expect(sheets.body.map((sheet: { id: string }) => sheet.id)).toEqual([
      sheetId,
    ]);

    const sharedBases = await http()
      .get(`/workspaces/${targetWorkspaceId}/bases`)
      .set(target())
      .expect(200);
    expect(sharedBases.body.map((base: { id: string }) => base.id)).toContain(
      baseId,
    );

    await http()
      .patch(`/records/${recordId}`)
      .set(target())
      .send({ cells: {} })
      .expect(403);
    await http()
      .post(`/sheets/${sheetId}/records`)
      .set(target())
      .send({ cells: {} })
      .expect(403);
  });

  it('revokes access immediately and forbids duplicates/outsiders', async () => {
    await http()
      .post(`/workspaces/${sourceWorkspaceId}/shares`)
      .set(owner())
      .send({
        targetWorkspaceId,
        objectType: 'sheet',
        objectId: sheetId,
        role: 'view',
      })
      .expect(409);

    const outsider = await http()
      .post('/auth/register')
      .send({
        email: `share-outsider-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: '共享局外人',
      })
      .expect(201);
    await http()
      .get(`/sheets/${sheetId}/records`)
      .set(as(outsider.body.accessToken))
      .expect(403);

    await http().delete(`/shares/${shareId}`).set(owner()).expect(200);
    await http().get(`/sheets/${sheetId}/records`).set(target()).expect(403);
    const sharedBases = await http()
      .get(`/workspaces/${targetWorkspaceId}/bases`)
      .set(target())
      .expect(200);
    expect(sharedBases.body.map((base: { id: string }) => base.id)).not.toContain(
      baseId,
    );
  });

  it('supports edit grants for a whole base', async () => {
    const created = await http()
      .post(`/workspaces/${sourceWorkspaceId}/shares`)
      .set(owner())
      .send({
        targetWorkspaceId,
        objectType: 'base',
        objectId: baseId,
        role: 'edit',
      })
      .expect(201);
    baseShareId = created.body.id;

    const sheets = await http()
      .get(`/bases/${baseId}/sheets`)
      .set(target())
      .expect(200);
    expect(sheets.body).toHaveLength(2);

    const record = await http()
      .post(`/sheets/${sheetId}/records`)
      .set(target())
      .send({ cells: {} })
      .expect(201);
    expect(record.body.createdBy).toBeTruthy();

    await http()
      .patch(`/records/${recordId}`)
      .set(target())
      .send({ cells: {} })
      .expect(200);

    await http().delete(`/shares/${baseShareId}`).set(owner()).expect(200);
    await http().get(`/bases/${baseId}`).set(target()).expect(403);
  });
});
