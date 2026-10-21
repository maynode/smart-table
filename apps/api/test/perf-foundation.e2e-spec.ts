import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Performance foundation (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
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
    prisma = app.get(PrismaService);

    const owner = await http()
      .post('/auth/register')
      .send({
        email: `perf-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: '性能管理员',
      });
    token = owner.body.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('keeps the claim_status side-column index the claim query depends on', async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'records'
        AND indexdef LIKE '%claim_status%'
    `;
    expect(indexes.length).toBeGreaterThan(0);
  });

  it('claims through the indexed side column and exposes Prometheus metrics', async () => {
    const workspace = await http()
      .post('/workspaces')
      .set(auth())
      .send({ name: `性能工作区${stamp}` });
    const base = await http()
      .post(`/workspaces/${workspace.body.id}/bases`)
      .set(auth())
      .send({ name: '性能 Base' });
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
      .send({ cells: { [serial.body.id]: 'PERF-001', [status.body.id]: 'unclaimed' } });

    const formId = randomUUID();
    const form = await http()
      .post(`/forms/${formId}`)
      .set(auth())
      .send({
        baseId: base.body.id,
        sheetId: formSheet.body.id,
        name: '性能领取',
        fields: [{ fieldId: phone.body.id, required: true }],
        share: { enabled: true, audience: 'anyone' },
        successPage: { templateHtml: '序列号：{{序列号}}' },
      });
    expect(form.status).toBe(201);

    const automation = await http()
      .post('/automations')
      .set(auth())
      .send({
        baseId: base.body.id,
        name: '性能占码',
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
            cells: {
              [status.body.id]: { kind: 'literal', value: 'claimed' },
            },
          },
        ],
      });
    expect(automation.status).toBe(201);

    const submitted = await http()
      .post(`/public/forms/${form.body.share.token}/submit`)
      .send({ cells: { [phone.body.id]: '13700000000' } });
    expect(submitted.status).toBe(201);
    expect(submitted.body.success.html).toContain('PERF-001');

    const records = await http()
      .get(`/sheets/${codeSheet.body.id}/records?limit=10`)
      .set(auth());
    expect(records.body.records[0].claimStatus).toBe('claimed');

    const metrics = await http().get('/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.headers['content-type']).toContain('text/plain');
    expect(metrics.text).toContain('form_submit_total');

    const runs = await http()
      .get(`/automations/${automation.body.id}/runs`)
      .set(auth());
    expect(runs.body[0].status).toBe('success');
    expect(runs.body[0].steps.length).toBeGreaterThan(0);
  });
});
