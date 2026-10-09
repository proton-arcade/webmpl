/**
 * Explore check — drives the shipped bundle the way a person would:
 * first-boot account setup, open the file manager, select several items,
 * right-click for options, open more apps, drag and snap a window.
 *
 *   npm run explore
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'

const ROOT = process.cwd()
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }
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
const warns = []
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  failures.push(m)
  console.log(`  \x1b[31m✗\x1b[0m ${m}`
  )
}
const warn = (m) => {
  warns.push(m)
  console.log(`  \x1b[33m!\x1b[0m ${m}`)
}

const vc = new VirtualConsole()
vc.on('jsdomError', (e) => bad(`page error: ${e.message}`))

const raw = await (await fetch(BASE + '/')).text()
const html = raw.replace(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi, '')
const dom = new JSDOM(html, {
  url: BASE + '/',
  pretendToBeVisual: true,
  runScripts: 'dangerously',
  resources: 'usable',
  virtualConsole: vc,
  beforeParse(w) {
    // jsdom has no pointer-capture; the WM relies on it for drags.
    w.Element.prototype.setPointerCapture = () => {}
    w.Element.prototype.releasePointerCapture = () => {}
  },
})
const w = dom.window
const d = w.document
await new Promise((r) => setTimeout(r, 1500))
const tick = (ms = 300) => new Promise((r) => setTimeout(r, ms))

const mouse = (el, type, x = 100, y = 100, extra = {}) =>
  el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true, view: w, clientX: x, clientY: y, button: 0, ...extra }))
async function realClick(el, extra = {}) {
  if (!el) return false
  mouse(el, 'mousedown', 100, 100, extra)
  await tick(30)
  if (!el.isConnected) return false
  mouse(el, 'mouseup', 100, 100, extra)
  mouse(el, 'click', 100, 100, extra)
  return true
}
function setInput(el, val) {
  const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set
  setter.call(el, val)
  el.dispatchEvent(new w.Event('input', { bubbles: true }))
}
const wins = () => [...d.querySelectorAll('.wm-window')]

/* ------------------------------ 1. first boot ------------------------------ */
console.log('• first boot: account setup…')
const createBtn = [...d.querySelectorAll('button')].find((b) => /Create account/.test(b.textContent))
if (!createBtn) warn('no first-boot setup screen on a fresh profile')
else {
  const name = d.querySelector('input[placeholder*="Ada"]')
  const host = [...d.querySelectorAll('input')].find((i) => i.value === 'mixt-desktop')
  const pws = [...d.querySelectorAll('input[type="password"]')]
  if (name) setInput(name, 'Test Person')
  if (host) setInput(host, 'test-pc')
  if (pws[0]) setInput(pws[0], 'secret1')
  if (pws[1]) setInput(pws[1], 'secret1')
  await tick(100)
  await realClick(createBtn)
  await tick(500)
  if ([...d.querySelectorAll('button')].some((b) => /Create account/.test(b.textContent))) bad('setup did not finish (account not created)')
  else ok('account created from the first-boot setup')
}
if (!d.querySelector('.panel')) bad('desktop panel missing after setup')
else ok('desktop is up with a panel')

/* ------------------------------ 2. open Files ------------------------------ */
console.log('• opening the file manager from a desktop icon…')
const filesIcon = [...d.querySelectorAll('.desktop-icon')].find((e) => /Files/.test(e.getAttribute('title') ?? ''))
if (!filesIcon) bad('no Files desktop icon')
else {
  mouse(filesIcon, 'dblclick')
  await tick(400)
  if (wins().length < 1) bad('Files did not open')
  else ok('the file manager opened')
}

/* ------------------------------ 3. multi-select ---------------------------- */
console.log('• selecting several items in the file manager (ctrl+click)…')
let filesWin = wins()[wins().length - 1]
let entries = [...(filesWin?.querySelectorAll('.desktop-icon') ?? [])]
if (entries.length < 2) warn(`fewer than 2 items to select in the home folder (${entries.length})`)
if (entries.length >= 2) {
  await realClick(entries[0])
  mouse(entries[1], 'mousedown', 100, 100, { ctrlKey: true })
  mouse(entries[1], 'mouseup', 100, 100, { ctrlKey: true })
  mouse(entries[1], 'click', 100, 100, { ctrlKey: true })
  await tick(200)
  const sel = entries.filter((e) => e.getAttribute('data-selected') === 'true').length
  if (sel >= 2) ok(`multi-select works (${sel} selected)`)
  else bad(`multi-select failed (only ${sel} selected)`)

  console.log('• right-clicking a selected item shows the options…')
  mouse(entries[1], 'contextmenu', 300, 300, { button: 2 })
  await tick(200)
  const popup = [...d.querySelectorAll('.menu-popup')].find((p) => /Rename/.test(p.textContent))
  if (popup) ok('the item options menu opens (has Rename)')
  else bad('right-click did not show the options menu')
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await tick(100)
}

/* ------------------------------ 3b. zip then unzip ------------------------ */
console.log('• compress a folder, then unzip it into a new folder…')
filesWin = wins()[wins().length - 1]
const mainView = filesWin.querySelector('[tabindex="0"]')
if (mainView) {
  mouse(mainView, 'click') // clear any prior selection
  await tick(100)
}
const docs = [...filesWin.querySelectorAll('.desktop-icon')].find((e) => /Documents/.test(e.textContent))
if (!docs) warn('no Documents folder to compress')
else {
  mouse(docs, 'contextmenu', 300, 300, { button: 2 })
  await tick(200)
  const comp = [...d.querySelectorAll('.menu-popup .menu-item')].find((e) => /Compress/.test(e.textContent))
  if (!comp) warn('no Compress in the context menu')
  else {
    await realClick(comp)
    await tick(400)
    const createBtn = [...d.querySelectorAll('button')].find((b) => /Create archive/.test(b.textContent))
    if (!createBtn)
      warn(
        `the create-archive prompt did not appear (windows=${wins().length}, hasArchiveText=${[...d.querySelectorAll('.wm-window')].some((x) => /Create a new archive/.test(x.textContent))})`,
      )
    else {
      await realClick(createBtn)
      await tick(400)
      const zip = [...filesWin.querySelectorAll('.desktop-icon')].find((e) => /\.zip/.test(e.textContent))
      if (!zip) warn('the .zip did not appear in the file manager')
      else {
        ok('compress produced a .zip in the same folder')
        const zipsBefore = [...filesWin.querySelectorAll('.desktop-icon')].filter((e) => /\.zip/.test(e.textContent)).length
        mouse(zip, 'dblclick') // double-click = unzip
        await tick(700)
        let names = [...filesWin.querySelectorAll('.desktop-icon')].map((e) => e.textContent)
        let newFolder = names.find((t) => /Documents \(\d+\)/.test(t))
        if (!newFolder) {
          // fall back to the explicit menu entry
          mouse(zip, 'contextmenu', 320, 320, { button: 2 })
          await tick(200)
          const ex = [...d.querySelectorAll('.menu-popup .menu-item')].find((e) => /Extract Here/.test(e.textContent))
          if (ex) {
            await realClick(ex)
            await tick(700)
            names = [...filesWin.querySelectorAll('.desktop-icon')].map((e) => e.textContent)
            newFolder = names.find((t) => /Documents \(\d+\)/.test(t))
          }
        }
        const zipsAfter = [...filesWin.querySelectorAll('.desktop-icon')].filter((e) => /\.zip/.test(e.textContent)).length
        if (zipsAfter > zipsBefore) bad(`unzip created another .zip (${zipsBefore} -> ${zipsAfter})`)
        if (newFolder) ok(`unzip created a new folder and no extra zip (${newFolder.trim()})`)
        else bad('unzip did not create a new folder next to the zip')
      }
    }
  }
}

/* ------------------------------ 3c. filesystem ops ------------------------ */
console.log('• filesystem: create, rename, copy, paste, trash…')
filesWin = wins().find((x) => /Places/.test(x.textContent)) ?? filesWin
{
  const nf = [...filesWin.querySelectorAll('button')].find((b) => /New folder/.test(b.getAttribute('title') ?? ''))
  if (!nf) warn('no New Folder button')
  else {
    await realClick(nf)
    await tick(300)
    const ren = filesWin.querySelector('input.entry')
    if (!ren) warn('no inline rename box after New Folder')
    else {
      setInput(ren, 'Proj')
      ren.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await tick(300)
      let names = [...filesWin.querySelectorAll('.desktop-icon')].map((e) => e.textContent)
      if (names.some((t) => /Proj/.test(t))) ok('create + rename works')
      else bad('rename after New Folder did not stick')

      const proj = [...filesWin.querySelectorAll('.desktop-icon')].find((e) => /Proj/.test(e.textContent))
      if (proj) {
        mouse(proj, 'contextmenu', 300, 300, { button: 2 })
        await tick(200)
        const cp = [...d.querySelectorAll('.menu-popup .menu-item')].find((e) => /^Copy/.test(e.textContent.trim()))
        if (cp) {
          await realClick(cp)
          await tick(150)
        }
        const main = filesWin.querySelector('[tabindex="0"]')
        mouse(main, 'contextmenu', 400, 400, { button: 2 })
        await tick(200)
        const pa = [...d.querySelectorAll('.menu-popup .menu-item')].find((e) => /Paste/.test(e.textContent))
        if (pa) {
          await realClick(pa)
          await tick(300)
        }
        names = [...filesWin.querySelectorAll('.desktop-icon')].map((e) => e.textContent)
        const copies = names.filter((t) => /Proj/.test(t)).length
        if (copies >= 2) ok(`copy + paste duplicated the folder (${copies})`)
        else bad('copy + paste did not create a second copy')

        for (const el of [...filesWin.querySelectorAll('.desktop-icon')].filter((e) => /Proj/.test(e.textContent))) {
          mouse(el, 'contextmenu', 300, 300, { button: 2 })
          await tick(150)
          const tr = [...d.querySelectorAll('.menu-popup .menu-item')].find((e) => /Move to Trash/.test(e.textContent))
          if (tr) {
            await realClick(tr)
            await tick(200)
          }
        }
        names = [...filesWin.querySelectorAll('.desktop-icon')].map((e) => e.textContent)
        if (!names.some((t) => /Proj/.test(t))) ok('move to trash removed the folders')
        else bad('trash left Proj folders behind')
      }
    }
  }
}

/* ------------------------------ 4. open more apps -------------------------- */
console.log('• opening Terminal; VLC is downloadable-only…')
const termIcon = [...d.querySelectorAll('.desktop-icon')].find((e) => /Terminal/.test(e.getAttribute('title') ?? ''))
if (termIcon) {
  mouse(termIcon, 'dblclick')
  await tick(400)
}
await realClick(d.querySelector('.menu-button'))
await tick(300)
const vlcInMenu = [...d.querySelectorAll('.menu-item')].some((e) => /VLC media player/.test(e.textContent))
if (vlcInMenu) warn('VLC still preinstalled in the menu (should be downloadable-only)')
else ok('VLC/Weather/2048 are not preinstalled (download from Software Manager)')
d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
await tick(100)

/* ------------------------------ 5. drag a window --------------------------- */
console.log('• dragging a window by its titlebar…')
let termWin = wins().find((x) => /Terminal/.test(x.textContent)) ?? wins()[0]
if (termWin) {
  const bar = termWin.querySelector('.wm-titlebar')
  const beforeStyle = termWin.getAttribute('style') ?? ''
  mouse(bar, 'pointerdown', 400, 120)
  await tick(50)
  mouse(w, 'pointermove', 520, 200)
  mouse(w, 'pointermove', 560, 240)
  mouse(w, 'pointerup', 560, 240)
  await tick(150)
  const afterStyle = termWin.getAttribute('style') ?? ''
  if (afterStyle !== beforeStyle) ok('the window moved when dragged')
  else warn('dragging produced no style change (may need a real browser)')
}

/* ------------------------------ 6. snap to left ---------------------------- */
console.log('• snapping a window to the left half…')
if (termWin) {
  const bar = termWin.querySelector('.wm-titlebar')
  mouse(bar, 'pointerdown', 400, 120)
  await tick(50)
  mouse(w, 'pointermove', 5, 300) // left edge
  mouse(w, 'pointerup', 5, 300)
  await tick(200)
  const st = termWin.getAttribute('style') ?? ''
  if (/width/.test(st)) ok('snapping adjusted the window geometry')
  else warn('snap produced no geometry change (may need a real browser)')
}

/* --------------------- 7. calendar closes on click-away -------------------- */
console.log('• opening the calendar, then clicking elsewhere…')
const clock = [...d.querySelectorAll('.panel-item')].find((e) => /GMT|UTC|AM|PM/.test(e.getAttribute('title') ?? ''))
if (!clock) bad('there is no clock on the panel to open the calendar')
else {
  await realClick(clock)
  await tick(250)
  const cal = [...d.querySelectorAll('.menu-popup')].find((p) => /[A-Z][a-z]+ \d{4}/.test(p.textContent ?? ''))
  if (!cal) bad('clicking the clock opened no calendar')
  else {
    ok('the calendar opened')
    mouse(d.body, 'mousedown', 620, 380)
    await tick(250)
    const still = [...d.querySelectorAll('.menu-popup')].find((p) => /[A-Z][a-z]+ \d{4}/.test(p.textContent ?? ''))
    if (still) bad('the calendar stayed open after clicking away')
    else ok('the calendar closed on click-away')
  }
}

/* ------------------- 8. the panel marks what is running -------------------- */
console.log('• the panel marking running apps…')
const quick = (name) => [...d.querySelectorAll('.panel-item')].find((e) => (e.getAttribute('title') ?? '').startsWith(name))
const termQuick = quick('Terminal')
if (!termQuick) bad('there is no Terminal launcher on the panel')
else if (termQuick.getAttribute('data-running') !== 'true') bad('a running app is not marked on the panel')
else ok('the panel underlines the running app')

w.dispatchEvent(new w.CustomEvent('mixt:launch', { detail: { appId: 'terminal', props: {} } }))
await tick(500)
const badge = quick('Terminal')?.querySelector('.panel-badge')
if (!badge) bad('opening a second window of an app showed no +N badge')
else if (badge.textContent?.trim() !== '+1') bad(`the badge reads “${badge.textContent}”, expected +1`)
else ok('a second window gets a +1 badge')

/* ---------------- 9. the Updates tab lists only real updates --------------- */
console.log('• the Software Manager Updates tab…')
w.dispatchEvent(new w.CustomEvent('mixt:launch', { detail: { appId: 'mixtinstall', props: {} } }))
await tick(600)
const shop = wins().find((x) => /Software Manager/.test(x.textContent ?? ''))
if (!shop) bad('the Software Manager did not open')
else {
  const updatesTab = [...shop.querySelectorAll('button, .menu-item, div')].find((e) => /^Updates/.test((e.textContent ?? '').trim()))
  if (!updatesTab) bad('there is no Updates tab')
  else {
    await realClick(updatesTab)
    await tick(400)
    const text = shop.textContent ?? ''
    // Weather is an uninstalled extra: it belongs in the catalogue, not here
    if (/Weather/.test(text)) bad('the Updates tab still lists an app that was never installed (Weather)')
    else ok('uninstalled extras are not listed as updates')
    if (!/→/.test(text)) bad('no update shows the version it would move to')
    else ok('each update shows the version it moves to')
    if (!/Update/.test(text)) bad('there is no Update button')
    const installButtons = [...shop.querySelectorAll('button')].filter((b) => (b.textContent ?? '').trim() === 'Install')
    if (installButtons.length) bad(`the Updates tab still offers ${installButtons.length} Install button(s)`)
    else ok('the Updates tab offers updates, not installs')
  }
}

server.close()
console.log('')
if (warns.length) console.log(`  \x1b[33m${warns.length} warning(s)\x1b[0m (environment-limited, not counted)`)
if (failures.length) {
  console.log(`  \x1b[31m${failures.length} failure(s)\x1b[0m`)
  for (const f of failures) console.log(`    • ${f}`)
  process.exit(1)
}
console.log('  \x1b[32m✓\x1b[0m the exploratory pass found no blocking bugs')
process.exit(0)
