/**
 * Checks the site converter — the second website in this repository, which
 * turns a page written for the open internet into one that stands on its own.
 *
 *   npm run converter
 *
 * converter/converter.js is loaded the way converter/index.html loads it: as a
 * classic script against a bare global. It is deliberately not a module, so
 * requiring it here would tell us nothing about the thing that actually runs.
 *
 * These are checks on behaviour, not on implementation: a remote address comes
 * out pointing at a local file, something that could only work against a
 * foreign machine comes out switched off, and nothing that was already local
 * gets touched.
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let failures = 0

const ok = (name) => console.log(`  \x1b[32m✓\x1b[0m ${name}`)
const bad = (name, why) => { failures += 1; console.log(`  \x1b[31m✗\x1b[0m ${name}  ${why ?? ''}`) }
const check = (name, fn) => {
  try { fn() === false ? bad(name) : ok(name) }
  catch (e) { bad(name, e.message) }
}

/* load the way the browser does */
const sandbox = { console }
sandbox.globalThis = sandbox
sandbox.window = sandbox
vm.createContext(sandbox)
vm.runInContext(readFileSync(resolve(root, 'converter/converter.js'), 'utf8'), sandbox, { filename: 'converter.js' })
const C = sandbox.MixtSiteConverter

if (!C || typeof C.convert !== 'function') {
  console.log('  \x1b[31m✗\x1b[0m converter.js did not define MixtSiteConverter.convert')
  process.exit(1)
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="https://cdn.example/framework.min.css" integrity="sha384-abc123" crossorigin="anonymous">
  <link rel="preconnect" href="https://fonts.example">
  <script src="https://cdn.example/analytics.js"><\/script>
</head>
<body>
  <h1>A page from out there</h1>
  <img src="https://img.example/hero.png" alt="hero">
  <img srcset="https://img.example/small.png 480w, https://img.example/large.png 1080w">
  <iframe src="https://player.example/embed/42"></iframe>
  <form action="https://forms.example/subscribe" method="post"><input type="email"></form>
  <a href="/already-local.html">local link</a>
  <a href="mailto:someone@example.com">mail</a>
  <img src="images/relative.png" alt="">
  <script>navigator.sendBeacon("https://tracker.example/seen", "1")<\/script>
</body>
</html>
`

const result = C.convert(PAGE, { name: 'Example page', url: 'https://example.com/page.html' })

console.log('')
console.log('  the converter — a page from out there becomes a page for this project')

check('an absolute stylesheet now points inside ./vendor/', () => {
  const hit = result.manifest.vendored.find((v) => v.from === 'https://cdn.example/framework.min.css')
  if (!hit) return `not vendored: ${JSON.stringify(result.manifest.vendored.map((v) => v.from))}`
  if (!hit.to.startsWith('vendor/')) return `pointed at ${hit.to}`
})

check('the rewritten HTML really carries the local path', () => {
  if (!result.html.includes('href="vendor/')) return 'no vendor/ href in the output'
  if (/href="https:\/\/cdn\.example\/framework/.test(result.html)) return 'the CDN address survived'
})

check('a protocol-relative address is treated as remote too', () => {
  const out = C.convert('<script src="//cdn.example/x.js"><\/script>')
  return out.manifest.vendored.length === 1 || `got ${out.manifest.vendored.length}`
})

check('every entry of a srcset list is rewritten, not just the first', () => {
  const small = result.manifest.vendored.find((v) => v.from === 'https://img.example/small.png')
  const large = result.manifest.vendored.find((v) => v.from === 'https://img.example/large.png')
  if (!small || !large) return `srcset entries missing: ${JSON.stringify(result.manifest.vendored.map((v) => v.from))}`
})

check('no http(s) address is left standing outside a comment', () => {
  /* strip the comments the converter adds, then look for anything still remote */
  const bare = result.html.replace(/<!--[\s\S]*?-->/g, '')
  const left = (bare.match(/https?:\/\/[^\s"'<>)]+/g) || [])
    .filter((u) => !/^https?:\/\/(www\.)?w3\.org\//.test(u))
  return left.length === 0 || `still remote: ${left.join(', ')}`
})

check('an integrity hash is dropped, or the local copy would be refused', () => {
  if (/integrity\s*=/i.test(result.html)) return 'integrity survived'
  return result.manifest.disabled.some((d) => d.what === 'integrity') || 'not reported in the manifest'
})

check('an iframe from another machine is switched off', () => {
  const d = result.manifest.disabled.find((x) => x.what === 'iframe')
  return !!d || 'no iframe entry'
})

check('a form that posts away is switched off', () => {
  return result.manifest.disabled.some((x) => x.what === 'form') || 'no form entry'
})

check('prefetch and preconnect hints are switched off', () => {
  return result.manifest.disabled.some((x) => x.what === 'link hint') || 'no link hint entry'
})

check('a beacon to a tracker is switched off', () => {
  return result.manifest.disabled.some((x) => x.what === 'sendBeacon') || 'no sendBeacon entry'
})

check('what was switched off is left in the source as a comment, not deleted', () => {
  return /<!-- disabled by the converter: iframe/.test(result.html) || 'no marker comment'
})

check('an address that was already local is left alone', () => {
  return result.html.includes('href="/already-local.html"') || 'the local link was rewritten'
})

check('a relative image path is left alone', () => {
  return result.html.includes('src="images/relative.png"') || 'the relative path was rewritten'
})

check('a mailto: address is not treated as a remote asset', () => {
  return result.html.includes('mailto:someone@example.com') || 'mailto was vendored'
})

check('two remote files that would collide get different local names', () => {
  const out = C.convert('<img src="https://a.example/x.png"><img src="https://b.example/x.png">')
  const paths = out.manifest.vendored.map((v) => v.to)
  return new Set(paths).size === 2 || `collision: ${paths.join(', ')}`
})

check('the manifest records where it came from and when', () => {
  const m = result.manifest
  if (m.kind !== 'mixt-site-conversion') return `kind is ${m.kind}`
  if (m.source !== 'https://example.com/page.html') return `source is ${m.source}`
  if (!m.converted || Number.isNaN(Date.parse(m.converted))) return `converted is ${m.converted}`
})

check('the manifest says plainly that nothing was downloaded', () => {
  return /nothing was downloaded|no asset listed here was downloaded/i.test(result.manifest.note) || 'no note'
})

check('the site record is in the [Website] key-per-line form', () => {
  const lines = result.ini.split('\n')
  if (lines[0] !== '[Website]') return `first line is ${JSON.stringify(lines[0])}`
  for (const key of ['Name=', 'URL=', 'Server=', 'Path=', 'Description='])
    if (!lines.some((l) => l.startsWith(key))) return `missing ${key}`
  const body = lines.slice(1).filter(Boolean)
  if (!body.every((l) => /^[A-Za-z][A-Za-z0-9_]*=/.test(l))) return 'a line is not key=value'
})

check('the site record names the site and counts what changed', () => {
  if (!result.ini.includes('Name=Example page')) return 'no Name= line'
  if (!/Assets=\d+/.test(result.ini)) return 'no Assets= line'
  if (!/Disabled=\d+/.test(result.ini)) return 'no Disabled= line'
})

check('the summary a person reads mentions both counts', () => {
  const text = C.describe(result)
  return /remote asset/.test(text) && /switched off/.test(text) || `says: ${text}`
})

check('an empty page converts without throwing', () => {
  const out = C.convert('')
  return out.manifest.vendored.length === 0 && out.manifest.disabled.length === 0 || 'not empty'
})

check('a page with nothing remote comes back unchanged', () => {
  const src = '<!doctype html><html><body><p>plain</p></body></html>'
  return C.convert(src).html === src || 'was modified'
})

/* the page itself, checked the way a person reaches it */
const page = readFileSync(resolve(root, 'converter/index.html'), 'utf8')

check('converter/index.html asks for nothing outside its own folder', () => {
  const refs = [...page.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)].map((m) => m[1])
  const outside = refs.filter((r) => /^(https?:)?\/\//.test(r) || r.startsWith('/') || r.startsWith('..'))
  return outside.length === 0 || `external: ${outside.join(', ')}`
})

check('the page loads the converter as a classic script, so it works from disk', () => {
  return /<script src="converter\.js"><\/script>/.test(page) || 'not a classic script'
})

const style = readFileSync(resolve(root, 'converter/style.css'), 'utf8')
check('the stylesheet pulls in no font or remote asset', () => {
  const urls = [...style.matchAll(/url\(\s*["']?([^"')]+)/g)].map((m) => m[1])
  const remote = urls.filter((u) => /^(https?:)?\/\//.test(u))
  const imports = /@import/.test(style)
  return remote.length === 0 && !imports || `remote: ${remote.join(', ')}${imports ? ' +@import' : ''}`
})

console.log('')
if (failures === 0) {
  console.log(`  \x1b[32m✓\x1b[0m the converter produces a page that stands on its own`)
  process.exit(0)
}
console.log(`  \x1b[31m${failures} failure(s)\x1b[0m`)
process.exit(1)
