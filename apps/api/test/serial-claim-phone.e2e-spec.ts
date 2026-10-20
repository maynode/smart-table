import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('Duplicate phone guard (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();
  let token: string;

  let baseId: string;
  let formId: string;
  let formSheetId: string;
  let codeSheetId: string;
  let shareToken: string;
  let phoneFieldId: string;
  let statusFieldId: string;
  let serialFieldId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

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

    const owner = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `phone-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: '手机号管理员',
      });
    token = owner.body.accessToken;

    const workspace = await request(app.getHttpServer())
      .post('/workspaces')
      .set(auth())
      .send({ name: '手机号防重' });
    const base = await request(app.getHttpServer())
      .post(`/workspaces/${workspace.body.id}/bases`)
      .set(auth())
      .send({ name: '领取 Base' });
    baseId = base.body.id;

    const formSheet = await request(app.getHttpServer())
      .post(`/bases/${baseId}/sheets`)
      .set(auth())
      .send({ name: '收集表单' });
    formSheetId = formSheet.body.id;
    const phone = await request(app.getHttpServer())
      .post(`/sheets/${formSheetId}/fields`)
      .set(auth())
      .send({ name: '手机号', type: 'phone' });
    phoneFieldId = phone.body.id;

    const codeSheet = await request(app.getHttpServer())
      .post(`/bases/${baseId}/sheets`)
      .set(auth())
      .send({ name: '码库' });
    codeSheetId = codeSheet.body.id;
    const serial = await request(app.getHttpServer())
      .post(`/sheets/${codeSheetId}/fields`)
      .set(auth())
      .send({ name: '序列号', type: 'text' });
    serialFieldId = serial.body.id;
    const status = await request(app.getHttpServer())
      .post(`/sheets/${codeSheetId}/fields`)
      .set(auth())
      .send({
        name: '状态',
        type: 'select',
        options: {
          choices: [
            { id: 'unclaimed', name: '未领' },
            { id: 'claimed', name: '已领' },
          ],
        },
      });
    statusFieldId = status.body.id;

    for (const serialNumber of ['PHONE-1', 'PHONE-2', 'PHONE-3']) {
      await request(app.getHttpServer())
        .post(`/sheets/${codeSheetId}/records`)
        .set(auth())
        .send({
          cells: {
            [serialFieldId]: serialNumber,
            [statusFieldId]: '未领',
          },
        });
    }

    formId = randomUUID();
    const form = await request(app.getHttpServer())
      .post(`/forms/${formId}`)
      .set(auth())
      .send({
        baseId,
        sheetId: formSheetId,
        name: '领取表单',
        fields: [{ fieldId: phoneFieldId, required: true }],
        share: { enabled: true, audience: 'anyone' },
        successPage: { templateHtml: '你的序列号：{{序列号}}' },
        rejectDuplicatePhone: true,
      });
    expect(form.status).toBe(201);
    shareToken = form.body.share.token;

    const automation = await request(app.getHttpServer())
      .post('/automations')
      .set(auth())
      .send({
        baseId,
        name: '占码',
        onFindEmpty: 'stop',
        trigger: {
          type: 'recordCreated',
          sheetId: formSheetId,
          filters: {
            conjunction: 'and',
            conditions: [{ fieldId: phoneFieldId, operator: 'isNotEmpty' }],
          },
        },
        steps: [
          {
            id: 'find',
            type: 'findRecords',
            sheetId: codeSheetId,
            filters: {
              conjunction: 'and',
              conditions: [
                { fieldId: statusFieldId, operator: 'equals', value: '未领' },
              ],
            },
          },
          {
            id: 'modify',
            type: 'modifyRecords',
            target: { mode: 'fromStep', stepId: 'find' },
            cells: {
              [statusFieldId]: { kind: 'literal', value: '已领' },
            },
          },
        ],
      });
    expect(automation.status).toBe(201);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('rejects a second submission from the same phone unless the switch is off', async () => {
    const first = await request(app.getHttpServer())
      .post(`/public/forms/${shareToken}/submit`)
      .send({ cells: { [phoneFieldId]: '13800000000' } });
    expect(first.status).toBe(201);
    expect(first.body.success.html).toContain('PHONE-1');

    const duplicate = await request(app.getHttpServer())
      .post(`/public/forms/${shareToken}/submit`)
      .send({ cells: { [phoneFieldId]: '13800000000' } });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.message).toContain('不可重复领取');

    const other = await request(app.getHttpServer())
      .post(`/public/forms/${shareToken}/submit`)
      .send({ cells: { [phoneFieldId]: '13900000000' } });
    expect(other.status).toBe(201);
    expect(other.body.success.html).toContain('PHONE-2');

    const codesAfterReject = await request(app.getHttpServer())
      .get(`/sheets/${codeSheetId}/records?limit=200`)
      .set(auth());
    expect(
      codesAfterReject.body.records.filter(
        (record: { claimStatus: string }) => record.claimStatus === 'claimed',
      ),
    ).toHaveLength(2);
    const formRecordsAfterReject = await request(app.getHttpServer())
      .get(`/sheets/${formSheetId}/records?limit=200`)
      .set(auth());
    expect(formRecordsAfterReject.body.records).toHaveLength(2);

    const updated = await request(app.getHttpServer())
      .post(`/forms/${formId}`)
      .set(auth())
      .send({
        baseId,
        sheetId: formSheetId,
        name: '领取表单',
        fields: [{ fieldId: phoneFieldId, required: true }],
        rejectDuplicatePhone: false,
      });
    expect(updated.status).toBe(201);
    expect(updated.body.rejectDuplicatePhone).toBe(false);

    const allowed = await request(app.getHttpServer())
      .post(`/public/forms/${shareToken}/submit`)
      .send({ cells: { [phoneFieldId]: '13800000000' } });
    expect(allowed.status).toBe(201);
    expect(allowed.body.success.html).toContain('PHONE-3');

    const codes = await request(app.getHttpServer())
      .get(`/sheets/${codeSheetId}/records?limit=200`)
      .set(auth());
    expect(
      codes.body.records.filter(
        (record: { claimStatus: string }) => record.claimStatus === 'claimed',
      ),
    ).toHaveLength(3);
  });
});
