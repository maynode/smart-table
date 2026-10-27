/**
 * Fail closed in production / STRICT_ENV: weak or placeholder JWT secrets
 * must not boot.
 */
export function assertJwtSecretOrExit(
  secret: string | undefined,
  env: {
    nodeEnv?: string;
    strictEnv?: string;
  } = {},
): string {
  const value = (secret ?? '').trim();
  const strict =
    env.nodeEnv === 'production' ||
    env.strictEnv === '1' ||
    env.strictEnv === 'true';
  if (!strict) {
    return value || 'dev-only-change-me';
  }
  const weak =
    !value ||
    value.length < 32 ||
    value.includes('dev-only') ||
    value === 'change-me' ||
    value === 'secret';
  if (weak) {
    // eslint-disable-next-line no-console
    console.error(
      '[fatal] JWT_SECRET must be set to a random string of length >= 32 (and must not contain "dev-only") when NODE_ENV=production or STRICT_ENV=1',
    );
    process.exit(1);
  }
  return value;
}
