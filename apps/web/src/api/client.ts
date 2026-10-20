export interface StoredUser {
  id: string;
  email: string;
  name: string;
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

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(ApiError.describe(body));
    this.name = 'ApiError';
  }

  private static describe(body: unknown): string {
    if (body && typeof body === 'object' && 'message' in body) {
      const message = (body as { message: unknown }).message;
      if (Array.isArray(message)) return message.join('；');
      if (typeof message === 'string') return message;
    }
    return '请求失败';
  }
}

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string | null;
}

export async function api<T>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const token = options.token === undefined ? getToken() : options.token;
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers,
    body:
      options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent('st:unauthorized'));
    }
    throw new ApiError(response.status, data);
  }
  return data as T;
}
