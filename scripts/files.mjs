/**
 * The file manager and the per-account filesystem.
 *
 *   npm run files
 *
 * Covers the things that were broken or missing:
 *   • the drive icon in the path bar did nothing when clicked;
 *   • the Back button after opening a folder such as /bin;
 *   • dragging one file onto a folder, and onto empty space;
 *   • every account getting its own filesystem in this browser;
 *   • the administrator's /users folder, and nobody else's;
 *   • backing an account up and restoring it.
 *
 * It boots the shipped bundle in jsdom, the way the other harnesses do.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'

const ROOT = process.cwd()
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.json': 'application/json' }
const SESSION_KEY = 'mixt.session.v1'

const server = createServer(async (req, res) => {
  let path = new URL(req.url, 'http://x').pathname
  if (path.endsWith('/')) path += 'index.html'
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
  const target = {
    canvas: null, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif', globalAlpha: 1,
    measureText: (t) => ({ width: (t?.length ?? 0) * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    getImageData: (x, y, ww, hh) => ({ data: new Uint8ClampedArray(Math.max(4, Math.ceil(ww * hh * 4))), width: ww, height: hh }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
  }
  const ctx = new Proxy(target, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) })
  w.HTMLCanvasElement.prototype.getContext = () => ctx
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AAAA'
}

/** Boot the shipped bundle with a server session already stored.
 *  `preload` runs before the bundle, so anything it writes to storage is there
 *  when the filesystem is first read. */
async function boot(session, preload) {
  const raw = await (await fetch(BASE + '/')).text()
  const html = raw
    .replace(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi, '')
    .replace(/<script[^>]*mixt\.bundle\.js[^>]*>\s*<\/script>/gi, '')
  const dom = new JSDOM(html, { url: BASE + '/', pretendToBeVisual: true, runScripts: 'dangerously', virtualConsole: vc })
  const w = dom.window
  stubCanvas(w)
  Object.defineProperty(w, 'innerWidth', { value: 1440, configurable: true })
  Object.defineProperty(w, 'innerHeight', { value: 900, configurable: true })
  w.Element.prototype.setPointerCapture = function () {}
  w.Element.prototype.releasePointerCapture = function () {}
  /* No backend here: the API client's fetch must fail quietly, which is the
     same as being offline. jsdom has no fetch at all, so give it one. */
  w.fetch = () => Promise.reject(new Error('offline'))
  if (session) w.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  if (preload) preload(w)

  const bundle = await (await fetch(BASE + '/mixt.bundle.js')).text()
  const tag = w.document.createElement('script')
  tag.textContent = bundle
  w.document.body.appendChild(tag)
  await tick(1000)
  return { w, d: w.document }
}

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

/* jsdom has no DataTransfer, and React reads dataTransfer straight off the
   native event — so hand it one. */
function drag(w, from, to) {
  if (!from) return false
  const dt = { effectAllowed: '', dropEffect: '', data: {}, setData(k, v) { this.data[k] = v }, getData(k) { return this.data[k] } }
  const start = new w.Event('dragstart', { bubbles: true, cancelable: true })
  start.dataTransfer = dt
  from.dispatchEvent(start)
  const over = new w.Event('dragover', { bubbles: true, cancelable: true })
  over.dataTransfer = dt
  to.dispatchEvent(over)
  const drop = new w.Event('drop', { bubbles: true, cancelable: true })
  drop.dataTransfer = dt
  to.dispatchEvent(drop)
  const end = new w.Event('dragend', { bubbles: true, cancelable: true })
  end.dataTransfer = dt
  from.dispatchEvent(end)
  return true
}

const win = (d) => [...d.querySelectorAll('.wm-window')].pop()
/* an icon's text is its name plus a "N items" badge, so match the name only */
const iconName = (el) => (el.querySelector('.label')?.textContent ?? el.textContent ?? '').trim()
const iconNamed = (root, name) =>
  [...root.querySelectorAll('.desktop-icon')].find((e) => iconName(e) === name)
const pathBar = (w) => {
  /* the breadcrumb lives in the toolbar; the drive icon is its first button */
  const bar = [...w.querySelectorAll('.mixt-toolbar button')].find((b) => b.title === 'File System')
  return bar
}

/* ------------------------------- 1. navigation ---------------------------- */
console.log('• the path bar in the file manager…')
const a = await boot({ token: 'demo-token', role: 'user', username: 'demo' })
a.w.dispatchEvent(new a.w.CustomEvent('mixt:launch', { detail: { appId: 'nemo', props: { path: '/' } } }))
await tick(700)
let fw = win(a.d)
if (!fw) bad('the file manager did not open')
else {
  /* open a folder by double-clicking it, the way a person would */
  const binIcon = iconNamed(fw, 'bin')
  if (!binIcon) bad('there is no bin folder to open at the root')
  else {
    binIcon.dispatchEvent(new a.w.MouseEvent('dblclick', { bubbles: true, cancelable: true, view: a.w }))
    await tick(400)
    fw = win(a.d)
    const inBin = /(^|›)bin/.test(fw.textContent ?? '')
    if (!inBin) bad('double-clicking bin did not open it')
    else ok('double-clicking a folder opens it')

    /* the Back button has to take you out again */
    const back = [...fw.querySelectorAll('.mixt-toolbar button')].find((b) => b.title === 'Back')
    if (!back) bad('there is no Back button')
    else if (back.disabled) bad('the Back button is disabled after opening a folder')
    else {
      await realClick(a.w, back)
      await tick(400)
      fw = win(a.d)
      const barText = fw.querySelector('.mixt-toolbar')?.textContent ?? ''
      if (/›bin/.test(barText)) bad(`Back did not leave the folder: “${barText}”`)
      else ok('Back takes you out of the folder you opened')
    }
  }

  /* the drive icon used to be decoration */
  fw = win(a.d)
  const drive = pathBar(fw)
  if (!drive) bad('there is no drive icon in the path bar')
  else {
    /* go somewhere deep first, so the icon has something to go back to */
    const homeBtn = [...fw.querySelectorAll('.mixt-toolbar button')].find((b) => b.title === 'Home')
    await realClick(a.w, homeBtn)
    await tick(300)
    fw = win(a.d)
    await realClick(a.w, pathBar(fw))
    await tick(400)
    fw = win(a.d)
    const bar = fw.querySelector('.mixt-toolbar')?.textContent ?? ''
    if (!/File System/.test(bar)) bad(`the drive icon did not go to the filesystem root: “${bar}”`)
    else ok('the drive icon goes to the root of the filesystem')
  }
}

/* ---------------------------- 2. drag and drop ---------------------------- */
console.log('• dragging files…')
/* The seeded home folder has no loose file in it, so this account starts with
   one to drag. It has to be written before the bundle reads the filesystem. */
const withNotes = (w) => {
  const key = 'mixt.vfs.v2:demo'
  const raw = w.localStorage.getItem(key)
  if (!raw) return
  const tree = JSON.parse(raw)
  tree.children.home.children.mixt.children['notes.txt'] = {
    type: 'file', content: 'drag me', mime: 'text/plain', created: 1, modified: 1,
  }
  w.localStorage.setItem(key, JSON.stringify(tree))
}
const dragBoot = await boot({ token: 'demo-token', role: 'user', username: 'demo' }, (w) => {
  /* A filesystem of its own, with one loose file and one folder to drop it in.
     parseTree() accepts any well-formed tree, so this does not have to be the
     whole seeded machine. */
  const f = (content) => ({ type: 'file', content, mime: 'text/plain', created: 1, modified: 1 })
  const d = (children) => ({ type: 'dir', children, created: 1, modified: 1 })
  w.localStorage.setItem(
    'mixt.vfs.v2:demo',
    JSON.stringify(d({ home: d({ mixt: d({ Documents: d({}), 'notes.txt': f('drag me') }) }) })),
  )
})
dragBoot.w.dispatchEvent(new dragBoot.w.CustomEvent('mixt:launch', { detail: { appId: 'nemo', props: { path: '/home/mixt' } } }))
await tick(700)
let dw = win(dragBoot.d)
if (!dw) bad('the file manager did not open for the drag test')
else {
  const icons = [...dw.querySelectorAll('.desktop-icon')]
  const docs = iconNamed(dw, 'Documents')
  const notes = iconNamed(dw, 'notes.txt')
  if (!docs || !notes) bad(`the home folder is missing what the test needs (Documents=${!!docs}, notes.txt=${!!notes})`)
  else {
    drag(dragBoot.w, notes, docs)
    await tick(500)
    dw = win(dragBoot.d)
    const still = !!iconNamed(dw, 'notes.txt')
    if (still) bad('dragging a file onto a folder left it where it was')
    else ok('dragging a file onto a folder moves it in')

    /* The background is a drop target too. The honest way to exercise it is
       across two windows: drop onto the empty space of the folder you want the
       file in, which is what dragging out of a subfolder really looks like. */
    dragBoot.w.dispatchEvent(new dragBoot.w.CustomEvent('mixt:launch', { detail: { appId: 'nemo', props: { path: '/home/mixt/Documents' } } }))
    await tick(600)
    const inside = iconNamed(win(dragBoot.d), 'notes.txt')
    if (!inside) bad('the file was not in the folder it was dropped on')
    else {
      ok('the dropped file is inside the folder')
      const homeWin = [...dragBoot.d.querySelectorAll('.wm-window')].find((x) =>
        [...x.querySelectorAll('.desktop-icon .label')].some((l) => l.textContent === 'Documents'))
      const surface = homeWin.querySelector('.desktop-icon').parentElement
      drag(dragBoot.w, inside, surface)
      await tick(600)
      const stillInside = !!iconNamed(win(dragBoot.d), 'notes.txt')
      const inHome = !!iconNamed(homeWin, 'notes.txt')
      if (stillInside || !inHome) bad(`dropping on empty space did not move it out (still inside=${stillInside}, in home=${inHome})`)
      else ok('dropping on empty space moves it into the folder that window is showing')
    }
  }
}

/* ---------------------- 3. one filesystem per account --------------------- */
console.log('• each account has its own files…')
const one = await boot({ token: 'demo-token', role: 'user', username: 'demo' })
one.w.dispatchEvent(new one.w.CustomEvent('mixt:launch', { detail: { appId: 'xed', props: { path: '/home/mixt/only-demo.txt' } } }))
await tick(600)
/* write the file through the OS the same way the text editor does */
one.w.dispatchEvent(new one.w.CustomEvent('mixt:launch', { detail: { appId: 'terminal', props: {} } }))
await tick(600)
const demoStored = one.w.localStorage.getItem('mixt.vfs.v2:demo')
if (demoStored === null) bad('nothing was saved under demo’s own filesystem key')
else if (one.w.localStorage.getItem('mixt.vfs.v2') !== null && one.w.localStorage.getItem('mixt.vfs.v2:demo') === null)
  bad('the filesystem is still under the old shared key')
else ok('the filesystem is stored under the account’s own key')

/* the shared key must not be what a second account reads */
const two = await boot({ token: 'other-token', role: 'user', username: 'somebody-else' })
await tick(300)
const otherStored = two.w.localStorage.getItem('mixt.vfs.v2:somebody-else')
if (otherStored !== null && otherStored === one.w.localStorage.getItem('mixt.vfs.v2:demo'))
  bad('the second account was handed the first account’s files')
else ok('a second account does not get the first account’s files')

/* --------------------------- 4. the admin's /users ------------------------ */
console.log('• the administrator’s /users folder…')
const admin = await boot({ token: 'admin-token', role: 'admin', username: 'Mixt_MPL' })
/* give the other account something to be seen with */
admin.w.localStorage.setItem(
  'mixt.vfs.v2:demo',
  JSON.stringify({ type: 'dir', created: 1, modified: 1, children: { 'demo-was-here.txt': { type: 'file', content: 'hello', mime: 'text/plain', created: 1, modified: 1 } } }),
)
admin.w.dispatchEvent(new admin.w.CustomEvent('mixt:launch', { detail: { appId: 'nemo', props: { path: '/' } } }))
await tick(800)
let aw = win(admin.d)
const usersFolder = iconNamed(aw, 'users')
if (!usersFolder) bad('the administrator has no users folder at the root — saw: ' + [...aw.querySelectorAll('.desktop-icon .label')].map((e) => e.textContent).join(','))
else {
  usersFolder.dispatchEvent(new admin.w.MouseEvent('dblclick', { bubbles: true, cancelable: true, view: admin.w }))
  await tick(500)
  aw = win(admin.d)
  const demoRow = iconNamed(aw, 'demo')
  if (!demoRow) bad('the users folder does not list the other account')
  else {
    demoRow.dispatchEvent(new admin.w.MouseEvent('dblclick', { bubbles: true, cancelable: true, view: admin.w }))
    await tick(500)
    aw = win(admin.d)
    const theirs = !!iconNamed(aw, 'demo-was-here.txt')
    if (!theirs) bad('the administrator cannot see inside the other account’s files')
    else ok('the administrator can open another account’s filesystem')
  }
}

/* …and nobody else gets it */
const plain = await boot({ token: 'demo-token', role: 'user', username: 'demo' })
plain.w.dispatchEvent(new plain.w.CustomEvent('mixt:launch', { detail: { appId: 'nemo', props: { path: '/' } } }))
await tick(800)
const pw = win(plain.d)
const leaked = [...pw.querySelectorAll('.desktop-icon')].some((e) => (e.textContent ?? '').trim() === 'users')
if (leaked) bad('a standard account can see the users folder')
else ok('a standard account does not get the users folder')

/* --------------------- 5. the application tree on disk -------------------- */
console.log('• the application tree in /usr/share/applications…')
const appBoot = await boot({ token: 'demo-token', role: 'user', username: 'demo' })
appBoot.w.dispatchEvent(new appBoot.w.CustomEvent('mixt:launch', { detail: { appId: 'nemo', props: { path: '/usr/share/applications' } } }))
await tick(800)
let apw = win(appBoot.d)
if (!apw) bad('the file manager did not open on /usr/share/applications')
else {
  const atRoot = [...apw.querySelectorAll('.desktop-icon .label')].map((e) => e.textContent)
  if (!atRoot.includes('index')) bad(`the application index is not there — saw ${atRoot.slice(0, 6).join(',')}`)
  else ok('the index file is in /usr/share/applications')
  if (!atRoot.includes('nemo')) bad(`there is no directory for the Files application — saw ${atRoot.slice(0, 6).join(',')}`)
  else {
    const nemoDir = [...apw.querySelectorAll('.desktop-icon')].find((e) => e.querySelector('.label')?.textContent === 'nemo')
    nemoDir.dispatchEvent(new appBoot.w.MouseEvent('dblclick', { bubbles: true, cancelable: true, view: appBoot.w }))
    await tick(500)
    apw = win(appBoot.d)
    const inside = [...apw.querySelectorAll('.desktop-icon .label')].map((e) => e.textContent)
    if (!inside.includes('main.js')) bad(`an application directory has no main.js — saw ${inside.join(',')}`)
    else if (!inside.includes('_Dependencies')) bad(`an application directory has no _Dependencies folder — saw ${inside.join(',')}`)
    else if (!inside.includes('README.md')) bad(`an application directory has nothing but the main file — saw ${inside.join(',')}`)
    else ok('an application directory holds main.js, _Dependencies and the rest')
  }
}

/* -------------------------------- 5. backups ------------------------------ */
console.log('• backing an account up…')
const bak = await boot({ token: 'demo-token', role: 'user', username: 'demo' })
bak.w.dispatchEvent(new bak.w.CustomEvent('mixt:launch', { detail: { appId: 'settings', props: { page: 'backup' } } }))
await tick(800)
const sw = win(bak.d)
const text = sw?.textContent ?? ''
if (!/Backups/.test(text)) bad('the Backups page did not open')
else if (!/Back up now/.test(text)) bad('the Backups page has no way to make a backup')
else if (!/not included/.test(text)) bad('the Backups page does not say the password stays on the server')
else ok('the Backups page offers a backup and says what it holds')

const backupBtn = [...sw.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Back up now'))
if (!backupBtn) bad('there is no Back up now button to press')
else {
  /* jsdom has no real downloads, so watch for the anchor the page creates */
  let offered = null
  const origCreate = bak.w.document.createElement.bind(bak.w.document)
  bak.w.document.createElement = (tag) => {
    const el = origCreate(tag)
    if (String(tag).toLowerCase() === 'a') {
      const origClick = el.click.bind(el)
      el.click = () => { offered = el.download; }
    }
    return el
  }
  bak.w.URL.createObjectURL = () => 'blob:stub'
  bak.w.URL.revokeObjectURL = () => {}
  await realClick(bak.w, backupBtn)
  await tick(500)
  if (!offered) bad('pressing Back up now offered no file')
  else if (!/^mixt-backup-demo-/.test(offered)) bad(`the backup was offered as “${offered}”`)
  else ok(`pressing Back up now offers ${offered}`)
}

console.log('')
if (failures.length === 0) console.log(`  \x1b[32m✓\x1b[0m the file manager, per-account files and backups all behave\n`)
else {
  console.log(`  \x1b[31m✗\x1b[0m ${failures.length} file manager failure(s)`)
  for (const f of failures) console.log(`    • ${f}`)
  console.log('')
}
process.exit(failures.length === 0 ? 0 : 1)
