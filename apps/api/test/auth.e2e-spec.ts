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
  const email = `auth-${Date.now()}@example.com`;
  const password = 'Passw0rd!123';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers, logs in, and answers an authenticated ping', async () => {
    const register = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, name: '张三' });

    expect(register.status).toBe(201);
    expect(register.body.accessToken).toEqual(expect.any(String));
    expect(register.body.user.email).toBe(email);
    expect(register.body.user.passwordHash).toBeUndefined();

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });

    expect(login.status).toBe(200);
    const token = login.body.accessToken as string;
    expect(token).toEqual(expect.any(String));

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);
    expect(me.body.name).toBe('张三');

    const anonymous = await request(app.getHttpServer()).get('/auth/me');
    expect(anonymous.status).toBe(401);

    const badPassword = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'wrong-password' });
    expect(badPassword.status).toBe(401);
  });
});
