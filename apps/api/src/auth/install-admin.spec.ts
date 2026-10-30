import {
  configuredInstallAdminAccounts,
  isEnvInstallAdminAccount,
  isInstallAdmin,
} from './install-admin';

type FakeUser = {
  id: string;
  account: string;
  installAdmin: boolean;
  createdAt: Date;
};

function fakePrisma(users: FakeUser[]) {
  return {
    user: {
      findUnique: async ({ where: { id } }: { where: { id: string } }) =>
        users.find((u) => u.id === id) ?? null,
      findFirst: async ({
        where,
        orderBy,
      }: {
        where?: { installAdmin?: boolean };
        orderBy?: { createdAt: 'asc' | 'desc' };
        select?: unknown;
      }) => {
        let list = [...users];
        if (where?.installAdmin === true) {
          list = list.filter((u) => u.installAdmin);
        }
        if (orderBy?.createdAt === 'asc') {
          list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        }
        return list[0] ?? null;
      },
    },
  };
}

describe('install-admin', () => {
  const prevAccounts = process.env.INSTALL_ADMIN_ACCOUNTS;
  const prevEmails = process.env.INSTALL_ADMIN_EMAILS;

  afterEach(() => {
    if (prevAccounts === undefined) delete process.env.INSTALL_ADMIN_ACCOUNTS;
    else process.env.INSTALL_ADMIN_ACCOUNTS = prevAccounts;
    if (prevEmails === undefined) delete process.env.INSTALL_ADMIN_EMAILS;
    else process.env.INSTALL_ADMIN_EMAILS = prevEmails;
  });

  it('parses configured accounts', () => {
    process.env.INSTALL_ADMIN_ACCOUNTS = 'Alice, bob@X.com';
    delete process.env.INSTALL_ADMIN_EMAILS;
    expect(configuredInstallAdminAccounts()).toEqual(['alice', 'bob@x.com']);
    expect(isEnvInstallAdminAccount('BOB@x.com')).toBe(true);
  });

  it('honors DB installAdmin flag', async () => {
    delete process.env.INSTALL_ADMIN_ACCOUNTS;
    delete process.env.INSTALL_ADMIN_EMAILS;
    const prisma = fakePrisma([
      {
        id: '1',
        account: 'first',
        installAdmin: false,
        createdAt: new Date('2026-01-01'),
      },
      {
        id: '2',
        account: 'second',
        installAdmin: true,
        createdAt: new Date('2026-02-01'),
      },
    ]);
    expect(await isInstallAdmin(prisma as never, '2')).toBe(true);
    expect(await isInstallAdmin(prisma as never, '1')).toBe(false);
  });

  it('honors env list even without DB flag', async () => {
    process.env.INSTALL_ADMIN_ACCOUNTS = 'ops';
    const prisma = fakePrisma([
      {
        id: '1',
        account: 'ops',
        installAdmin: false,
        createdAt: new Date('2026-01-01'),
      },
      {
        id: '2',
        account: 'other',
        installAdmin: false,
        createdAt: new Date('2026-02-01'),
      },
    ]);
    expect(await isInstallAdmin(prisma as never, '1')).toBe(true);
    expect(await isInstallAdmin(prisma as never, '2')).toBe(false);
  });

  it('falls back to first user when no DB admin and no env', async () => {
    delete process.env.INSTALL_ADMIN_ACCOUNTS;
    delete process.env.INSTALL_ADMIN_EMAILS;
    const prisma = fakePrisma([
      {
        id: '1',
        account: 'first',
        installAdmin: false,
        createdAt: new Date('2026-01-01'),
      },
      {
        id: '2',
        account: 'second',
        installAdmin: false,
        createdAt: new Date('2026-02-01'),
      },
    ]);
    expect(await isInstallAdmin(prisma as never, '1')).toBe(true);
    expect(await isInstallAdmin(prisma as never, '2')).toBe(false);
  });
});
