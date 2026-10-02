import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { wgslVitePlugin } from '@vgpu/wgsl/loader-vite'

export default defineConfig({
  plugins: [react(), wgslVitePlugin()],
  server: {
    port: 5173,
    // The backend serves the mission API under /api and /health, /ready at
    // the root: forward them as they are, without rewriting the path.
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/health': { target: 'http://localhost:8080', changeOrigin: true },
      '/ready': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
})
