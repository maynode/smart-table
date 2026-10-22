/**
 * 公开填写链接：跟当前浏览器地址同源。
 * 避免 API 里写死的 localhost 在局域网 IP 访问时不可用。
 */
export function fillShareUrl(token: string | null | undefined): string {
  const t = (token ?? '').trim();
  if (!t) return '';
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : '';
  if (!origin) return `/fill/${encodeURIComponent(t)}`;
  return `${origin.replace(/\/$/, '')}/fill/${encodeURIComponent(t)}`;
}

/** 若后端给了完整 qrUrl，仍优先改写成当前 origin（保留 path/token）。 */
export function rewritePublicUrl(apiUrl: string | null | undefined): string {
  const raw = (apiUrl ?? '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw, window.location.origin);
    const fill = parsed.pathname.match(/^\/fill\/([^/]+)\/?$/);
    if (fill?.[1]) return fillShareUrl(decodeURIComponent(fill[1]));
    return `${window.location.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return raw;
  }
}
