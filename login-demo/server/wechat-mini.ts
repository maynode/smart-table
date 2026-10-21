/**
 * 真实微信小程序接口的薄封装。
 * 文档：
 *   access_token  https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/mp-access-token/getAccessToken.html
 *   小程序码      https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/qrcode-link/qr-code/getUnlimitedQRCode.html
 *   code2Session  https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html
 */

export interface MiniConfig {
  appid: string
  secret: string
  envVersion: 'develop' | 'trial' | 'release'
  page: string
}

interface TokenCache {
  token: string
  expiresAt: number
}

const WECHAT_API = 'https://api.weixin.qq.com'
let tokenCache: TokenCache | null = null

async function readJsonBody(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

export async function getAccessToken(config: MiniConfig): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token

  const response = await fetch(
    `${WECHAT_API}/cgi-bin/token?grant_type=client_credential` +
      `&appid=${encodeURIComponent(config.appid)}&secret=${encodeURIComponent(config.secret)}`,
  )
  const data = await readJsonBody(response)
  const token = data.access_token as string | undefined
  if (!token) {
    throw new Error(`获取 access_token 失败：${String(data.errcode)} ${String(data.errmsg)}`)
  }
  tokenCache = { token, expiresAt: Date.now() + Number(data.expires_in ?? 7200) * 1000 }
  return token
}

/**
 * 生成小程序码（unlimited 接口，scene 里放票据 id）。
 * 成功时微信返回图片二进制，失败时返回 JSON。
 */
export async function createMiniCode(config: MiniConfig, scene: string): Promise<string> {
  const token = await getAccessToken(config)
  const response = await fetch(`${WECHAT_API}/wxa/getwxacodeunlimit?access_token=${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      scene,
      page: config.page,
      check_path: false,
      env_version: config.envVersion,
      width: 280,
    }),
  })

  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('image')) {
    const buffer = Buffer.from(await response.arrayBuffer())
    return `data:${contentType.split(';')[0]};base64,${buffer.toString('base64')}`
  }

  const text = await response.text()
  throw new Error(`生成小程序码失败：${text.slice(0, 300)}`)
}

export interface MiniSession {
  openid: string
  unionid?: string
  sessionKey: string
}

/** 小程序里 wx.login 拿到的 code → openid。session_key 不要返回给前端或落库。 */
export async function code2Session(config: MiniConfig, jsCode: string): Promise<MiniSession> {
  const response = await fetch(
    `${WECHAT_API}/sns/jscode2session?appid=${encodeURIComponent(config.appid)}` +
      `&secret=${encodeURIComponent(config.secret)}` +
      `&js_code=${encodeURIComponent(jsCode)}&grant_type=authorization_code`,
  )
  const data = await readJsonBody(response)
  if (data.errcode) {
    throw new Error(`code2Session 失败：${String(data.errcode)} ${String(data.errmsg)}`)
  }
  const openid = data.openid as string | undefined
  if (!openid) throw new Error('code2Session 未返回 openid')
  return {
    openid,
    unionid: data.unionid as string | undefined,
    sessionKey: String(data.session_key ?? ''),
  }
}
