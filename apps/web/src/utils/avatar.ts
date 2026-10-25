/**
 * 本地生成卡通头像（DiceBear adventurer）+ 自定义上传展示。
 * 素材：Adventurer by Lisa Wischofsky，CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/
 */
import { createAvatar } from '@dicebear/core';
import * as adventurer from '@dicebear/adventurer';
import { AVATAR_BACKGROUNDS, normalizeAvatarSeed } from 'shared';

const cache = new Map<string, string>();

/** 裁剪输出边长；JPEG 约 192² ≈ 十几～几十 KB */
export const AVATAR_OUTPUT_SIZE = 192;
/** 上传体积上限（与 API 一致） */
export const AVATAR_MAX_BYTES = 64 * 1024;

/** 返回 data: URL，完全本地、无需外网 */
export function buildAvatarUrl(
  seed: string | null | undefined,
  fallback = 'guest',
  size = 128,
): string {
  const resolved = normalizeAvatarSeed(seed, fallback);
  const key = `${resolved}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const url = createAvatar(adventurer, {
    seed: resolved,
    size,
    backgroundColor: [...AVATAR_BACKGROUNDS],
  }).toDataUri();

  cache.set(key, url);
  return url;
}

/** 优先自定义上传 URL，否则用种子生成卡通头像 */
export function resolveAvatarSrc(options: {
  avatarUrl?: string | null;
  avatarSeed?: string | null;
  account?: string | null;
  size?: number;
}): string {
  const custom = options.avatarUrl?.trim();
  if (custom) return custom;
  const fallback = options.account?.trim() || 'guest';
  return buildAvatarUrl(
    options.avatarSeed || fallback,
    fallback,
    options.size ?? 96,
  );
}

/** 将裁剪后的画布压成 JPEG Blob，尽量压到几十 KB 以内 */
export async function canvasToAvatarBlob(
  canvas: HTMLCanvasElement,
  maxBytes = AVATAR_MAX_BYTES,
): Promise<Blob> {
  let quality = 0.82;
  let blob = await canvasToJpeg(canvas, quality);
  while (blob.size > maxBytes && quality > 0.4) {
    quality -= 0.08;
    blob = await canvasToJpeg(canvas, quality);
  }
  if (blob.size > maxBytes) {
    // 再缩一档尺寸兜底
    const smaller = document.createElement('canvas');
    smaller.width = 128;
    smaller.height = 128;
    const ctx = smaller.getContext('2d');
    if (!ctx) throw new Error('无法压缩头像');
    ctx.drawImage(canvas, 0, 0, 128, 128);
    quality = 0.75;
    blob = await canvasToJpeg(smaller, quality);
    while (blob.size > maxBytes && quality > 0.35) {
      quality -= 0.08;
      blob = await canvasToJpeg(smaller, quality);
    }
  }
  if (blob.size > maxBytes) {
    throw new Error('头像压缩后仍过大，请换一张更简单的图片');
  }
  return blob;
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('头像导出失败'));
        else resolve(blob);
      },
      'image/jpeg',
      quality,
    );
  });
}
