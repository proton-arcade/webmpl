/**
 * Smoke test runner.
 *
 *   npm run smoke
 *
 * Builds src/smoke/bundle.tsx for node, executes it inside jsdom with a stubbed
 * canvas, and reports whether the desktop mounts, every application renders and
 * every MixtNet page renders.
 */
import { execSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'

const OUT_DIR = '.smoke-out'

console.log('• building smoke bundle…')
execSync(`npx vite build --ssr src/smoke/bundle.tsx --outDir ${OUT_DIR} --logLevel error`, {
  stdio: 'inherit',
})

const entry = [`${OUT_DIR}/bundle.js`, `${OUT_DIR}/bundle.mjs`].find((p) => existsSync(p))
if (!entry) {
  console.error(`✗ build produced no bundle in ${OUT_DIR}`)
  process.exit(1)
}

/* ------------------------------- jsdom setup ------------------------------- */
/* ----------------------------- the real machine -------------------------- */
/* Mixt is a computer on the network, so the desktop is exercised against one:
   this boots the actual server into a throwaway directory and points the
   browser's fetch at it. Nothing here is stubbed — a check that passes here
   passes against `node server/index.js`. */
const dataDir = await mkdtemp(join(tmpdir(), 'mixt-smoke-'))
const { createServer } = await import('../server/index.js')
const { server, world } = await createServer({ port: 0, dataDir, rootPassword: 'smoke-root' })
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const ORIGIN = `http://127.0.0.1:${server.address().port}`

const nodeFetch = globalThis.fetch.bind(globalThis)
const routedFetch = (input, init) => {
  const raw = typeof input === 'string' ? input : (input?.url ?? String(input))
  return nodeFetch(/^https?:\/\//.test(raw) ? raw : ORIGIN + raw, init)
}
globalThis.fetch = routedFetch

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://localhost:3000/',
  pretendToBeVisual: true,
})
const { window } = dom
window.fetch = routedFetch

/* Sign the administrator in before the desktop boots, the way a browser that
   already has a session does: the token in sessionStorage is the session. */
{
  const res = await routedFetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'Mixt_MPL', password: 'smoke-root' }),
  })
  const session = await res.json()
  window.sessionStorage.setItem(
    'mixt.session.v1',
    JSON.stringify({ token: session.token, role: session.role, username: session.username }),
  )
}

globalThis.window = window
globalThis.document = window.document
globalThis.localStorage = window.localStorage
globalThis.sessionStorage = window.sessionStorage
globalThis.HTMLElement = window.HTMLElement
globalThis.HTMLCanvasElement = window.HTMLCanvasElement
globalThis.Element = window.Element
globalThis.Node = window.Node
globalThis.Event = window.Event
globalThis.CustomEvent = window.CustomEvent
globalThis.KeyboardEvent = window.KeyboardEvent
globalThis.MouseEvent = window.MouseEvent
globalThis.PointerEvent = window.PointerEvent ?? window.MouseEvent
globalThis.getComputedStyle = window.getComputedStyle.bind(window)
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window)
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window)
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
window.devicePixelRatio = 1
Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true })
Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })

/* --------------------------- canvas 2d context stub ------------------------ */
function makeGradient() {
  return { addColorStop() {} }
}
function makeContext2D() {
  const target = {
    canvas: null,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '10px sans-serif',
    globalAlpha: 1,
    createLinearGradient: makeGradient,
    createRadialGradient: makeGradient,
    createPattern: () => ({}),
    measureText: (t) => ({ width: (t?.length ?? 0) * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    getImageData: (x, y, w, h) => ({
      data: new Uint8ClampedArray(Math.max(4, Math.ceil(w * h * 4))),
      width: w,
      height: h,
    }),
  }
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop]
      return () => {}
    },
    set(t, prop, value) {
      t[prop] = value
      return true
    },
  })
}
window.HTMLCanvasElement.prototype.getContext = function () {
  return makeContext2D()
}
window.HTMLCanvasElement.prototype.toDataURL = function () {
  return 'data:image/png;base64,AAAA'
}

/* ------------------------------ run the bundle ----------------------------- */
const mod = await import(pathToFileURL(entry).href)
const { results, failed } = await mod.runSmoke()

/* --------------------------------- teardown -------------------------------- */
await world.clients.get('database').flush()
server.close()
await rm(dataDir, { recursive: true, force: true }).catch(() => {})

const green = (s) => `\x1b[32m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`

console.log('')
console.log(`  ${results.length} checks run`)
for (const r of results) {
  if (!r.ok) console.log(`  ${red('✗')} ${r.name}\n      ${(r.detail ?? '').split('\n').slice(0, 4).join('\n      ')}`)
}
if (failed.length === 0) {
  console.log(`  ${green('✓ all checks passed')}`)
  console.log('')
  console.log(`  ${results.length - failed.length} / ${results.length} checks passed`)
  process.exit(0)
} else {
  console.log('')
  console.log(`  ${red(`${failed.length} of ${results.length} checks failed`)}`)
  process.exit(1)
}
