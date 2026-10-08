import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Mixt / Mixt Web OS — Vite config tuned for sandboxed live-preview hosting
// (server must accept proxied hosts/origins, e.g. https://<port>-<id>.e2b.app)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 3000,
    strictPort: false,
    allowedHosts: true,
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },
  preview: {
    host: true,
    allowedHosts: true,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
  },
})
