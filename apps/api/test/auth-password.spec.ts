import { hashPassword, verifyPassword } from '../src/auth/password';

describe('password hashing', () => {
  it('uses argon2id and verifies correctly', async () => {
    const hash = await hashPassword('Passw0rd!123');

    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(verifyPassword(hash, 'Passw0rd!123')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'not-the-password')).resolves.toBe(
      false,
    );
  });
});
