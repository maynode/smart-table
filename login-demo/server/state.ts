import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export type Env = Record<string, string | undefined>

/** 模拟的开放平台应用凭据（真实环境里来自开放平台后台） */
export const APPID = 'wx_demo_appid_0001'
export const APPSECRET = 'demo_secret_please_change'

export const TICKET_TTL_MS = 120_000
/** 真微信小程序码留更长时间，方便开发者工具调试 / 手机慢慢扫 */
export const MINI_TICKET_TTL_MS = 5 * 60_000
export const CODE_TTL_MS = 5 * 60_000
export const SESSION_TTL_S = 60 * 60 * 24

export const SESSION_COOKIE = 'st_demo_sid'
export const GH_STATE_COOKIE = 'st_demo_gh_state'

export type TicketStatus = 'pending' | 'scanned' | 'confirmed' | 'cancelled' | 'expired'

export interface MockUser {
  openid: string
  unionid: string
  nickname: string
  avatar: string
  city: string
}

export interface Ticket {
  id: string
  status: TicketStatus
  channel?: 'mock' | 'mini'
  createdAt: number
  expiresAt: number
  scannedAt?: number
  confirmedAt?: number
  code?: string
  openid?: string
}

export interface CodeRecord {
  code: string
  openid: string
  unionid: string
  expiresAt: number
  used: boolean
}

export interface TokenRecord {
  accessToken: string
  openid: string
  unionid: string
  expiresAt: number
}

export interface SessionPayload {
  uid: string
  provider: 'wechat-mock' | 'wechat-mini' | 'github'
  openid: string
  unionid?: string
  nickname: string
  avatar?: string
  iat: number
  exp: number
}

/** 进程内存储：重启即清空，这正是 demo 想展示的“票据是短期状态” */
export const tickets = new Map<string, Ticket>()
export const codes = new Map<string, CodeRecord>()
export const tokens = new Map<string, TokenRecord>()
export const users = new Map<string, MockUser>()

/** 每次启动随机生成：重启后旧 cookie 自动失效，适合练手 */
export const SESSION_SECRET = randomBytes(32).toString('hex')

// ---------------------------------------------------------------- http helpers

export function json(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

export async function readJson<T = Record<string, unknown>>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 8 * 1024) throw new Error('request body too large')
    chunks.push(chunk as Buffer)
  }
  if (!chunks.length) return {} as T
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
}

export function readCookie(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers.cookie
  if (!raw) return undefined
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}

export function setCookie(res: ServerResponse, name: string, value: string, maxAgeSeconds: number): void {
  const prev = res.getHeader('set-cookie')
  const list = Array.isArray(prev) ? prev.map(String) : prev ? [String(prev)] : []
  list.push(`${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`)
  res.setHeader('set-cookie', list)
}

export function clearCookie(res: ServerResponse, name: string): void {
  const prev = res.getHeader('set-cookie')
  const list = Array.isArray(prev) ? prev.map(String) : prev ? [String(prev)] : []
  list.push(`${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
  res.setHeader('set-cookie', list)
}

// ------------------------------------------------------------------- sessions

export function createSessionToken(payload: Omit<SessionPayload, 'iat' | 'exp'>): string {
  const full: SessionPayload = { ...payload, iat: Date.now(), exp: Date.now() + SESSION_TTL_S * 1000 }
  const body = Buffer.from(JSON.stringify(full)).toString('base64url')
  const sig = createHmac('sha256', SESSION_SECRET).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function parseSessionToken(token?: string): SessionPayload | null {
  if (!token) return null
  const idx = token.lastIndexOf('.')
  if (idx <= 0) return null
  const body = token.slice(0, idx)
  const sig = token.slice(idx + 1)
  const expected = createHmac('sha256', SESSION_SECRET).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload
    if (!payload.exp || payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

export function currentSession(req: IncomingMessage): SessionPayload | null {
  return parseSessionToken(readCookie(req, SESSION_COOKIE))
}

export function publicSession(payload: SessionPayload) {
  return {
    uid: payload.uid,
    provider: payload.provider,
    openid: payload.openid,
    unionid: payload.unionid,
    nickname: payload.nickname,
    avatar: payload.avatar,
    expiresAt: payload.exp,
    issuedAt: payload.iat,
  }
}

// ---------------------------------------------------------------- misc helpers

export function originOf(req: IncomingMessage): string {
  const proto = String(req.headers['x-forwarded-proto'] ?? 'http')
  const host = req.headers.host ?? '127.0.0.1:5180'
  return `${proto}://${host}`
}

export function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown'
}

const buckets = new Map<string, number[]>()

/** 极简限流：同一个 key 在窗口期内最多 limit 次 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs)
  if (hits.length >= limit) {
    buckets.set(key, hits)
    return false
  }
  hits.push(now)
  buckets.set(key, hits)
  return true
}

export function newId(prefix: string, bytes = 9): string {
  return `${prefix}${randomBytes(bytes).toString('hex')}`
}

export function expireTickets(): void {
  const now = Date.now()
  for (const ticket of tickets.values()) {
    if ((ticket.status === 'pending' || ticket.status === 'scanned') && now > ticket.expiresAt) {
      ticket.status = 'expired'
    }
  }
  for (const [code, record] of codes) {
    if (record.expiresAt < now - 10 * 60_000) codes.delete(code)
  }
  for (const [token, record] of tokens) {
    if (record.expiresAt < now) tokens.delete(token)
  }
}

const sweeper = setInterval(expireTickets, 30_000)
sweeper.unref()
