import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('Analysis reports (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();
  const account = `ar${String(stamp).slice(-10)}`;
  const password = 'Ab12_cd34';
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

    const owner = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        account,
        password,
        securityQuestion: '你小学就读的学校名称是？',
        securityAnswer: 'demo',
      });
    expect(owner.status).toBeLessThan(400);
    token = owner.body.accessToken;

    const workspace = await request(app.getHttpServer())
      .post('/workspaces')
      .set(auth())
      .send({ name: '分析工作区' });
    const base = await request(app.getHttpServer())
      .post(`/workspaces/${workspace.body.id}/bases`)
      .set(auth())
      .send({ name: '分析 Base' });
    baseId = base.body.id;

    const sheet = await request(app.getHttpServer())
      .post(`/bases/${baseId}/sheets`)
      .set(auth())
      .send({ name: '销售', seed: false });
    sheetId = sheet.body.id;
    const field = await request(app.getHttpServer())
      .post(`/sheets/${sheetId}/fields`)
      .set(auth())
      .send({ name: '金额', type: 'number' });
    await request(app.getHttpServer())
      .post(`/sheets/${sheetId}/records`)
      .set(auth())
      .send({ cells: { [field.body.id]: 100 } });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('creates, answers async to ready, and deletes', async () => {
    const created = await request(app.getHttpServer())
      .post(`/bases/${baseId}/analysis-reports`)
      .set(auth())
      .send({ name: '销售简报' });
    expect(created.status).toBe(201);
    const reportId = created.body.id as string;

    const answered = await request(app.getHttpServer())
      .post(`/analysis-reports/${reportId}/answer`)
      .set(auth())
      .send({ optionId: `sheet:${sheetId}` });
    expect(answered.status).toBe(201);
    expect(['exploring', 'generating', 'ready']).toContain(
      answered.body.status,
    );

    let status = answered.body.status as string;
    for (let i = 0; i < 40 && status !== 'ready' && status !== 'failed'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const polled = await request(app.getHttpServer())
        .get(`/analysis-reports/${reportId}`)
        .set(auth());
      expect(polled.status).toBe(200);
      status = polled.body.status;
      if (status === 'ready') {
        expect(polled.body.reportMarkdown).toBeTruthy();
      }
    }
    expect(status).toBe('ready');

    const deleted = await request(app.getHttpServer())
      .delete(`/analysis-reports/${reportId}`)
      .set(auth());
    expect(deleted.status).toBe(200);
    expect(deleted.body.deleted).toBe(true);

    const gone = await request(app.getHttpServer())
      .get(`/analysis-reports/${reportId}`)
      .set(auth());
    expect(gone.status).toBe(404);
  }, 30_000);
});
