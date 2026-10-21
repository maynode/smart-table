import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('Folders and template library (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();
  let token: string;
  let workspaceId: string;
  let rootFolderId: string;
  let childFolderId: string;
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
        email: `folders-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: '文件夹管理员',
      });
    token = owner.body.accessToken;
    const workspace = await http()
      .post('/workspaces')
      .set(auth())
      .send({ name: `文件夹工作区${stamp}` });
    workspaceId = workspace.body.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('nests folders and moves a base into a child folder', async () => {
    const root = await http()
      .post(`/workspaces/${workspaceId}/folders`)
      .set(auth())
      .send({ name: '运营' })
      .expect(201);
    rootFolderId = root.body.id;
    const child = await http()
      .post(`/workspaces/${workspaceId}/folders`)
      .set(auth())
      .send({ name: '重点客户', parentId: rootFolderId })
      .expect(201);
    childFolderId = child.body.id;

    const base = await http()
      .post(`/workspaces/${workspaceId}/bases`)
      .set(auth())
      .send({ name: '手工 Base' })
      .expect(201);
    await http()
      .post(`/bases/${base.body.id}/move`)
      .set(auth())
      .send({ folderId: childFolderId })
      .expect(201);

    const tree = await http()
      .get(`/workspaces/${workspaceId}/folders`)
      .set(auth())
      .expect(200);
    const rootNode = tree.body.folders.find(
      (item: { id: string }) => item.id === rootFolderId,
    );
    expect(rootNode.children[0].name).toBe('重点客户');
    expect(rootNode.children[0].bases[0].name).toBe('手工 Base');

    await http()
      .patch(`/folders/${rootFolderId}`)
      .set(auth())
      .send({ parentId: childFolderId })
      .expect(400);
    await http()
      .post(`/workspaces/${workspaceId}/folders`)
      .set(auth())
      .send({ name: '重复层级', parentId: rootFolderId })
      .expect(201);
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
      .send({ workspaceId, folderId: childFolderId })
      .expect(201);
    serialBaseId = created.body.baseId;
    expect(created.body.codes).toBe(100);
    expect(created.body.sheets.map((sheet: { name: string }) => sheet.name)).toEqual([
      '码库',
      '收集表单',
    ]);
    expect(created.body.shareUrl).toContain('/fill/');

    const base = await http()
      .get(`/bases/${serialBaseId}`)
      .set(auth())
      .expect(200);
    expect(base.body.folderId).toBe(childFolderId);

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

    const customer = await http()
      .post('/templates/customer-crm/instantiate')
      .set(auth())
      .send({ workspaceId })
      .expect(201);
    templateBaseId = customer.body.baseId;
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

  it('deleting a folder reparents contents and rejects unknown templates', async () => {
    await http().delete(`/folders/${childFolderId}`).set(auth()).expect(200);
    const tree = await http()
      .get(`/workspaces/${workspaceId}/folders`)
      .set(auth())
      .expect(200);
    const rootNode = tree.body.folders.find(
      (item: { id: string }) => item.id === rootFolderId,
    );
    expect(rootNode.bases.map((base: { id: string }) => base.id)).toContain(
      serialBaseId,
    );

    await http()
      .post('/templates/nope/instantiate')
      .set(auth())
      .send({ workspaceId })
      .expect(400);
  });

  it('rejects folder mutations from non-members', async () => {
    const outsider = await http()
      .post('/auth/register')
      .send({
        email: `folder-outsider-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: '局外人',
      })
      .expect(201);
    await http()
      .post(`/workspaces/${workspaceId}/folders`)
      .set({ Authorization: `Bearer ${outsider.body.accessToken}` })
      .send({ name: '越权文件夹' })
      .expect(403);
  });
});
