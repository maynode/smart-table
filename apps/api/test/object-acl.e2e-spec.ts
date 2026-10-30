import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('Content permissions object ACL (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();
  let ownerToken: string;
  let editorToken: string;
  let viewerToken: string;
  let editorId: string;
  let viewerId: string;
  let workspaceId: string;
  let sheetId: string;
  let fields: Record<string, string>;
  let unclaimedId: string;
  let claimedId: string;

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
        account: `acl_owner${stamp}`,
        password: 'Passw0rd!123',
                securityQuestion: '你小学就读的学校名称是？', securityAnswer: 'demo',
        });
    ownerToken = owner.body.accessToken;

    const editor = await http()
      .post('/auth/register')
      .send({
        account: `acl_editor${stamp}`,
        password: 'Passw0rd!123',
                securityQuestion: '你小学就读的学校名称是？', securityAnswer: 'demo',
        });
    editorToken = editor.body.accessToken;
    editorId = editor.body.user.id;

    const viewer = await http()
      .post('/auth/register')
      .send({
        account: `acl_viewer${stamp}`,
        password: 'Passw0rd!123',
                securityQuestion: '你小学就读的学校名称是？', securityAnswer: 'demo',
        });
    viewerToken = viewer.body.accessToken;
    viewerId = viewer.body.user.id;

    const workspace = await http()
      .post('/workspaces')
      .set(auth(ownerToken))
      .send({ name: `权限工作区${stamp}` })
      .expect(201);
    workspaceId = workspace.body.id;

    await http()
      .post(`/workspaces/${workspaceId}/members`)
      .set(auth(ownerToken))
      .send({ account: `acl_editor${stamp}`, role: 'editor' })
      .expect(201);
    await http()
      .post(`/workspaces/${workspaceId}/members`)
      .set(auth(ownerToken))
      .send({ account: `acl_viewer${stamp}`, role: 'viewer' })
      .expect(201);

    const base = await http()
      .post(`/workspaces/${workspaceId}/bases`)
      .set(auth(ownerToken))
      .send({ name: '权限 Base' })
      .expect(201);
    const sheet = await http()
      .post(`/bases/${base.body.id}/sheets`)
      .set(auth(ownerToken))
      .send({ name: '权限表', seed: false })
      .expect(201);
    sheetId = sheet.body.id;

    const status = await http()
      .post(`/sheets/${sheetId}/fields`)
      .set(auth(ownerToken))
      .send({
        name: '状态',
        type: 'select',
        options: {
          choices: [
            { id: 'unclaimed', name: '未领' },
            { id: 'claimed', name: '已领' },
          ],
        },
      })
      .expect(201);
    const title = await http()
      .post(`/sheets/${sheetId}/fields`)
      .set(auth(ownerToken))
      .send({ name: '标题', type: 'text' })
      .expect(201);
    const secret = await http()
      .post(`/sheets/${sheetId}/fields`)
      .set(auth(ownerToken))
      .send({ name: '机密', type: 'text' })
      .expect(201);
    fields = {
      status: status.body.id,
      title: title.body.id,
      secret: secret.body.id,
    };

    const unclaimed = await http()
      .post(`/sheets/${sheetId}/records`)
      .set(auth(ownerToken))
      .send({
        cells: { [fields.status]: 'unclaimed', [fields.secret]: '仅所有者可见' },
      })
      .expect(201);
    unclaimedId = unclaimed.body.id;
    const claimed = await http()
      .post(`/sheets/${sheetId}/records`)
      .set(auth(ownerToken))
      .send({ cells: { [fields.status]: 'claimed' } })
      .expect(201);
    claimedId = claimed.body.id;

    await http()
      .put(`/permissions/sheet/${sheetId}`)
      .set(auth(ownerToken))
      .send({
        everyone: {
          level: 'edit',
          recordRule: {
            mode: 'condition',
            filter: {
              conjunction: 'and',
              conditions: [
                {
                  fieldId: fields.status,
                  operator: 'equals',
                  value: 'unclaimed',
                },
              ],
            },
            canAdd: false,
            canDelete: false,
          },
          fieldRule: {
            mode: 'fields',
            fields: {
              [fields.title]: { viewable: true, editable: false, submitOnce: true },
              [fields.secret]: { viewable: false, editable: false },
            },
          },
        },
      })
      .expect(200);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('hides out-of-scope rows and unreadable columns from editors', async () => {
    const response = await http()
      .get(`/sheets/${sheetId}/records?limit=50`)
      .set(auth(editorToken))
      .expect(200);

    expect(response.body.records).toHaveLength(1);
    expect(response.body.records[0].id).toBe(unclaimedId);
    expect(response.body.records[0].cells[fields.secret]).toBeUndefined();
    expect(response.body.records[0].cells[fields.status]).toBe('unclaimed');

    const sheet = await http()
      .get(`/sheets/${sheetId}`)
      .set(auth(editorToken))
      .expect(200);
    expect(sheet.body.fields.map((field: any) => field.name)).not.toContain(
      '机密',
    );
  });

  it('blocks adds, deletes and edits outside the row scope', async () => {
    await http()
      .post(`/sheets/${sheetId}/records`)
      .set(auth(editorToken))
      .send({ cells: { [fields.status]: 'unclaimed' } })
      .expect(403);

    await http()
      .patch(`/records/${claimedId}`)
      .set(auth(editorToken))
      .send({ cells: { [fields.status]: 'claimed' } })
      .expect(403);

    await http()
      .delete(`/records/${unclaimedId}`)
      .set(auth(editorToken))
      .expect(403);
  });

  it('allows a first submit but blocks later edits of a submit-once field', async () => {
    await http()
      .patch(`/records/${unclaimedId}`)
      .set(auth(editorToken))
      .send({ cells: { [fields.title]: '首次提交' } })
      .expect(200);

    await http()
      .patch(`/records/${unclaimedId}`)
      .set(auth(editorToken))
      .send({ cells: { [fields.title]: '再次修改' } })
      .expect(403);

    await http()
      .patch(`/records/${unclaimedId}`)
      .set(auth(editorToken))
      .send({ cells: { [fields.status]: 'claimed' } })
      .expect(200);
  });

  it('member-specific none overrides the everyone level', async () => {
    await http()
      .put(`/permissions/sheet/${sheetId}`)
      .set(auth(ownerToken))
      .send({
        members: [
          { userId: editorId, level: 'none' },
          { userId: viewerId, level: 'none' },
        ],
      })
      .expect(200);

    await http()
      .get(`/sheets/${sheetId}/records`)
      .set(auth(editorToken))
      .expect(403);
    await http()
      .get(`/sheets/${sheetId}/records`)
      .set(auth(viewerToken))
      .expect(403);

    await http()
      .delete(`/permissions/sheet/${sheetId}/members/${editorId}`)
      .set(auth(ownerToken))
      .expect(200);
    await http()
      .get(`/sheets/${sheetId}/records`)
      .set(auth(editorToken))
      .expect(200);
  });

  it('rejects permission management from non-admins and bad levels', async () => {
    await http()
      .put(`/permissions/sheet/${sheetId}`)
      .set(auth(editorToken))
      .send({ everyone: { level: 'view' } })
      .expect(403);

    await http()
      .put(`/permissions/sheet/${sheetId}`)
      .set(auth(ownerToken))
      .send({ everyone: { level: 'superuser' } })
      .expect(400);
  });
});
