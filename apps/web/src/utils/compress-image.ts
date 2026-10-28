/** 反馈截图：最长边限制 + JPEG 压缩，目标 ≤ maxBytes。 */
export async function compressImageFile(
  file: Blob,
  options?: { maxEdge?: number; maxBytes?: number },
): Promise<Blob> {
  const maxEdge = options?.maxEdge ?? 1600;
  const maxBytes = options?.maxBytes ?? 400 * 1024;
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法压缩图片');
    ctx.drawImage(bitmap, 0, 0, width, height);

    let quality = 0.82;
    let blob = await canvasToJpeg(canvas, quality);
    while (blob.size > maxBytes && quality > 0.4) {
      quality -= 0.08;
      blob = await canvasToJpeg(canvas, quality);
    }
    if (blob.size > maxBytes) {
      const smaller = document.createElement('canvas');
      const nextScale = 0.75;
      smaller.width = Math.max(1, Math.round(width * nextScale));
      smaller.height = Math.max(1, Math.round(height * nextScale));
      const sctx = smaller.getContext('2d');
      if (!sctx) throw new Error('无法压缩图片');
      sctx.drawImage(canvas, 0, 0, smaller.width, smaller.height);
      quality = 0.75;
      blob = await canvasToJpeg(smaller, quality);
      while (blob.size > maxBytes && quality > 0.35) {
        quality -= 0.08;
        blob = await canvasToJpeg(smaller, quality);
      }
    }
    if (blob.size > maxBytes) {
      throw new Error('图片压缩后仍过大，请换一张更小的图');
    }
    return blob;
  } finally {
    bitmap.close();
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('图片导出失败'));
        else resolve(blob);
      },
      'image/jpeg',
      quality,
    );
  });
}
