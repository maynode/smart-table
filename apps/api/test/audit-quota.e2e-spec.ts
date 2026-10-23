import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('Audit log and quotas (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();
  const ownerEmail = `audit-quota-${stamp}@example.com`;
  let token: string;
  let workspaceId: string;
  let baseId: string;
  let sheetId: string;
  let fieldId: string;
  let recordId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    process.env.INSTALL_ADMIN_EMAILS = ownerEmail;
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
        email: ownerEmail,
        password: 'Passw0rd!123',
        name: '配额管理员',
      })
      .expect(201);
    token = owner.body.accessToken;
    const workspace = await http()
      .post('/workspaces')
      .set(auth())
      .send({ name: `配额工作区${stamp}` })
      .expect(201);
    workspaceId = workspace.body.id;
    const base = await http()
      .post(`/workspaces/${workspaceId}/bases`)
      .set(auth())
      .send({ name: '配额 Base' })
      .expect(201);
    baseId = base.body.id;
    const sheet = await http()
      .post(`/bases/${baseId}/sheets`)
      .set(auth())
      .send({ name: '配额表', seed: false })
      .expect(201);
    sheetId = sheet.body.id;
    const field = await http()
      .post(`/sheets/${sheetId}/fields`)
      .set(auth())
      .send({ name: '备注', type: 'text' })
      .expect(201);
    fieldId = field.body.id;
    const record = await http()
      .post(`/sheets/${sheetId}/records`)
      .set(auth())
      .send({ cells: {} })
      .expect(201);
    recordId = record.body.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('writes an audit row when a record is updated', async () => {
    await http()
      .patch(`/records/${recordId}`)
      .set(auth())
      .send({ cells: { [fieldId]: '审计修改' } })
      .expect(200);

    let logs: Array<{
      action: string;
      objectId: string;
      actorId: string;
      metadata: Record<string, unknown>;
    }> = [];
    for (let attempt = 0; attempt < 30 && !logs.length; attempt += 1) {
      const response = await http()
        .get(`/workspaces/${workspaceId}/audit-logs?action=record.updated`)
        .set(auth())
        .expect(200);
      logs = response.body;
      if (!logs.length) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(logs[0].objectId).toBe(recordId);
    expect(logs[0].actorId).toBeTruthy();
    expect(logs[0].metadata.sheetId).toBe(sheetId);
    expect(
      (logs[0].metadata.changes as Record<string, unknown>)[fieldId],
    ).toBe('审计修改');
  });

  it('enforces seat, automation and storage quotas with error codes', async () => {
    const quota = await http()
      .get(`/workspaces/${workspaceId}/quota`)
      .set(auth())
      .expect(200);
    expect(quota.body.canEdit).toBe(true);
    expect(quota.body.usage.seats).toBe(1);

    const updated = await http()
      .put('/admin/quotas')
      .set(auth())
      .send({
        scope: 'installation',
        maxSeats: 1,
        maxAutomationRunsPerMonth: 1,
        maxStorageBytes: 10,
      })
      .expect(200);
    expect(updated.body.maxSeats).toBe(1);

    await http()
      .post('/auth/register')
      .send({
        email: `audit-quota-second-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: '第二成员',
      })
      .expect(201);
    const invite = await http()
      .post(`/workspaces/${workspaceId}/members`)
      .set(auth())
      .send({
        email: `audit-quota-second-${stamp}@example.com`,
        role: 'editor',
      })
      .expect(403);
    expect(invite.body.code).toBe('QUOTA_SEATS_EXCEEDED');

    const automation = await http()
      .post('/automations')
      .set(auth())
      .send({
        baseId,
        name: '配额自动化',
        trigger: { type: 'recordCreated', sheetId },
        steps: [{ id: 's1', type: 'findRecords', sheetId }],
      })
      .expect(201);
    await http()
      .post(`/automations/${automation.body.id}/run`)
      .set(auth())
      .send({})
      .expect(201);
    // 自动化运行次数不限额：第二次仍应成功
    await http()
      .post(`/automations/${automation.body.id}/run`)
      .set(auth())
      .send({})
      .expect(201);

    const form = await http()
      .post(`/forms/${randomUUID()}`)
      .set(auth())
      .send({
        baseId,
        sheetId,
        name: '配额表单',
        fields: [],
      })
      .expect(201);
    const upload = await http()
      .post(`/forms/${form.body.id}/cover`)
      .set(auth())
      .attach('file', Buffer.alloc(64, 1), {
        filename: 'cover.png',
        contentType: 'image/png',
      })
      .expect(403);
    expect(upload.body.code).toBe('QUOTA_STORAGE_EXCEEDED');

    const after = await http()
      .put('/admin/quotas')
      .set(auth())
      .send({
        scope: 'workspace',
        workspaceId,
        maxSeats: 5,
        maxAutomationRunsPerMonth: 100,
        maxStorageBytes: 1_000_000,
      })
      .expect(200);
    expect(after.body.workspaceId).toBe(workspaceId);

    await http()
      .put('/admin/quotas')
      .set(auth())
      .send({
        scope: 'installation',
        maxSeats: 1000,
        maxAutomationRunsPerMonth: 1_000_000,
        maxStorageBytes: 100 * 1024 ** 3,
      })
      .expect(200);
  });
});
