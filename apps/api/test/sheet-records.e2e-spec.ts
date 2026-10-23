import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('Sheets, fields and records (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();

  let token: string;
  let outsiderToken: string;
  let baseId: string;
  let sheetId: string;
  let serialFieldId: string;
  let statusFieldId: string;
  let phoneFieldId: string;

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
        email: `sheets-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: '表格所有者',
      });
    token = owner.body.accessToken;

    const outsider = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `sheets-out-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: '外部人',
      });
    outsiderToken = outsider.body.accessToken;

    const workspace = await request(app.getHttpServer())
      .post('/workspaces')
      .set(auth(token))
      .send({ name: '码库工作区' });

    const base = await request(app.getHttpServer())
      .post(`/workspaces/${workspace.body.id}/bases`)
      .set(auth(token))
      .send({ name: '序列号领取' });

    baseId = base.body.id;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('creates 码库 fields and pages records with cursor only', async () => {
    const sheet = await request(app.getHttpServer())
      .post(`/bases/${baseId}/sheets`)
      .set(auth(token))
      .send({ name: '码库', seed: false });

    expect(sheet.status).toBe(201);
    expect(sheet.body.name).toBe('码库');
    sheetId = sheet.body.id;

    const serial = await request(app.getHttpServer())
      .post(`/sheets/${sheetId}/fields`)
      .set(auth(token))
      .send({ name: '序列号', type: 'text' });
    expect(serial.status).toBe(201);
    expect(serial.body.type).toBe('text');
    serialFieldId = serial.body.id;

    const status = await request(app.getHttpServer())
      .post(`/sheets/${sheetId}/fields`)
      .set(auth(token))
      .send({
        name: '状态',
        type: 'select',
        options: {
          choices: [
            { id: 'unclaimed', name: '未领', color: 'yellow' },
            { id: 'claimed', name: '已领', color: 'green' },
          ],
        },
      });
    expect(status.status).toBe(201);
    statusFieldId = status.body.id;

    const phone = await request(app.getHttpServer())
      .post(`/sheets/${sheetId}/fields`)
      .set(auth(token))
      .send({ name: '手机号', type: 'phone' });
    expect(phone.status).toBe(201);
    phoneFieldId = phone.body.id;

    const badType = await request(app.getHttpServer())
      .post(`/sheets/${sheetId}/fields`)
      .set(auth(token))
      .send({ name: '坏字段', type: 'not-a-field-type' });
    expect(badType.status).toBe(400);

    const first = await request(app.getHttpServer())
      .post(`/sheets/${sheetId}/records`)
      .set(auth(token))
      .send({
        cells: {
          [serialFieldId]: 'TEST-01',
          [statusFieldId]: 'unclaimed',
        },
      });

    expect(first.status).toBe(201);
    expect(first.body.version).toBe(1);
    expect(first.body.cells[serialFieldId]).toBe('TEST-01');

    const second = await request(app.getHttpServer())
      .post(`/sheets/${sheetId}/records`)
      .set(auth(token))
      .send({
        cells: {
          [serialFieldId]: 'TEST-02',
          [statusFieldId]: 'unclaimed',
        },
      });
    expect(second.status).toBe(201);

    const unknownField = await request(app.getHttpServer())
      .post(`/sheets/${sheetId}/records`)
      .set(auth(token))
      .send({ cells: { 'no-such-field': 'x' } });
    expect(unknownField.status).toBe(400);

    const pageOne = await request(app.getHttpServer())
      .get(`/sheets/${sheetId}/records?limit=1`)
      .set(auth(token));

    expect(pageOne.status).toBe(200);
    expect(pageOne.body.records).toHaveLength(1);
    expect(pageOne.body.nextCursor).toEqual(expect.any(String));

    const pageTwo = await request(app.getHttpServer())
      .get(
        `/sheets/${sheetId}/records?limit=1&cursor=${encodeURIComponent(
          pageOne.body.nextCursor,
        )}`,
      )
      .set(auth(token));

    expect(pageTwo.status).toBe(200);
    expect(pageTwo.body.records).toHaveLength(1);
    expect(pageTwo.body.records[0].id).not.toBe(pageOne.body.records[0].id);

    const all = await request(app.getHttpServer())
      .get(`/sheets/${sheetId}/records`)
      .set(auth(token));
    expect(all.body.records).toHaveLength(2);
    expect(all.body.nextCursor).toBeNull();

    const detail = await request(app.getHttpServer())
      .get(`/sheets/${sheetId}`)
      .set(auth(token));
    expect(detail.status).toBe(200);
    expect(detail.body.fields).toHaveLength(3);

    const outsider = await request(app.getHttpServer())
      .get(`/sheets/${sheetId}/records`)
      .set(auth(outsiderToken));
    expect(outsider.status).toBe(403);

    const patched = await request(app.getHttpServer())
      .patch(`/records/${first.body.id}`)
      .set(auth(token))
      .send({ cells: { [phoneFieldId]: '13800000000' } });

    expect(patched.status).toBe(200);
    expect(patched.body.version).toBe(2);
    expect(patched.body.cells[phoneFieldId]).toBe('13800000000');
    expect(patched.body.cells[serialFieldId]).toBe('TEST-01');
  });
});
