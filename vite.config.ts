import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

export default defineConfig(({ mode }) => {
  // Only the server reads this value. API credentials stay on the backend.
  const apiOrigin = loadEnv(mode, process.cwd(), '').DEV_API_ORIGIN
  return {
    plugins: [
      tanstackRouter({ target: 'react', autoCodeSplitting: true }),
      react(),
      tailwindcss(),
    ],
    server: {
      host: true,
      port: 5173,
      proxy: apiOrigin ? {
        '/api/identify': { target: apiOrigin, changeOrigin: true, proxyTimeout: 310_000 },
        '/api/shelf': { target: apiOrigin, changeOrigin: true, proxyTimeout: 310_000 },
      } : undefined,
    },
  }
})
