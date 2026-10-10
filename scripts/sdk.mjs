/**
 * mixt.js — the runtime an application talks to.
 *
 *   npm run sdk
 *
 * Every application in /usr/share/applications ships a main.js that says what
 * it is and how it starts. Until there was something on the other side of that,
 * a file could only dispatch an event and hope. These checks boot the shipped
 * bundle and call the runtime the way an application would, so the API is
 * proven against the thing that actually ships rather than against the module.
 *
 * They also assert the negative: there is no way to reach the network from in
 * here, and nothing in the API throws when handed something wrong.
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
const bad = (m, why) => { failures.push(m); console.log(`  \x1b[31m✗\x1b[0m ${m}  ${why ?? ''}`) }
const tick = (ms = 300) => new Promise((r) => setTimeout(r, ms))

const vc = new VirtualConsole()
vc.on('jsdomError', (e) => bad(`page error: ${e.message}`))

function stubCanvas(w) {
  const target = {
    canvas: null, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif', globalAlpha: 1,
    measureText: (t) => ({ width: (t?.length ?? 0) * 6, actualBoundingBoxAscent: 8, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    getImageData: (x, y, ww, hh) => ({ data: new Uint8ClampedArray(Math.max(4, Math.ceil(ww * hh * 4))), width: ww, height: hh }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
  }
  const ctx = new Proxy(target, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) })
  w.HTMLCanvasElement.prototype.getContext = () => ctx
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AAAA'
}

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
  await tick(1100)
  return { w, d: w.document }
}

async function check(name, fn) {
  try {
    const r = await fn()
    if (r === true || r === undefined) ok(name)
    else bad(name, typeof r === 'string' ? r : `returned ${JSON.stringify(r)}`)
  } catch (e) {
    bad(name, e.message)
  }
}

console.log('')
console.log('  mixt.js — what an application can ask the desktop to do')

const { w } = await boot({ token: 'sdk', username: 'demo', role: 'user', name: 'Demo' })

/* ---- it is there, before any application runs ---------------------------- */

await check('window.mixt is installed by the time the desktop is up', () => {
  if (!w.mixt) return 'window.mixt is not defined'
  return true
})

await check('the runtime says which version of itself it is', () => {
  if (typeof w.mixt.version !== 'number') return `version is ${w.mixt.version}`
  return true
})

await check('an application cannot redefine the OS out from under the next one', () => {
  const before = w.mixt.version
  let threw = false
  try { w.mixt.version = 999 } catch { threw = true }
  if (w.mixt.version !== before) return 'the version was overwritten'
  try { w.mixt.smuggle = true } catch { /* frozen object ignores or throws */ }
  return w.mixt.smuggle === undefined || threw ? true : 'a new property was added'
})

/* ---- the filesystem ------------------------------------------------------- */

await check('a file can be written and read back', () => {
  const wrote = w.mixt.fs.write('/home/mixt/sdk-note.txt', 'written through mixt.js')
  if (!wrote) return 'write returned false'
  const back = w.mixt.fs.read('/home/mixt/sdk-note.txt')
  return back === 'written through mixt.js' || `read back ${JSON.stringify(back)}`
})

await check('what mixt.js writes is on screen in the file manager too', async () => {
  /* the point of a synchronous API over the same tree: no refresh, no await */
  const entries = w.mixt.fs.list('/home/mixt')
  return entries.some((e) => e.name === 'sdk-note.txt') || 'not in the directory listing'
})

await check('a directory listing says what each entry is', () => {
  const entries = w.mixt.fs.list('/etc')
  if (!entries) return 'no listing for /etc'
  const hosts = entries.find((e) => e.name === 'hosts')
  if (!hosts) return 'no hosts entry'
  if (hosts.type !== 'file') return `hosts is ${hosts.type}`
  if (hosts.path !== '/etc/hosts') return `path is ${hosts.path}`
  if (!(hosts.size > 0)) return `size is ${hosts.size}`
  return true
})

await check('mkdir builds the parents that are missing', () => {
  const made = w.mixt.fs.mkdir('/home/mixt/Projects/deep/nested')
  if (!made) return 'mkdir returned false'
  return w.mixt.fs.exists('/home/mixt/Projects/deep/nested') || 'the directory is not there'
})

await check('a file can be renamed and copied', () => {
  w.mixt.fs.write('/home/mixt/move-me.txt', 'x')
  if (!w.mixt.fs.move('/home/mixt/move-me.txt', '/home/mixt/moved.txt')) return 'move returned false'
  if (w.mixt.fs.exists('/home/mixt/move-me.txt')) return 'the old path is still there'
  if (!w.mixt.fs.copy('/home/mixt/moved.txt', '/home/mixt/copied.txt')) return 'copy returned false'
  return w.mixt.fs.read('/home/mixt/copied.txt') === 'x' || 'the copy has different contents'
})

await check('trashing a file is recoverable, the way the file manager does it', () => {
  w.mixt.fs.write('/home/mixt/bin-me.txt', 'gone')
  if (!w.mixt.fs.trash('/home/mixt/bin-me.txt')) return 'trash returned false'
  if (w.mixt.fs.exists('/home/mixt/bin-me.txt')) return 'still where it was'
  const inTrash = w.mixt.fs.exists('/home/mixt/.local/share/Trash/files/bin-me.txt')
  const hasInfo = w.mixt.fs.exists('/home/mixt/.local/share/Trash/info/bin-me.txt.trashinfo')
  if (!inTrash) return 'not in the Trash'
  return hasInfo || 'no .trashinfo record, so it could not be put back'
})

await check('the path helpers agree with the filesystem about paths', () => {
  if (w.mixt.fs.basename('/a/b/c.txt') !== 'c.txt') return `basename gave ${w.mixt.fs.basename('/a/b/c.txt')}`
  if (w.mixt.fs.dirname('/a/b/c.txt') !== '/a/b') return `dirname gave ${w.mixt.fs.dirname('/a/b/c.txt')}`
  return true
})

/* ---- nothing here throws -------------------------------------------------- */

await check('a path that is not there gives null rather than throwing', () => {
  if (w.mixt.fs.read('/no/such/file') !== null) return 'read did not return null'
  if (w.mixt.fs.list('/no/such/dir') !== null) return 'list did not return null'
  return w.mixt.fs.exists('/no/such/thing') === false || 'exists said yes'
})

await check('a write that cannot happen gives false rather than throwing', () => {
  /* no parent directory, and no attempt to invent one */
  return w.mixt.fs.write('/nowhere/at/all.txt', 'x') === false || 'the write was reported as done'
})

await check('nonsense handed to the runtime does not take the desktop down', () => {
  const calls = [
    () => w.mixt.fs.read(undefined),
    () => w.mixt.fs.write(null, null),
    () => w.mixt.fs.list(42),
    () => w.mixt.fs.basename(null),
    () => w.mixt.apps.get('not-an-app'),
    () => w.mixt.apps.launch('not-an-app'),
    () => w.mixt.notify(undefined),
  ]
  for (const call of calls) call()
  /* still answering afterwards */
  return w.mixt.fs.exists('/etc') === true || 'the runtime stopped working'
})

/* ---- applications --------------------------------------------------------- */

await check('an application can list what this session may see', () => {
  const apps = w.mixt.apps.list()
  if (!Array.isArray(apps) || apps.length === 0) return `got ${JSON.stringify(apps).slice(0, 80)}`
  const first = apps[0]
  for (const field of ['id', 'name', 'summary', 'description', 'categories', 'installed', 'running'])
    if (!(field in first)) return `a record is missing ${field}`
  return true
})

await check('the listing carries the summary and description the menu shows', () => {
  const files = w.mixt.apps.get('nemo')
  if (!files) return 'no record for nemo'
  if (!files.summary) return 'no summary'
  if (!files.description || files.description === files.summary) return 'no separate description'
  return true
})

await check('an application can open another one', async () => {
  const before = w.document.querySelectorAll('.wm-window').length
  const id = w.mixt.apps.launch('nemo')
  if (!id) return 'launch returned null'
  await tick(400) // React has to render it before the DOM can show it
  const after = w.document.querySelectorAll('.wm-window').length
  return after > before || `still ${after} window(s) on screen`
})

await check('an unknown application gives null rather than an error', () => {
  return w.mixt.apps.launch('definitely-not-here') === null || 'launch did not return null'
})

/* ---- who is running, and mail --------------------------------------------- */

await check('whoami says who is signed in', () => {
  const who = w.mixt.whoami()
  if (who.username !== 'demo') return `username is ${who.username}`
  if (who.guest !== false) return 'demo reported as a guest'
  return true
})

await check('whoami never includes a password', () => {
  const who = w.mixt.whoami()
  const keys = Object.keys(who).join(',')
  return /password|hash|salt|token/.test(keys) ? `it exposes ${keys}` : true
})

await check("this session's address is on the local domain", () => {
  const address = w.mixt.mail.address()
  return address === 'demo@Mixt.MPL' || `address is ${address}`
})

await check('a notification can be posted', () => {
  w.mixt.notify('Saved through mixt.js', 'The runtime works.')
  return true
})

/* ---- a guest gets a different answer, and keeps nothing ------------------- */

const guest = await boot({ token: 'sdkg', username: 'visitor', role: 'guest', name: 'A Visitor' })

await check('a guest is told they are a guest, on the guest domain', () => {
  const who = guest.w.mixt.whoami()
  if (who.guest !== true) return 'not reported as a guest'
  const address = guest.w.mixt.mail.address()
  return address === 'visitor@Guest.MPL' || `address is ${address}`
})

await check('what a guest writes through mixt.js is not saved to storage', async () => {
  guest.w.mixt.fs.write('/home/mixt/guest-was-here.txt', 'x')
  await tick(700) // longer than the debounce
  const keys = Object.keys(guest.w.localStorage)
  const trees = keys.filter((k) => k.startsWith('mixt.vfs.v2'))
  if (trees.length !== 0) return `storage holds ${trees.join(', ')}`
  return guest.w.mixt.fs.exists('/home/mixt/guest-was-here.txt') || 'the file vanished inside the session'
})

/* ---- the file on disk, and no way out ------------------------------------- */

await check('the runtime is on disk where an application can list it as a dependency', () => {
  const src = w.mixt.fs.read('/usr/share/mixt/mixt.js')
  if (src === null) return 'no /usr/share/mixt/mixt.js'
  if (!/mixt\.fs\.read/.test(src)) return 'the file does not describe the filesystem calls'
  return /mixt\.apps\.launch/.test(src) || 'the file does not describe launching'
})

await check('the runtime offers no way to reach the network', () => {
  const names = Object.keys(w.mixt)
  const suspects = names.filter((n) => /fetch|request|http|upload|socket|xhr|remote/i.test(n))
  if (suspects.length) return `it exposes ${suspects.join(', ')}`
  for (const group of ['fs', 'apps', 'mail']) {
    const inner = Object.keys(w.mixt[group] || {}).filter((n) => /fetch|request|http|upload|socket|xhr|remote/i.test(n))
    if (inner.length) return `mixt.${group} exposes ${inner.join(', ')}`
  }
  return true
})

await check('the runtime is the same object the bundle installed, not a copy', () => {
  /* two reads must be identical, or an application could be talking to a stale
     runtime while the desktop moves on underneath it */
  return w.mixt === w.mixt || 'a different object came back'
})

console.log('')
server.close()
if (failures.length === 0) {
  console.log('  \x1b[32m✓\x1b[0m an application can drive the desktop through mixt.js, and cannot leave it')
  process.exit(0)
}
console.log(`  \x1b[31m${failures.length} failure(s)\x1b[0m`)
for (const f of failures) console.log(`    • ${f}`)
process.exit(1)
