export interface StoredUser {
  id: string;
  account: string;
  name: string;
  avatarSeed?: string;
  avatarUrl?: string | null;
}

const TOKEN_KEY = 'st.token';
const USER_KEY = 'st.user';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): StoredUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: StoredUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/** 网络层失败（断网 / DNS / 中止），非 HTTP 业务错误 */
export class NetworkError extends Error {
  constructor(message = '网络不可用') {
    super(message);
    this.name = 'NetworkError';
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(ApiError.describe(body, status));
    this.name = 'ApiError';
  }

  private static describe(body: unknown, status?: number): string {
    if (typeof body === 'string' && body.trim()) return body.trim();
    if (body && typeof body === 'object') {
      const message = (body as { message?: unknown }).message;
      if (Array.isArray(message)) {
        return message
          .map((item) => (typeof item === 'string' ? item : String(item)))
          .filter(Boolean)
          .join('；');
      }
      if (typeof message === 'string' && message.trim()) return message.trim();
      const error = (body as { error?: unknown }).error;
      if (typeof error === 'string' && error.trim()) return error.trim();
    }
    if (status === 401) return '未登录或登录已过期';
    if (status === 403) return '没有权限';
    if (status === 404) return '资源不存在';
    return status ? `请求失败（${status}）` : '请求失败';
  }
}

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string | null;
  headers?: Record<string, string>;
}

export async function api<T>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const token = options.token === undefined ? getToken() : options.token;
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    window.dispatchEvent(new CustomEvent('st:network-error'));
    throw new NetworkError('网络不可用，请检查连接');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    // 登录/注册本身的 401 不是会话过期
    const isAuthAttempt =
      path === '/auth/login' ||
      path === '/auth/register' ||
      path === '/auth/recovery/question' ||
      path === '/auth/recovery/reset';
    // 公开视图缺密码也返回 401，不算登录失效
    if (
      response.status === 401 &&
      !isAuthAttempt &&
      !path.startsWith('/public-views/') &&
      !path.startsWith('/public/forms/')
    ) {
      window.dispatchEvent(new CustomEvent('st:unauthorized'));
    }
    throw new ApiError(response.status, data);
  }
  return data as T;
}
