/**
 * Hosting check — "it has to work on a normal localhost website".
 *
 *   npm run static
 *
 * This does not test the Vite dev server. It tests the thing someone actually
 * does with the repository: point a plain static file server at the folder and
 * open it on localhost. So it
 *
 *   • validates that the built bundles are not stale,
 *   • serves the repository root with a bare node:http static file server
 *     (what `python3 -m http.server`, Live Server and XAMPP do),
 *   • checks index.html asks for nothing but same-folder files — no /src, no
 *     ES modules, no absolute paths, no third-party origins,
 *   • boots the exact bytes the server returns, straight from the URL,
 *   • repeats the whole thing from a subdirectory (/mixt/) to prove every path
 *     is relative, and
 *   • fails loudly if a missing file is not a 404.
 *
 * A white page under any of those is a failed check, not a surprise.
 */
import { createServer } from 'node:http'
import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
}

/* ------------------------- 0. is the bundle up to date? -------------------- */
console.log('• checking the published bundle is current…')

function newestSource() {
  let newest = 0
  const skip = new Set(['node_modules', '.git', 'dist', '.static-build', '.smoke-out', '.diagnose-out', '.tmp'])
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name) || entry.name.startsWith('.')) {
        if (entry.name !== 'index.html') continue
      }
      const full = join(dir, entry.name)
      const info = statSync(full)
      if (entry.isDirectory()) walk(full)
      else if (full.endsWith('.ts') || full.endsWith('.tsx') || full.endsWith('.css') || full.endsWith('.html')) {
        newest = Math.max(newest, info.mtimeMs)
      }
    }
  }
  walk(join(ROOT, 'src'))
  for (const file of ['index.html', 'package.json']) {
    if (existsSync(join(ROOT, file))) newest = Math.max(newest, statSync(join(ROOT, file)).mtimeMs)
  }
  return newest
}

const failures = []
const ok = (label, detail = '') => console.log(`  ✓ ${label}${detail ? '  ' + detail : ''}`)
const bad = (label, detail = '') => {
  failures.push(label)
  console.log(`  ✗ ${label}${detail ? '  ' + detail : ''}`)
}

if (!existsSync('mixt.bundle.js') || !existsSync('mixt.bundle.css')) {
  bad('the published bundle is missing — run `npm run build`')
} else if (statSync('mixt.bundle.js').mtimeMs < newestSource() - 2000) {
  bad('mixt.bundle.js is older than the sources', 'run `npm run build` before serving the folder')
} else {
  ok('mixt.bundle.js matches the sources')
}

console.log('• rebuilding to be sure…')
execSync('node scripts/build-static.mjs', { stdio: 'pipe' })
ok('build published mixt.bundle.js, mixt.bundle.css and index.html to the root')

/* ------------------------- a bare static file server ----------------------- */
let mount = ''
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
    if (mount && path.startsWith(mount)) path = path.slice(mount.length) || '/'
    if (path.endsWith('/')) path += 'index.html'
    const file = join(ROOT, path)
    if (!file.startsWith(ROOT)) return void res.writeHead(403).end('forbidden')
    const info = await statSync(file)
    if (!info.isFile()) throw new Error('not a file')
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'content-length': body.length })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('404')
  }
})
await new Promise((r) => server.listen(0, '0.0.0.0', r))
const { port } = server.address()
const BASE = `http://127.0.0.1:${port}`
console.log(`• static server (no headers, no rewrites, no modules) on ${BASE}`)

/* --------------------------------- helpers -------------------------------- */
/* Boot the page the way a browser does: jsdom fetches index.html and its
   sub-resources over the same URL the user would open, then executes the
   script. If the host hands out a file with the wrong type, or the script
   cannot run for any reason, the render is empty and the check fails. */
async function bootPage(url, { fromFile = false } = {}) {
  const { JSDOM, VirtualConsole } = await import('jsdom')
  const errors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', (e) => errors.push(`${e.message}${e.detail ? ' — ' + e.detail : ''}`))
  virtualConsole.on('error', (...args) => errors.push(args.map(String).join(' ')))

  // jsdom cannot parse Tailwind v4's stylesheet (real browsers can), and a CSS
  // parse error stops it from finishing the document load, which in turn stops
  // a deferred script from running. The stylesheet itself is validated over
  // HTTP above; what this step proves is that the *script* is served with the
  // right type, at a path the page can find, and that it mounts the desktop.
  const rawHtml = fromFile ? await readFile(url, 'utf8') : await (await fetch(url)).text()
  const html = rawHtml.replace(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi, '')

  const dom = new JSDOM(html, {
    url: fromFile ? pathToFileURL(url).href : url,
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    resources: 'usable',
    virtualConsole,
  })
  await new Promise((r) => setTimeout(r, 1600))
  return { dom, errors, window: dom.window }
}

async function checkHosting(label, prefix) {
  const base = BASE + prefix
  console.log(`\n  ── ${label} (${base}/) ──`)

  const indexRes = await fetch(`${base}/`)
  const index = await indexRes.text()
  if (!indexRes.ok) return bad(`${prefix || '/'} did not serve index.html`, String(indexRes.status))
  ok('index.html', `${indexRes.status} ${indexRes.headers.get('content-type')}`)

  const refs = [...index.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
  const external = refs.filter((r) => /^(https?:)?\/\//.test(r))
  const absolute = refs.filter((r) => r.startsWith('/'))
  const sources = refs.filter((r) => /\/(src|@vite|@react-refresh)/.test(r))
  const moduleScripts = /<script[^>]+type=["']module["']/.test(index)

  if (external.length) bad('index.html asks a third-party origin for a file', external.join(' '))
  if (absolute.length) bad('index.html uses root-absolute paths (breaks in a subdirectory)', absolute.join(' '))
  if (sources.length) bad('index.html asks for source files — a plain static host cannot compile them', sources.join(' '))
  if (moduleScripts) bad('index.html loads an ES module (needs the right MIME type and http(s); breaks from disk)')
  if (!external.length && !absolute.length && !sources.length && !moduleScripts) {
    ok('every reference is a plain, relative, same-folder file', refs.join(' '))
  }

  for (const ref of refs) {
    const res = await fetch(`${base}/${ref}`)
    res.ok ? ok(`GET ${ref}`, `${res.status} ${(await res.arrayBuffer()).byteLength} bytes`) : bad(`GET ${ref}`, String(res.status))
  }

  const styleUrls = [...(await (await fetch(`${base}/mixt.bundle.css`)).text()).matchAll(/url\(\s*["']?([^"')]+)/g)].map((m) => m[1])
  const styleExternal = styleUrls.filter((u) => /^(https?:)?\/\//.test(u))
  styleExternal.length === 0 ? ok('the stylesheet references nothing external') : bad('external url() in the stylesheet', styleExternal.join(' '))

  const missing = await fetch(`${base}/nope.js`)
  missing.status === 404 ? ok('a missing file returns 404') : bad(`a missing file returned ${missing.status}`)

  // the wallpaper the desktop paints itself with — fetched by the running app
  const wall = await fetch(`${base}/wallpapers/mixt-wave.jpg`)
  wall.ok ? ok('the wallpaper resolves', String(wall.status)) : bad('the wallpaper did not resolve', String(wall.status))

  const { dom, errors } = await bootPage(base + '/')
  const rendered = dom.window.document.getElementById('root')?.innerHTML ?? ''
  if (rendered.length > 500 && rendered.includes('class="panel')) ok('the served page boots the desktop', `${rendered.length} bytes`)
  else bad('the served page produced an empty screen', `${rendered.length} bytes`)
  if (errors.length) bad('errors while loading the page', errors[0].slice(0, 140))
  else ok('no errors while loading the page')

  // relative asset paths are what make the subdirectory case work
  const wallpaperRef = /url\("?([^)"']*mixt-[a-z]+\.jpg)/.exec(rendered)?.[1] ?? ''
  if (wallpaperRef.startsWith('/')) bad('the desktop requests the wallpaper with an absolute path', wallpaperRef)
  else if (wallpaperRef) ok('the desktop requests its wallpaper relatively', wallpaperRef)
  dom.window.close()
}

try {
  mount = ''
  await checkHosting('the folder served as the web root', '')

  mount = '/mixt'
  await checkHosting('the folder served from a subdirectory', '/mixt')

  /* ------------------- the same folder, opened from disk -------------------- */
  console.log('\n  ── opened directly from disk (file://) ──')
  const diskDir = mkdtempSync(join(tmpdir(), 'mixt-disk-'))
  for (const file of ['index.html', 'mixt.bundle.js', 'mixt.bundle.css', 'logo.svg']) {
    writeFileSync(join(diskDir, file), await readFile(join(ROOT, file)))
  }
  cpSync(join(ROOT, 'wallpapers'), join(diskDir, 'wallpapers'), { recursive: true })
  const diskBoot = await bootPage(join(diskDir, 'index.html'), { fromFile: true })
  const diskRendered = diskBoot.window.document.getElementById('root')?.innerHTML ?? ''
  if (diskRendered.includes('class="panel')) ok('the desktop mounts from file://', `${diskRendered.length} bytes`)
  else bad('file:// produced an empty screen', `${diskRendered.length} bytes`)
  // file:// has an opaque origin: storage is refused, and the OS has to cope
  diskBoot.errors.length === 0 ? ok('no errors on file:// (storage refused, memory fallback)') : bad('errors on file://', diskBoot.errors[0].slice(0, 140))
  diskBoot.window.close()
} finally {
  server.close()
}

console.log('')
if (failures.length === 0) {
  console.log('  \x1b[32m✓\x1b[0m the folder is a normal static website: any localhost host runs it, subdirectory and file:// included')
  process.exit(0)
}
console.log(`  \x1b[31m${failures.length} failure(s)\x1b[0m`)
for (const f of failures) console.log(`    • ${f}`)
process.exit(1)
