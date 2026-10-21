export interface SessionUser {
  uid: string
  provider: 'wechat-mock' | 'github'
  openid: string
  unionid?: string
  nickname: string
  avatar?: string
  expiresAt: number
  issuedAt: number
}

export interface CreatedQr {
  id: string
  qrSvg: string
  authorizeUrl: string
  expiresAt: number
  expiresIn: number
}

export type QrStatus = 'pending' | 'scanned' | 'confirmed' | 'cancelled' | 'expired'

export interface QrPoll {
  status: QrStatus
  expiresAt: number
  scannedAt?: number
  confirmedAt?: number
  code?: string
}

export interface AppConfig {
  appid: string
  githubEnabled: boolean
  miniEnabled: boolean
  miniEnv: string
  miniPage: string
  mockQrconnect: string
  realQrconnect: string
}

export interface MiniTicketCreated {
  id: string
  image: string
  expiresAt: number
  expiresIn: number
  envVersion: string
  page: string
}

export interface MiniPoll {
  status: QrStatus
  expiresAt: number
  confirmedAt?: number
  code?: string
}

export class ApiError extends Error {
  status: number
  payload: unknown

  constructor(message: string, status: number, payload: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }
  if (!response.ok) {
    const message =
      (payload as { error?: string } | null)?.error ?? `请求失败（HTTP ${response.status}）`
    throw new ApiError(message, response.status, payload)
  }
  return payload as T
}

export const api = {
  config: () => request<AppConfig>('/api/config'),
  me: () => request<{ user: SessionUser | null }>('/api/me'),
  logout: () => request<{ ok: boolean }>('/api/logout', { method: 'POST' }),
  createQr: () => request<CreatedQr>('/api/login/qr', { method: 'POST' }),
  pollQr: (id: string) => request<QrPoll>(`/api/login/qr/${encodeURIComponent(id)}`),
  scanQr: (id: string) => request(`/api/login/qr/${encodeURIComponent(id)}/scan`, { method: 'POST' }),
  confirmQr: (id: string) => request(`/api/login/qr/${encodeURIComponent(id)}/confirm`, { method: 'POST' }),
  cancelQr: (id: string) => request(`/api/login/qr/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  exchange: (code: string) =>
    request<{ user: SessionUser }>('/api/login/exchange', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  createMiniTicket: () =>
    request<MiniTicketCreated>('/api/login/mini/ticket', { method: 'POST' }),
  pollMiniTicket: (id: string) =>
    request<MiniPoll>(`/api/login/mini/ticket/${encodeURIComponent(id)}`),
  exchangeMini: (code: string) =>
    request<{ user: SessionUser }>('/api/login/mini/exchange', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
}
