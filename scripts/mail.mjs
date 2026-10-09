/**
 * Mail delivery check — the real backend, two real accounts.
 *
 *   npm run mail
 *
 * Every other harness drives the frontend; this one drives server.cjs over
 * HTTP, because "one user's mail arrives in another user's inbox" is a claim
 * about the server, not about the pixels. It starts its own backend on a free
 * port with its own data file (MIXT_DB), so the developer's data.json is never
 * touched and the run is repeatable.
 *
 * What it proves:
 *   - a message sent by `demo` appears in `Mixt_MPL`'s Inbox, unread, from
 *     demo@proper.com, with the subject and body intact;
 *   - the sender keeps a copy in Sent;
 *   - reading the mailbox twice does not duplicate anything;
 *   - a bare local part (`Mixt_MPL`) resolves like the full address;
 *   - an address with no account behind it is refused with a reason, not
 *     silently dropped;
 *   - a guest cannot send (nothing is stored for guests) and cannot read.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'

const ROOT = new URL('..', import.meta.url).pathname
const green = (s) => `\x1b[32m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`

let failures = 0
const ok = (m) => console.log('  ' + green('✓') + ' ' + m)
const bad = (m) => {
  failures++
  console.log('  ' + red('✗') + ' ' + m)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer()
    s.on('error', rej)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => res(port))
    })
  })
}

const port = await freePort()
const BASE = `http://127.0.0.1:${port}`
const dir = mkdtempSync(join(tmpdir(), 'mixt-mail-'))
const db = join(dir, 'data.json')

/* root password comes from ROOTPASS.md, exactly as the server reads it */
const rootPass = (() => {
  const line = readFileSync(join(ROOT, 'ROOTPASS.md'), 'utf8').split('\n').find((l) => l.includes('Current root password')) || ''
  const m = /`([^`]+)`/.exec(line)
  return m ? m[1] : 'mixt-root'
})()

const child = spawn(process.execPath, ['server.cjs'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(port), MIXT_DB: db },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverLog = ''
child.stdout.on('data', (c) => (serverLog += c))
child.stderr.on('data', (c) => (serverLog += c))

async function api(path, { method = 'GET', token, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const type = r.headers.get('content-type') || ''
  const data = type.includes('json') ? await r.json() : await r.text()
  return { status: r.status, data }
}

async function signIn(username, password) {
  const r = await api('/api/login', { method: 'POST', body: { username, password } })
  if (r.status !== 200 || !r.data.ok) throw new Error(`could not sign in as ${username}: ${r.status} ${JSON.stringify(r.data)}`)
  return r.data.token
}

/* wait for the backend to answer */
let up = false
for (let i = 0; i < 60 && !up; i++) {
  try {
    up = (await api('/api/health')).status === 200
  } catch {
    await wait(100)
  }
}
if (!up) {
  console.log(red('the test backend never started:\n' + serverLog))
  child.kill('SIGKILL')
  process.exit(1)
}

try {
  console.log('• two accounts, one machine…')
  const demo = await signIn('demo', 'demo')
  const root = await signIn('Mixt_MPL', rootPass)
  ok('demo and Mixt_MPL are both signed in')

  console.log('• demo writes to the administrator…')
  const subject = 'Tea timer request'
  const bodyText = 'Can the panel clock show seconds? I time my tea with it.'
  const sent = await api('/api/mail/send', {
    method: 'POST',
    token: demo,
    body: { to: 'Mixt_MPL@proper.com', subject, body: bodyText },
  })
  if (sent.status !== 200 || !sent.data.ok) bad(`sending failed: ${sent.status} ${JSON.stringify(sent.data)}`)
  else {
    ok('the message was accepted')
    if (!sent.data.id) bad('the server did not return a message id')

    const inbox = await api('/api/mail', { token: root })
    const got = (inbox.data || []).find((m) => m.subject === subject)
    if (!got) bad(`Mixt_MPL's inbox has ${ (inbox.data || []).length } message(s) and none of them is the one demo sent`)
    else {
      ok('it arrived in the administrator\'s Inbox')
      if (got.folder !== 'Inbox') bad(`it landed in ${got.folder}, not Inbox`)
      if (got.read !== false) bad('it arrived already marked read')
      if (got.from !== 'demo@proper.com') bad(`it says it is from ${got.from}, not demo@proper.com`)
      if (got.to !== 'Mixt_MPL@proper.com') bad(`it is addressed to ${got.to}`)
      if (got.body !== bodyText) bad('the body was altered in transit')
      else ok('from, to, subject and body all survived the trip')
    }

    const again = await api('/api/mail', { token: root })
    const copies = (again.data || []).filter((m) => m.subject === subject)
    if (copies.length !== 1) bad(`reading the inbox twice produced ${copies.length} copies of the same message`)
    else ok('reading the mailbox again does not duplicate it')

    const sentBox = await api('/api/mail', { token: demo })
    const copy = (sentBox.data || []).find((m) => m.subject === subject)
    if (!copy) bad('demo has no copy of the message they sent')
    else if (copy.folder !== 'Sent') bad(`demo's copy is in ${copy.folder}, not Sent`)
    else ok('the sender keeps a copy in Sent')

    const demoInbox = (sentBox.data || []).filter((m) => m.folder === 'Inbox' && m.subject === subject)
    if (demoInbox.length) bad('the message also turned up in the sender\'s own Inbox')
    else ok('mailboxes stay separate')
  }

  console.log('• addresses…')
  const bare = await api('/api/mail/send', { method: 'POST', token: demo, body: { to: 'Mixt_MPL', subject: 'bare local part', body: 'x' } })
  if (bare.status !== 200 || !bare.data.ok) bad(`a bare "Mixt_MPL" was refused: ${bare.status} ${JSON.stringify(bare.data)}`)
  else {
    const inbox = await api('/api/mail', { token: root })
    const got = (inbox.data || []).find((m) => m.subject === 'bare local part')
    if (!got) bad('the bare local part was accepted but nothing was delivered')
    else if (got.to !== 'Mixt_MPL@proper.com') bad(`it was delivered to ${got.to} instead of the canonical address`)
    else ok('a bare local part resolves to the same mailbox')
  }

  const nobody = await api('/api/mail/send', { method: 'POST', token: demo, body: { to: 'nobody@proper.com', subject: 'lost', body: 'x' } })
  if (nobody.status !== 404) bad(`an unknown recipient gave ${nobody.status}, expected 404`)
  else if (!/nobody/.test(nobody.data.error || '')) bad(`the refusal does not name the address: ${nobody.data.error}`)
  else ok('an address with no account behind it is refused with a reason')

  const blank = await api('/api/mail/send', { method: 'POST', token: demo, body: { to: '   ', subject: 'x', body: 'x' } })
  if (blank.status !== 400) bad(`an empty recipient gave ${blank.status}, expected 400`)
  else ok('an empty recipient is refused')

  console.log('• guests…')
  const g = await api('/api/guest', { method: 'POST' })
  const guestToken = g.data.token
  const gSend = await api('/api/mail/send', { method: 'POST', token: guestToken, body: { to: 'demo', subject: 'from a guest', body: 'x' } })
  if (gSend.status !== 403) bad(`a guest could send mail (${gSend.status})`)
  else ok('a guest cannot send')
  const gRead = await api('/api/mail', { token: guestToken })
  if (gRead.status !== 403) bad(`a guest could read a mailbox (${gRead.status})`)
  else ok('a guest has no mailbox to read')

  const demoAfter = await api('/api/mail', { token: demo })
  if ((demoAfter.data || []).some((m) => m.subject === 'from a guest')) bad("the guest's message was delivered anyway")
  else ok("nothing from the guest reached anyone's inbox")
} catch (e) {
  bad(`the check threw: ${e.message}`)
  if (serverLog) console.log(serverLog)
} finally {
  child.kill('SIGTERM')
  await wait(200)
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* a leftover temp dir is not worth failing over */
  }
}

console.log('')
if (failures) {
  console.log(red(`  ${failures} failure(s)`))
  process.exit(1)
}
console.log(green('  ✓ mail really travels between the accounts on this machine'))
