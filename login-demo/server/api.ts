import type { IncomingMessage, ServerResponse } from 'node:http'
import QRCode from 'qrcode'
import { renderPhonePage } from './phone-page'
import {
  consumeCode,
  createMockUser,
  issueAccessToken,
  issueAuthorizationCode,
  lookupToken,
  lookupUser,
} from './mock-wechat'
import { code2Session, createMiniCode, type MiniConfig } from './wechat-mini'
import {
  APPSECRET,
  APPID,
  GH_STATE_COOKIE,
  MINI_TICKET_TTL_MS,
  SESSION_COOKIE,
  SESSION_TTL_S,
  TICKET_TTL_MS,
  clearCookie,
  clientIp,
  codes,
  createSessionToken,
  currentSession,
  expireTickets,
  json,
  newId,
  originOf,
  parseSessionToken,
  publicSession,
  rateLimit,
  readCookie,
  readJson,
  setCookie,
  tickets,
  type Env,
  type SessionPayload,
  type Ticket,
} from './state'

const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize'
const GITHUB_TOKEN = 'https://github.com/login/oauth/access_token'
const GITHUB_USER = 'https://api.github.com/user'

interface GithubConfig {
  enabled: boolean
  clientId: string
  clientSecret: string
  callbackUrl: string
}

interface MiniState extends MiniConfig {
  enabled: boolean
}

type Next = () => void

export function createAuthApi(env: Env) {
  const github: GithubConfig = {
    enabled: Boolean((env.GITHUB_CLIENT_ID ?? '').trim() && (env.GITHUB_CLIENT_SECRET ?? '').trim()),
    clientId: (env.GITHUB_CLIENT_ID ?? '').trim(),
    clientSecret: (env.GITHUB_CLIENT_SECRET ?? '').trim(),
    callbackUrl: (env.GITHUB_CALLBACK_URL ?? '').trim(),
  }

  const mini: MiniState = {
    enabled: Boolean((env.WX_MINI_APPID ?? '').trim() && (env.WX_MINI_APPSECRET ?? '').trim()),
    appid: (env.WX_MINI_APPID ?? '').trim(),
    secret: (env.WX_MINI_APPSECRET ?? '').trim(),
    envVersion: ((env.WX_MINI_ENV ?? 'develop').trim() as MiniConfig['envVersion']) || 'develop',
    page: (env.WX_MINI_PAGE ?? 'pages/login/login').trim() || 'pages/login/login',
  }

  return async function authMiddleware(req: IncomingMessage, res: ServerResponse, next: Next) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    const method = (req.method ?? 'GET').toUpperCase()

    const handled =
      path === '/phone' ||
      path.startsWith('/api/') ||
      path.startsWith('/mock/')

    if (!handled) return next()

    try {
      await route(req, res, method, path, url, github, mini)
    } catch (error) {
      console.error('[login-demo] failed to handle', path, error)
      if (!res.headersSent) json(res, 500, { error: '服务器内部错误', detail: String(error) })
      else res.end()
    }
  }
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  url: URL,
  github: GithubConfig,
  mini: MiniState,
): Promise<void> {
  // ---------------------------------------------------------- 扫码登录：创建票据
  if (method === 'POST' && path === '/api/login/qr') {
    if (!rateLimit(`${clientIp(req)}:qr-create`, 60, 60_000)) {
      return json(res, 429, { error: '请求太频繁，稍后再试' })
    }
    expireTickets()

    const ticket: Ticket = {
      id: newId('qr_'),
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + TICKET_TTL_MS,
    }
    tickets.set(ticket.id, ticket)

    const origin = originOf(req)
    const redirectUri = `${origin}/api/login/wechat/callback`
    // 与真实微信一致：二维码内容就是带 appid / redirect_uri / scope / state 的授权地址
    const authorizeUrl =
      `${origin}/mock/wechat/connect/qrconnect` +
      `?appid=${encodeURIComponent(APPID)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code&scope=snsapi_login&state=${ticket.id}`

    const qrSvg = await QRCode.toString(authorizeUrl, {
      type: 'svg',
      margin: 1,
      width: 240,
      errorCorrectionLevel: 'M',
      color: { dark: '#111827', light: '#ffffff' },
    })

    return json(res, 200, {
      id: ticket.id,
      qrSvg,
      authorizeUrl,
      expiresAt: ticket.expiresAt,
      expiresIn: TICKET_TTL_MS,
    })
  }

  // ---------------------------------------------------------- 扫码登录：轮询状态
  const pollMatch = /^\/api\/login\/qr\/([\w-]+)$/.exec(path)
  if (method === 'GET' && pollMatch) {
    expireTickets()
    const ticket = tickets.get(pollMatch[1])
    if (!ticket) return json(res, 404, { error: '二维码不存在（服务重启会清空票据）' })

    const body: Record<string, unknown> = {
      status: ticket.status,
      expiresAt: ticket.expiresAt,
      scannedAt: ticket.scannedAt,
      confirmedAt: ticket.confirmedAt,
    }
    // 已确认时下发一次性 code；真正的一次性由 /api/login/exchange 保证
    if (ticket.status === 'confirmed' && ticket.code) {
      const available = codeAvailable(ticket.code)
      if (available) body.code = ticket.code
    }
    return json(res, 200, body)
  }

  // ---------------------------------------------------------- 扫码登录：模拟扫码
  const scanMatch = /^\/api\/login\/qr\/([\w-]+)\/scan$/.exec(path)
  if (method === 'POST' && scanMatch) {
    const ticket = tickets.get(scanMatch[1])
    if (!ticket) return json(res, 404, { error: '二维码不存在' })
    if (Date.now() > ticket.expiresAt && ticket.status === 'pending') ticket.status = 'expired'
    if (ticket.status === 'expired') return json(res, 410, { error: '二维码已过期，请刷新' })
    if (ticket.status === 'cancelled') return json(res, 409, { error: '本次登录已取消' })
    if (ticket.status === 'pending') {
      ticket.status = 'scanned'
      ticket.scannedAt = Date.now()
    }
    return json(res, 200, { status: ticket.status, expiresAt: ticket.expiresAt })
  }

  // ---------------------------------------------------------- 扫码登录：模拟确认
  const confirmMatch = /^\/api\/login\/qr\/([\w-]+)\/confirm$/.exec(path)
  if (method === 'POST' && confirmMatch) {
    const ticket = tickets.get(confirmMatch[1])
    if (!ticket) return json(res, 404, { error: '二维码不存在' })
    if (Date.now() > ticket.expiresAt && ticket.status === 'pending') ticket.status = 'expired'
    if (ticket.status === 'expired') return json(res, 410, { error: '二维码已过期，请刷新' })
    if (ticket.status === 'cancelled') return json(res, 409, { error: '本次登录已取消' })
    if (ticket.status === 'confirmed') {
      return json(res, 200, { status: 'confirmed', confirmedAt: ticket.confirmedAt })
    }
    const user = createMockUser()
    ticket.openid = user.openid
    ticket.code = issueAuthorizationCode(user.openid, user.unionid)
    ticket.status = 'confirmed'
    ticket.confirmedAt = Date.now()
    return json(res, 200, { status: 'confirmed', confirmedAt: ticket.confirmedAt })
  }

  // ---------------------------------------------------------- 扫码登录：取消
  const cancelMatch = /^\/api\/login\/qr\/([\w-]+)\/cancel$/.exec(path)
  if (method === 'POST' && cancelMatch) {
    const ticket = tickets.get(cancelMatch[1])
    if (!ticket) return json(res, 404, { error: '二维码不存在' })
    if (ticket.status === 'pending' || ticket.status === 'scanned') {
      ticket.status = 'cancelled'
    }
    return json(res, 200, { status: ticket.status })
  }

  // ------------------------------------------------ 真·微信：生成小程序码票据
  if (method === 'POST' && path === '/api/login/mini/ticket') {
    if (!mini.enabled) {
      return json(res, 503, {
        error: '未配置小程序：在 login-demo/.env 填 WX_MINI_APPID / WX_MINI_APPSECRET 后重启 dev server',
        needConfig: true,
      })
    }
    if (!rateLimit(`${clientIp(req)}:mini-ticket`, 30, 60_000)) {
      return json(res, 429, { error: '请求太频繁，稍后再试' })
    }
    expireTickets()

    const ticket: Ticket = {
      id: newId('mq_'),
      status: 'pending',
      channel: 'mini',
      createdAt: Date.now(),
      expiresAt: Date.now() + MINI_TICKET_TTL_MS,
    }
    tickets.set(ticket.id, ticket)

    try {
      const image = await createMiniCode(mini, ticket.id)
      return json(res, 200, {
        id: ticket.id,
        image,
        expiresAt: ticket.expiresAt,
        expiresIn: MINI_TICKET_TTL_MS,
        envVersion: mini.envVersion,
        page: mini.page,
      })
    } catch (error) {
      tickets.delete(ticket.id)
      return json(res, 502, {
        error: '生成小程序码失败，检查 AppID/AppSecret 是否正确、接口权限是否可用',
        detail: String((error as Error).message),
      })
    }
  }

  // ------------------------------------------------ 真·微信：轮询小程序码票据
  const miniPollMatch = /^\/api\/login\/mini\/ticket\/([\w-]+)$/.exec(path)
  if (method === 'GET' && miniPollMatch) {
    expireTickets()
    const ticket = tickets.get(miniPollMatch[1])
    if (!ticket) return json(res, 404, { error: '二维码不存在（服务重启会清空票据）' })

    const body: Record<string, unknown> = {
      status: ticket.status,
      expiresAt: ticket.expiresAt,
      confirmedAt: ticket.confirmedAt,
    }
    if (ticket.status === 'confirmed' && ticket.code && codeAvailable(ticket.code)) {
      body.code = ticket.code
    }
    return json(res, 200, body)
  }

  // ------------------------------------------------ 真·微信：小程序侧回填 openid
  if (method === 'POST' && path === '/api/login/mini/confirm') {
    if (!mini.enabled) return json(res, 503, { error: '未配置小程序' })

    const body = await readJson<{ scene?: string; jsCode?: string }>(req)
    const scene = (body.scene ?? '').trim()
    const jsCode = (body.jsCode ?? '').trim()
    if (!scene || !jsCode) return json(res, 400, { error: '缺少 scene 或 jsCode' })

    const ticket = tickets.get(scene)
    if (!ticket) return json(res, 404, { error: '二维码不存在或已失效，请回到电脑端刷新' })
    if (Date.now() > ticket.expiresAt && ticket.status === 'pending') ticket.status = 'expired'
    if (ticket.status === 'expired') return json(res, 410, { error: '二维码已过期，请回到电脑端刷新' })
    if (ticket.status === 'confirmed') {
      return json(res, 200, { ok: true, openid: ticket.openid })
    }

    try {
      const session = await code2Session(mini, jsCode)
      ticket.openid = session.openid
      ticket.status = 'confirmed'
      ticket.confirmedAt = Date.now()
      ticket.code = issueAuthorizationCode(session.openid, session.unionid ?? '')
      return json(res, 200, {
        ok: true,
        openid: session.openid,
        unionid: session.unionid ?? null,
      })
    } catch (error) {
      return json(res, 502, {
        error: '微信登录失败',
        detail: String((error as Error).message),
      })
    }
  }

  // ------------------------------------------------ 真·微信：PC 端兑换会话
  if (method === 'POST' && path === '/api/login/mini/exchange') {
    const body = await readJson<{ code?: string }>(req)
    const code = (body.code ?? '').trim()
    if (!code) return json(res, 400, { error: '缺少 code' })

    const result = consumeCode(code)
    if (!result.ok) {
      return json(res, 400, { error: 'code 无效、已被使用或已过期', wechat: result })
    }

    const token = createSessionToken({
      uid: result.openid,
      provider: 'wechat-mini',
      openid: result.openid,
      unionid: result.unionid || undefined,
      nickname: '微信用户',
    })
    const payload = parseSessionToken(token)
    if (!payload) return json(res, 500, { error: '会话签发失败' })
    setCookie(res, SESSION_COOKIE, token, SESSION_TTL_S)
    return json(res, 200, { user: publicSession(payload) })
  }

  // ---------------------------------------------------------- code 换会话（服务端）
  if (method === 'POST' && path === '/api/login/exchange') {
    if (!rateLimit(`${clientIp(req)}:exchange`, 60, 60_000)) {
      return json(res, 429, { error: '请求太频繁，稍后再试' })
    }
    const body = await readJson<{ code?: string }>(req)
    const code = (body.code ?? '').trim()
    if (!code) return json(res, 400, { error: '缺少 code' })

    const result = await exchangeWechatCode(code, originOf(req))
    if (!result.ok) return json(res, 400, { error: result.error, wechat: result.detail })

    const token = createSessionToken(result.session)
    const payload = parseSessionToken(token)
    if (!payload) return json(res, 500, { error: '会话签发失败' })
    setCookie(res, SESSION_COOKIE, token, SESSION_TTL_S)
    return json(res, 200, { user: publicSession(payload) })
  }

  // ---------------------------------------------------------- 扫码登录：授权回调
  if (method === 'GET' && path === '/api/login/wechat/callback') {
    const code = url.searchParams.get('code') ?? ''
    const state = url.searchParams.get('state') ?? ''
    const ticket = state ? tickets.get(state) : undefined
    if (!code) return redirect(res, '/?login=wechat-error&reason=missing_code')
    if (!ticket) return redirect(res, '/?login=wechat-error&reason=unknown_ticket')

    const result = await exchangeWechatCode(code, originOf(req))
    if (!result.ok) return redirect(res, '/?login=wechat-error&reason=exchange_failed')

    const token = createSessionToken(result.session)
    setCookie(res, SESSION_COOKIE, token, SESSION_TTL_S)
    return redirect(res, '/?login=wechat-ok')
  }

  // ---------------------------------------------------------- 当前会话 / 退出
  if (method === 'GET' && path === '/api/me') {
    const session = currentSession(req)
    return json(res, 200, { user: session ? publicSession(session) : null })
  }

  if (method === 'POST' && path === '/api/logout') {
    clearCookie(res, SESSION_COOKIE)
    return json(res, 200, { ok: true })
  }

  // ---------------------------------------------------------- 前端配置
  if (method === 'GET' && path === '/api/config') {
    return json(res, 200, {
      appid: APPID,
      githubEnabled: github.enabled,
      miniEnabled: mini.enabled,
      miniEnv: mini.envVersion,
      miniPage: mini.page,
      mockQrconnect: `${originOf(req)}/mock/wechat/connect/qrconnect`,
      realQrconnect: 'https://open.weixin.qq.com/connect/qrconnect',
    })
  }

  // ---------------------------------------------------------- GitHub OAuth：发起
  if (method === 'GET' && path === '/api/auth/github') {
    if (!github.enabled) {
      return json(res, 503, {
        error: 'GitHub 登录未配置：在 login-demo/.env 里填 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET 后重启 dev server',
      })
    }
    const state = newId('gh_', 12)
    setCookie(res, GH_STATE_COOKIE, state, 600)
    const redirectUri = github.callbackUrl || `${originOf(req)}/api/auth/github/callback`
    const authorize =
      `${GITHUB_AUTHORIZE}?client_id=${encodeURIComponent(github.clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=read:user&state=${state}`
    return redirect(res, authorize)
  }

  // ---------------------------------------------------------- GitHub OAuth：回调
  if (method === 'GET' && path === '/api/auth/github/callback') {
    const code = url.searchParams.get('code') ?? ''
    const state = url.searchParams.get('state') ?? ''
    const expectedState = readCookie(req, GH_STATE_COOKIE)
    clearCookie(res, GH_STATE_COOKIE)

    if (!github.enabled) return redirect(res, '/?login=github-error&reason=not_configured')
    if (!code) return redirect(res, '/?login=github-error&reason=cancelled')
    if (!state || !expectedState || state !== expectedState) {
      return redirect(res, '/?login=github-error&reason=state_mismatch')
    }

    try {
      const tokenResponse = await fetch(GITHUB_TOKEN, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          client_id: github.clientId,
          client_secret: github.clientSecret,
          code,
          redirect_uri: github.callbackUrl || `${originOf(req)}/api/auth/github/callback`,
        }),
      })
      const tokenData = (await tokenResponse.json()) as { access_token?: string; error?: string }
      if (!tokenData.access_token) return redirect(res, '/?login=github-error&reason=token_exchange')

      const userResponse = await fetch(GITHUB_USER, {
        headers: {
          authorization: `Bearer ${tokenData.access_token}`,
          accept: 'application/vnd.github+json',
          'user-agent': 'smart-table-login-demo',
        },
      })
      const profile = (await userResponse.json()) as {
        id?: number
        login?: string
        name?: string
        avatar_url?: string
        html_url?: string
      }
      if (!profile.id || !profile.login) return redirect(res, '/?login=github-error&reason=profile')

      const token = createSessionToken({
        uid: `gh:${profile.id}`,
        provider: 'github',
        openid: String(profile.id),
        nickname: profile.name || profile.login,
        avatar: profile.avatar_url,
      })
      setCookie(res, SESSION_COOKIE, token, SESSION_TTL_S)
      return redirect(res, '/?login=github-ok')
    } catch (error) {
      console.error('[login-demo] github oauth failed', error)
      return redirect(res, '/?login=github-error&reason=network')
    }
  }

  // ---------------------------------------------------------- mock：扫码打开的确认页
  if (method === 'GET' && (path === '/mock/wechat/connect/qrconnect' || path === '/phone')) {
    expireTickets()
    const state = url.searchParams.get('state') ?? url.searchParams.get('t') ?? ''
    const ticket = tickets.get(state)
    res.statusCode = 200
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(renderPhonePage({ ticketId: state, appName: 'smart-table', expiresAt: ticket?.expiresAt ?? 0 }))
    return
  }

  // ---------------------------------------------------------- mock：code 换 token
  if (method === 'GET' && path === '/mock/wechat/sns/oauth2/access_token') {
    const appid = url.searchParams.get('appid') ?? ''
    const secret = url.searchParams.get('secret') ?? ''
    const code = url.searchParams.get('code') ?? ''
    const grantType = url.searchParams.get('grant_type') ?? ''

    if (appid !== APPID || secret !== APPSECRET) {
      return json(res, 200, { errcode: 40125, errmsg: 'invalid appsecret' })
    }
    if (grantType !== 'authorization_code') {
      return json(res, 200, { errcode: 40002, errmsg: 'invalid grant_type' })
    }
    const result = consumeCode(code)
    if (!result.ok) {
      return json(res, 200, { errcode: result.errcode, errmsg: result.errmsg })
    }
    return json(res, 200, {
      access_token: issueAccessToken(result.openid, result.unionid),
      expires_in: 7200,
      refresh_token: newId('rt_', 16),
      openid: result.openid,
      scope: 'snsapi_login',
      unionid: result.unionid,
    })
  }

  // ---------------------------------------------------------- mock：拉取用户资料
  if (method === 'GET' && path === '/mock/wechat/sns/userinfo') {
    const accessToken = url.searchParams.get('access_token') ?? ''
    const openid = url.searchParams.get('openid') ?? ''
    const tokenRecord = lookupToken(accessToken)
    if (!tokenRecord || tokenRecord.openid !== openid) {
      return json(res, 200, { errcode: 40001, errmsg: 'invalid credential' })
    }
    const user = lookupUser(openid)
    if (!user) return json(res, 200, { errcode: 40003, errmsg: 'invalid openid' })
    return json(res, 200, {
      openid: user.openid,
      nickname: user.nickname,
      sex: 1,
      province: '浙江',
      city: user.city,
      country: '中国',
      headimgurl: user.avatar,
      unionid: user.unionid,
    })
  }

  return json(res, 404, { error: `未实现的接口：${method} ${path}` })
}

// ------------------------------------------------------------------- internals

/** 轮询时只“预览” code 是否可用，不消耗它；真正消费在 exchange */
function codeAvailable(code: string): boolean {
  const record = codes.get(code)
  return Boolean(record && !record.used && record.expiresAt > Date.now())
}

async function exchangeWechatCode(
  code: string,
  origin: string,
): Promise<
  | { ok: true; session: Omit<SessionPayload, 'iat' | 'exp'> }
  | { ok: false; error: string; detail?: unknown }
> {
  const tokenUrl =
    `${origin}/mock/wechat/sns/oauth2/access_token` +
    `?appid=${encodeURIComponent(APPID)}` +
    `&secret=${encodeURIComponent(APPSECRET)}` +
    `&code=${encodeURIComponent(code)}` +
    `&grant_type=authorization_code`

  const tokenResponse = await fetch(tokenUrl)
  const tokenData = (await tokenResponse.json()) as {
    access_token?: string
    openid?: string
    unionid?: string
    errcode?: number
    errmsg?: string
  }

  if (!tokenData.access_token || !tokenData.openid) {
    return { ok: false, error: 'code 无效、已被使用或已过期', detail: tokenData }
  }

  const profileUrl =
    `${origin}/mock/wechat/sns/userinfo` +
    `?access_token=${encodeURIComponent(tokenData.access_token)}` +
    `&openid=${encodeURIComponent(tokenData.openid)}`
  const profileResponse = await fetch(profileUrl)
  const profile = (await profileResponse.json()) as {
    nickname?: string
    headimgurl?: string
    unionid?: string
    errcode?: number
  }

  return {
    ok: true,
    session: {
      uid: tokenData.openid,
      provider: 'wechat-mock',
      openid: tokenData.openid,
      unionid: tokenData.unionid,
      nickname: profile.nickname ?? '微信用户',
      avatar: profile.headimgurl,
    },
  }
}

function redirect(res: ServerResponse, location: string): void {
  res.statusCode = 302
  res.setHeader('location', location)
  res.end()
}
