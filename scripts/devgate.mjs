/* The development page is the administrator's build page.
 *
 * `dev.html` asks the backend who is signed in before it loads anything, and
 * sends everybody else to the published site. This runs the real inline script
 * from the served page — extracted, not reimplemented — against three answers
 * from the backend, so the gate is checked as behaviour rather than as text.
 */
import vm from 'node:vm'

const BASES = process.argv.slice(2).filter((a) => /^https?:\/\//.test(a))
if (!BASES.length) {
  console.error('usage: node scripts/devgate.mjs http://127.0.0.1:3000')
  process.exit(2)
}

const green = (s) => `\x1b[32m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const results = []
function check(name, fn) {
  try {
    fn()
    results.push({ name, ok: true })
  } catch (e) {
    results.push({ name, ok: false, detail: e?.message ?? String(e) })
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message)
}

/** Run the page's gate with a stubbed backend and DOM, and report what it did. */
function runGate(html, session) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  assert(scripts.length === 1, `expected one inline gate script, found ${scripts.length}`)
  const gate = scripts[0]
  /* Vite injects its own client and refresh scripts; what must not be there is
     a script *tag* pointing at the application source, because that is what the
     gate is deciding whether you are allowed to have. The path also appears in
     the gate's own code and in the page's comment, so look at tags only. */
  const appTags = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1])
  assert(
    !appTags.some((s) => s.includes('main.tsx')),
    `the page hands out the application source before the gate answers: ${appTags.join(', ')}`
  )

  const injected = []
  const appended = []
  let replaced = null

  const makeEl = (tag) => ({
    tag,
    textContent: '',
    style: { cssText: '' },
    type: '',
    src: '',
  })
  const elements = {}

  const sandbox = {
    document: {
      body: { appendChild: (el) => { appended.push(el); if (el.id) elements[el.id] = el } },
      createElement: makeEl,
      getElementById: (id) => elements[id] ?? null,
    },
    location: { replace: (to) => { replaced = to } },
    fetch: (_url) =>
      session === 'offline'
        ? Promise.reject(new Error('no backend'))
        : Promise.resolve({
            ok: session !== null,
            json: () => Promise.resolve(session ?? {}),
          }),
    setTimeout: (fn) => { fn(); return 0 },
    console,
  }
  sandbox.globalThis = sandbox

  vm.createContext(sandbox)
  vm.runInContext(gate, sandbox)

  /* the gate is promise-driven; let it settle */
  return new Promise((resolve) =>
    setTimeout(() => {
      for (const el of appended) if (el.tag === 'script' && el.src) injected.push(el.src)
      resolve({ injected, replaced, note: elements['gate-note']?.textContent ?? '' })
    }, 30)
  )
}

for (const base of BASES) {
  console.log(`\n\x1b[1mthe development page on ${base}\x1b[0m`)
  let html = ''
  try {
    const res = await fetch(`${base}/dev.html`)
    assert(res.ok, `GET /dev.html returned ${res.status}`)
    html = await res.text()
  } catch (e) {
    results.push({ name: `${base}: dev.html is served`, ok: false, detail: e?.message ?? String(e) })
    continue
  }
  results.push({ name: `${base}: dev.html is served`, ok: true })

  const admin = await runGate(html, { role: 'admin', username: 'Mixt_MPL' })
  check(`${base}: the administrator gets the development build`, () => {
    assert(admin.injected.includes('/src/main.tsx'), `no app script was injected: ${JSON.stringify(admin.injected)}`)
    assert(admin.replaced === null, `the administrator was redirected to ${admin.replaced}`)
  })

  const user = await runGate(html, { role: 'user', username: 'demo' })
  check(`${base}: a standard account is sent to the published site`, () => {
    assert(user.injected.length === 0, `the development bundle was handed to a standard account: ${user.injected}`)
    assert(user.replaced === 'index.html', `expected a redirect to index.html, got ${user.replaced}`)
    assert(/administrator/i.test(user.note), `the note did not explain itself: "${user.note}"`)
  })

  const guest = await runGate(html, { role: 'guest', username: 'Guest' })
  check(`${base}: a guest is sent to the published site`, () => {
    assert(guest.injected.length === 0, 'the development bundle was handed to a guest')
    assert(guest.replaced === 'index.html', `expected a redirect to index.html, got ${guest.replaced}`)
  })

  const anon = await runGate(html, null)
  check(`${base}: nobody signed in is sent to the published site`, () => {
    assert(anon.injected.length === 0, 'the development bundle loaded with no session at all')
    assert(anon.replaced === 'index.html', `expected a redirect to index.html, got ${anon.replaced}`)
  })

  const offline = await runGate(html, 'offline')
  check(`${base}: with no backend answering, it falls back rather than trusting the page`, () => {
    assert(offline.injected.length === 0, 'the development bundle loaded with no backend to ask')
    assert(offline.replaced === 'index.html', `expected a redirect to index.html, got ${offline.replaced}`)
  })
}

for (const r of results) {
  console.log(`  ${r.ok ? green('✓') : red('✗')} ${r.name}`)
  if (!r.ok) console.log(`      ${r.detail}`)
}
const failed = results.filter((r) => !r.ok).length
console.log(
  failed === 0
    ? `  ${green('✓')} ${results.length} checks passed — the development page answers to the administrator alone\n`
    : `  ${red('✗')} ${failed} of ${results.length} checks failed\n`,
)
process.exit(failed === 0 ? 0 : 1)
