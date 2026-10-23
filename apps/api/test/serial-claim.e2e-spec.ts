import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

interface ClaimScenario {
  baseId: string;
  formId: string;
  shareToken: string;
  automationId: string;
  formSheetId: string;
  codeSheetId: string;
  phoneFieldId: string;
  serialFieldId: string;
  statusFieldId: string;
  codePhoneFieldId: string;
  claimedAtFieldId: string;
  serials: string[];
}

describe('Serial claim path (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();
  let token: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function seedScenario(
    label: string,
    serialPrefix: string,
    codeCount: number,
  ): Promise<ClaimScenario> {
    const workspace = await request(app.getHttpServer())
      .post('/workspaces')
      .set(auth())
      .send({ name: `${label}工作区` });
    const base = await request(app.getHttpServer())
      .post(`/workspaces/${workspace.body.id}/bases`)
      .set(auth())
      .send({ name: `${label}Base` });

    const formSheet = await request(app.getHttpServer())
      .post(`/bases/${base.body.id}/sheets`)
      .set(auth())
      .send({ name: '收集表单', seed: false });
    const phone = await request(app.getHttpServer())
      .post(`/sheets/${formSheet.body.id}/fields`)
      .set(auth())
      .send({ name: '手机号', type: 'phone' });
    const remark = await request(app.getHttpServer())
      .post(`/sheets/${formSheet.body.id}/fields`)
      .set(auth())
      .send({ name: '备注', type: 'text' });

    const codeSheet = await request(app.getHttpServer())
      .post(`/bases/${base.body.id}/sheets`)
      .set(auth())
      .send({ name: '码库', seed: false });
    const serial = await request(app.getHttpServer())
      .post(`/sheets/${codeSheet.body.id}/fields`)
      .set(auth())
      .send({ name: '序列号', type: 'text' });
    const status = await request(app.getHttpServer())
      .post(`/sheets/${codeSheet.body.id}/fields`)
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
    const codePhone = await request(app.getHttpServer())
      .post(`/sheets/${codeSheet.body.id}/fields`)
      .set(auth())
      .send({ name: '领取手机号', type: 'phone' });
    const claimedAt = await request(app.getHttpServer())
      .post(`/sheets/${codeSheet.body.id}/fields`)
      .set(auth())
      .send({ name: '领取时间', type: 'date' });

    const serials = Array.from(
      { length: codeCount },
      (_, index) => `${serialPrefix}-${index + 1}`,
    );
    for (const serialNumber of serials) {
      const created = await request(app.getHttpServer())
        .post(`/sheets/${codeSheet.body.id}/records`)
        .set(auth())
        .send({
          cells: {
            [serial.body.id]: serialNumber,
            [status.body.id]: '未领',
          },
        });
      expect(created.status).toBe(201);
    }

    const formId = randomUUID();
    const form = await request(app.getHttpServer())
      .post(`/forms/${formId}`)
      .set(auth())
      .send({
        baseId: base.body.id,
        sheetId: formSheet.body.id,
        name: `${label}序列号领取`,
        fields: [
          { fieldId: phone.body.id, required: true },
          { fieldId: remark.body.id },
        ],
        share: { enabled: true, audience: 'anyone' },
        successPage: {
          templateHtml: '领取成功，你的序列号是 {{序列号}}，备注：{{备注}}',
        },
      });
    expect(form.status).toBe(201);

    const automation = await request(app.getHttpServer())
      .post('/automations')
      .set(auth())
      .send({
        baseId: base.body.id,
        name: `${label}占码`,
        trigger: {
          type: 'recordCreated',
          sheetId: formSheet.body.id,
          filters: {
            conjunction: 'and',
            conditions: [{ fieldId: phone.body.id, operator: 'isNotEmpty' }],
          },
        },
        onFindEmpty: 'stop',
        steps: [
          {
            id: 'find-code',
            type: 'findRecords',
            sheetId: codeSheet.body.id,
            filters: {
              conjunction: 'and',
              conditions: [
                { fieldId: status.body.id, operator: 'equals', value: '未领' },
              ],
            },
          },
          {
            id: 'claim-code',
            type: 'modifyRecords',
            target: { mode: 'fromStep', stepId: 'find-code' },
            cells: {
              [status.body.id]: { kind: 'literal', value: '已领' },
              [codePhone.body.id]: {
                kind: 'variable',
                variable: { source: 'trigger', field: '手机号' },
              },
              [claimedAt.body.id]: {
                kind: 'variable',
                variable: { source: 'naturalTime', naturalTime: 'today' },
              },
            },
          },
        ],
      });
    expect(automation.status).toBe(201);

    return {
      baseId: base.body.id,
      formId,
      shareToken: form.body.share.token,
      automationId: automation.body.id,
      formSheetId: formSheet.body.id,
      codeSheetId: codeSheet.body.id,
      phoneFieldId: phone.body.id,
      serialFieldId: serial.body.id,
      statusFieldId: status.body.id,
      codePhoneFieldId: codePhone.body.id,
      claimedAtFieldId: claimedAt.body.id,
      serials,
    };
  }

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
        email: `claim-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: '领取管理员',
      });
    token = owner.body.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('claims a code, renders its serial on the success page, and writes nothing when exhausted', async () => {
    const scenario = await seedScenario('单次领取', 'SN-HAPPY', 2);

    const submitted = await request(app.getHttpServer())
      .post(`/public/forms/${scenario.shareToken}/submit`)
      .send({
        cells: {
          [scenario.phoneFieldId]: '13800000000',
          [scenario.serialFieldId]: undefined,
        },
      });
    expect(submitted.status).toBe(201);
    expect(submitted.body.success.html).toContain('SN-HAPPY-1');
    expect(submitted.body.stepOutputs['序列号']).toBe('SN-HAPPY-1');

    const codes = await request(app.getHttpServer())
      .get(`/sheets/${scenario.codeSheetId}/records?limit=200`)
      .set(auth());
    const first = codes.body.records[0];
    expect(first.claimStatus).toBe('claimed');
    expect(first.cells[scenario.statusFieldId]).toBe('已领');
    expect(first.cells[scenario.codePhoneFieldId]).toBe('13800000000');
    expect(first.cells[scenario.claimedAtFieldId]).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const formRecords = await request(app.getHttpServer())
      .get(`/sheets/${scenario.formSheetId}/records?limit=200`)
      .set(auth());
    expect(formRecords.body.records).toHaveLength(1);
  });

  it('lets exactly five of ten concurrent submissions claim five codes', async () => {
    const scenario = await seedScenario('并发领取', 'SN-CONCURRENT', 5);

    const submissions = Array.from({ length: 10 }, (_, index) =>
      request(app.getHttpServer())
        .post(`/public/forms/${scenario.shareToken}/submit`)
        .send({
          cells: { [scenario.phoneFieldId]: `139000001${String(index).padStart(2, '0')}` },
        }),
    );

    const responses = await Promise.all(submissions);
    const created = responses.filter((response) => response.status === 201);
    const rejected = responses.filter((response) => response.status === 409);

    expect(created).toHaveLength(5);
    expect(rejected).toHaveLength(5);
    expect(rejected[0].body.message).toContain('领取完毕');

    const claimedSerials = created.map(
      (response) => response.body.stepOutputs['序列号'] as string,
    );
    expect(new Set(claimedSerials).size).toBe(5);
    for (const serialNumber of claimedSerials) {
      expect(scenario.serials).toContain(serialNumber);
    }

    const codes = await request(app.getHttpServer())
      .get(`/sheets/${scenario.codeSheetId}/records?limit=200`)
      .set(auth());
    const claimed = codes.body.records.filter(
      (record: { claimStatus: string }) => record.claimStatus === 'claimed',
    );
    expect(claimed).toHaveLength(5);
    expect(
      new Set(
        claimed.map(
          (record: { cells: Record<string, string> }) =>
            record.cells[scenario.serialFieldId],
        ),
      ).size,
    ).toBe(5);
    expect(
      claimed.every(
        (record: { cells: Record<string, string> }) =>
          record.cells[scenario.statusFieldId] === '已领',
      ),
    ).toBe(true);

    const formRecords = await request(app.getHttpServer())
      .get(`/sheets/${scenario.formSheetId}/records?limit=200`)
      .set(auth());
    expect(formRecords.body.records).toHaveLength(5);

    const runs = await request(app.getHttpServer())
      .get(`/automations/${scenario.automationId}/runs?limit=200`)
      .set(auth());
    expect(runs.body).toHaveLength(5);
    expect(
      runs.body.every((run: { status: string }) => run.status === 'success'),
    ).toBe(true);
  });
});
