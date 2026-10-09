import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, resolve } from 'node:path'

/* Development server. `npm run dev` serves the TypeScript sources with hot
 * reload through dev.html.
 *
 * The published site is a different thing entirely: index.html loads the
 * prebuilt classic bundle (mixt.bundle.js), so the folder works on any static
 * host with no build step. `npm run build` regenerates that bundle — see
 * vite.static.config.ts.
 */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
}

/* Serve the published files as raw bytes, exactly as they sit on disk.
 *
 * Vite's transform pipeline intercepts every request, so asking the dev server
 * for `/mixt.bundle.css` returns a JavaScript module (`content-type:
 * text/javascript`, body `import { createHotContext … }`). Browsers apply
 * strict MIME checking to `<link rel=stylesheet>` and silently discard a sheet
 * that is not `text/css` — so `index.html` loaded the OS with no CSS at all: a
 * white page with a live, correctly-running bundle underneath, which is exactly
 * the failure jsdom cannot see.
 *
 * Installed before Vite's internal middlewares so it wins. `/src/*`, `/@vite/*`
 * and `dev.html` still go through Vite, so hot reload is untouched. */
function servePublishedFiles() {
  return {
    name: 'mixt-serve-published',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: () => void) => {
        try {
          const root: string = server.config.root
          const wanted = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0])
          const path = wanted === '/' ? '/index.html' : wanted
          const isPublished =
            path === '/index.html' ||
            path === '/logo.svg' ||
            path.startsWith('/mixt.bundle.') ||
            path.startsWith('/wallpapers/')
          if (!isPublished) return next()
          const file = resolve(root, '.' + path)
          if (!file.startsWith(resolve(root)) || !existsSync(file) || !statSync(file).isFile()) return next()
          res.statusCode = 200
          res.setHeader('content-type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream')
          res.setHeader('cache-control', 'no-store') // never hand back a stale bundle
          res.end(readFileSync(file))
        } catch {
          next()
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [servePublishedFiles(), react(), tailwindcss()],
  // relative URLs everywhere, so the site also works from a subdirectory
  base: './',
  // wallpapers/ and logo.svg live in the repository root; Vite serves any file
  // under the project root, so there is no public/ directory to keep in sync
  publicDir: false,
  server: {
    host: true,
    port: 3000,
    strictPort: false,
    open: '/dev.html', // the published index.html is the prebuilt bundle
    // accept proxied hosts/origins (sandboxed preview panes)
    allowedHosts: true,
    cors: true,
  },
  preview: {
    host: true,
    allowedHosts: true,
    open: false, // serving dist/ must not try to launch a browser
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
  },
})
