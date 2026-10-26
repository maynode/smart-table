/**
 * 协同 / Live 的 WebSocket 根地址。
 *
 * Dev 固定直连本机 API 回环（不经 Vite WS 代理，也不走页面上的局域网 IP）：
 * 1) Vite 旧 `ws://` proxy target 会丢 `user_changes` 回程；
 * 2) 本机用 http://192.168.x.x:5173 打开时，连自身局域网 IP:3000 常撞 Windows hairpin，
 *    WS 能握手但后续帧异常，表现为「同步很慢」。
 * 其它设备访问 Dev 时，127.0.0.1 会连失败 → MessageCenter 立刻降级 HTTP（经 Vite `/api` 代理仍可用）。
 * 生产或自定义：设 `VITE_API_WS`（如 `wss://host` / `ws://192.168.x.x:3000`）。
 */
export function resolveApiWsBase(): string {
  if (typeof window === 'undefined') return '';
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const envWs = (import.meta.env.VITE_API_WS as string | undefined)?.trim();
  if (envWs) return envWs.replace(/\/$/, '');
  const port = String(import.meta.env.VITE_API_PORT ?? '3000').replace(
    /^:/,
    '',
  );
  if (import.meta.env.DEV) {
    return `ws://127.0.0.1:${port}`;
  }
  // 生产：同域（nginx 反代 /collab、/live），无需再暴露 API :3000
  return `${proto}://${window.location.host}`;
}
