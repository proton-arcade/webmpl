/**
 * Server-account session check.
 *
 *   npm run session
 *
 * Boots the SHIPPED bundle (mixt.bundle.js, the bytes a browser downloads)
 * against a small fake Mixt API and walks the flows that only exist when a
 * backend is present:
 *
 *   1. signing in as the administrator adopts the desktop identity — no
 *      first-boot "create an account" form, and the panel shows that account;
 *   2. System Settings → Users reports Administrator, not a standard user;
 *   3. logging out from the panel's session menu really ends the session —
 *      windows close, the server session is dropped and the login gate returns;
 *   4. a guest is let in without being asked to create an account.
 *
 * The offline harnesses (smoke/explore/diagnose/interact) never see any of
 * this: they run with no server, so the login gate and the session plumbing are
 * never mounted.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'

const ROOT = process.cwd()
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' }
const SESSION_KEY = 'mixt.session.v1'
const ROOTPASS = 'mixt-root'

/* ------------------------------- fake API -------------------------------- */
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const p = url.pathname
  const send = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(obj))
  }
  if (p.startsWith('/api/')) {
    if (p === '/api/health') return send(200, { ok: true })
    if (p === '/api/login' && req.method === 'POST') {
      let body = ''
      for await (const c of req) body += c
      const d = JSON.parse(body || '{}')
      if (d.username === 'Mixt_MPL' && d.password === ROOTPASS) return send(200, { ok: true, token: 'admin-token', role: 'admin', username: 'Mixt_MPL' })
      if (d.username === 'demo' && d.password === 'demo') return send(200, { ok: true, token: 'demo-token', role: 'user', username: 'demo' })
      return send(401, { ok: false, error: 'wrong username or password' })
    }
    if (p === '/api/guest' && req.method === 'POST') return send(200, { ok: true, token: 'guest-token', role: 'guest', username: 'guest' })
    if (p === '/api/apps') return send(200, [])
    if (p === '/api/settings') return send(200, {})
    return send(200, { ok: true })
  }
  let path = p.endsWith('/') ? p + 'index.html' : p
  try {
    const body = await readFile(join(ROOT, path))
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end('404')
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${server.address().port}`

/* ------------------------------- harness --------------------------------- */
const failures = []
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  failures.push(m)
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
}
const tick = (ms = 300) => new Promise((r) => setTimeout(r, ms))

const vc = new VirtualConsole()
vc.on('jsdomError', (e) => bad(`page error: ${e.message}`))

function stubCanvas(w) {
  const gradient = () => ({ addColorStop() {} })
  const target = {
    canvas: null, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif', globalAlpha: 1,
    createLinearGradient: gradient, createRadialGradient: gradient, createPattern: () => ({}),
    measureText: (t) => ({ width: (t?.length ?? 0) * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    getImageData: (x, y, ww, hh) => ({ data: new Uint8ClampedArray(Math.max(4, Math.ceil(ww * hh * 4))), width: ww, height: hh }),
  }
  const ctx = new Proxy(target, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) })
  w.HTMLCanvasElement.prototype.getContext = () => ctx
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AAAA'
}

/** Boot the shipped bundle with an existing server session already stored. */
async function boot(session) {
  const raw = await (await fetch(BASE + '/')).text()
  const html = raw
    .replace(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi, '')
    .replace(/<script[^>]*mixt\.bundle\.js[^>]*>\s*<\/script>/gi, '')
  const dom = new JSDOM(html, { url: BASE + '/', pretendToBeVisual: true, runScripts: 'dangerously', virtualConsole: vc })
  const w = dom.window
  stubCanvas(w)
  Object.defineProperty(w, 'innerWidth', { value: 1440, configurable: true })
  Object.defineProperty(w, 'innerHeight', { value: 900, configurable: true })
  w.devicePixelRatio = 1
  w.Element.prototype.setPointerCapture = function () {}
  w.Element.prototype.releasePointerCapture = function () {}
  // the bundle's API client calls fetch(); jsdom has none, so point it here
  w.fetch = (input, init) => fetch(typeof input === 'string' ? new URL(input, BASE).href : input, init)
  if (session) w.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))

  const bundle = await (await fetch(BASE + '/mixt.bundle.js')).text()
  const tag = w.document.createElement('script')
  tag.textContent = bundle
  w.document.body.appendChild(tag)
  await tick(1000)
  return { w, d: w.document }
}

/** A faithful click: the element must survive mousedown for the click to land. */
async function realClick(w, el) {
  if (!el) return false
  const ev = (t) => new w.MouseEvent(t, { bubbles: true, cancelable: true, view: w, clientX: 120, clientY: 120, button: 0 })
  el.dispatchEvent(ev('mousedown'))
  await tick(30)
  if (!el.isConnected) return false
  el.dispatchEvent(ev('mouseup'))
  el.dispatchEvent(ev('click'))
  return true
}
const byText = (d, sel, re) => [...d.querySelectorAll(sel)].find((e) => re.test(e.textContent ?? ''))
/* Assert against RENDERED text inside #root only. The bundle is injected as an
 * inline <script> in <body>, so body.innerHTML also contains the bundle's own
 * source text — every string literal in the app — which matches anything. */
const rootText = (d) => d.getElementById('root')?.textContent ?? ''
const firstBootShown = (d) => rootText(d).includes('set up an account for you')
const loginGateShown = (d) => rootText(d).includes('Sign in to Mixt')

/* ------------------- 1. the administrator owns the desktop ----------------- */
console.log('• signing in as the administrator (Mixt_MPL)…')
const admin = await boot({ token: 'admin-token', role: 'admin', username: 'Mixt_MPL' })
const { w, d } = admin
if (firstBootShown(d)) bad('the administrator was still asked to create an account (first-boot form)')
else ok('no first-boot form — the server account is the account')

const panelText = d.querySelector('.panel')?.textContent ?? ''
if (!panelText.includes('Mixt_MPL')) bad(`the panel does not show the signed-in account (shows: ${panelText.slice(-60)})`)
else ok('the panel shows Mixt_MPL')

/* ------------------- 2. System Settings reports the role ------------------- */
console.log('• opening System Settings → Users…')
w.dispatchEvent(new w.CustomEvent('mixt:launch', { detail: { appId: 'settings', props: { page: 'users' } } }))
await tick(600)
let win = [...d.querySelectorAll('.wm-window')].pop()
if (win && !/Administrator/.test(win.textContent ?? '')) {
  const nav = byText(d, '.wm-window button, .wm-window .settings-nav *, .wm-window *', /^Users\s*&\s*Groups$/)
  if (nav) {
    await realClick(w, nav)
    await tick(500)
    win = [...d.querySelectorAll('.wm-window')].pop()
  }
}
const settingsText = win?.textContent ?? ''
if (!/Administrator/.test(settingsText)) bad(`System Settings does not report Administrator (found: ${settingsText.slice(0, 120)})`)
else if (/adm, sudo/.test(settingsText)) ok('System Settings → Users reports Administrator with privileged groups')
else ok('System Settings → Users reports Administrator')

/* ------------------------- 3. logging out works ---------------------------- */
console.log('• logging out from the panel session menu…')
const sessionItem = [...d.querySelectorAll('.panel-item')].find((e) => (e.getAttribute('title') ?? '').includes('@'))
if (!(await realClick(w, sessionItem))) bad('could not open the panel session menu')
else {
  await tick(250)
  const logoutItem = byText(d, '.menu-popup .menu-item', /^Log out/)
  if (!logoutItem) bad('the session menu has no "Log out…" entry')
  else {
    await realClick(w, logoutItem)
    await tick(400)
    const confirm = [...d.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Log out')
    if (!confirm) bad('clicking "Log out…" opened no dialog — the event is not handled')
    else {
      await realClick(w, confirm)
      await tick(1600)
      if (w.sessionStorage.getItem(SESSION_KEY) !== null) bad('the server session survived logging out')
      else ok('the server session was dropped')
      if (!loginGateShown(d)) bad('the login gate did not come back after logging out')
      else ok('the login gate is back, ready for the next sign-in')
      if (d.querySelectorAll('.wm-window').length !== 0) bad('windows were left open after logging out')
      else ok('open windows were closed')
    }
  }
}

/* --------------------------- 4. guests are let in -------------------------- */
console.log('• continuing as a guest…')
const guest = await boot({ token: 'guest-token', role: 'guest', username: 'guest' })
if (firstBootShown(guest.d)) bad('a guest was asked to create an account, which would save data for them')
else ok('a guest is let straight in with nothing saved')
if (!(guest.d.querySelector('.panel')?.textContent ?? '').includes('guest')) bad('the panel does not identify the guest session')
else ok('the panel identifies the guest session')

server.close()
console.log('')
if (failures.length) {
  console.log(`  \x1b[31m${failures.length} session failure(s)\x1b[0m`)
  for (const f of failures) console.log(`    • ${f}`)
  process.exit(1)
}
console.log('  \x1b[32m✓\x1b[0m the administrator signs in, is reported correctly, and can log out again')
process.exit(0)
