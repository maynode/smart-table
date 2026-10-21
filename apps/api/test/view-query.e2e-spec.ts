import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('View query (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();
  let token: string;
  let sheetId: string;
  let fields: Record<string, string>;
  let rows: Array<{ id: string; cells: Record<string, unknown> }>;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const http = () => request(app.getHttpServer());

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

    const owner = await http()
      .post('/auth/register')
      .send({
        email: `views-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: '视图管理员',
      });
    token = owner.body.accessToken;

    const workspace = await http()
      .post('/workspaces')
      .set(auth())
      .send({ name: `视图工作区${stamp}` });
    const base = await http()
      .post(`/workspaces/${workspace.body.id}/bases`)
      .set(auth())
      .send({ name: '视图 Base' });

    const codeSheet = await http()
      .post(`/bases/${base.body.id}/sheets`)
      .set(auth())
      .send({ name: '码库' })
      .expect(201);
    const serial = await http()
      .post(`/sheets/${codeSheet.body.id}/fields`)
      .set(auth())
      .send({ name: '序列号', type: 'text' })
      .expect(201);
    const code = await http()
      .post(`/sheets/${codeSheet.body.id}/records`)
      .set(auth())
      .send({ cells: { [serial.body.id]: 'CODE-001' } })
      .expect(201);

    const sheet = await http()
      .post(`/bases/${base.body.id}/sheets`)
      .set(auth())
      .send({ name: '主表' })
      .expect(201);
    sheetId = sheet.body.id;

    const status = await http()
      .post(`/sheets/${sheetId}/fields`)
      .set(auth())
      .send({
        name: '状态',
        type: 'select',
        options: {
          choices: [
            { id: 'unclaimed', name: '未领' },
            { id: 'claimed', name: '已领' },
          ],
        },
      })
      .expect(201);
    const quantity = await http()
      .post(`/sheets/${sheetId}/fields`)
      .set(auth())
      .send({ name: '数量', type: 'number' })
      .expect(201);
    const formula = await http()
      .post(`/sheets/${sheetId}/fields`)
      .set(auth())
      .send({ name: '双倍', type: 'formula', options: { formula: '=数量*2' } })
      .expect(201);
    const relation = await http()
      .post(`/sheets/${sheetId}/fields`)
      .set(auth())
      .send({
        name: '关联',
        type: 'relation',
        options: { relation: { targetSheetId: codeSheet.body.id } },
      })
      .expect(201);
    const lookup = await http()
      .post(`/sheets/${sheetId}/fields`)
      .set(auth())
      .send({
        name: '查找',
        type: 'lookup',
        options: {
          lookup: {
            relationFieldId: relation.body.id,
            targetFieldId: serial.body.id,
            aggregate: 'first',
          },
        },
      })
      .expect(201);

    fields = {
      status: status.body.id,
      quantity: quantity.body.id,
      formula: formula.body.id,
      relation: relation.body.id,
      lookup: lookup.body.id,
    };

    const first = await http()
      .post(`/sheets/${sheetId}/records`)
      .set(auth())
      .send({
        cells: {
          [fields.status]: 'unclaimed',
          [fields.quantity]: 2,
          [fields.relation]: code.body.id,
        },
      })
      .expect(201);
    const second = await http()
      .post(`/sheets/${sheetId}/records`)
      .set(auth())
      .send({
        cells: { [fields.status]: 'claimed', [fields.quantity]: 5 },
      })
      .expect(201);
    rows = [first.body, second.body];
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('filters, sorts, computes formulas and resolves lookups', async () => {
    const response = await http()
      .post(`/sheets/${sheetId}/query`)
      .set(auth())
      .send({
        filters: {
          conjunction: 'and',
          conditions: [
            { fieldId: fields.status, operator: 'equals', value: 'unclaimed' },
          ],
        },
        sorts: [{ fieldId: fields.quantity, direction: 'desc' }],
        colorRules: [
          {
            fieldId: fields.quantity,
            operator: 'gt',
            value: 1,
            color: '#fff1f0',
            scope: 'row',
          },
        ],
      })
      .expect(200);

    expect(response.body.records).toHaveLength(1);
    const record = response.body.records[0];
    expect(record.id).toBe(rows[0].id);
    expect(record.cells[fields.formula]).toBe(4);
    expect(record.cells[fields.lookup]).toBe('CODE-001');
    expect(response.body.colors[record.id]).toBe('#fff1f0');
  });

  it('groups rows and sorts by the selected field', async () => {
    const response = await http()
      .post(`/sheets/${sheetId}/query`)
      .set(auth())
      .send({
        sorts: [{ fieldId: fields.quantity, direction: 'desc' }],
        groups: [{ fieldId: fields.status }],
      })
      .expect(200);

    expect(response.body.records.map((item: any) => item.cells[fields.quantity])).toEqual([5, 2]);
    const labels = response.body.groups
      .map((group: any) => `${group.label}:${group.count}`)
      .sort();
    expect(labels).toEqual(['已领:1', '未领:1']);
  });

  it('rejects callers without access to the sheet', async () => {
    const outsider = await http()
      .post('/auth/register')
      .send({
        email: `views-outsider-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: '外部用户',
      });
    await http()
      .post(`/sheets/${sheetId}/query`)
      .set({ Authorization: `Bearer ${outsider.body.accessToken}` })
      .send({})
      .expect(403);
  });
});
