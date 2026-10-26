/**
 * Probe listRecords total+offset for the 10M demo sheet (JWT from .env).
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

function loadEnv() {
  const text = readFileSync('.env', 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return out;
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

const env = loadEnv();
const base = process.env.API_BASE ?? 'http://127.0.0.1:3000';
const sheetId = 'c7832a8a-0f0d-45e9-92a1-2cae46563dd2';
const userId = '2dd34d08-5391-4ac8-8d56-03b76d1e21fc';
const token = signJwt(
  { sub: userId, account: 'zrg_dev@163.com', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 },
  env.JWT_SECRET,
);

async function get(path) {
  const res = await fetch(`${base}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body)}`);
  return body;
}

const page0 = await get(`/sheets/${sheetId}/records?limit=500&offset=0`);
const pageDeep = await get(`/sheets/${sheetId}/records?limit=50&offset=999000`);
console.log({
  home: {
    count: page0.records?.length,
    total: page0.total,
    offset: page0.offset,
    nextCursor: Boolean(page0.nextCursor),
  },
  deep: {
    count: pageDeep.records?.length,
    total: pageDeep.total,
    offset: pageDeep.offset,
    sample: pageDeep.records?.[0]?.cells,
  },
});
