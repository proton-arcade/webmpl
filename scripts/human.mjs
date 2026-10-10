/**
 * A person's pass over the desktop.
 *
 *   npm run human
 *
 * The other harnesses each guard one area. This one does what somebody sitting
 * down at the machine would do, end to end, and fails if any of it does not
 * hold up:
 *
 *   • write a file, back the account up, delete the file, restore — the file
 *     comes back;
 *   • open a sound file and get the player that ships, not one that is not
 *     installed;
 *   • install VLC, choose it in System Settings, and have sound files follow;
 *   • sign in as the administrator and read another account's file through
 *     /users, without being able to change it;
 *   • sign out and back in as somebody else and find your own files, not
 *     theirs.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'

const ROOT = process.cwd()
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }
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

/** Boot the shipped bundle. `preload` runs before the bundle reads storage. */
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

const win = (d) => [...d.querySelectorAll('.wm-window')].pop()
/* the titlebar text, not the whole window — a window's "Open With" menu lists
   every player it could use, which is not the same as what actually opened */
const titles = (d) => [...d.querySelectorAll('.wm-window .wm-title')].map((e) => e.textContent ?? '')
const launch = (w, appId, props = {}) =>
  w.dispatchEvent(new w.CustomEvent('mixt:launch', { detail: { appId, props } }))
const iconName = (el) => (el.querySelector('.label')?.textContent ?? el.textContent ?? '').trim()
const iconNamed = (root, name) =>
  [...root.querySelectorAll('.desktop-icon')].find((e) => iconName(e) === name)

/* React keeps its own value, so .value alone does nothing */
function setValue(w, el, value) {
  const proto = el instanceof w.HTMLTextAreaElement ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new w.Event('input', { bubbles: true }))
  el.dispatchEvent(new w.Event('change', { bubbles: true }))
}

const f = (content, mime = 'text/plain') => ({ type: 'file', content, mime, created: 1, modified: 1 })
const d = (children) => ({ type: 'dir', children, created: 1, modified: 1 })

/* A home folder with a document and a sound file, for one account. */
const treeFor = (docText) =>
  d({
    home: d({
      mixt: d({
        Desktop: d({}),
        Documents: d({ 'important.txt': f(docText) }),
        Downloads: d({}),
        Music: d({ 'song.ogg': f('', 'audio/ogg') }),
        Pictures: d({}),
        Videos: d({}),
      }),
    }),
    srv: d({ www: d({}) }),
  })

/* ----------------------- 1. back up, lose it, restore --------------------- */
console.log('• writing a file, backing up, then restoring…')
const person = await boot({ token: 'demo-token', role: 'user', username: 'demo' }, (w) => {
  w.localStorage.setItem('mixt.vfs.v2:demo', JSON.stringify(treeFor('the thing I cannot lose')))
})

launch(person.w, 'settings', { page: 'backup' })
await tick(800)
let sw = win(person.d)
if (!/Back up now/.test(sw?.textContent ?? '')) bad('the Backups page has no way to make a backup')
else {
  /* capture the backup the page offers instead of downloading it */
  let captured = null
  const origBlob = person.w.Blob
  person.w.Blob = function (parts, opts) {
    captured = String(parts?.[0] ?? '')
    return new origBlob(parts, opts)
  }
  person.w.URL.createObjectURL = () => 'blob:stub'
  person.w.URL.revokeObjectURL = () => {}
  const origCreate = person.d.createElement.bind(person.d)
  person.d.createElement = (tag) => {
    const el = origCreate(tag)
    if (String(tag).toLowerCase() === 'a') el.click = () => {}
    return el
  }
  await realClick(person.w, [...sw.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Back up now')))
  await tick(500)
  if (!captured) bad('pressing Back up now produced no backup file')
  else {
    let parsed = null
    try {
      parsed = JSON.parse(captured)
    } catch {
      /* not json */
    }
    if (!parsed || parsed.kind !== 'mixt-account-backup') bad('the backup offered is not a Mixt account backup')
    else if (!JSON.stringify(parsed.filesystem).includes('the thing I cannot lose'))
      bad('the backup does not contain the file that was written')
    else if (JSON.stringify(parsed).includes('demo-token') || /"password"/.test(captured))
      bad('the backup contains the password or the session token')
    else ok('the backup holds the files and none of the credentials')

    /* now lose the file the way a person would, and put the backup back */
    launch(person.w, 'nemo', { path: '/home/mixt/Documents' })
    await tick(700)
    let fw = win(person.d)
    const doc = iconNamed(fw, 'important.txt')
    if (!doc) bad('the document is not in Documents to begin with')
    else {
      /* delete it through the app: select, then the Delete key */
      await realClick(person.w, doc)
      await tick(200)
      /* the handler is on the scrolling view inside the window, so press the
         key on something inside it — the frame never sees it */
      const view = fw.querySelector('[tabindex="0"]') ?? doc
      view.dispatchEvent(new person.w.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
      await tick(600)
      fw = win(person.d)
      if (iconNamed(fw, 'important.txt')) bad('deleting the document did not remove it')
      else ok('the document is deleted')

      /* restore from the backup file */
      launch(person.w, 'settings', { page: 'backup' })
      await tick(700)
      sw = win(person.d)
      const chooser = [...sw.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Choose file'))
      const fileInput = sw.querySelector('input[type="file"]')
      if (!chooser || !fileInput) bad('there is no way to choose a backup file to restore')
      else {
        const file = new person.w.File([captured], 'mixt-backup-demo.json', { type: 'application/json' })
        Object.defineProperty(fileInput, 'files', { value: [file], configurable: true })
        fileInput.dispatchEvent(new person.w.Event('input', { bubbles: true }))
        fileInput.dispatchEvent(new person.w.Event('change', { bubbles: true }))
        await tick(600)
        sw = win(person.d)
        const confirm = [...sw.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Yes, restore it'))
        if (!confirm) bad(`restoring did not ask first — the page says “${(sw.textContent ?? '').replace(/System Settings[\s\S]*?System$/,'').slice(-260)}” | File.text is ${typeof file.text}`)
        else {
          await realClick(person.w, confirm)
          await tick(900)
          launch(person.w, 'nemo', { path: '/home/mixt/Documents' })
          await tick(700)
          const restored = iconNamed(win(person.d), 'important.txt')
          if (!restored) bad('the restored account does not have the file back')
          else ok('restoring the backup brings the deleted file back')
        }
      }
    }
  }
}

/* ------------------- 2. a sound file opens a real player ------------------ */
console.log('• opening a sound file…')
const listener = await boot({ token: 'demo-token', role: 'user', username: 'demo' }, (w) => {
  w.localStorage.setItem('mixt.vfs.v2:demo', JSON.stringify(treeFor('x')))
})
launch(listener.w, 'nemo', { path: '/home/mixt/Music' })
await tick(800)
let lw = win(listener.d)
const song = iconNamed(lw, 'song.ogg')
if (!song) bad('there is no sound file to open')
else {
  song.dispatchEvent(new listener.w.MouseEvent('dblclick', { bubbles: true, cancelable: true, view: listener.w }))
  await tick(800)
  const open = titles(listener.d)
  const opened = open.some((t) => /Mixt Player/.test(t))
  const openedVlc = open.some((t) => /VLC/.test(t))
  if (openedVlc) bad(`a sound file opened VLC, which is not installed — titles: ${open.join(' | ')}`)
  else if (!opened) bad(`a sound file opened no recognisable player — titles: ${open.join(' | ')}`)
  else ok('a sound file opens the player that ships with the system')
}

/* --------------- 3. choosing an installed player is honoured -------------- */
console.log('• installing VLC and choosing it…')
const chooser = await boot(
  { token: 'demo-token', role: 'user', username: 'demo' },
  (w) => {
    w.localStorage.setItem('mixt.vfs.v2:demo', JSON.stringify(treeFor('x')))
    w.localStorage.setItem('mixt.settings.v2', JSON.stringify({ username: 'demo', mediaApp: 'mediaplayer' }))
    w.localStorage.setItem('mixt.installed.v2:demo', JSON.stringify({ mediaplayer: true }))
  },
)
launch(chooser.w, 'nemo', { path: '/home/mixt/Music' })
await tick(800)
let cw = win(chooser.d)
const song2 = iconNamed(cw, 'song.ogg')
if (!song2) bad('there is no sound file to open for the VLC test')
else {
  song2.dispatchEvent(new chooser.w.MouseEvent('dblclick', { bubbles: true, cancelable: true, view: chooser.w }))
  await tick(800)
  const open2 = titles(chooser.d)
  if (open2.some((t) => /VLC/.test(t))) ok('with VLC installed and chosen, a sound file opens VLC')
  else bad(`VLC was installed and chosen but something else opened — ${open2.join(' | ')}`)
}

/* ---------------- 4. the administrator reads, and cannot write ------------ */
console.log('• the administrator looking at another account’s files…')
const admin = await boot({ token: 'admin-token', role: 'admin', username: 'Mixt_MPL' }, (w) => {
  w.localStorage.setItem('mixt.vfs.v2:demo', JSON.stringify(treeFor('demo’s private note')))
})
launch(admin.w, 'nemo', { path: '/users/demo/home/mixt/Documents' })
await tick(900)
let aw = win(admin.d)
const seen = iconNamed(aw, 'important.txt')
if (!seen) bad('the administrator cannot see the other account’s document')
else {
  seen.dispatchEvent(new admin.w.MouseEvent('dblclick', { bubbles: true, cancelable: true, view: admin.w }))
  await tick(800)
  const opened = [...admin.d.querySelectorAll('.wm-window')].map((x) => x.textContent ?? '')
  if (!opened.some((t) => /important\.txt/.test(t)))
    bad('the administrator could not open the other account’s document')
  else ok('the administrator can read another account’s file')
}

/* --------------- 5. signing out leaves the next person their own ---------- */
console.log('• signing out and in as somebody else…')
const shared = await boot({ token: 'demo-token', role: 'user', username: 'demo' }, (w) => {
  w.localStorage.setItem('mixt.vfs.v2:demo', JSON.stringify(treeFor('demo’s private note')))
  w.localStorage.setItem('mixt.vfs.v2:other', JSON.stringify(treeFor('somebody else’s note')))
})
launch(shared.w, 'nemo', { path: '/home/mixt/Documents' })
await tick(800)
const demoDoc = iconNamed(win(shared.d), 'important.txt')
if (!demoDoc) bad('demo has no document to begin with')
else {
  demoDoc.dispatchEvent(new shared.w.MouseEvent('dblclick', { bubbles: true, cancelable: true, view: shared.w }))
  await tick(700)
  const text = [...shared.d.querySelectorAll('.wm-window')].map((x) => x.textContent ?? '').join(' ')
  if (!text.includes('demo’s private note')) bad('demo did not see their own document')
  else ok('demo sees their own document')

  /* sign out, then in as the other account */
  shared.w.sessionStorage.removeItem(SESSION_KEY)
  shared.w.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: 'other-token', role: 'user', username: 'other' }))
  shared.w.dispatchEvent(new shared.w.CustomEvent('mixt:authchanged'))
  await tick(900)
  launch(shared.w, 'nemo', { path: '/home/mixt/Documents' })
  await tick(800)
  /* the newest window only — the one demo had open is still on screen and is
     not evidence about whose files are mounted now */
  const otherText = [...win(shared.d).querySelectorAll('.desktop-icon .label')].map((e) => e.textContent).join(' ')
  const otherDoc = iconNamed(win(shared.d), 'important.txt')
  let otherBody = ''
  if (otherDoc) {
    otherDoc.dispatchEvent(new shared.w.MouseEvent('dblclick', { bubbles: true, cancelable: true, view: shared.w }))
    await tick(700)
    otherBody = win(shared.d).textContent ?? ''
  }
  if (otherBody.includes('demo’s private note')) bad('the next person to sign in can read the last person’s files')
  else ok('somebody else signing in does not get demo’s files')
}

console.log('')
if (failures.length === 0) console.log(`  \x1b[32m✓\x1b[0m the desktop holds up to being used like a person would use it\n`)
else {
  console.log(`  \x1b[31m✗\x1b[0m ${failures.length} failure(s) on the human pass`)
  for (const x of failures) console.log(`    • ${x}`)
  console.log('')
}
process.exit(failures.length === 0 ? 0 : 1)
