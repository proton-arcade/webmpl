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
    if (p === '/api/apps') return send(200, req.method === 'POST' ? { ok: true } : [{ id: 'app-1', name: 'Test App', author: 'demo', status: 'pending' }])
    if (p === '/api/apps/app-1/approve' || p === '/api/apps/app-1/reject') return send(200, { ok: true })
    if (p === '/api/users' && req.method === 'GET') return send(200, [{ username: 'Mixt_MPL', role: 'admin' }, { username: 'demo', role: 'user' }])
    if (p === '/api/users' && req.method === 'POST') return send(200, { ok: true })
    if (p === '/api/stats') return send(200, { ok: true, users: 2, admins: 1, sessions: 3, appsPending: 1, appsApproved: 0, mailboxes: 0, savedSettings: 1 })
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

/* React keeps its own value, so assigning .value alone does nothing: go through
   the native setter and fire the input event the way a keyboard would. */
function typeInto(w, input, text) {
  const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set
  setter.call(input, text)
  input.dispatchEvent(new w.Event('input', { bubbles: true }))
}
function pressEnter(w, el) {
  el.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
}
/* .menu-item is used for categories, places and apps alike — scope to the app
   grid (the auto-fill container) or the 176px category column. */
const appNames = (d) => [...d.querySelectorAll('[style*="auto-fill"] > .menu-item')].map((e) => (e.textContent ?? '').trim())
const categoryNames = (d) => [...d.querySelectorAll('[style*="176px"] .menu-item')].map((e) => (e.textContent ?? '').trim())
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

/* ------------- 5. the administrator console is admin-only ----------------- */
console.log('• the Administration console…')
const adm = await boot({ token: 'admin-token', role: 'admin', username: 'Mixt_MPL' })
adm.w.dispatchEvent(new adm.w.CustomEvent('mixt:launch', { detail: { appId: 'administration', props: {} } }))
await tick(600)
const consoleWin = [...adm.d.querySelectorAll('.wm-window')].pop()
const consoleText = consoleWin?.textContent ?? ''
if (!consoleText.includes('Administration') || !consoleText.includes('Waiting for approval')) bad('the console did not open on the published-apps tab')
else if (!consoleText.includes('Test App')) bad('the console does not list the app waiting for approval')
else ok('the console opens with the app waiting for approval')
if (/Administrator access only/.test(consoleText)) bad('the administrator was told the console is admin-only')

/* each tab carries its own part of the job */
for (const [tabName, wants] of [['Accounts', ['Whitelisted accounts', 'Mixt_MPL', 'demo', 'Add an account']], ['Server', ['What the server is holding', 'Administrators', 'ROOTPASS.md']]]) {
  const tabBtn = [...consoleWin.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim().startsWith(tabName))
  if (!tabBtn) bad(`the console has no “${tabName}” tab`)
  else {
    await realClick(adm.w, tabBtn)
    await tick(400)
    const text = consoleWin.textContent ?? ''
    const missing = wants.filter((w) => !text.includes(w))
    if (missing.length) bad(`the ${tabName} tab is missing ${missing.join(', ')}`)
    else ok(`the ${tabName} tab holds ${wants.length} of its parts`)
  }
}

console.log('• what the Administration category holds…')
await realClick(adm.w, adm.d.querySelector('.menu-button'))
await tick(300)
const adminCat = byText(adm.d, '.menu-item', /^Administration$/)
if (!adminCat) bad('the menu has no Administration category')
else {
  await realClick(adm.w, adminCat)
  await tick(300)
  const inCat = appNames(adm.d)
  if (!inCat.includes('Administration')) bad('the Administration app is not in its own category')
  else if (inCat.length < 3) bad(`the Administration category is still nearly empty: ${inCat.join(', ')}`)
  else ok(`the Administration category holds ${inCat.length}: ${inCat.join(', ')}`)
  if (!categoryNames(adm.d).includes('Administration')) bad('the menu lost the Administration category')
}

console.log('• a standard user must not see it…')
const demo = await boot({ token: 'demo-token', role: 'user', username: 'demo' })
await realClick(demo.w, demo.d.querySelector('.menu-button'))
await tick(300)
const demoApps = appNames(demo.d)
if (demoApps.includes('Administration')) bad('a standard user can see the Administration console in the menu')
else ok('a standard user does not see the Administration console')
demo.w.dispatchEvent(new demo.w.CustomEvent('mixt:launch', { detail: { appId: 'administration', props: {} } }))
await tick(600)
const forced = [...demo.d.querySelectorAll('.wm-window')].pop()?.textContent ?? ''
if (!/Administrator access only/.test(forced)) bad('a standard user who launches it anyway gets in')
else ok('launching it anyway is refused, not opened')

/* ------------- 6. signing back in after a sign-out ------------------------ */
console.log('• typing a password after signing out…')
const back = await boot({ token: 'admin-token', role: 'admin', username: 'Mixt_MPL' })
back.w.dispatchEvent(new back.w.CustomEvent('mixt:session', { detail: 'logout' }))
await tick(400)
await realClick(back.w, [...back.d.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Log out'))
await tick(1500)
if (!loginGateShown(back.d)) bad('the sign-in screen did not come back')
else {
  const boxes = [...back.d.querySelectorAll('#root input')]
  const pass = boxes.find((i) => i.type === 'password')
  if (!pass) bad('the sign-in screen has no password box to type into')
  else {
    pass.focus()
    typeInto(back.w, boxes[0], 'Mixt_MPL')
    typeInto(back.w, pass, 'mixt-root')
    await tick(120)
    if (pass.value !== 'mixt-root') bad('typing into the password box did not stick')
    else {
      pressEnter(back.w, pass)
      await tick(1200)
      if (loginGateShown(back.d)) bad('signing back in with the right password did not work')
      else if (!(back.d.querySelector('.panel')?.textContent ?? '').includes('Mixt_MPL')) bad('signed back in but the session is not the administrator')
      else ok('signed back in as the administrator from the sign-in screen')
    }
  }
}

/* ------------- 7. empty boxes go straight in as a guest ------------------- */
console.log('• leaving the boxes empty…')
const anon = await boot(null)
await tick(400)
if (!loginGateShown(anon.d)) bad('no sign-in screen appeared for a fresh visitor')
else {
  const go = [...anon.d.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Log in')
  if (!(await realClick(anon.w, go))) bad('could not press Log in with empty boxes')
  else {
    await tick(1200)
    if (loginGateShown(anon.d)) bad('empty boxes did not go in as a guest')
    else {
      const stored = JSON.parse(anon.w.sessionStorage.getItem(SESSION_KEY) ?? 'null')
      if (!stored || stored.role !== 'guest') bad(`the empty sign-in did not create a guest session (got ${JSON.stringify(stored)})`)
      else ok('empty username and password go straight in as a guest')
    }
  }
}

server.close()
console.log('')
if (failures.length) {
  console.log(`  \x1b[31m${failures.length} session failure(s)\x1b[0m`)
  for (const f of failures) console.log(`    • ${f}`)
  process.exit(1)
}
console.log('  \x1b[32m✓\x1b[0m the administrator signs in, is reported correctly, and can log out again')
process.exit(0)
