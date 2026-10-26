import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import WebSocket from 'ws';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('Base Live Bus (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();
  const account = `lv${String(stamp).slice(-10)}`;
  const password = 'Ab12_cd34';
  let token: string;
  let baseId: string;
  let workspaceId: string;
  let sheetId: string;
  let port: number;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    process.env.LIVE_REDIS = '0';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await configureApp(app);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    port =
      typeof address === 'object' && address && 'port' in address
        ? Number(address.port)
        : 0;

    const owner = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        account,
        password,
        securityQuestion: '你小学就读的学校名称是？',
        securityAnswer: 'demo',
      });
    expect(owner.status).toBeLessThan(400);
    token = owner.body.accessToken;

    const workspace = await request(app.getHttpServer())
      .post('/workspaces')
      .set(auth())
      .send({ name: 'Live 工作区' });
    workspaceId = workspace.body.id;
    const base = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/bases`)
      .set(auth())
      .send({ name: 'Live Base' });
    baseId = base.body.id;
    const sheet = await request(app.getHttpServer())
      .post(`/bases/${baseId}/sheets`)
      .set(auth())
      .send({ name: 'Live 表', seed: true });
    expect(sheet.status).toBeLessThan(400);
    sheetId = sheet.body.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  async function openLive(query: string): Promise<WebSocket> {
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/live?${query}`,
      );
      const timer = setTimeout(() => reject(new Error('ws timeout')), 10_000);
      socket.on('open', () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.on('error', reject);
    });
    await new Promise<void>((resolve) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as { type: string };
        if (msg.type === 'live_hello') {
          ws.send(JSON.stringify({ type: 'client_ready' }));
          resolve();
        }
      });
    });
    return ws;
  }

  it('pushes sheet.created over /live and supports since catchup', async () => {
    const events: Array<{ kind: string }> = [];
    const ws = await openLive(
      `token=${encodeURIComponent(token)}&baseId=${encodeURIComponent(baseId)}`,
    );

    const waitCreated = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('sheet.created not received')),
        10_000,
      );
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as {
          type: string;
          kind?: string;
        };
        if (msg.type === 'live_event') {
          events.push({ kind: msg.kind ?? '' });
          if (msg.kind === 'sheet.created') {
            clearTimeout(timer);
            resolve();
          }
        }
      });
    });

    const created = await request(app.getHttpServer())
      .post(`/bases/${baseId}/sheets`)
      .set(auth())
      .send({ name: 'Live 新表', seed: false });
    expect(created.status).toBeLessThan(400);
    await waitCreated;
    expect(events.some((e) => e.kind === 'sheet.created')).toBe(true);

    const since = await request(app.getHttpServer())
      .get(`/bases/${baseId}/live/since?seq=0`)
      .set(auth());
    expect(since.status).toBe(200);
    expect(since.body.latestSeq).toBeGreaterThan(0);

    ws.close();
  }, 30_000);

  it('pushes base.created to workspace live room', async () => {
    const ws = await openLive(
      `token=${encodeURIComponent(token)}&workspaceId=${encodeURIComponent(workspaceId)}`,
    );

    const got = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('base.created not received')),
        10_000,
      );
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as {
          type: string;
          kind?: string;
        };
        if (msg.type === 'live_event' && msg.kind === 'base.created') {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    const created = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/bases`)
      .set(auth())
      .send({ name: `LiveBase-${Date.now()}` });
    expect(created.status).toBeLessThan(400);
    await got;

    const since = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/live/since?seq=0`)
      .set(auth());
    expect(since.status).toBe(200);
    expect(
      (since.body.events as Array<{ kind: string }>).some(
        (e) => e.kind === 'base.created',
      ),
    ).toBe(true);

    ws.close();
  }, 30_000);

  it('pushes member.changed when avatar seed updates', async () => {
    const ws = await openLive(
      `token=${encodeURIComponent(token)}&workspaceId=${encodeURIComponent(workspaceId)}`,
    );

    const got = new Promise<{ action?: string }>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('member.changed not received')),
        10_000,
      );
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as {
          type: string;
          kind?: string;
          meta?: { action?: string };
        };
        if (msg.type === 'live_event' && msg.kind === 'member.changed') {
          clearTimeout(timer);
          resolve({ action: msg.meta?.action });
        }
      });
    });

    const seed = `av${String(Date.now()).slice(-10)}`;
    const updated = await request(app.getHttpServer())
      .post('/auth/avatar')
      .set(auth())
      .send({ avatarSeed: seed });
    expect(updated.status).toBeLessThan(400);
    expect(updated.body.avatarSeed).toBe(seed);

    const event = await got;
    expect(event.action).toBe('avatar');

    ws.close();
  }, 30_000);

  it('pushes member.changed when username updates', async () => {
    const ws = await openLive(
      `token=${encodeURIComponent(token)}&workspaceId=${encodeURIComponent(workspaceId)}`,
    );

    const got = new Promise<{ action?: string; account?: string }>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('member.changed not received')),
          10_000,
        );
        ws.on('message', (raw) => {
          const msg = JSON.parse(String(raw)) as {
            type: string;
            kind?: string;
            meta?: { action?: string; account?: string };
          };
          if (msg.type === 'live_event' && msg.kind === 'member.changed') {
            clearTimeout(timer);
            resolve({
              action: msg.meta?.action,
              account: msg.meta?.account,
            });
          }
        });
      },
    );

    const nextAccount = `un${String(Date.now()).slice(-10)}`;
    const updated = await request(app.getHttpServer())
      .post('/auth/username')
      .set(auth())
      .send({ account: nextAccount });
    expect(updated.status).toBeLessThan(400);
    expect(updated.body.account).toBe(nextAccount);

    const event = await got;
    expect(event.action).toBe('username');
    expect(event.account).toBe(nextAccount);

    ws.close();
  }, 30_000);

  it('pushes widget.changed when dashboard widget is added', async () => {
    const dash = await request(app.getHttpServer())
      .post(`/bases/${baseId}/dashboards`)
      .set(auth())
      .send({ name: `LiveDash-${Date.now()}` });
    expect(dash.status).toBeLessThan(400);
    const dashboardId = dash.body.id as string;

    const ws = await openLive(
      `token=${encodeURIComponent(token)}&baseId=${encodeURIComponent(baseId)}`,
    );

    const got = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('widget.changed not received')),
        10_000,
      );
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as {
          type: string;
          kind?: string;
        };
        if (msg.type === 'live_event' && msg.kind === 'widget.changed') {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    const widget = await request(app.getHttpServer())
      .post(`/dashboards/${dashboardId}/widgets`)
      .set(auth())
      .send({
        type: 'text',
        title: 'Live 文本块',
        config: { text: 'hi' },
      });
    expect(widget.status).toBeLessThan(400);
    await got;
    ws.close();
  }, 30_000);

  it('pushes view.changed when saved view is created', async () => {
    const ws = await openLive(
      `token=${encodeURIComponent(token)}&baseId=${encodeURIComponent(baseId)}`,
    );

    const got = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('view.changed not received')),
        10_000,
      );
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as {
          type: string;
          kind?: string;
        };
        if (msg.type === 'live_event' && msg.kind === 'view.changed') {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    const created = await request(app.getHttpServer())
      .post(`/sheets/${sheetId}/saved-views`)
      .set(auth())
      .send({
        name: `LiveView-${Date.now()}`,
        query: { filters: { conjunction: 'and', conditions: [] } },
      });
    expect(created.status).toBeLessThan(400);
    await got;
    ws.close();
  }, 30_000);

  it('pushes sheet.rev_bumped after automation createRecord', async () => {
    const automation = await request(app.getHttpServer())
      .post('/automations')
      .set(auth())
      .send({
        baseId,
        name: `LiveAuto-${Date.now()}`,
        trigger: { type: 'recordCreated', sheetId },
        steps: [
          {
            id: 'create-one',
            type: 'createRecord',
            sheetId,
            cells: {},
          },
        ],
      });
    expect(automation.status).toBeLessThan(400);
    const automationId = automation.body.id as string;

    const ws = await openLive(
      `token=${encodeURIComponent(token)}&baseId=${encodeURIComponent(baseId)}`,
    );

    const got = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('sheet.rev_bumped not received')),
        10_000,
      );
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as {
          type: string;
          kind?: string;
          entityId?: string;
          meta?: { reason?: string };
        };
        if (
          msg.type === 'live_event' &&
          msg.kind === 'sheet.rev_bumped' &&
          msg.entityId === sheetId &&
          msg.meta?.reason === 'automation'
        ) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    const ran = await request(app.getHttpServer())
      .post(`/automations/${automationId}/run`)
      .set(auth())
      .send({});
    expect(ran.status).toBeLessThan(400);
    await got;
    ws.close();
  }, 30_000);

  it('renames form with sheet and emits form.updated; cascade delete emits form/public_view deleted', async () => {
    const formSheet = await request(app.getHttpServer())
      .post(`/bases/${baseId}/sheets`)
      .set(auth())
      .send({ name: '收集表单-Live', seed: false });
    expect(formSheet.status).toBeLessThan(400);
    const formSheetId = formSheet.body.id as string;

    const field = await request(app.getHttpServer())
      .post(`/sheets/${formSheetId}/fields`)
      .set(auth())
      .send({ name: '姓名', type: 'text' });
    expect(field.status).toBeLessThan(400);

    const { randomUUID } = await import('crypto');
    const formId = randomUUID();
    const upserted = await request(app.getHttpServer())
      .post(`/forms/${formId}`)
      .set(auth())
      .send({
        baseId,
        sheetId: formSheetId,
        name: '旧表单名',
        fields: [{ fieldId: field.body.id, required: false }],
        share: { enabled: true, audience: 'anyone' },
      });
    expect(upserted.status).toBeLessThan(400);

    const seeded = await request(app.getHttpServer())
      .post(`/sheets/${formSheetId}/records`)
      .set(auth())
      .send({ cells: { [field.body.id]: '示例' } });
    expect(seeded.status).toBeLessThan(400);

    const pub = await request(app.getHttpServer())
      .post(`/sheets/${formSheetId}/public-views`)
      .set(auth())
      .send({
        name: '表单公开',
        sheetIds: [],
        formSheetIds: [formSheetId],
        dashboardIds: [],
        analysisReportIds: [],
      });
    expect(pub.status).toBeLessThan(400);
    const viewId = pub.body.id as string;

    const ws = await openLive(
      `token=${encodeURIComponent(token)}&baseId=${encodeURIComponent(baseId)}`,
    );

    const renamed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('form.updated not received')),
        10_000,
      );
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as {
          type: string;
          kind?: string;
          entityId?: string;
          meta?: { name?: string };
        };
        if (
          msg.type === 'live_event' &&
          msg.kind === 'form.updated' &&
          msg.entityId === formId &&
          msg.meta?.name === '新表单名'
        ) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    const patch = await request(app.getHttpServer())
      .patch(`/sheets/${formSheetId}`)
      .set(auth())
      .send({ name: '新表单名' });
    expect(patch.status).toBeLessThan(400);
    await renamed;

    const formAfter = await request(app.getHttpServer())
      .get(`/forms/${formId}`)
      .set(auth());
    expect(formAfter.status).toBeLessThan(400);
    expect(formAfter.body.name).toBe('新表单名');

    const deletedKinds = new Set<string>();
    const cascade = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `cascade live incomplete: ${[...deletedKinds].join(',')}`,
            ),
          ),
        10_000,
      );
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as {
          type: string;
          kind?: string;
          entityId?: string;
        };
        if (msg.type !== 'live_event') return;
        if (
          (msg.kind === 'form.deleted' && msg.entityId === formId) ||
          (msg.kind === 'public_view.deleted' && msg.entityId === viewId) ||
          (msg.kind === 'sheet.deleted' && msg.entityId === formSheetId)
        ) {
          deletedKinds.add(msg.kind!);
        }
        if (
          deletedKinds.has('form.deleted') &&
          deletedKinds.has('public_view.deleted') &&
          deletedKinds.has('sheet.deleted')
        ) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    const removed = await request(app.getHttpServer())
      .delete(`/sheets/${formSheetId}`)
      .set(auth());
    expect(removed.status).toBeLessThan(400);
    await cascade;
    ws.close();
  }, 30_000);

  it('pushes sheet.schema_changed to public live room', async () => {
    const pub = await request(app.getHttpServer())
      .post(`/sheets/${sheetId}/public-views`)
      .set(auth())
      .send({
        name: `SchemaPub-${Date.now()}`,
        sheetIds: [sheetId],
        formSheetIds: [],
        dashboardIds: [],
        analysisReportIds: [],
      });
    expect(pub.status).toBeLessThan(400);
    const publicToken = pub.body.token as string;

    const ws = await openLive(
      `publicToken=${encodeURIComponent(publicToken)}`,
    );

    const got = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('schema_changed not received on public')),
        10_000,
      );
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as {
          type: string;
          kind?: string;
          entityId?: string;
        };
        if (
          msg.type === 'live_event' &&
          msg.kind === 'sheet.schema_changed' &&
          msg.entityId === sheetId
        ) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    const field = await request(app.getHttpServer())
      .post(`/sheets/${sheetId}/fields`)
      .set(auth())
      .send({ name: `LiveCol-${Date.now()}`, type: 'text' });
    expect(field.status).toBeLessThan(400);
    await got;
    ws.close();
  }, 30_000);

  it('serves public-view and form live/since with only public-safe events', async () => {
    const pub = await request(app.getHttpServer())
      .post(`/sheets/${sheetId}/public-views`)
      .set(auth())
      .send({
        name: `CatchupPub-${Date.now()}`,
        sheetIds: [sheetId],
        formSheetIds: [],
        dashboardIds: [],
        analysisReportIds: [],
      });
    expect(pub.status).toBeLessThan(400);

    const field = await request(app.getHttpServer())
      .post(`/sheets/${sheetId}/fields`)
      .set(auth())
      .send({ name: `CatchupCol-${Date.now()}`, type: 'text' });
    expect(field.status).toBeLessThan(400);

    const sincePub = await request(app.getHttpServer()).get(
      `/public-views/${pub.body.token}/live/since?seq=0`,
    );
    expect(sincePub.status).toBe(200);
    expect(sincePub.body.latestSeq).toBeGreaterThan(0);
    const pubKinds = (sincePub.body.events as Array<{ kind: string }>).map(
      (e) => e.kind,
    );
    expect(pubKinds).toContain('sheet.schema_changed');
    expect(pubKinds.some((k) => k.startsWith('permission'))).toBe(false);

    const { randomUUID } = await import('crypto');
    const formSheet = await request(app.getHttpServer())
      .post(`/bases/${baseId}/sheets`)
      .set(auth())
      .send({ name: 'CatchupFormSheet', seed: false });
    expect(formSheet.status).toBeLessThan(400);
    const formField = await request(app.getHttpServer())
      .post(`/sheets/${formSheet.body.id}/fields`)
      .set(auth())
      .send({ name: '姓名', type: 'text' });
    expect(formField.status).toBeLessThan(400);
    const formId = randomUUID();
    const form = await request(app.getHttpServer())
      .post(`/forms/${formId}`)
      .set(auth())
      .send({
        baseId,
        sheetId: formSheet.body.id,
        name: 'CatchupForm',
        fields: [{ fieldId: formField.body.id, required: false }],
        share: { enabled: true, audience: 'anyone' },
      });
    expect(form.status).toBeLessThan(400);
    const shareToken = form.body.share?.token ?? form.body.shareToken;
    expect(shareToken).toBeTruthy();

    const sinceForm = await request(app.getHttpServer()).get(
      `/public/forms/${shareToken}/live/since?seq=0`,
    );
    expect(sinceForm.status).toBe(200);
    expect(sinceForm.body.latestSeq).toBeGreaterThan(0);
  }, 30_000);

  it('serves /live/me/since for the current user', async () => {
    const since = await request(app.getHttpServer())
      .get('/live/me/since?seq=0')
      .set(auth());
    expect(since.status).toBe(200);
    expect(typeof since.body.latestSeq).toBe('number');
    expect(Array.isArray(since.body.events)).toBe(true);
  });

  it('keeps workspace since seq independent from base seq (no mixed-cursor skip)', async () => {
    // 抬高 base seq
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post(`/sheets/${sheetId}/fields`)
        .set(auth())
        .send({ name: `SeqBump-${Date.now()}-${i}`, type: 'text' })
        .expect((res) => expect(res.status).toBeLessThan(400));
    }
    const baseSince = await request(app.getHttpServer())
      .get(`/bases/${baseId}/live/since?seq=0`)
      .set(auth());
    expect(baseSince.body.latestSeq).toBeGreaterThan(3);

    // workspace 原生事件（无 baseId）
    const renamed = await request(app.getHttpServer())
      .patch(`/workspaces/${workspaceId}`)
      .set(auth())
      .send({ name: `LiveWS-${Date.now()}` });
    expect(renamed.status).toBeLessThan(400);

    // 若错误地用 base.latestSeq 去滤 ws 历史，会漏掉 workspace.updated
    const wsSince = await request(app.getHttpServer())
      .get(
        `/workspaces/${workspaceId}/live/since?seq=${baseSince.body.latestSeq}`,
      )
      .set(auth());
    expect(wsSince.status).toBe(200);
    expect(
      (wsSince.body.events as Array<{ kind: string }>).some(
        (e) => e.kind === 'workspace.updated',
      ),
    ).toBe(true);
  });

  it('pushes notification.created when member role changes', async () => {
    const peerAccount = `lvb${String(Date.now()).slice(-9)}`;
    const peer = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        account: peerAccount,
        password,
        securityQuestion: '你小学就读的学校名称是？',
        securityAnswer: 'demo',
      });
    expect(peer.status).toBeLessThan(400);
    const peerToken = peer.body.accessToken as string;
    const peerId = peer.body.user.id as string;

    const invited = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/members`)
      .set(auth())
      .send({ account: peerAccount, role: 'viewer' });
    expect(invited.status).toBeLessThan(400);
    expect(invited.body.userId).toBe(peerId);

    const ws = await openLive(
      `token=${encodeURIComponent(peerToken)}&workspaceId=${encodeURIComponent(workspaceId)}`,
    );

    const got = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('notification.created not received')),
        10_000,
      );
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as {
          type: string;
          kind?: string;
        };
        if (msg.type === 'live_event' && msg.kind === 'notification.created') {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    const updated = await request(app.getHttpServer())
      .patch(`/workspaces/${workspaceId}/members/${peerId}`)
      .set(auth())
      .send({ role: 'editor' });
    expect(updated.status).toBeLessThan(400);
    await got;
    ws.close();
  }, 30_000);
});
