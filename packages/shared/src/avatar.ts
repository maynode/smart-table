/**
 * 头像种子工具。
 * 出图在前端用本地 DiceBear（@dicebear/adventurer）生成，不依赖外网 CDN。
 * 风格素材：Adventurer by Lisa Wischofsky，CC BY 4.0。
 */

export const AVATAR_STYLE = 'adventurer' as const;
export const AVATAR_BACKGROUNDS = [
  'b6e3f4',
  'c0aede',
  'd1d4f9',
  'ffd5dc',
  'ffdfbf',
] as const;

/** 生成可持久化的头像种子 */
export function createAvatarSeed(entropy = ''): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const base = `${entropy}${rand}`.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (base || rand).slice(0, 32);
}

/** 规范化种子，供本地生成或展示用 */
export function normalizeAvatarSeed(
  seed: string | null | undefined,
  fallback = 'guest',
): string {
  return (seed?.trim() || fallback).slice(0, 64);
}
