import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/* The build that produces the website people can open.
 *
 * `npm run dev` (vite.config.ts) serves the TypeScript sources with hot reload.
 * This config produces the plain files that index.html loads, so the folder
 * works on any static host — a bare `python3 -m http.server`, VSCode Live
 * Server, nginx, GitHub Pages, even double-clicking index.html:
 *
 *   · IIFE output, not ES modules — no `type="module"`, no MIME-type or CORS
 *     rules to satisfy, and it runs from file:// where modules cannot;
 *   · every URL relative, so serving the folder from a subdirectory works;
 *   · one JS file and one CSS file, so there is nothing to fetch at runtime.
 *
 * The two dynamic imports in the app (terminal helpers) are inlined, because a
 * classic script must be a single file.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  // wallpapers/ and logo.svg sit in the repository root and are copied into
  // the published folder by scripts/build-static.mjs — no public/ directory.
  publicDir: false,
  build: {
    target: 'es2019',
    outDir: '.static-build',
    emptyOutDir: true,
    assetsDir: '',
    cssCodeSplit: false,
    rollupOptions: {
      // src/main.tsx is the entry: it runs the migration and calls
      // startDesktop(). src/os/start.tsx only *exports* that function, so
      // using it here produced a bundle that loaded, ran, and mounted nothing.
      input: 'src/main.tsx',
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'mixt.bundle.js',
        assetFileNames: (info) => (info.name?.endsWith('.css') ? 'mixt.bundle.css' : 'assets/[name][extname]'),
      },
    },
  },
})
