import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('Grid shell support APIs (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();
  let token: string;
  let outsiderToken: string;
  let baseId: string;
  let sheetId: string;
  let fieldId: string;

  const auth = (value: string) => ({ Authorization: `Bearer ${value}` });

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

    const user = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `shell-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: '壳层用户',
      });
    token = user.body.accessToken;

    const outsider = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `shell-out-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: '外部人',
      });
    outsiderToken = outsider.body.accessToken;

    const workspace = await request(app.getHttpServer())
      .post('/workspaces')
      .set(auth(token))
      .send({ name: '壳层工作区' });
    const base = await request(app.getHttpServer())
      .post(`/workspaces/${workspace.body.id}/bases`)
      .set(auth(token))
      .send({ name: '序列号领取' });
    baseId = base.body.id;

    const sheet = await request(app.getHttpServer())
      .post(`/bases/${baseId}/sheets`)
      .set(auth(token))
      .send({ name: '码库' });
    sheetId = sheet.body.id;

    const field = await request(app.getHttpServer())
      .post(`/sheets/${sheetId}/fields`)
      .set(auth(token))
      .send({ name: '序列号', type: 'text' });
    fieldId = field.body.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('lists sheets/base detail, hides fields, and stores comments', async () => {
    const sheets = await request(app.getHttpServer())
      .get(`/bases/${baseId}/sheets`)
      .set(auth(token));
    expect(sheets.status).toBe(200);
    expect(sheets.body.map((s: { name: string }) => s.name)).toContain('码库');

    const base = await request(app.getHttpServer())
      .get(`/bases/${baseId}`)
      .set(auth(token));
    expect(base.status).toBe(200);
    expect(base.body.name).toBe('序列号领取');

    const hide = await request(app.getHttpServer())
      .patch(`/fields/${fieldId}`)
      .set(auth(token))
      .send({ hidden: true });
    expect(hide.status).toBe(200);
    expect(hide.body.hidden).toBe(true);

    const sheetDetail = await request(app.getHttpServer())
      .get(`/sheets/${sheetId}`)
      .set(auth(token));
    expect(sheetDetail.body.fields[0].hidden).toBe(true);

    const comment = await request(app.getHttpServer())
      .post(`/sheets/${sheetId}/comments`)
      .set(auth(token))
      .send({ body: '这里的序列号需要复核' });
    expect(comment.status).toBe(201);
    expect(comment.body.body).toBe('这里的序列号需要复核');
    expect(comment.body.author.name).toBe('壳层用户');

    const comments = await request(app.getHttpServer())
      .get(`/sheets/${sheetId}/comments`)
      .set(auth(token));
    expect(comments.status).toBe(200);
    expect(comments.body).toHaveLength(1);

    const outsiderComment = await request(app.getHttpServer())
      .post(`/sheets/${sheetId}/comments`)
      .set(auth(outsiderToken))
      .send({ body: '越权评论' });
    expect(outsiderComment.status).toBe(403);
  });
});
