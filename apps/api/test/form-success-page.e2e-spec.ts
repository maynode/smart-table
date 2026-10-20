import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('Form success page variables (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();
  let token: string;
  let outsiderToken: string;
  let formId: string;

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

    const owner = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `success-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: '成功页管理员',
      });
    token = owner.body.accessToken;

    const outsider = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `success-out-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: '外部人',
      });
    outsiderToken = outsider.body.accessToken;

    const workspace = await request(app.getHttpServer())
      .post('/workspaces')
      .set(auth(token))
      .send({ name: '成功页工作区' });
    const base = await request(app.getHttpServer())
      .post(`/workspaces/${workspace.body.id}/bases`)
      .set(auth(token))
      .send({ name: '序列号领取' });
    const sheet = await request(app.getHttpServer())
      .post(`/bases/${base.body.id}/sheets`)
      .set(auth(token))
      .send({ name: '收集表单' });

    const phone = await request(app.getHttpServer())
      .post(`/sheets/${sheet.body.id}/fields`)
      .set(auth(token))
      .send({ name: '手机号', type: 'phone' });
    const serial = await request(app.getHttpServer())
      .post(`/sheets/${sheet.body.id}/fields`)
      .set(auth(token))
      .send({ name: '序列号', type: 'text' });

    formId = randomUUID();
    const form = await request(app.getHttpServer())
      .post(`/forms/${formId}`)
      .set(auth(token))
      .send({
        baseId: base.body.id,
        sheetId: sheet.body.id,
        name: '序列号领取',
        fields: [
          { fieldId: phone.body.id, required: true },
          { fieldId: serial.body.id },
        ],
        share: { enabled: true, audience: 'anyone' },
        successPage: {
          templateHtml:
            '领取成功，你的序列号是 {{序列号}}，客服：{{客服}}，未知变量 {{未定义变量}}',
        },
      });
    expect(form.status).toBe(201);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('merges step outputs over form cells and preserves unknown variables', async () => {
    const empty = await request(app.getHttpServer())
      .post(`/forms/${formId}/success-preview`)
      .set(auth(token))
      .send({ formCells: { 手机号: '13800000000' } });

    expect(empty.status).toBe(200);
    expect(empty.body.html).toContain('{{序列号}}');
    expect(empty.body.html).toContain('{{客服}}');

    const overridden = await request(app.getHttpServer())
      .post(`/forms/${formId}/success-preview`)
      .set(auth(token))
      .send({
        formCells: { 序列号: 'FORM-001', 手机号: '13800000000' },
        stepOutputs: { 序列号: 'TEST-01', 客服: '小助手' },
      });

    expect(overridden.status).toBe(200);
    expect(overridden.body.html).toContain('TEST-01');
    expect(overridden.body.html).not.toContain('FORM-001');
    expect(overridden.body.html).toContain('小助手');
    expect(overridden.body.html).toContain('{{未定义变量}}');
    expect(overridden.body.values['序列号']).toBe('TEST-01');

    const escaped = await request(app.getHttpServer())
      .post(`/forms/${formId}/success-preview`)
      .set(auth(token))
      .send({ stepOutputs: { 序列号: '<img src=x onerror=alert(1)>' } });

    expect(escaped.status).toBe(200);
    expect(escaped.body.html).toContain('&lt;img');
    expect(escaped.body.html).not.toContain('<img');

    const outsider = await request(app.getHttpServer())
      .post(`/forms/${formId}/success-preview`)
      .set(auth(outsiderToken))
      .send({ stepOutputs: { 序列号: 'NOPE' } });
    expect(outsider.status).toBe(403);
  });

  it('never 500s when the template references an automation-only variable', async () => {
    const publicForm = await request(app.getHttpServer())
      .get(`/forms/${formId}`)
      .set(auth(token));
    const tokenValue = publicForm.body.share.token as string;

    const submitted = await request(app.getHttpServer())
      .post(`/public/forms/${tokenValue}/submit`)
      .send({ cells: { [publicForm.body.fields[0].fieldId]: '13900000000' } });

    expect(submitted.status).toBe(201);
    expect(submitted.body.success.html).toContain('{{序列号}}');
  });
});
