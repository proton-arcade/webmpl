/**
 * Served-site check.
 *
 *   npm run served [baseURL ...]      (default: http://127.0.0.1:8080)
 *
 * Every other harness in this repo builds the sources fresh and runs them
 * inside jsdom, so they all pass even when the files a browser downloads are
 * wrong. This one asks a real server for what the browser would get:
 *
 *   1. each asset referenced by index.html must return 200 *and* a content-type
 *      the browser will accept — a stylesheet served as text/javascript is
 *      dropped outright (strict MIME checking), which leaves a fully-running OS
 *      with no CSS: a white page. jsdom does not enforce that; a browser does.
 *   2. the served mixt.bundle.js — those exact bytes, not a rebuild — must mount
 *      the desktop inside jsdom.
 */
import { JSDOM } from 'jsdom'

const BASES = process.argv.slice(2).filter((a) => /^https?:\/\//.test(a))
const TARGETS = BASES.length ? BASES : ['http://127.0.0.1:8080']

const green = (s) => `\x1b[32m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`

/* What a browser will accept for each extension. Anything not matching is
 * refused: stylesheets and classic scripts are checked strictly. */
const ACCEPT = {
  '.css': ['text/css'],
  '.js': ['text/javascript', 'application/javascript'],
  '.svg': ['image/svg+xml'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.html': ['text/html'],
}

function extOf(url) {
  const path = url.split('?')[0].split('#')[0]
  const i = path.lastIndexOf('.')
  return i < 0 ? '' : path.slice(i).toLowerCase()
}

/* ------------------------------- canvas stub ------------------------------ */
function stubCanvas(window) {
  const gradient = () => ({ addColorStop() {} })
  const target = {
    canvas: null,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '10px sans-serif',
    globalAlpha: 1,
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    createPattern: () => ({}),
    measureText: (t) => ({ width: (t?.length ?? 0) * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, Math.ceil(w * h * 4))), width: w, height: h }),
  }
  const ctx = new Proxy(target, {
    get: (t, p) => (p in t ? t[p] : () => {}),
    set: (t, p, v) => ((t[p] = v), true),
  })
  window.HTMLCanvasElement.prototype.getContext = () => ctx
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AAAA'
}

/* ------------------------------ asset checks ------------------------------ */
async function checkAssets(base) {
  const results = []
  const page = await fetch(base + '/')
  results.push({ ok: page.ok, name: 'GET /', detail: `status ${page.status}` })
  const html = await page.text()

  const refs = [...new Set([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]))]
    .filter((r) => !r.startsWith('data:') && !r.startsWith('#'))
    .filter((r) => !/^(https?:)?\/\//.test(r))

  for (const ref of refs) {
    const url = new URL(ref, base + '/').href
    let res
    try {
      res = await fetch(url)
    } catch (e) {
      results.push({ ok: false, name: `GET ${ref}`, detail: `${e.message}` })
      continue
    }
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    const wanted = ACCEPT[extOf(ref)]
    const typeOk = wanted ? wanted.includes(type) : true
    results.push({
      ok: res.ok && typeOk,
      name: `GET ${ref}`,
      detail: `status ${res.status}, content-type ${type || '(none)'}${typeOk ? '' : `, browser needs ${wanted.join(' or ')}`}`,
    })
  }

  /* the page must also declare the sheet and the bundle, or nothing can load */
  results.push({
    ok: /rel="stylesheet"[^>]*mixt\.bundle\.css/.test(html),
    name: 'index.html links mixt.bundle.css',
    detail: html.includes('mixt.bundle.css') ? 'present but not as a stylesheet' : 'missing entirely',
  })
  results.push({
    ok: /src="mixt\.bundle\.js"/.test(html),
    name: 'index.html loads mixt.bundle.js',
    detail: 'no <script src="mixt.bundle.js"> in the served page',
  })
  /* the shop is priced in dollars. A stray £ anywhere in the bundle means a
     price went back to pounds somewhere — the shop's own money() helper is
     dollars, but hand-written prices in other apps are not covered by it. */
  const bundleSrc = await (await fetch(base + '/mixt.bundle.js')).text()
  const pounds = (bundleSrc.match(/£/g) || []).length
  results.push({
    ok: pounds === 0,
    name: 'no price is in pounds',
    detail: pounds ? `${pounds} × £ still in the served bundle` : 'the shop is in dollars',
  })
  return results
}

/* ------------------------- boot the served bundle -------------------------- */
async function checkBoot(base) {
  const [html, bundle] = await Promise.all([(await fetch(base + '/')).text(), (await fetch(base + '/mixt.bundle.js')).text()])

  const dom = new JSDOM(html, { url: base + '/', pretendToBeVisual: true, runScripts: 'dangerously' })
  const { window } = dom
  stubCanvas(window)
  Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
  window.devicePixelRatio = 1
  window.Element.prototype.setPointerCapture = function () {}
  window.Element.prototype.releasePointerCapture = function () {}

  const errors = []
  window.addEventListener('error', (e) => errors.push(e.message || String(e.error)))

  const script = window.document.createElement('script')
  script.textContent = bundle
  window.document.body.appendChild(script)

  await new Promise((r) => setTimeout(r, 600))

  const root = window.document.getElementById('root')
  const rendered = root ? root.innerHTML : ''
  return [
    { ok: errors.length === 0, name: 'bundle ran without throwing', detail: errors.slice(0, 3).join(' | ') },
    { ok: !!root && root.children.length > 0, name: '#root has children', detail: root ? `innerHTML ${rendered.length} chars` : 'no #root element' },
    { ok: rendered.includes('panel'), name: 'panel is rendered', detail: 'desktop mounted but the panel is missing' },
    { ok: rendered.length > 4000, name: 'desktop is fully populated', detail: `only ${rendered.length} chars rendered` },
    ...noAccountAvatars(bundle, rendered),
  ]
}

/* Accounts have no avatars: no picker, no emoji, nothing carried per user. These
 * twelve were the entire picker, and none of them is used anywhere else in the
 * app — if one is back in the bundle, an avatar UI came back with it. */
const ACCOUNT_AVATARS = ['🦊', '🐧', '🌿', '🚀', '🎧', '🐙', '🍋', '🌙', '🔥', '🧊', '🐝', '🎲']
function noAccountAvatars(bundle, rendered) {
  const present = ACCOUNT_AVATARS.filter((a) => bundle.includes(a))
  const found = ACCOUNT_AVATARS.filter((a) => rendered.includes(a))
  return [
    { ok: present.length === 0, name: 'bundle has no account avatars', detail: `still contains ${present.join(' ')}` },
    { ok: found.length === 0, name: 'rendered desktop shows no avatar', detail: `on screen: ${found.join(' ')}` },
  ]
}

/* --------------------------------- runner --------------------------------- */
let failed = 0
for (const base of TARGETS) {
  console.log(`\n  ${base}`)
  let results
  try {
    results = [...(await checkAssets(base)), ...(await checkBoot(base))]
  } catch (e) {
    console.log(`  ${red('✗')} cannot reach ${base}: ${e.message}`)
    failed++
    continue
  }
  for (const r of results) {
    if (!r.ok) {
      failed++
      console.log(`  ${red('✗')} ${r.name}\n      ${r.detail}`)
    }
  }
  const bad = results.filter((r) => !r.ok).length
  console.log(
    bad === 0
      ? `  ${green('✓')} ${results.length} checks passed — page, asset types and the served bundle all good`
      : `  ${red('✗')} ${bad} of ${results.length} checks failed`,
  )
}
console.log('')
process.exit(failed === 0 ? 0 : 1)
