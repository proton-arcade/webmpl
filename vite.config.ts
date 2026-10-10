import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * There is no dev server in this project. The site is a plain folder of files
 * that Apache (or any static host) serves as-is, and the only thing you start
 * is the backend:
 *
 *     npm start        # node server.cjs
 *
 * This file exists for one reason: the test harnesses compile the real sources
 * with `vite build --ssr`, which auto-loads the config from the project root.
 * They need the JSX and Tailwind transforms below to turn src/*.tsx into
 * something Node can run. Nothing here starts a server or watches anything.
 *
 * The published bundle has its own config (vite.static.config.ts) with a
 * different entry point and an empty base, so relative paths survive being
 * served from a subdirectory.
 */
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
})
