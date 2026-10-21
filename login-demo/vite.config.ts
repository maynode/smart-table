import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createAuthApi } from './server/api'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      vue(),
      {
        name: 'login-demo-api',
        configureServer(server) {
          // 纯开发环境中间件：/api、/mock、/phone 都挂在这里，不依赖单独的后端进程
          server.middlewares.use(createAuthApi(env))
        },
      },
    ],
    server: {
      port: 5180,
      host: true,
    },
  }
})
