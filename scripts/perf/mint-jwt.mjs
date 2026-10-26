import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const text = readFileSync('.env', 'utf8');
const env = Object.fromEntries(
  [...text.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)].map((m) => [
    m[1],
    m[2].replace(/^"|"$/g, ''),
  ]),
);

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const body = b64url(
  JSON.stringify({
    sub: '2dd34d08-5391-4ac8-8d56-03b76d1e21fc',
    account: 'zrg_dev@163.com',
  }),
);
const data = `${header}.${body}`;
const sig = createHmac('sha256', env.JWT_SECRET)
  .update(data)
  .digest('base64url');
const token = `${data}.${sig}`;
writeFileSync('artifacts/perf/dev-jwt.txt', token);
console.log('wrote artifacts/perf/dev-jwt.txt', token.length);
