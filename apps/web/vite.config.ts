import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // Shared contracts stay a single source of truth; Vite compiles the TS.
      shared: fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    // 局域网 IP 访问（手机/其他电脑）需要显式放开 host 校验
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/files': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      // 客户端已直连 :3000；此处保留给手工探测。target 用 http（勿用 ws://），
      // 否则 Vite 代理会出现握手成功但后续帧丢失（user_changes 无 accept）。
      '/collab': {
        target: 'http://127.0.0.1:3000',
        ws: true,
        changeOrigin: true,
      },
      '/live': {
        target: 'http://127.0.0.1:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
