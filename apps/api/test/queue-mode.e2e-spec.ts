import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';

// Queue mode is selected at module construction; set it before importing app.
process.env.SUBMIT_MODE = 'queue';
process.env.PUBLIC_SUBMIT_RATE_LIMIT = '1000';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

jest.setTimeout(30_000);

describe('Queue submit mode (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();
  let token: string;

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
        email: `queue-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: '队列管理员',
      });
    token = owner.body.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
    delete process.env.SUBMIT_MODE;
  });

  async function poll(
    token: string,
    submissionId: string,
  ): Promise<Record<string, any>> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await http().get(
        `/public/forms/${token}/submissions/${submissionId}`,
      );
      expect(response.status).toBe(200);
      if (response.body.status === 'completed' || response.body.status === 'failed') {
        return response.body;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('submission did not settle in time');
  }

  it('accepts 202, processes in the worker, and exposes the rendered success page', async () => {
    const workspace = await http()
      .post('/workspaces')
      .set(auth())
      .send({ name: `队列工作区${stamp}` });
    const base = await http()
      .post(`/workspaces/${workspace.body.id}/bases`)
      .set(auth())
      .send({ name: '队列 Base' });
    const formSheet = await http()
      .post(`/bases/${base.body.id}/sheets`)
      .set(auth())
      .send({ name: '收集表单' });
    const phone = await http()
      .post(`/sheets/${formSheet.body.id}/fields`)
      .set(auth())
      .send({ name: '手机号', type: 'phone' });
    const codeSheet = await http()
      .post(`/bases/${base.body.id}/sheets`)
      .set(auth())
      .send({ name: '码库' });
    const serial = await http()
      .post(`/sheets/${codeSheet.body.id}/fields`)
      .set(auth())
      .send({ name: '序列号', type: 'text' });
    const status = await http()
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
    await http()
      .post(`/sheets/${codeSheet.body.id}/records`)
      .set(auth())
      .send({ cells: { [serial.body.id]: 'QUEUE-001', [status.body.id]: 'unclaimed' } });

    const form = await http()
      .post(`/forms/${randomUUID()}`)
      .set(auth())
      .send({
        baseId: base.body.id,
        sheetId: formSheet.body.id,
        name: '队列领取',
        fields: [{ fieldId: phone.body.id, required: true }],
        share: { enabled: true, audience: 'anyone' },
        successPage: { templateHtml: '你的序列号：{{序列号}}' },
      });
    expect(form.status).toBe(201);

    await http()
      .post('/automations')
      .set(auth())
      .send({
        baseId: base.body.id,
        name: '队列占码',
        onFindEmpty: 'stop',
        trigger: {
          type: 'recordCreated',
          sheetId: formSheet.body.id,
          filters: {
            conjunction: 'and',
            conditions: [{ fieldId: phone.body.id, operator: 'isNotEmpty' }],
          },
        },
        steps: [
          {
            id: 'find-code',
            type: 'findRecords',
            sheetId: codeSheet.body.id,
            filters: {
              conjunction: 'and',
              conditions: [
                { fieldId: status.body.id, operator: 'equals', value: 'unclaimed' },
              ],
            },
          },
          {
            id: 'claim-code',
            type: 'modifyRecords',
            target: { mode: 'fromStep', stepId: 'find-code' },
            cells: { [status.body.id]: { kind: 'literal', value: 'claimed' } },
          },
        ],
      })
      .expect(201);

    const accepted = await http()
      .post(`/public/forms/${form.body.share.token}/submit`)
      .send({ cells: { [phone.body.id]: '13600000000' } });
    expect(accepted.status).toBe(202);
    expect(accepted.body.status).toBe('queued');
    expect(accepted.body.submissionId).toBeTruthy();

    const settled = await poll(form.body.share.token, accepted.body.submissionId);
    expect(settled.status).toBe('completed');
    expect(settled.success.html).toContain('QUEUE-001');
    expect(settled.stepOutputs['序列号']).toBe('QUEUE-001');

    // A second submission has no code left: the queued job fails with 409 text
    // and the poll endpoint reports it without leaking a success page.
    const exhausted = await http()
      .post(`/public/forms/${form.body.share.token}/submit`)
      .send({ cells: { [phone.body.id]: '13600000001' } });
    expect(exhausted.status).toBe(202);
    const failed = await poll(form.body.share.token, exhausted.body.submissionId);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('领取完毕');
    expect(failed.success).toBeUndefined();
  });
});
