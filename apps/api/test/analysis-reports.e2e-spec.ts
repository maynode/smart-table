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

  it('creates, renames, chats to ready report, and deletes', async () => {
    const created = await request(app.getHttpServer())
      .post(`/bases/${baseId}/analysis-reports`)
      .set(auth())
      .send({ name: '销售简报' });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('draft');
    expect(created.body.messages?.[0]?.role).toBe('assistant');
    const reportId = created.body.id as string;

    const renamed = await request(app.getHttpServer())
      .patch(`/analysis-reports/${reportId}`)
      .set(auth())
      .send({ name: '销售简报（改名）' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('销售简报（改名）');

    const chatted = await request(app.getHttpServer())
      .post(`/analysis-reports/${reportId}/chat`)
      .set(auth())
      .send({ text: '请生成分析报告' });
    expect(chatted.status).toBe(201);
    expect(chatted.body.status).toBe('ready');
    expect(chatted.body.reportMarkdown).toBeTruthy();
    expect(
      chatted.body.messages.some(
        (m: { role: string; content: string }) =>
          m.role === 'user' && m.content.includes('生成分析报告'),
      ),
    ).toBe(true);

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

  it('uploads arbitrary files and chats with unlimited attachments under 100MB', async () => {
    const PNG_1X1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );

    const created = await request(app.getHttpServer())
      .post(`/bases/${baseId}/analysis-reports`)
      .set(auth())
      .send({ name: '附件对话' });
    expect(created.status).toBe(201);
    const reportId = created.body.id as string;

    const uploaded: Array<{
      url: string;
      name: string;
      mimetype: string;
      size: number;
    }> = [];

    const png = await request(app.getHttpServer())
      .post(`/analysis-reports/${reportId}/attachments`)
      .set(auth())
      .attach('file', PNG_1X1, {
        filename: 'shot.png',
        contentType: 'image/png',
      });
    expect(png.status).toBe(201);
    uploaded.push(png.body);

    const txt = await request(app.getHttpServer())
      .post(`/analysis-reports/${reportId}/attachments`)
      .set(auth())
      .attach('file', Buffer.from('hello analysis'), {
        filename: 'note.txt',
        contentType: 'text/plain',
      });
    expect(txt.status).toBe(201);
    expect(txt.body.mimetype).toBe('text/plain');
    uploaded.push(txt.body);

    const pdf = await request(app.getHttpServer())
      .post(`/analysis-reports/${reportId}/attachments`)
      .set(auth())
      .attach('file', Buffer.from('%PDF-1.4 demo'), {
        filename: 'brief.pdf',
        contentType: 'application/pdf',
      });
    expect(pdf.status).toBe(201);
    uploaded.push(pdf.body);

    for (const item of uploaded) {
      expect(item.url).toMatch(/^\/files\/uploads\//);
      expect(item.size).toBeLessThan(100 * 1024 * 1024);
    }

    const rejectedSize = await request(app.getHttpServer())
      .post(`/analysis-reports/${reportId}/attachments`)
      .set(auth())
      .attach('file', Buffer.alloc(100 * 1024 * 1024 + 1, 1), {
        filename: 'too-big.bin',
        contentType: 'application/octet-stream',
      });
    expect(rejectedSize.status).toBeGreaterThanOrEqual(400);

    const chatted = await request(app.getHttpServer())
      .post(`/analysis-reports/${reportId}/chat`)
      .set(auth())
      .send({ text: '看看这些附件', attachments: uploaded });
    expect(chatted.status).toBe(201);
    const userMsg = chatted.body.messages.find(
      (m: {
        role: string;
        content: string;
        attachments?: Array<{ url: string }>;
      }) => m.role === 'user' && m.content.includes('看看这些附件'),
    );
    expect(userMsg?.attachments).toHaveLength(3);
    expect(userMsg.attachments[0].url).toBe(uploaded[0].url);

    await request(app.getHttpServer())
      .delete(`/analysis-reports/${reportId}`)
      .set(auth());
  }, 120_000);
});
