import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Forms public share and submit (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();

  let token: string;
  let baseId: string;
  let sheetId: string;
  let phoneFieldId: string;
  let serialFieldId: string;
  let remarkFieldId: string;
  let formId: string;
  let shareToken: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function upsertForm(patch: Record<string, unknown> = {}) {
    const body = {
      baseId,
      sheetId,
      name: '序列号领取登记',
      fields: [
        { fieldId: phoneFieldId, required: true },
        { fieldId: serialFieldId },
        {
          fieldId: remarkFieldId,
          displayConditions: [
            { fieldId: phoneFieldId, operator: 'equals', value: '13800000000' },
          ],
        },
      ],
      share: { enabled: true, audience: 'anyone' },
      successPage: {
        templateHtml: '领取成功，你的序列号是 {{序列号}}',
      },
      ...patch,
    };

    return request(app.getHttpServer())
      .post(`/forms/${formId}`)
      .set(auth())
      .send(body);
  }

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
        email: `forms-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: '表单管理员',
      });
    token = user.body.accessToken;

    const workspace = await request(app.getHttpServer())
      .post('/workspaces')
      .set(auth())
      .send({ name: '表单工作区' });
    const base = await request(app.getHttpServer())
      .post(`/workspaces/${workspace.body.id}/bases`)
      .set(auth())
      .send({ name: '序列号领取' });
    baseId = base.body.id;

    const sheet = await request(app.getHttpServer())
      .post(`/bases/${baseId}/sheets`)
      .set(auth())
      .send({ name: '收集表单', seed: false });
    sheetId = sheet.body.id;

    async function field(name: string, type: string) {
      const response = await request(app.getHttpServer())
        .post(`/sheets/${sheetId}/fields`)
        .set(auth())
        .send({ name, type });
      return response.body.id as string;
    }

    phoneFieldId = await field('手机号', 'phone');
    serialFieldId = await field('序列号', 'text');
    remarkFieldId = await field('备注', 'text');
    formId = randomUUID();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('configures share/cover/display conditions, enforces 403 and rate limit', async () => {
    const created = await upsertForm();
    expect(created.status).toBe(201);
    expect(created.body.share.token).toEqual(expect.any(String));
    expect(created.body.share.qrUrl).toContain(created.body.share.token);
    expect(created.body.share.qrCodeDataUrl).toMatch(
      /^data:image\/png;base64,/,
    );
    shareToken = created.body.share.token;

    const cover = await request(app.getHttpServer())
      .post(`/forms/${formId}/cover`)
      .set(auth())
      .attach('file', PNG_1X1, 'cover.png');
    expect(cover.status).toBe(201);
    expect(cover.body.coverUrl).toMatch(/^\/files\/covers\//);

    const form = await request(app.getHttpServer())
      .get(`/forms/${formId}`)
      .set(auth());
    expect(form.status).toBe(200);
    expect(form.body.coverUrl).toBe(cover.body.coverUrl);

    const coverFile = await request(app.getHttpServer()).get(
      form.body.coverUrl,
    );
    expect(coverFile.status).toBe(200);
    expect(coverFile.headers['content-type']).toContain('image/png');

    const publicForm = await request(app.getHttpServer()).get(
      `/public/forms/${shareToken}`,
    );
    expect(publicForm.status).toBe(200);
    const visibleNames = (
      publicForm.body.fields as Array<{ name: string }>
    ).map((item) => item.name);
    // 公开接口返回全部配置字段；显示条件由前端按作答值求值
    expect(visibleNames).toEqual(['手机号', '序列号', '备注']);
    expect(publicForm.body.qrUrl).toContain(shareToken);

    const disabled = await upsertForm({ share: { enabled: false } });
    expect(disabled.status).toBe(201);
    expect(
      (
        await request(app.getHttpServer()).get(
          `/public/forms/${shareToken}`,
        )
      ).status,
    ).toBe(403);

    const expired = await upsertForm({
      share: {
        enabled: true,
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      },
    });
    expect(expired.status).toBe(201);
    expect(
      (
        await request(app.getHttpServer()).get(
          `/public/forms/${shareToken}`,
        )
      ).status,
    ).toBe(403);

    const restored = await upsertForm({
      share: { enabled: true, audience: 'anyone', expiresAt: null },
    });
    expect(restored.status).toBe(201);

    const missingPhone = await request(app.getHttpServer())
      .post(`/public/forms/${shareToken}/submit`)
      .send({ cells: {} });
    expect(missingPhone.status).toBe(400);

    const submitted = await request(app.getHttpServer())
      .post(`/public/forms/${shareToken}/submit`)
      .send({
        cells: { [phoneFieldId]: '13900000000', [remarkFieldId]: '应被过滤' },
      });
    expect(submitted.status).toBe(201);
    expect(submitted.body.status).toBe('completed');
    expect(submitted.body.success.html).toContain('{{序列号}}');

    const records = await request(app.getHttpServer())
      .get(`/sheets/${sheetId}/records`)
      .set(auth());
    expect(records.body.records).toHaveLength(1);
    expect(records.body.records[0].cells[phoneFieldId]).toBe('13900000000');
    expect(records.body.records[0].cells[remarkFieldId]).toBeUndefined();

    let saw429 = false;
    for (let i = 0; i < 40; i += 1) {
      const attempt = await request(app.getHttpServer())
        .post(`/public/forms/${shareToken}/submit`)
        .send({ cells: {} });
      if (attempt.status === 429) {
        saw429 = true;
        break;
      }
      expect(attempt.status).toBe(400);
    }
    expect(saw429).toBe(true);
  });
});
