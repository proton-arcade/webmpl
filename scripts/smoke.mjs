/**
 * Smoke test runner.
 *
 *   npm run smoke
 *
 * Builds src/smoke/bundle.tsx for node, executes it inside jsdom with a stubbed
 * canvas, and reports whether the desktop mounts, every application renders and
 * every MintNet page renders.
 */
import { execSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
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
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://localhost:3000/',
  pretendToBeVisual: true,
})
const { window } = dom

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
