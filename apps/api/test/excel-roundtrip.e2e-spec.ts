import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

function binaryParser(
  response: NodeJS.ReadableStream,
  callback: (error: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', (error: Error) => callback(error, Buffer.alloc(0)));
}

const parseBinary = binaryParser as unknown as (
  response: unknown,
  callback: (error: Error | null, body: Buffer) => void,
) => void;

describe('Excel import/export roundtrip (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();
  let token: string;
  let baseId: string;

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
        account: `excel${stamp}`,
        password: 'Passw0rd!123',
        name: 'Excel 管理员',
        securityQuestion: '你小学就读的学校名称是？', securityAnswer: 'demo',
        });
    token = owner.body.accessToken;

    const workspace = await http()
      .post('/workspaces')
      .set(auth())
      .send({ name: `Excel 工作区${stamp}` });
    const base = await http()
      .post(`/workspaces/${workspace.body.id}/bases`)
      .set(auth())
      .send({ name: 'Excel Base' });
    baseId = base.body.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  async function createSheet(name: string) {
    const sheet = await http()
      .post(`/bases/${baseId}/sheets`)
      .set(auth())
      .send({ name, seed: false })
      .expect(201);
    return sheet.body.id as string;
  }

  async function createFields(sheetId: string) {
    const specs = [
      { name: '名称', type: 'text' },
      { name: '数量', type: 'number' },
      { name: '手机号', type: 'phone' },
      {
        name: '状态',
        type: 'select',
        options: {
          choices: [
            { id: 'unclaimed', name: '未领' },
            { id: 'claimed', name: '已领' },
          ],
        },
      },
      {
        name: '标签',
        type: 'multiSelect',
        options: {
          choices: [
            { id: 'red', name: '红' },
            { id: 'blue', name: '蓝' },
          ],
        },
      },
      { name: '启用', type: 'checkbox' },
      { name: '日期', type: 'date' },
      { name: '金额', type: 'currency' },
    ];
    const fields: Array<{ id: string; name: string }> = [];
    for (const spec of specs) {
      const field = await http()
        .post(`/sheets/${sheetId}/fields`)
        .set(auth())
        .send(spec)
        .expect(201);
      fields.push({ id: field.body.id, name: field.body.name });
    }
    return Object.fromEntries(fields.map((field) => [field.name, field.id])) as Record<
      string,
      string
    >;
  }

  it('exports display values and imports them back into an identical sheet', async () => {
    const sourceId = await createSheet('导出源');
    const sourceFields = await createFields(sourceId);

    const cells = {
      [sourceFields['名称']]: '测试记录',
      [sourceFields['数量']]: 42,
      [sourceFields['手机号']]: '13800000000',
      [sourceFields['状态']]: 'unclaimed',
      [sourceFields['标签']]: ['red', 'blue'],
      [sourceFields['启用']]: true,
      [sourceFields['日期']]: '2026-10-21',
      [sourceFields['金额']]: 99.5,
    };
    await http()
      .post(`/sheets/${sourceId}/records`)
      .set(auth())
      .send({ cells })
      .expect(201);

    const exported = await http()
      .get(`/sheets/${sourceId}/export`)
      .set(auth())
      .buffer(true)
      .parse(parseBinary)
      .expect(200);
    expect(exported.headers['content-type']).toContain('spreadsheetml');
    expect(Buffer.isBuffer(exported.body)).toBe(true);
    expect(exported.body.length).toBeGreaterThan(1000);

    const targetId = await createSheet('导入目标');
    const targetFields = await createFields(targetId);

    const imported = await http()
      .post(`/sheets/${targetId}/import`)
      .set(auth())
      .attach('file', exported.body, 'roundtrip.xlsx')
      .expect(201);
    expect(imported.body.imported).toBe(1);
    expect(imported.body.errors).toEqual([]);

    const target = await http()
      .get(`/sheets/${targetId}/records?limit=10`)
      .set(auth())
      .expect(200);
    expect(target.body.records).toHaveLength(1);
    const stored = target.body.records[0].cells;

    expect(stored[targetFields['名称']]).toBe('测试记录');
    expect(stored[targetFields['数量']]).toBe(42);
    expect(stored[targetFields['手机号']]).toBe('13800000000');
    expect(stored[targetFields['状态']]).toBe('unclaimed');
    expect(stored[targetFields['标签']]).toEqual(['red', 'blue']);
    expect(stored[targetFields['启用']]).toBe(true);
    expect(stored[targetFields['日期']]).toBe('2026-10-21');
    expect(stored[targetFields['金额']]).toBe(99.5);
    expect(target.body.records[0].claimStatus).toBe('unclaimed');
  });

  it('rejects unknown select options per row without aborting the file', async () => {
    const sheetId = await createSheet('容错导入');
    const fields = await createFields(sheetId);
    const sourceId = await createSheet('容错源');
    const sourceFields = await createFields(sourceId);

    await http()
      .post(`/sheets/${sourceId}/records`)
      .set(auth())
      .send({
        cells: {
          [sourceFields['名称']]: '坏选项',
          [sourceFields['状态']]: '不存在的状态',
        },
      })
      .expect(201);
    const exported = await http()
      .get(`/sheets/${sourceId}/export`)
      .set(auth())
      .buffer(true)
      .parse(parseBinary)
      .expect(200);

    const imported = await http()
      .post(`/sheets/${sheetId}/import`)
      .set(auth())
      .attach('file', exported.body, 'bad.xlsx')
      .expect(201);
    expect(imported.body.imported).toBe(0);
    expect(imported.body.errors[0].message).toContain('选项不存在');
    expect(fields['状态']).toBeTruthy();
  });
});
