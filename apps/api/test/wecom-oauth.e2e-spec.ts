import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { createServer, type Server } from 'node:http';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('WeCom OAuth and notification adapter (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();
  let token: string;
  let userId: string;
  let workspaceId: string;
  let baseId: string;
  let sheetId: string;
  let server: Server;
  let mockUrl: string;
  let messages: Array<Record<string, unknown>> = [];

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url?.startsWith('/token')) {
          const payload = JSON.parse(body || '{}') as { code?: string };
          res.end(
            JSON.stringify({
              userid: `wx_${payload.code}`,
              name: '企微用户',
              email: `wecom-${stamp}@example.com`,
            }),
          );
          return;
        }
        if (req.url?.startsWith('/message')) {
          messages.push(JSON.parse(body || '{}') as Record<string, unknown>);
          res.end(JSON.stringify({ errcode: 0 }));
          return;
        }
        res.statusCode = 404;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    mockUrl = `http://127.0.0.1:${port}`;
    process.env.WECOM_ENABLED = 'true';
    process.env.WECOM_MOCK_IDP_URL = mockUrl;
    process.env.WECOM_MOCK_NOTIFY_URL = mockUrl;
    process.env.WECOM_CORP_ID = 'ww-test-corp';
    process.env.WECOM_AGENT_ID = '1000002';

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
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (app) await app.close();
  });

  it('logs in through WeCom OAuth and maps the user idempotently', async () => {
    const config = await http().get('/auth/wecom/config').expect(200);
    expect(config.body.enabled).toBe(true);
    expect(config.body.authorizeUrl).toContain('/authorize');

    const first = await http()
      .post('/auth/wecom/callback')
      .send({ code: 'code-1' })
      .expect(200);
    token = first.body.accessToken;
    userId = first.body.user.id;
    expect(first.body.user.email).toBe(`wecom-${stamp}@example.com`);

    const second = await http()
      .post('/auth/wecom/callback')
      .send({ code: 'code-1' })
      .expect(200);
    expect(second.body.user.id).toBe(userId);

    const me = await http().get('/auth/me').set(auth()).expect(200);
    expect(me.body.id).toBe(userId);

    await http()
      .post('/auth/wecom/callback')
      .send({ code: '' })
      .expect(401);
  });

  it('sends application messages through the WeCom adapter', async () => {
    const workspace = await http()
      .post('/workspaces')
      .set(auth())
      .send({ name: `企微工作区${stamp}` })
      .expect(201);
    workspaceId = workspace.body.id;
    const base = await http()
      .post(`/workspaces/${workspaceId}/bases`)
      .set(auth())
      .send({ name: '企微 Base' })
      .expect(201);
    baseId = base.body.id;
    const sheet = await http()
      .post(`/bases/${baseId}/sheets`)
      .set(auth())
      .send({ name: '企微表' })
      .expect(201);
    sheetId = sheet.body.id;

    const automation = await http()
      .post('/automations')
      .set(auth())
      .send({
        baseId,
        name: '企微通知',
        trigger: { type: 'recordCreated', sheetId },
        steps: [
          {
            id: 'msg',
            type: 'sendMessage',
            channel: 'doc',
            recipients: [{ source: 'fixed', userIds: [userId] }],
            content: { text: '企微应用消息' },
          },
        ],
      })
      .expect(201);

    await http()
      .post(`/automations/${automation.body.id}/run`)
      .set(auth())
      .send({})
      .expect(201);

    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].touser).toBe('wx_code-1');
    expect(messages[0].text).toBe('企微应用消息');
  });
});
