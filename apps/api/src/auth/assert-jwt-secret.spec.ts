import { assertJwtSecretOrExit } from './assert-jwt-secret';

describe('assertJwtSecretOrExit', () => {
  const exitSpy = jest
    .spyOn(process, 'exit')
    .mockImplementation((() => undefined) as never);

  afterEach(() => {
    exitSpy.mockClear();
  });

  afterAll(() => {
    exitSpy.mockRestore();
  });

  it('allows weak secret outside production', () => {
    expect(
      assertJwtSecretOrExit('dev-only-change-me', { nodeEnv: 'development' }),
    ).toBe('dev-only-change-me');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits on weak secret in production', () => {
    assertJwtSecretOrExit('dev-only-change-me-in-production', {
      nodeEnv: 'production',
    });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('accepts strong secret in production', () => {
    const secret = 'a'.repeat(32) + '-prod-ready-secret';
    expect(
      assertJwtSecretOrExit(secret, { nodeEnv: 'production' }),
    ).toBe(secret);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
