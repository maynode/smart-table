import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

describe('activity logs (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const stamp = String(Date.now()).slice(-8);
  const adminAccount = `aad${stamp}`;
  const userAccount = `aus${stamp}`;
  let adminToken = '';
  let userToken = '';

  const registerBody = (account: string) => ({
    account,
    password: 'Ab12_cd34',
    securityQuestion: '你小学就读的学校名称是？',
    securityAnswer: 'demo',
  });

  beforeAll(async () => {
    process.env.INSTALL_ADMIN_ACCOUNTS = adminAccount;
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

    const adminReg = await request(app.getHttpServer())
      .post('/auth/register')
      .send(registerBody(adminAccount));
    if (![200, 201].includes(adminReg.status)) {
      throw new Error(
        `admin register ${adminReg.status}: ${JSON.stringify(adminReg.body)}`,
      );
    }
    adminToken = adminReg.body.accessToken as string;

    const userReg = await request(app.getHttpServer())
      .post('/auth/register')
      .send(registerBody(userAccount));
    if (![200, 201].includes(userReg.status)) {
      throw new Error(
        `user register ${userReg.status}: ${JSON.stringify(userReg.body)}`,
      );
    }
    userToken = userReg.body.accessToken as string;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('records frontend workspace create and lists for install admin', async () => {
    const wsName = `日志工作区_${stamp}`;
    const ws = await request(app.getHttpServer())
      .post('/workspaces')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: wsName });
    expect([200, 201]).toContain(ws.status);

    let found = false;
    for (let i = 0; i < 40 && !found; i += 1) {
      const listed = await request(app.getHttpServer())
        .get('/admin/activity-logs')
        .query({ q: userAccount, op: 'create' })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      found = listed.body.items.some(
        (row: { summary: string }) =>
          typeof row.summary === 'string' &&
          row.summary.includes(userAccount) &&
          row.summary.includes('工作区'),
      );
      if (!found) await new Promise((r) => setTimeout(r, 50));
    }
    expect(found).toBe(true);
    void ws;
  });

  it('does not expose activity list to normal users', async () => {
    await request(app.getHttpServer())
      .get('/admin/activity-logs')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('accepts client track and ignores admin paths', async () => {
    const trackHome = await request(app.getHttpServer())
      .post('/activity/track')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ event: 'page.view', path: '/', title: '首页' });
    expect([200, 201]).toContain(trackHome.status);

    const trackAdmin = await request(app.getHttpServer())
      .post('/activity/track')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ event: 'page.view', path: '/admin/users', title: '后台' });
    expect([200, 201]).toContain(trackAdmin.status);

    await new Promise((r) => setTimeout(r, 150));

    const home = await prisma.activityLog.findFirst({
      where: {
        actorAccount: userAccount,
        action: 'client.page.view',
        path: '/',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(home?.summary).toContain('打开了页面');

    const adminHit = await prisma.activityLog.findFirst({
      where: {
        actorAccount: userAccount,
        path: '/admin/users',
        source: 'client',
      },
    });
    expect(adminHit).toBeNull();
  });
});
