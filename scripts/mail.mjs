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
 *     demo@Mixt.MPL, with the subject and body intact;
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
    body: { to: 'Mixt_MPL@Mixt.MPL', subject, body: bodyText },
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
      if (got.from !== 'demo@Mixt.MPL') bad(`it says it is from ${got.from}, not demo@Mixt.MPL`)
      if (got.to !== 'Mixt_MPL@Mixt.MPL') bad(`it is addressed to ${got.to}`)
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
    else if (got.to !== 'Mixt_MPL@Mixt.MPL') bad(`it was delivered to ${got.to} instead of the canonical address`)
    else ok('a bare local part resolves to the same mailbox')
  }

  const nobody = await api('/api/mail/send', { method: 'POST', token: demo, body: { to: 'nobody@Mixt.MPL', subject: 'lost', body: 'x' } })
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
  console.log('• publishing an app…')
  const noCode = await api('/api/apps', { method: 'POST', token: demo, body: { name: 'Half an app' } })
  if (noCode.status !== 400) bad(`publishing with no code gave ${noCode.status}, expected 400`)
  else if (!/code/.test(noCode.data.error || '')) bad(`the refusal does not say the code is missing: ${noCode.data.error}`)
  else ok('publishing without the code is refused')

  const withCode = await api('/api/apps', { method: 'POST', token: demo, body: { name: 'Tea Timer', code: 'echo steep' } })
  if (withCode.status !== 200 || withCode.data.status !== 'pending')
    bad(`a whitelisted user publishing code gave ${withCode.status} ${JSON.stringify(withCode.data)}`)
  else ok('a whitelisted account can publish, and it waits for approval')

  const guestPub = await api('/api/apps', { method: 'POST', token: guestToken, body: { name: 'Guest app', code: 'x' } })
  if (guestPub.status !== 403) bad(`a guest could publish an app (${guestPub.status})`)
  else ok('a guest cannot publish')

  const adminPub = await api('/api/apps', { method: 'POST', token: root, body: { name: 'Console app', code: 'echo hi', approved: true } })
  if (adminPub.status !== 200 || adminPub.data.status !== 'approved')
    bad(`what the administrator publishes came back ${JSON.stringify(adminPub.data)}, expected approved`)
  else ok('what the administrator publishes goes straight out approved')

  console.log('• mailboxes can be switched…')
  const off = await api('/api/users/demo/mailbox', { method: 'POST', token: root, body: { on: false } })
  if (off.status !== 200) bad(`switching demo's mailbox off gave ${off.status}`)
  else {
    const readOff = await api('/api/mail', { token: demo })
    if (readOff.status !== 403) bad(`demo could still read a switched-off mailbox (${readOff.status})`)
    else ok('a switched-off mailbox cannot be read')
    const sendOff = await api('/api/mail/send', { method: 'POST', token: root, body: { to: 'demo', subject: 'blocked', body: 'x' } })
    if (sendOff.status !== 403) bad(`mail reached a switched-off mailbox (${sendOff.status})`)
    else if (!/has no mailbox/.test(sendOff.data.error || '')) bad(`the refusal is unclear: ${sendOff.data.error}`)
    else ok('and cannot be written to, with the reason given')
    const on = await api('/api/users/demo/mailbox', { method: 'POST', token: root, body: { on: true } })
    const readOn = await api('/api/mail', { token: demo })
    if (on.status !== 200 || readOn.status !== 200) bad(`switching the mailbox back on did not work (${on.status}/${readOn.status})`)
    else if (!(readOn.data || []).some((m) => m.subject === 'Tea timer request')) bad('the mail was lost while the mailbox was off')
    else ok('switching it back on brings the mail with it')
  }

  console.log('• guest mail…')
  const g2 = await api('/api/guest', { method: 'POST', body: { username: 'visitor', name: 'A Visitor', password: 'letmein' } })
  const visitor = g2.data.token
  if (!visitor) bad('a guest could not sign in with a name and password')
  const gOff = await api('/api/mail', { token: visitor })
  if (gOff.status !== 403) bad(`a guest had a mailbox before one was switched on (${gOff.status})`)
  else ok('guests have no mailbox until the administrator gives them one')

  /* a second guest, signed in before the switch went on, has to get one too */
  const g3 = await api('/api/guest', { method: 'POST', body: { username: 'caller', name: 'A Caller', password: 'letmein' } })
  const caller = g3.data.token

  await api('/api/users/guest/mailbox', { method: 'POST', token: root, body: { on: true } })
  const gOn = await api('/api/mail', { token: visitor })
  if (gOn.status !== 200) bad(`switching guest mail on did not give them one (${gOn.status})`)
  else {
    ok('the administrator can switch guest mail on')
    const gSend = await api('/api/mail/send', { method: 'POST', token: visitor, body: { to: 'demo', subject: 'Hello from a guest', body: 'Thanks for the tea.' } })
    if (gSend.status !== 200) bad(`a guest with a mailbox still could not send (${gSend.status})`)
    else {
      const demoBox = await api('/api/mail', { token: demo })
      const arrived = (demoBox.data || []).find((m) => m.subject === 'Hello from a guest')
      if (!arrived) bad("the guest's message never reached demo")
      else if (arrived.from !== 'visitor@Guest.MPL') bad(`it claims to be from ${arrived.from}`)
      else ok('and it says which guest it came from, on the guest domain')
    }
  }

  /* Each guest has a mailbox of their own rather than one shared box, so two
     people on the same machine do not read each other's mail. */
  const callerBox = await api('/api/mail', { token: caller })
  if (callerBox.status !== 200) bad(`the second guest got no mailbox (${callerBox.status})`)
  else if ((callerBox.data || []).length !== 0)
    bad(`the second guest can see ${(callerBox.data || []).length} message(s) that are not theirs`)
  else ok('a second guest gets their own empty mailbox, not the first guest\'s')

  const toCaller = await api('/api/mail/send', { method: 'POST', token: demo, body: { to: 'caller@Guest.MPL', subject: 'For the caller', body: 'Only for you.' } })
  if (toCaller.status !== 200) bad(`an account could not write to a guest address (${toCaller.status}: ${toCaller.data && toCaller.data.error})`)
  else {
    const [callerAfter, visitorAfter] = await Promise.all([
      api('/api/mail', { token: caller }),
      api('/api/mail', { token: visitor }),
    ])
    const got = (callerAfter.data || []).find((m) => m.subject === 'For the caller')
    const leaked = (visitorAfter.data || []).find((m) => m.subject === 'For the caller')
    if (!got) bad("mail addressed to one guest never arrived")
    else if (leaked) bad("mail for one guest turned up in another guest's mailbox")
    else ok('mail addressed to one guest reaches that guest alone')
  }

  /* The guest domain is the only way in: an address on it with guest mail
     switched off again is simply not reachable, and nothing is queued for it. */
  await api('/api/users/guest/mailbox', { method: 'POST', token: root, body: { on: false } })
  const closedOff = await api('/api/mail/send', { method: 'POST', token: demo, body: { to: 'caller@Guest.MPL', subject: 'No one home', body: 'x' } })
  if (closedOff.status !== 404) bad(`a guest address was still reachable with guest mail off (${closedOff.status})`)
  else ok('switching guest mail off makes the guest addresses unreachable')
  await api('/api/users/guest/mailbox', { method: 'POST', token: root, body: { on: true } })

  console.log('• guest sign-ins are tracked…')
  const log = await api('/api/guests', { token: root })
  if (log.status !== 200) bad(`the administrator could not read the guest log (${log.status})`)
  else {
    const entry = (log.data || []).find((g) => g.username === 'visitor')
    if (!entry) bad('the guest sign-in was not recorded')
    else if (entry.name !== 'A Visitor' || !entry.at) bad(`the record is incomplete: ${JSON.stringify(entry)}`)
    else ok('the administrator sees who signed in as a guest, and when')
    const denied = await api('/api/guests', { token: demo })
    if (denied.status !== 403) bad(`a standard user could read the guest log (${denied.status})`)
    else ok('nobody else can')
  }

  console.log('• the administrator can set a password…')
  const setPw = await api('/api/users/demo/password', { method: 'POST', token: root, body: { password: 'steep-longer' } })
  if (setPw.status !== 200) bad(`setting a password gave ${setPw.status}`)
  else {
    const oldPw = await api('/api/login', { method: 'POST', body: { username: 'demo', password: 'demo' } })
    if (oldPw.status !== 401) bad('the old password still works after it was changed')
    else ok('the old password stops working')
    const newPw = await api('/api/login', { method: 'POST', body: { username: 'demo', password: 'steep-longer' } })
    if (newPw.status !== 200) bad('the new password does not sign in')
    else ok('and the new one does')
    const blank = await api('/api/users/demo/password', { method: 'POST', token: root, body: { password: '' } })
    if (blank.status !== 400) bad(`an empty password was accepted (${blank.status})`)
    else ok('an empty password is refused')
  }
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
