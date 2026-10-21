import { createHash, randomBytes } from 'node:crypto'
import {
  CODE_TTL_MS,
  codes,
  tokens,
  users,
  type MockUser,
} from './state'

const NICKNAMES = ['林小满', '周一舟', '陈拾光', '苏见月', '许清和', '沈知微']
const CITIES = ['杭州', '上海', '成都', '深圳', '南京']

function avatarDataUri(seed: string): string {
  const digest = createHash('sha1').update(seed).digest()
  const hue = digest[0] % 360
  const initial = NICKNAMES[digest[1] % NICKNAMES.length].slice(0, 1)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue},72%,62%)"/>` +
    `<stop offset="1" stop-color="hsl(${(hue + 46) % 360},72%,46%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="96" height="96" rx="24" fill="url(#g)"/>` +
    `<text x="48" y="61" font-size="40" text-anchor="middle" fill="#fff" font-family="system-ui,sans-serif">${initial}</text>` +
    `</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

/** 模拟一次“微信用户扫码后授权”：生成一个稳定的 openid / unionid 身份 */
export function createMockUser(): MockUser {
  const openid = `o${randomBytes(10).toString('hex')}`
  const unionid = `u${randomBytes(12).toString('hex')}`
  const nickname = `${NICKNAMES[Math.floor(Math.random() * NICKNAMES.length)]}_${randomBytes(1).toString('hex')}`
  const user: MockUser = {
    openid,
    unionid,
    nickname,
    avatar: avatarDataUri(openid),
    city: CITIES[Math.floor(Math.random() * CITIES.length)],
  }
  users.set(openid, user)
  return user
}

/** 用户确认授权后，微信侧签发一次性 code */
export function issueAuthorizationCode(openid: string, unionid: string): string {
  const code = `code_${randomBytes(12).toString('hex')}`
  codes.set(code, {
    code,
    openid,
    unionid,
    expiresAt: Date.now() + CODE_TTL_MS,
    used: false,
  })
  return code
}

export type ConsumeResult =
  | { ok: true; openid: string; unionid: string }
  | { ok: false; errcode: number; errmsg: string }

/** 对应真实接口：code 换 access_token 时的校验（一次性、5 分钟） */
export function consumeCode(code: string): ConsumeResult {
  const record = codes.get(code)
  if (!record) return { ok: false, errcode: 40029, errmsg: 'invalid code' }
  if (record.used) return { ok: false, errcode: 40163, errmsg: 'code been used' }
  if (Date.now() > record.expiresAt) return { ok: false, errcode: 40030, errmsg: 'code expired' }
  record.used = true
  return { ok: true, openid: record.openid, unionid: record.unionid }
}

/** 对应真实接口：authorization_code 模式返回的 access_token（这里有效期同样 2 小时） */
export function issueAccessToken(openid: string, unionid: string): string {
  const accessToken = `at_${randomBytes(16).toString('hex')}`
  tokens.set(accessToken, { accessToken, openid, unionid, expiresAt: Date.now() + 7200_000 })
  return accessToken
}

export function lookupToken(accessToken: string) {
  const record = tokens.get(accessToken)
  if (!record) return null
  if (record.expiresAt < Date.now()) {
    tokens.delete(accessToken)
    return null
  }
  return record
}

export function lookupUser(openid: string): MockUser | undefined {
  return users.get(openid)
}
