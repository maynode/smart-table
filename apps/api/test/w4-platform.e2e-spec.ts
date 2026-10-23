import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { AutomationSchedulerService } from '../src/automations/automation-scheduler.service';

process.env.AUTOMATION_SCHEDULER_ENABLED = 'false';

describe('W4 platform capabilities (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const stamp = Date.now();
  let token: string;
  let baseId: string;
  let sheetId: string;

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
    prisma = app.get(PrismaService);

    const owner = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        account: `w4${stamp}`,
        password: 'Passw0rd!123',
        name: 'W4 管理员',
        securityQuestion: '你小学就读的学校名称是？', securityAnswer: 'demo',
        });
    token = owner.body.accessToken;
    const workspace = await request(app.getHttpServer())
      .post('/workspaces')
      .set(auth())
      .send({ name: 'W4 工作区' });
    const base = await request(app.getHttpServer())
      .post(`/workspaces/${workspace.body.id}/bases`)
      .set(auth())
      .send({ name: 'W4 Base' });
    baseId = base.body.id;
    const sheet = await request(app.getHttpServer())
      .post(`/bases/${baseId}/sheets`)
      .set(auth())
      .send({ name: 'W4 表', seed: false });
    sheetId = sheet.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('persists named views through CRUD', async () => {
    const created = await request(app.getHttpServer())
      .post(`/sheets/${sheetId}/saved-views`)
      .set(auth())
      .send({
        name: '只看未领',
        query: {},
      });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('只看未领');

    const list = await request(app.getHttpServer())
      .get(`/sheets/${sheetId}/saved-views`)
      .set(auth());
    expect(list.body).toHaveLength(1);

    const renamed = await request(app.getHttpServer())
      .patch(`/saved-views/${created.body.id}`)
      .set(auth())
      .send({ name: '仅未领' });
    expect(renamed.body.name).toBe('仅未领');

    await request(app.getHttpServer())
      .delete(`/saved-views/${created.body.id}`)
      .set(auth())
      .expect(200);
    const after = await request(app.getHttpServer())
      .get(`/sheets/${sheetId}/saved-views`)
      .set(auth());
    expect(after.body).toHaveLength(0);
  });

  it('uploads an attachment and serves it back', async () => {
    const uploaded = await request(app.getHttpServer())
      .post(`/sheets/${sheetId}/attachments`)
      .set(auth())
      .attach('file', Buffer.from('w4-attachment'), {
        filename: 'note.txt',
        contentType: 'text/plain',
      });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.url).toMatch(/^\/files\/uploads\//);

    const served = await request(app.getHttpServer()).get(uploaded.body.url);
    expect(served.status).toBe(200);
    expect(served.text).toBe('w4-attachment');
  });

  it('deletes fields and strips their values from records', async () => {
    const field = await request(app.getHttpServer())
      .post(`/sheets/${sheetId}/fields`)
      .set(auth())
      .send({ name: '临时字段', type: 'text' });
    await request(app.getHttpServer())
      .post(`/sheets/${sheetId}/records`)
      .set(auth())
      .send({ cells: { [field.body.id]: '待删除' } });

    await request(app.getHttpServer())
      .delete(`/fields/${field.body.id}`)
      .set(auth())
      .expect(200);

    const records = await request(app.getHttpServer())
      .get(`/sheets/${sheetId}/records`)
      .set(auth());
    expect(records.body.records[0].cells[field.body.id]).toBeUndefined();
  });

  it('runs due schedule automations exactly once via atomic claim', async () => {
    const field = await request(app.getHttpServer())
      .post(`/sheets/${sheetId}/fields`)
      .set(auth())
      .send({ name: '来源', type: 'text' });
    const created = await request(app.getHttpServer())
      .post('/automations')
      .set(auth())
      .send({
        baseId,
        name: '每分钟写入',
        enabled: true,
        trigger: { type: 'schedule', cron: '* * * * *', timezone: 'UTC' },
        steps: [
          {
            id: 'create-scheduled',
            type: 'createRecord',
            sheetId,
            cells: {
              [field.body.id]: { kind: 'literal', value: 'scheduler' },
            },
          },
        ],
      });
    expect(created.status).toBe(201);
    expect(created.body.nextRunAt).toBeTruthy();

    await prisma.automation.update({
      where: { id: created.body.id },
      data: { nextRunAt: new Date(Date.now() - 60_000) },
    });
    const scheduler = app.get(AutomationSchedulerService);
    const first = await scheduler.runDueSchedules();
    const second = await scheduler.runDueSchedules();
    expect(first.some((item) => item.automationId === created.body.id)).toBe(
      true,
    );
    expect(second.some((item) => item.automationId === created.body.id)).toBe(
      false,
    );

    const runs = await prisma.automationRun.findMany({
      where: { automationId: created.body.id },
    });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('success');

    const records = await request(app.getHttpServer())
      .get(`/sheets/${sheetId}/records`)
      .set(auth());
    const matches = records.body.records.filter(
      (record: { cells: Record<string, unknown> }) =>
        record.cells[field.body.id] === 'scheduler',
    );
    expect(matches).toHaveLength(1);

    const automation = await prisma.automation.findUnique({
      where: { id: created.body.id },
    });
    expect(automation?.lastRunAt).toBeTruthy();
    expect(automation?.nextRunAt?.getTime()).toBeGreaterThan(Date.now());
  });

  it('renames and deletes a sheet', async () => {
    const renamed = await request(app.getHttpServer())
      .patch(`/sheets/${sheetId}`)
      .set(auth())
      .send({ name: '已重命名' });
    expect(renamed.body.name).toBe('已重命名');
    await request(app.getHttpServer())
      .delete(`/sheets/${sheetId}`)
      .set(auth())
      .expect(200);
    await request(app.getHttpServer())
      .get(`/sheets/${sheetId}`)
      .set(auth())
      .expect(404);
  });
});
