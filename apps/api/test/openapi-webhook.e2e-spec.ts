import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { createServer, type Server } from 'node:http';
import { createHmac } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('Open API and webhooks (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();
  let token: string;
  let workspaceId: string;
  let baseId: string;
  let sheetId: string;
  let apiKey: string;
  let apiKeyId: string;
  let readKey: string;
  let webhookId: string;
  let webhookSecret: string;
  let webhookUrl: string;
  let server: Server;
  const received: Array<{
    body: string;
    event: string;
    signature: string;
  }> = [];

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const http = () => request(app.getHttpServer());

  async function waitFor<T>(
    read: () => Promise<T>,
    done: (value: T) => boolean,
    timeout = 10_000,
  ): Promise<T> {
    const startedAt = Date.now();
    let last: T | undefined;
    while (Date.now() - startedAt < timeout) {
      last = await read();
      if (done(last)) return last;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`condition not met, last=${JSON.stringify(last)}`);
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

    const owner = await http()
      .post('/auth/register')
      .send({
        email: `openapi-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: '开放 API 管理员',
      });
    token = owner.body.accessToken;
    const workspace = await http()
      .post('/workspaces')
      .set(auth())
      .send({ name: `开放工作区${stamp}` });
    workspaceId = workspace.body.id;
    const base = await http()
      .post(`/workspaces/${workspaceId}/bases`)
      .set(auth())
      .send({ name: '开放 Base' });
    baseId = base.body.id;
    const sheet = await http()
      .post(`/bases/${baseId}/sheets`)
      .set(auth())
      .send({ name: '开放表' });
    sheetId = sheet.body.id;

    const key = await http()
      .post(`/workspaces/${workspaceId}/api-keys`)
      .set(auth())
      .send({ name: '自动化 Key' })
      .expect(201);
    apiKey = key.body.token;
    apiKeyId = key.body.id;
    expect(apiKey.startsWith('st_')).toBe(true);
    const readonly = await http()
      .post(`/workspaces/${workspaceId}/api-keys`)
      .set(auth())
      .send({ name: '只读 Key', scopes: ['read'] })
      .expect(201);
    readKey = readonly.body.token;

    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        received.push({
          body,
          event: String(req.headers['x-smarttable-event'] ?? ''),
          signature: String(req.headers['x-smarttable-signature'] ?? ''),
        });
        res.statusCode = 200;
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    webhookUrl = `http://127.0.0.1:${port}/hook`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (app) await app.close();
  });

  it('authenticates API keys, enforces scopes and mirrors product writes', async () => {
    await http().get(`/open/v1/workspaces/${workspaceId}/bases`).expect(401);
    await http()
      .get(`/open/v1/workspaces/${workspaceId}/bases`)
      .set('X-API-Key', 'st_bad_token')
      .expect(401);

    const bases = await http()
      .get(`/open/v1/workspaces/${workspaceId}/bases`)
      .set('X-API-Key', apiKey)
      .expect(200);
    expect(bases.body.map((base: { id: string }) => base.id)).toContain(baseId);

    const createdBase = await http()
      .post(`/open/v1/workspaces/${workspaceId}/bases`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ name: 'API 创建的 Base' })
      .expect(201);
    const createdSheet = await http()
      .post(`/open/v1/bases/${createdBase.body.id}/sheets`)
      .set('X-API-Key', apiKey)
      .send({ name: 'API 表' })
      .expect(201);
    await http()
      .post(`/open/v1/sheets/${createdSheet.body.id}/fields`)
      .set('X-API-Key', apiKey)
      .send({ name: '名称', type: 'text' })
      .expect(201);
    const record = await http()
      .post(`/open/v1/sheets/${createdSheet.body.id}/records`)
      .set('X-API-Key', apiKey)
      .send({ cells: {} })
      .expect(201);
    const listed = await http()
      .get(`/open/v1/sheets/${createdSheet.body.id}/records`)
      .set('X-API-Key', apiKey)
      .expect(200);
    expect(listed.body.records[0].id).toBe(record.body.id);

    await http()
      .post(`/open/v1/sheets/${createdSheet.body.id}/records`)
      .set('X-API-Key', readKey)
      .send({ cells: {} })
      .expect(403);
  });

  it('delivers signed record.created webhooks', async () => {
    const webhook = await http()
      .post(`/workspaces/${workspaceId}/webhooks`)
      .set(auth())
      .send({ url: webhookUrl })
      .expect(201);
    webhookId = webhook.body.id;
    webhookSecret = webhook.body.secret;

    await http()
      .post(`/open/v1/sheets/${sheetId}/records`)
      .set('X-API-Key', apiKey)
      .send({ cells: {} })
      .expect(201);

    const status = await waitFor(
      async () => {
        const deliveries = await http()
          .get(`/webhooks/${webhookId}/deliveries`)
          .set(auth())
          .expect(200);
        return deliveries.body[0]?.status as string | undefined;
      },
      (value) => value === 'success',
    );
    expect(status).toBe('success');

    expect(received).toHaveLength(1);
    expect(received[0].event).toBe('record.created');
    const expected = `sha256=${createHmac('sha256', webhookSecret)
      .update(received[0].body)
      .digest('hex')}`;
    expect(received[0].signature).toBe(expected);
    const payload = JSON.parse(received[0].body) as {
      event: string;
      data: { sheetId: string };
    };
    expect(payload.event).toBe('record.created');
    expect(payload.data.sheetId).toBe(sheetId);
  });

  it('retries failures and exposes a dead letter', async () => {
    const bad = await http()
      .post(`/workspaces/${workspaceId}/webhooks`)
      .set(auth())
      .send({ url: 'http://127.0.0.1:1/unreachable' })
      .expect(201);

    await http()
      .post(`/sheets/${sheetId}/records`)
      .set(auth())
      .send({ cells: {} })
      .expect(201);

    const attempts = await waitFor(
      async () => {
        const deliveries = await http()
          .get(`/webhooks/${bad.body.id}/deliveries?status=failed`)
          .set(auth())
          .expect(200);
        return (deliveries.body[0]?.attempts ?? 0) as number;
      },
      (value) => value === 3,
    );
    expect(attempts).toBe(3);

    const dead = await http()
      .get(`/webhooks/${bad.body.id}/deliveries?status=failed`)
      .set(auth())
      .expect(200);
    expect(dead.body[0].status).toBe('failed');
    expect(dead.body[0].error).toBeTruthy();

    await http()
      .post(`/webhook-deliveries/${dead.body[0].id}/retry`)
      .set(auth())
      .expect(201);
  });

  it('revokes webhooks and API keys', async () => {
    await http().delete(`/webhooks/${webhookId}`).set(auth()).expect(200);
    await http()
      .delete(`/api-keys/${apiKeyId}`)
      .set(auth())
      .expect(200);
    await http()
      .get(`/open/v1/workspaces/${workspaceId}/bases`)
      .set('X-API-Key', apiKey)
      .expect(401);
  });
});
