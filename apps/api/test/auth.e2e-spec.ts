import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('Auth (e2e)', () => {
  let app: NestFastifyApplication;
  const account = `auth_${Date.now()}`;
  const password = 'Passw0rd!123';

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
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers, logs in, and answers an authenticated ping', async () => {
    const register = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        account,
        password,
        securityQuestion: '你小学就读的学校名称是？',
        securityAnswer: 'demo',
      });

    expect(register.status).toBe(201);
    expect(register.body.accessToken).toEqual(expect.any(String));
    expect(register.body.user.account).toBe(account);
    expect(register.body.user.name).toBeUndefined();
    expect(register.body.user.passwordHash).toBeUndefined();

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ account, password });

    expect(login.status).toBe(200);
    const token = login.body.accessToken as string;
    expect(token).toEqual(expect.any(String));

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(me.status).toBe(200);
    expect(me.body.account).toBe(account);
    expect(me.body.name).toBeUndefined();

    const anonymous = await request(app.getHttpServer()).get('/auth/me');
    expect(anonymous.status).toBe(401);

    const badPassword = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ account, password: 'wrong-password' });
    expect(badPassword.status).toBe(401);
  });
});
