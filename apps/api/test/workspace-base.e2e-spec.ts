import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('Workspace + Base + members (e2e)', () => {
  let app: NestFastifyApplication;
  const stamp = Date.now();
  const ownerAccount = `owner_${stamp}`;
  const memberAccount = `member_${stamp}`;
  const outsiderAccount = `outsider_${stamp}`;

  let ownerToken: string;
  let memberToken: string;
  let outsiderToken: string;
  let memberUserId: string;
  let workspaceId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function register(
    account: string,
    name: string,
  ): Promise<{ token: string; userId: string }> {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ account, password: 'Passw0rd!123', name, securityQuestion: '你小学就读的学校名称是？', securityAnswer: 'demo' });

    expect(res.status).toBe(201);
    return { token: res.body.accessToken, userId: res.body.user.id };
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

    ownerToken = (await register(ownerAccount, '所有者')).token;
    const member = await register(memberAccount, '成员');
    memberToken = member.token;
    memberUserId = member.userId;
    outsiderToken = (await register(outsiderAccount, '外部人')).token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a workspace and base, invites a member, and enforces roles', async () => {
    const workspace = await request(app.getHttpServer())
      .post('/workspaces')
      .set(auth(ownerToken))
      .send({ name: '序列号工作区' });

    expect(workspace.status).toBe(201);
    expect(workspace.body.role).toBe('owner');
    workspaceId = workspace.body.id;

    const base = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/bases`)
      .set(auth(ownerToken))
      .send({ name: '序列号领取' });

    expect(base.status).toBe(201);
    expect(base.body.workspaceId).toBe(workspaceId);

    const bases = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/bases`)
      .set(auth(ownerToken));

    expect(bases.status).toBe(200);
    expect(bases.body.map((item: { name: string }) => item.name)).toContain(
      '序列号领取',
    );

    const outsiderList = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/bases`)
      .set(auth(outsiderToken));
    expect(outsiderList.status).toBe(403);

    const invite = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/members`)
      .set(auth(ownerToken))
      .send({ account: memberAccount, role: 'editor' });

    expect(invite.status).toBe(201);
    expect(invite.body.role).toBe('editor');

    const memberList = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/bases`)
      .set(auth(memberToken));
    expect(memberList.status).toBe(200);

    const changeRole = await request(app.getHttpServer())
      .patch(`/workspaces/${workspaceId}/members/${memberUserId}`)
      .set(auth(ownerToken))
      .send({ role: 'viewer' });

    expect(changeRole.status).toBe(200);
    expect(changeRole.body.role).toBe('viewer');

    // A viewer cannot create bases.
    const denied = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/bases`)
      .set(auth(memberToken))
      .send({ name: '越权创建' });
    expect(denied.status).toBe(403);

    const members = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/members`)
      .set(auth(ownerToken));
    expect(members.status).toBe(200);
    expect(
      members.body.map((item: { account: string }) => item.account),
    ).toEqual(expect.arrayContaining([ownerAccount, memberAccount]));

    const remove = await request(app.getHttpServer())
      .delete(`/workspaces/${workspaceId}/members/${memberUserId}`)
      .set(auth(ownerToken));
    expect(remove.status).toBe(204);

    const afterRemoval = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/bases`)
      .set(auth(memberToken));
    expect(afterRemoval.status).toBe(403);
  });
});
