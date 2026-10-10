/**
 * Interaction check — the bug this guards is subtle enough that a plain
 * `click()` dispatch will NOT catch it.
 *
 *   npm run interact
 *
 * A real browser only fires `click` if the element is still in the document
 * after `mousedown`. For a while the desktop closed the main menu on any
 * mousedown, so pressing a menu item unmounted the menu before the click could
 * land: categories never switched, apps never opened, and only the panel's
 * quick launch worked. This harness reproduces the *full* mousedown → mouseup →
 * click sequence against the shipped bundle and asserts each of the three ways
 * of opening an app still works.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'

const ROOT = process.cwd()
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' }
const server = createServer(async (req, res) => {
  let path = new URL(req.url, 'http://x').pathname
  if (path.endsWith('/')) path += 'index.html'
  try {
    const body = await readFile(join(ROOT, path))
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' })
    res.end(body)
  } catch { res.writeHead(404).end('404') }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${server.address().port}`

const failures = []
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  failures.push(m)
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
}

const vc = new VirtualConsole()
vc.on('jsdomError', (e) => bad(`page error while interacting: ${e.message}`))

const raw = await (await fetch(BASE + '/')).text()
const html = raw.replace(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi, '')
const dom = new JSDOM(html, { url: BASE + '/', pretendToBeVisual: true, runScripts: 'dangerously', resources: 'usable', virtualConsole: vc })
const w = dom.window
await new Promise((r) => setTimeout(r, 1500))
const d = w.document
const tick = (ms = 300) => new Promise((r) => setTimeout(r, ms))

/* A faithful click: the element must survive mousedown for the click to land. */
async function realClick(el) {
  if (!el) return false
  const ev = (t) => new w.MouseEvent(t, { bubbles: true, cancelable: true, view: w, clientX: 100, clientY: 100, button: 0 })
  el.dispatchEvent(ev('mousedown'))
  await tick(30)
  if (!el.isConnected) return false
  el.dispatchEvent(ev('mouseup'))
  el.dispatchEvent(ev('click'))
  return true
}
const wins = () => d.querySelectorAll('.wm-window').length
const menuOpen = () => !!d.querySelector('.menu-button[data-open="true"]')

console.log('• opening the main menu with a real click…')
const menuBtn = d.querySelector('.menu-button')
if (!(await realClick(menuBtn))) bad('could not open the main menu')
await tick()
if (!menuOpen()) bad('the main menu did not open')
else ok('the main menu opens')

console.log('• switching a category (must stay open and filter)…')
const before = d.querySelectorAll('.menu-item').length
const cat = [...d.querySelectorAll('.menu-item')].find((e) => /^Accessories$/.test(e.textContent?.trim() ?? ''))
if (!cat) bad('category list missing Accessories')
else {
  const survived = await realClick(cat)
  await tick(200)
  if (!survived || !menuOpen()) bad('clicking a category closed the menu (the mousedown-swallowing bug)')
  else if (d.querySelectorAll('.menu-item').length >= before) bad('the category did not filter the app grid')
  else ok(`category switched, grid filtered ${before} → ${d.querySelectorAll('.menu-item').length}`)
}

console.log('• launching an app from the menu…')
if (!menuOpen()) {
  await realClick(d.querySelector('.menu-button'))
  await tick()
}
const app = [...d.querySelectorAll('.menu-item')].find((e) => /^Calculator$/.test(e.textContent?.trim() ?? ''))
if (!app) bad('Calculator not present in the menu')
else {
  const survived = await realClick(app)
  await tick(400)
  if (!survived) bad('the menu swallowed the click on an app')
  else if (wins() < 1) bad('clicking an app in the menu opened no window')
  else ok('the app opened from the menu')
  if (menuOpen()) bad('the menu stayed open after launching an app')
}

console.log('• opening an app from a desktop icon (double click)…')
const startWins = wins()
const icon = [...d.querySelectorAll('.desktop-icon')].find((e) => /Terminal/.test(e.getAttribute('title') ?? ''))
if (!icon) bad('no Terminal desktop icon')
else {
  icon.dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true, view: w }))
  await tick(400)
  if (wins() <= startWins) bad('double-clicking a desktop icon opened no window')
  else ok('the desktop icon opened the app')
}

console.log('• launching from the panel quick launch…')
const quick = [...d.querySelectorAll('.panel-item')].find((e) => e.getAttribute('title'))
if (!(await realClick(quick))) bad('panel quick launch click failed')
await tick(300)
if (wins() === 0) bad('panel quick launch opened nothing')
else ok('the panel quick launch works')

server.close()
console.log('')
if (failures.length) {
  console.log(`  \x1b[31m${failures.length} interaction failure(s)\x1b[0m`)
  for (const f of failures) console.log(`    • ${f}`)
  process.exit(1)
}
console.log('  \x1b[32m✓\x1b[0m the menu, the desktop and the panel all open apps with real event sequences')
process.exit(0)
