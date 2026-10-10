/**
 * Boot diagnostics.
 *
 *   npm run diagnose
 *
 * Boots the real OS entry point (src/os/start.tsx — exactly what main.tsx
 * runs) inside jsdom, once per hostile-browser condition, and reports whether
 * the desktop came up. A white screen is a boot failure: instead of asking
 * someone to open devtools and guess, this says which kind of browser or saved
 * state leaves the page empty.
 *
 * The conditions exist because each one has broken the boot at some point:
 * a browser that denies web storage (sandboxed iframe, Safari private mode),
 * a full disk, a saved filesystem written by another build, settings that no
 * longer match their types, an interrupted write, a tiny window.
 *
 * The matrix runs each condition in its own process, so module-level state
 * (the zustand stores, the loaded filesystem) cannot leak between them.
 */
import { execSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { existsSync, rmSync } from 'node:fs'

const OUT_DIR = '.diagnose-out'
const CONDITIONS = [
  'clean-install',
  'returning-user',
  'storage-blocked',
  'local-storage-blocked',
  'session-storage-blocked',
  'storage-full',
  'damaged-filesystem',
  'truncated-filesystem',
  'stale-settings',
  'tiny-window',
  'canvas-unavailable',
]

/* ------------------------------- child mode ------------------------------- */
if (process.argv[2] === '--one') {
  await runCondition(process.argv[3])
  process.exit(0)
}

/* ------------------------------ parent mode ------------------------------- */
console.log('• building the boot entry…')
rmSync(OUT_DIR, { recursive: true, force: true })
execSync(`npx vite build --ssr src/os/start.tsx --outDir ${OUT_DIR} --logLevel error`, { stdio: 'inherit' })

const rows = []
for (const name of CONDITIONS) {
  const started = Date.now()
  const run = spawnSync(process.execPath, [new URL(import.meta.url).pathname, '--one', name], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, MIXT_DIAGNOSE_CHILD: '1' },
  })
  const line = (run.stdout ?? '').split('\n').find((l) => l.startsWith('MIXT_DIAGNOSE_RESULT '))
  if (!line) {
    rows.push({
      name,
      ok: false,
      mounted: false,
      detail: `the run crashed before reporting (exit ${run.status}) ${(run.stderr ?? '').split('\n')[0] ? '- ' + run.stderr.split('\n')[0].trim() : ''}`,
      ms: Date.now() - started,
    })
    continue
  }
  rows.push({ ...JSON.parse(line.slice('MIXT_DIAGNOSE_RESULT '.length)), ms: Date.now() - started })
}

const green = (s) => `\x1b[32m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const pad = (s, n) => String(s).padEnd(n)

console.log('')
console.log(`  ${pad('boot condition', 26)}${pad('desktop', 10)}${pad('time', 8)}detail`)
console.log(`  ${'-'.repeat(26)}${'-'.repeat(10)}${'-'.repeat(8)}${'-'.repeat(30)}`)
for (const row of rows) {
  const plain = row.mounted ? 'mounted' : 'WHITE PAGE'
  const state = row.mounted ? green(plain) : red(plain)
  const gap = ' '.repeat(Math.max(1, 10 - plain.length))
  console.log(`  ${pad(row.name, 26)}${state}${gap}${pad(row.ms + 'ms', 8)}${row.detail ?? ''}`)
}

const failed = rows.filter((r) => !r.mounted)
console.log('')
if (failed.length === 0) {
  console.log(`  ${green('✓')} the desktop boots in all ${rows.length} conditions`)
  console.log('')
  process.exit(0)
}
console.log(`  ${red(`${failed.length} of ${rows.length} conditions left an empty page:`)}`)
for (const row of failed) console.log(`    • ${row.name} — ${row.detail}`)
console.log('')
process.exit(1)

/* ----------------------------- the conditions ----------------------------- */
async function runCondition(mode) {
  const { JSDOM } = await import('jsdom')
  const entry = [`${OUT_DIR}/start.js`, `${OUT_DIR}/start.mjs`].find((p) => existsSync(p))
  if (!entry) throw new Error(`no bundle in ${OUT_DIR} — run npm run diagnose`)

  const width = mode === 'tiny-window' ? 360 : 1440
  const height = mode === 'tiny-window' ? 240 : 900

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost:3000/',
    pretendToBeVisual: true,
  })
  const { window } = dom
  const globals = {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    HTMLCanvasElement: window.HTMLCanvasElement,
    Element: window.Element,
    Node: window.Node,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    KeyboardEvent: window.KeyboardEvent,
    MouseEvent: window.MouseEvent,
    PointerEvent: window.PointerEvent ?? window.MouseEvent,
    location: window.location,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
  }
  for (const [key, value] of Object.entries(globals)) globalThis[key] = value
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
  window.devicePixelRatio = 1
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true })

  const denied = (what) =>
    new DOMException(`Failed to read the '${what}' property from 'Window': Access is denied for this document.`, 'SecurityError')

  // a tiny sketch of a canvas: jsdom has none, and the OS draws several things
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AAAA'
  window.HTMLCanvasElement.prototype.getContext = function () {
    if (mode === 'canvas-unavailable') return null
    return new Proxy(
      { measureText: (t) => ({ width: (t?.length ?? 0) * 6 }), createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }), getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h }) },
      { get: (t, p) => (p in t ? t[p] : () => {}), set: (t, p, v) => ((t[p] = v), true) },
    )
  }

  /* ---- saved state: what the browser had before this boot ---- */
  const local = window.localStorage
  const session = window.sessionStorage

  if (mode === 'returning-user') {
    // a profile from the previous release: webmpl.* keys, /home/mint home
    local.setItem(
      'webmpl.vfs.v2',
      JSON.stringify({
        type: 'dir',
        name: '/',
        children: {
          home: { type: 'dir', name: 'home', children: { mint: { type: 'dir', name: 'mint', children: { Documents: { type: 'dir', name: 'Documents', children: {} } } } } },
          etc: { type: 'dir', name: 'etc', children: {} },
        },
      }),
    )
    local.setItem('webmpl.settings.v2', JSON.stringify({ accent: '#61ad2b', scheme: 'dark' }))
    session.setItem('webmpl.boot.cycle', '7')
  }

  if (mode === 'damaged-filesystem') {
    // a directory that lost its children map (older build / interrupted write)
    local.setItem(
      'mixt.vfs.v2',
      JSON.stringify({ type: 'dir', children: { home: { type: 'dir', name: 'home', children: { mixt: { type: 'dir' } } } } }),
    )
  }

  if (mode === 'truncated-filesystem') {
    local.setItem('mixt.vfs.v2', '{"type":"dir","children":{"home":{"type":"dir","name":"ho')
  }

  if (mode === 'stale-settings') {
    local.setItem(
      'mixt.settings.v2',
      JSON.stringify({ wallpaper: null, desktopIcons: null, startupApps: null, panelSize: 'wide', accent: 'chartreuse', scheme: 'neon', volume: 900 }),
    )
  }

  /* ---- storage behaviour ---- */
  if (mode === 'storage-blocked' || mode === 'local-storage-blocked') {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw denied('localStorage')
      },
      configurable: true,
    })
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw denied('localStorage')
      },
      configurable: true,
    })
  }
  if (mode === 'storage-blocked' || mode === 'session-storage-blocked') {
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw denied('sessionStorage')
      },
      configurable: true,
    })
    Object.defineProperty(globalThis, 'sessionStorage', {
      get() {
        throw denied('sessionStorage')
      },
      configurable: true,
    })
  }
  if (mode === 'storage-full') {
    const full = (store) =>
      new Proxy(store, {
        get(target, prop) {
          if (prop === 'setItem' || prop === 'removeItem') {
            return () => {
              throw new DOMException('Quota exceeded', 'QuotaExceededError')
            }
          }
          const value = target[prop]
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    Object.defineProperty(window, 'localStorage', { value: full(local), configurable: true })
    Object.defineProperty(window, 'sessionStorage', { value: full(session), configurable: true })
    Object.defineProperty(globalThis, 'localStorage', { value: window.localStorage, configurable: true })
    Object.defineProperty(globalThis, 'sessionStorage', { value: window.sessionStorage, configurable: true })
  }

  /* ---- boot, exactly like main.tsx ---- */
  const errors = []
  window.addEventListener('error', (e) => errors.push(e.message))
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)))
  const realError = console.error
  console.error = (...args) => {
    errors.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '))
    realError(...args)
  }

  let result = { name: mode, mounted: false, detail: '' }
  try {
    const mod = await import(pathToFileURL(entry).href)
    mod.startDesktop()
    await new Promise((r) => setTimeout(r, 1200))

    const root = window.document.getElementById('root')
    const html = root?.innerHTML ?? ''
    const panel = html.includes('class="panel')
    const icons = html.includes('desktop-icon')
    const failureScreen = html.includes('could not start') || window.document.body.getAttribute('data-mixt-boot-failure') !== null
    result.mounted = html.length > 500 && panel && icons
    if (failureScreen) result.detail = 'showed the boot failure screen'
    else if (!result.mounted) result.detail = `rendered ${html.length} bytes of html`
    if (result.mounted && errors.length) result.detail = `${errors.length} console error(s): ${errors[0].slice(0, 90)}`
    if (mode === 'returning-user') {
      // the migration must have moved the old profile over
      const migrated = globalThis.localStorage.getItem('mixt.settings.v2')
      if (!migrated || !migrated.includes('61ad2b')) result.detail = 'the legacy profile was not migrated'
    }
  } catch (e) {
    result.detail = `boot threw: ${e?.message ?? e}`
  }

  console.log('MIXT_DIAGNOSE_RESULT ' + JSON.stringify(result))
}
