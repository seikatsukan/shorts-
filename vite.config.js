import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
// .env に API_PROXY_TARGET=http://localhost:8787 のように書くと、/api と /auth をそのサーバーへ流す
// （API とログインの Cookie を画面と同じオリジンに見せるため。cf-rules-api の README の決まり）
export default defineConfig(({ mode }) => {
  const target = loadEnv(mode, process.cwd(), '').API_PROXY_TARGET
  const proxy = target && { target, changeOrigin: true }
  return {
    plugins: [react()],
    server: proxy ? { proxy: { '/api': proxy, '/auth': proxy } } : undefined,
  }
})
