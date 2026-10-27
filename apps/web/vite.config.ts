import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['pwa-192.svg', 'pwa-512.svg'],
      manifest: {
        name: '智能表格',
        short_name: '智能表格',
        description: '可离线编辑的智能表格',
        theme_color: '#1a6b4a',
        background_color: '#f6f7f5',
        display: 'standalone',
        start_url: '/',
        lang: 'zh-CN',
        icons: [
          {
            src: 'pwa-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'pwa-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // SPA shell only — never cache business API JSON (IDB owns data).
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/files/, /^\/collab/, /^\/live/],
        globPatterns: ['**/*.{js,css,html,svg,woff2,ico}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api') ||
              url.pathname.startsWith('/files') ||
              url.pathname.startsWith('/collab') ||
              url.pathname.startsWith('/live'),
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: {
        // Keep SW off in Vite HMR; e2e uses preview/build.
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      // Shared contracts stay a single source of truth; Vite compiles the TS.
      shared: fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  worker: {
    format: 'es',
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
