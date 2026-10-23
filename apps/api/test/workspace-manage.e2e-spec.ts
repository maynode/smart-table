import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

process.env.AUTOMATION_SCHEDULER_ENABLED = 'false';

describe('Workspace rename / pin / delete (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();
  let token: string;

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
        account: `ws_manage${stamp}`,
        password: 'Passw0rd!123',
        name: '工作区管理员',
        securityQuestion: '你小学就读的学校名称是？', securityAnswer: 'demo',
        });
    token = owner.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('renames, pins to top, and deletes a workspace', async () => {
    const first = await request(app.getHttpServer())
      .post('/workspaces')
      .set(auth())
      .send({ name: '甲工作区' });
    expect(first.status).toBe(201);

    const second = await request(app.getHttpServer())
      .post('/workspaces')
      .set(auth())
      .send({ name: '乙工作区' });
    expect(second.status).toBe(201);

    const renamed = await request(app.getHttpServer())
      .patch(`/workspaces/${second.body.id}`)
      .set(auth())
      .send({ name: '乙工作区·改名' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('乙工作区·改名');

    const pinned = await request(app.getHttpServer())
      .patch(`/workspaces/${second.body.id}/pin`)
      .set(auth())
      .send({ pinned: true });
    expect(pinned.status).toBe(200);
    expect(pinned.body.pinned).toBe(true);
    expect(pinned.body.pinnedAt).toBeTruthy();

    const listed = await request(app.getHttpServer())
      .get('/workspaces')
      .set(auth());
    expect(listed.status).toBe(200);
    const mine = listed.body.filter(
      (item: { id: string }) =>
        item.id === first.body.id || item.id === second.body.id,
    );
    expect(mine[0].id).toBe(second.body.id);
    expect(mine[0].pinned).toBe(true);

    const removed = await request(app.getHttpServer())
      .delete(`/workspaces/${second.body.id}`)
      .set(auth());
    expect(removed.status).toBe(204);

    const after = await request(app.getHttpServer())
      .get('/workspaces')
      .set(auth());
    expect(after.body.some((item: { id: string }) => item.id === second.body.id))
      .toBe(false);
    expect(after.body.some((item: { id: string }) => item.id === first.body.id))
      .toBe(true);
  });
});
