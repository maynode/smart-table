import { ApiError } from './client';

/** 从抛错对象取出可读文案（兼容 ApiError / Error / 未知）。 */
export function messageOf(error: unknown): string {
  if (!error) return '';
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '';
}
