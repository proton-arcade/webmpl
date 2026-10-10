/**
 * Can the desktop actually reach the converter?
 *
 *   npm run localpages
 *
 * The site converter lives in the repository beside the desktop, but a page
 * nobody can open from inside the OS might as well not be there. These checks
 * boot the shipped bundle, open the browser, and get to the converter the two
 * ways a person would: from the bookmarks, and by typing its name in the
 * address bar.
 *
 * They also assert the boundary. A local page is loaded from the same origin by
 * relative path — there is no DNS lookup, no third-party frame and nothing
 * leaving this machine — and the browser is not turned into a way of browsing
 * the repository: only the pages that are meant to be opened are.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'

const ROOT = process.cwd()
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.json': 'application/json' }
const SESSION_KEY = 'mixt.session.v1'

/* nothing in here may take long; if the page wedges, say so and stop */
const hardStop = setTimeout(() => {
  console.log('  \x1b[31m✗\x1b[0m the check did not finish in time')
  process.exit(1)
}, 90000)

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

async function boot() {
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
  w.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: 'lp', username: 'demo', role: 'user', name: 'Demo' }))
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

/* a React controlled input ignores `input.value = x`: the native setter has to
   be used and the event has to bubble, or React never hears about it */
function typeInto(w, el, text) {
  const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set
  setter.call(el, text)
  el.dispatchEvent(new w.Event('input', { bubbles: true }))
  el.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  el.dispatchEvent(new w.KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true }))
}

console.log('')
console.log('  the converter, reached from inside the desktop')

const { w, d } = await boot()

w.mixt.apps.launch('browser')
await tick(700)

const frame = () => d.querySelector('.wm-window iframe')
const windowText = () => d.querySelector('.wm-window')?.textContent ?? ''

await check('the browser opens', () => !!d.querySelector('.wm-window') || 'no window on screen')

/* ---- by name in the address bar ------------------------------------------ */

const addr = [...d.querySelectorAll('.wm-window input')].find(
  (i) => /mixtnet|search|address|url/i.test(i.placeholder || '') || /mixtnet\.com/.test(i.value || ''),
)

await check('the address bar is there to type into', () => !!addr || 'no address bar found in the browser')

await check('typing "converter" reaches the page, not a search for the word', async () => {
  if (!addr) return 'no address bar'
  typeInto(w, addr, 'converter')
  await tick(900)
  const src = frame()?.getAttribute('src')
  if (!src) return 'nothing was framed'
  if (/search/.test(src)) return `it searched instead: ${src}`
  return src.startsWith('converter') || `framed ${src}`
})

await check('the framed page says what it is and that it is local', () => {
  const text = windowText()
  if (!/Site Converter/.test(text)) return 'the window does not name the converter'
  return /same folder as the desktop/.test(text) || 'it does not say the page is served locally'
})

await check('the frame is loaded by relative path, so it needs no network', () => {
  const src = frame()?.getAttribute('src') ?? ''
  if (/^https?:\/\//.test(src)) return `absolute: ${src}`
  if (src.startsWith('//')) return `protocol-relative: ${src}`
  return true
})

/* ---- the server really serves it ------------------------------------------ */

await check('the page the frame asks for is actually served', async () => {
  const src = frame()?.getAttribute('src') ?? 'converter/index.html'
  const res = await fetch(`${BASE}/${src}`)
  if (!res.ok) return `${src} came back ${res.status}`
  const body = await res.text()
  return /Mixt Site Converter/.test(body) || 'the page served is not the converter'
})

/* ---- the boundary ---------------------------------------------------------- */

await check('the browser is not a way of browsing the repository', async () => {
  /* An arbitrary path must not be openable just because it exists on disk.
     The invariant is that nothing outside LOCAL_PAGES is ever framed from our
     own origin — an absolute https:// URL for a name that merely looks like a
     host is the browser doing what a browser does, not the repository being
     served, and it fails to load because there is no such machine. */
  typeInto(w, addr, 'server.cjs')
  await tick(700)
  const src = frame()?.getAttribute('src') ?? ''
  const sameOrigin = src && !/^(https?:)?\/\//.test(src)
  if (sameOrigin) return `the repository was framed from this origin: ${src}`
  return true
})

await check('no path outside the listed pages is served from this origin', async () => {
  for (const attempt of ['package.json', 'src/os/vfs.ts', 'data.json', 'README.md']) {
    typeInto(w, addr, attempt)
    await tick(500)
    const src = frame()?.getAttribute('src') ?? ''
    if (src && !/^(https?:)?\/\//.test(src)) return `${attempt} was framed from this origin: ${src}`
  }
  return true
})

await check('a path that is not a listed local page is treated as a search', async () => {
  typeInto(w, addr, 'definitely-not-a-page')
  await tick(700)
  const src = frame()?.getAttribute('src') ?? ''
  return /definitely-not-a-page/.test(src) ? `it framed ${src}` : true
})

/* ---- it is findable, not just reachable ------------------------------------ */

await check('the converter is in the bookmarks, so it can be found', () => {
  /* Bookmarks are a file in the filesystem, not a localStorage key: they belong
     to the account, so they back up and move with it. */
  const raw = w.mixt.fs.read('/home/mixt/.config/mixtnet/bookmarks.json')
  if (raw === null) return 'no bookmarks file was written'
  let marks = []
  try { marks = JSON.parse(raw) } catch (e) { return `the bookmarks file is not JSON: ${e.message}` }
  const found = Array.isArray(marks) && marks.some((b) => /converter/.test(String(b.url || '')))
  if (found) return true
  return marks.length === 0 ? 'the bookmark list is empty' : `bookmarks are ${marks.map((b) => b.url).join(', ')}`
})

await check('the bookmarks menu offers it, which is how a person would get there', async () => {
  /* The bookmarks live behind the browser's Menu button, which is an icon with
     a title attribute rather than a button labelled "bookmarks". */
  const menu = [...d.querySelectorAll('.wm-window button')].find(
    (b) => (b.getAttribute('title') || '').toLowerCase() === 'menu',
  )
  if (!menu) return 'no Menu button in the browser'
  menu.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, view: w }))
  await tick(400)
  /* the menu renders its entries as .menu-item divs, not buttons */
  const showBookmarks = [...d.querySelectorAll('.menu-item')].find((b) =>
    /show bookmarks/i.test(b.textContent || ''),
  )
  if (!showBookmarks) return 'the menu has no "Show bookmarks" entry'
  showBookmarks.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, view: w }))
  await tick(400)
  return /Site Converter/.test(d.querySelector('.wm-window')?.textContent ?? '') || 'the bookmark list does not include it'
})

console.log('')
clearTimeout(hardStop)
server.close()
if (failures.length === 0) {
  console.log('  \x1b[32m✓\x1b[0m the converter can be opened from inside the desktop, and nothing else in the repository can')
  process.exit(0)
}
console.log(`  \x1b[31m${failures.length} failure(s)\x1b[0m`)
for (const f of failures) console.log(`    • ${f}`)
process.exit(1)
