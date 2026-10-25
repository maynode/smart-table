import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AutomationRunnerService } from '../src/automations/automation-runner.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Automation engine (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();
  /** 用户名 ≤20；密码无 !，且无连续 4 位字母/数字. */
  const ownerAccount = `au${String(stamp).slice(-10)}`;
  const ownerPassword = 'Ab12_cd34';
  let token: string;
  let userId: string;

  let baseId: string;
  let formSheetId: string;
  let codeSheetId: string;
  let emptySheetId: string;
  let outputSheetId: string;

  let phoneFieldId: string;
  let serialFieldId: string;
  let statusFieldId: string;
  let codePhoneFieldId: string;
  let claimedAtFieldId: string;
  let outputFieldId: string;

  let claimAutomationId: string;
  let claimFormRecordId: string;

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
        account: ownerAccount,
        password: ownerPassword,
        securityQuestion: '你小学就读的学校名称是？',
        securityAnswer: 'demo',
      });
    expect(owner.status).toBeLessThan(400);
    token = owner.body.accessToken;
    userId = owner.body.user.id;

    const workspace = await request(app.getHttpServer())
      .post('/workspaces')
      .set(auth())
      .send({ name: '序列号自动化' });
    const base = await request(app.getHttpServer())
      .post(`/workspaces/${workspace.body.id}/bases`)
      .set(auth())
      .send({ name: '领取 Base' });
    baseId = base.body.id;

    const formSheet = await request(app.getHttpServer())
      .post(`/bases/${baseId}/sheets`)
      .set(auth())
      .send({ name: '收集表单', seed: false });
    formSheetId = formSheet.body.id;
    const phone = await request(app.getHttpServer())
      .post(`/sheets/${formSheetId}/fields`)
      .set(auth())
      .send({ name: '手机号', type: 'phone' });
    phoneFieldId = phone.body.id;

    const codeSheet = await request(app.getHttpServer())
      .post(`/bases/${baseId}/sheets`)
      .set(auth())
      .send({ name: '码库', seed: false });
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
            { id: 'unclaimed', name: '未领', color: 'gray' },
            { id: 'claimed', name: '已领', color: 'green' },
          ],
        },
      });
    statusFieldId = status.body.id;

    const codePhone = await request(app.getHttpServer())
      .post(`/sheets/${codeSheetId}/fields`)
      .set(auth())
      .send({ name: '领取手机号', type: 'phone' });
    codePhoneFieldId = codePhone.body.id;

    const claimedAt = await request(app.getHttpServer())
      .post(`/sheets/${codeSheetId}/fields`)
      .set(auth())
      .send({ name: '领取时间', type: 'date' });
    claimedAtFieldId = claimedAt.body.id;

    for (const serialNumber of ['SN-001', 'SN-002', 'SN-003']) {
      const record = await request(app.getHttpServer())
        .post(`/sheets/${codeSheetId}/records`)
        .set(auth())
        .send({
          cells: {
            [serialFieldId]: serialNumber,
            [statusFieldId]: '未领',
          },
        });
      expect(record.status).toBe(201);
    }

    const emptySheet = await request(app.getHttpServer())
      .post(`/bases/${baseId}/sheets`)
      .set(auth())
      .send({ name: '空码库', seed: false });
    emptySheetId = emptySheet.body.id;
    await request(app.getHttpServer())
      .post(`/sheets/${emptySheetId}/fields`)
      .set(auth())
      .send({ name: '序列号', type: 'text' });

    const outputSheet = await request(app.getHttpServer())
      .post(`/bases/${baseId}/sheets`)
      .set(auth())
      .send({ name: '领取流水', seed: false });
    outputSheetId = outputSheet.body.id;
    const outputField = await request(app.getHttpServer())
      .post(`/sheets/${outputSheetId}/fields`)
      .set(auth())
      .send({ name: '结果', type: 'text' });
    outputFieldId = outputField.body.id;

    const automation = await request(app.getHttpServer())
      .post('/automations')
      .set(auth())
      .send({
        baseId,
        name: '领取序列号',
        trigger: {
          type: 'recordCreated',
          sheetId: formSheetId,
          filters: {
            conjunction: 'and',
            conditions: [
              { fieldId: phoneFieldId, operator: 'isNotEmpty' },
            ],
          },
        },
        steps: [
          {
            id: 'find-code',
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
            id: 'claim-code',
            type: 'modifyRecords',
            target: { mode: 'fromStep', stepId: 'find-code' },
            cells: {
              [statusFieldId]: { kind: 'literal', value: '已领' },
              [codePhoneFieldId]: {
                kind: 'variable',
                variable: { source: 'trigger', field: '手机号' },
              },
              [claimedAtFieldId]: {
                kind: 'variable',
                variable: { source: 'naturalTime', naturalTime: 'today' },
              },
            },
          },
        ],
      });
    expect(automation.status).toBe(201);
    claimAutomationId = automation.body.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('claims exactly one unclaimed code per trigger and never reuses it', async () => {
    const first = await request(app.getHttpServer())
      .post(`/sheets/${formSheetId}/records`)
      .set(auth())
      .send({ cells: { [phoneFieldId]: '13800000001' } });
    expect(first.status).toBe(201);
    claimFormRecordId = first.body.id;

    const firstRuns = await request(app.getHttpServer())
      .get(`/automations/${claimAutomationId}/runs`)
      .set(auth());
    expect(firstRuns.status).toBe(200);
    expect(firstRuns.body).toHaveLength(1);
    expect(firstRuns.body[0].status).toBe('success');
    expect(firstRuns.body[0].outputs['序列号']).toBe('SN-001');
    expect(firstRuns.body[0].steps[0].output.recordIds).toHaveLength(1);
    expect(firstRuns.body[0].durationMs).toBeGreaterThanOrEqual(0);

    const second = await request(app.getHttpServer())
      .post(`/sheets/${formSheetId}/records`)
      .set(auth())
      .send({ cells: { [phoneFieldId]: '13800000002' } });
    expect(second.status).toBe(201);

    const secondRuns = await request(app.getHttpServer())
      .get(`/automations/${claimAutomationId}/runs`)
      .set(auth());
    expect(secondRuns.body).toHaveLength(2);
    expect(secondRuns.body[0].status).toBe('success');
    expect(secondRuns.body[0].outputs['序列号']).toBe('SN-002');

    const records = await request(app.getHttpServer())
      .get(`/sheets/${codeSheetId}/records?limit=200`)
      .set(auth());
    const claimed = records.body.records.filter(
      (record: { claimStatus: string }) => record.claimStatus === 'claimed',
    );
    expect(claimed).toHaveLength(2);
    expect(claimed.map((record: { cells: Record<string, string> }) => record.cells[serialFieldId])).toEqual([
      'SN-001',
      'SN-002',
    ]);
    expect(claimed[0].cells[statusFieldId]).toBe('已领');
    expect(claimed[0].cells[codePhoneFieldId]).toBe('13800000001');
    expect(claimed[0].cells[claimedAtFieldId]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('stops the run when a find step returns no records and onEmpty=stop', async () => {
    const automation = await request(app.getHttpServer())
      .post('/automations')
      .set(auth())
      .send({
        baseId,
        name: '空码库终止',
        onFindEmpty: 'stop',
        trigger: { type: 'recordCreated', sheetId: formSheetId },
        steps: [
          {
            id: 'find-empty',
            type: 'findRecords',
            sheetId: emptySheetId,
          },
        ],
      });
    expect(automation.status).toBe(201);

    const run = await request(app.getHttpServer())
      .post(`/automations/${automation.body.id}/run`)
      .set(auth())
      .send({});
    expect(run.status).toBe(201);
    expect(run.body.status).toBe('skipped');

    const runs = await request(app.getHttpServer())
      .get(`/automations/${automation.body.id}/runs`)
      .set(auth());
    expect(runs.body[0].status).toBe('skipped');
    expect(runs.body[0].steps[0].output.recordIds).toEqual([]);
  });

  it('creates records and sends document notifications', async () => {
    const automation = await request(app.getHttpServer())
      .post('/automations')
      .set(auth())
      .send({
        baseId,
        name: '领取流水与通知',
        trigger: { type: 'recordCreated', sheetId: formSheetId },
        steps: [
          {
            id: 'create-output',
            type: 'createRecord',
            sheetId: outputSheetId,
            cells: {
              [outputFieldId]: {
                kind: 'variable',
                variable: { source: 'trigger', field: '手机号' },
              },
            },
          },
          {
            id: 'notify',
            type: 'sendMessage',
            name: '领取成功通知',
            channel: 'doc',
            recipients: [{ source: 'fixed', userIds: [userId] }],
            content: { text: '领取成功，手机号 {{手机号}}，序列号 {{序列号}}' },
          },
        ],
      });
    expect(automation.status).toBe(201);

    const run = await request(app.getHttpServer())
      .post(`/automations/${automation.body.id}/run`)
      .set(auth())
      .send({ recordId: claimFormRecordId });
    expect(run.status).toBe(201);
    expect(run.body.status).toBe('success');

    const outputRecords = await request(app.getHttpServer())
      .get(`/sheets/${outputSheetId}/records?limit=50`)
      .set(auth());
    expect(outputRecords.body.records).toHaveLength(1);
    expect(outputRecords.body.records[0].cells[outputFieldId]).toBe(
      '13800000001',
    );

    const notifications = await request(app.getHttpServer())
      .get('/notifications')
      .set(auth());
    expect(notifications.status).toBe(200);
    const latest = notifications.body.notifications[0];
    expect(latest.body).toContain('13800000001');
    expect(latest.body).toContain('{{序列号}}');

    const runs = await request(app.getHttpServer())
      .get(`/automations/${automation.body.id}/runs`)
      .set(auth());
    expect(runs.body[0].steps).toHaveLength(2);
    expect(runs.body[0].steps[1].type).toBe('sendMessage');
  });

  it('persists delay as waiting and resumes via durable DB poll', async () => {
    const automation = await request(app.getHttpServer())
      .post('/automations')
      .set(auth())
      .send({
        baseId,
        name: '延迟续跑',
        trigger: { type: 'recordCreated', sheetId: formSheetId },
        steps: [
          { id: 'wait', type: 'delay', delayMs: 1000 },
          {
            id: 'create-after-delay',
            type: 'createRecord',
            sheetId: outputSheetId,
            cells: {
              [outputFieldId]: {
                kind: 'literal',
                value: `after-delay-${stamp}`,
              },
            },
          },
        ],
      });
    expect(automation.status).toBe(201);

    const run = await request(app.getHttpServer())
      .post(`/automations/${automation.body.id}/run`)
      .set(auth())
      .send({});
    expect(run.status).toBe(201);
    expect(run.body.status).toBe('waiting');
    expect(run.body.runId).toBeTruthy();

    const runsWaiting = await request(app.getHttpServer())
      .get(`/automations/${automation.body.id}/runs`)
      .set(auth());
    expect(runsWaiting.body[0].status).toBe('waiting');
    expect(runsWaiting.body[0].steps).toHaveLength(1);
    expect(runsWaiting.body[0].steps[0].type).toBe('delay');

    const prisma = app.get(PrismaService);
    await prisma.$executeRaw(
      Prisma.sql`UPDATE automation_runs SET resume_at = NOW() - interval '1 second' WHERE id = ${run.body.runId}::uuid`,
    );

    const runner = app.get(AutomationRunnerService);
    const resumed = await runner.runDueDelayedRuns();
    expect(
      resumed.some(
        (item) => item.runId === run.body.runId && item.status === 'success',
      ),
    ).toBe(true);

    const runsDone = await request(app.getHttpServer())
      .get(`/automations/${automation.body.id}/runs`)
      .set(auth());
    expect(runsDone.body[0].status).toBe('success');
    expect(runsDone.body[0].steps.map((s: { type: string }) => s.type)).toEqual(
      ['delay', 'createRecord'],
    );

    const outputRecords = await request(app.getHttpServer())
      .get(`/sheets/${outputSheetId}/records?limit=50`)
      .set(auth());
    const hit = outputRecords.body.records.find(
      (row: { cells: Record<string, unknown> }) =>
        row.cells[outputFieldId] === `after-delay-${stamp}`,
    );
    expect(hit).toBeTruthy();
  });

  it('coalesces concurrent recordButton clicks via inflight idempotency', async () => {
    const target = await request(app.getHttpServer())
      .post(`/sheets/${formSheetId}/records`)
      .set(auth())
      .send({ cells: { [phoneFieldId]: '13900000099' } });
    expect(target.status).toBe(201);

    const automation = await request(app.getHttpServer())
      .post('/automations')
      .set(auth())
      .send({
        baseId,
        name: '按钮防重',
        trigger: {
          type: 'recordButton',
          sheetId: formSheetId,
          buttonKey: `btn_${stamp}`,
          buttonLabel: '领取',
        },
        steps: [
          { id: 'wait', type: 'delay', delayMs: 1000 },
          {
            id: 'mark',
            type: 'createRecord',
            sheetId: outputSheetId,
            cells: {
              [outputFieldId]: {
                kind: 'literal',
                value: `btn-${stamp}`,
              },
            },
          },
        ],
      });
    expect(automation.status).toBe(201);

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post('/automations/sheet-buttons/run')
        .set(auth())
        .send({
          sheetId: formSheetId,
          recordId: target.body.id,
          buttonKey: `btn_${stamp}`,
        }),
      request(app.getHttpServer())
        .post('/automations/sheet-buttons/run')
        .set(auth())
        .send({
          sheetId: formSheetId,
          recordId: target.body.id,
          buttonKey: `btn_${stamp}`,
        }),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstRun = first.body[0];
    const secondRun = second.body[0];
    expect(firstRun.runId).toBe(secondRun.runId);
    expect(firstRun.status).toBe('waiting');

    const prisma = app.get(PrismaService);
    const waiting = await prisma.automationRun.findUnique({
      where: { id: firstRun.runId },
    });
    expect(waiting?.idempotencyKey).toContain(':inflight');

    await prisma.$executeRaw(
      Prisma.sql`UPDATE automation_runs SET resume_at = NOW() - interval '1 second' WHERE id = ${firstRun.runId}::uuid`,
    );
    const runner = app.get(AutomationRunnerService);
    await runner.runDueDelayedRuns();

    const done = await prisma.automationRun.findUnique({
      where: { id: firstRun.runId },
    });
    expect(done?.status).toBe('success');
    expect(done?.idempotencyKey).toBeNull();

    const again = await request(app.getHttpServer())
      .post('/automations/sheet-buttons/run')
      .set(auth())
      .send({
        sheetId: formSheetId,
        recordId: target.body.id,
        buttonKey: `btn_${stamp}`,
      });
    expect(again.status).toBe(201);
    expect(again.body[0].runId).not.toBe(firstRun.runId);
  });

  it('skips delayed resume when automation is disabled while waiting', async () => {
    const automation = await request(app.getHttpServer())
      .post('/automations')
      .set(auth())
      .send({
        baseId,
        name: '等待中停用',
        trigger: { type: 'recordCreated', sheetId: formSheetId },
        steps: [
          { id: 'wait', type: 'delay', delayMs: 1000 },
          {
            id: 'create-after',
            type: 'createRecord',
            sheetId: outputSheetId,
            cells: {
              [outputFieldId]: {
                kind: 'literal',
                value: `disabled-${stamp}`,
              },
            },
          },
        ],
      });
    expect(automation.status).toBe(201);

    const run = await request(app.getHttpServer())
      .post(`/automations/${automation.body.id}/run`)
      .set(auth())
      .send({});
    expect(run.status).toBe(201);
    expect(run.body.status).toBe('waiting');

    const disabled = await request(app.getHttpServer())
      .patch(`/automations/${automation.body.id}`)
      .set(auth())
      .send({ enabled: false });
    expect(disabled.status).toBe(200);

    const prisma = app.get(PrismaService);
    await prisma.$executeRaw(
      Prisma.sql`UPDATE automation_runs SET resume_at = NOW() - interval '1 second' WHERE id = ${run.body.runId}::uuid`,
    );
    const runner = app.get(AutomationRunnerService);
    const resumed = await runner.runDueDelayedRuns();
    expect(
      resumed.some(
        (item) => item.runId === run.body.runId && item.status === 'skipped',
      ),
    ).toBe(true);

    const row = await prisma.automationRun.findUnique({
      where: { id: run.body.runId },
    });
    expect(row?.status).toBe('skipped');
    expect(row?.resumeAt).toBeNull();
    expect(row?.resumeContext).toBeNull();

    const outputRecords = await request(app.getHttpServer())
      .get(`/sheets/${outputSheetId}/records?limit=50`)
      .set(auth());
    const hit = outputRecords.body.records.find(
      (r: { cells: Record<string, unknown> }) =>
        r.cells[outputFieldId] === `disabled-${stamp}`,
    );
    expect(hit).toBeFalsy();
  });

  it('keeps run logs with time/status/duration and enforces editor access', async () => {
    const outsider = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        account: `ao${String(stamp).slice(-10)}`,
        password: ownerPassword,
        securityQuestion: '你小学就读的学校名称是？',
        securityAnswer: 'demo',
      });
    const outsiderToken = outsider.body.accessToken as string;

    const forbidden = await request(app.getHttpServer())
      .get(`/automations/${claimAutomationId}/runs`)
      .set({ Authorization: `Bearer ${outsiderToken}` });
    expect(forbidden.status).toBe(403);

    const runs = await request(app.getHttpServer())
      .get(`/automations/${claimAutomationId}/runs`)
      .set(auth());
    expect(runs.body[0]).toMatchObject({
      status: 'success',
      durationMs: expect.any(Number),
      startedAt: expect.any(String),
      finishedAt: expect.any(String),
    });
    expect(runs.body[0].steps[0]).toMatchObject({
      stepIndex: 0,
      type: 'findRecords',
      status: 'success',
    });
  });
});
