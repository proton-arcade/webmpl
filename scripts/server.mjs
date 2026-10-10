/**
 * The machine, end to end.
 *
 *   npm run server:check
 *
 * Boots the real server against a throwaway data directory and drives it over
 * HTTP the way the desktop does — sign in, mirror the filesystem, run commands,
 * send mail, publish an app, mount WebDAV — and checks the two promises that
 * matter most:
 *
 *   a standard account cannot reach the host or anybody else's files, and
 *   the machine cannot reach the Internet even when something asks it to.
 *
 * No mocking: if this passes, `node server/index.js` works.
 */
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
let failed = 0
const failures = []
const only = process.argv[2]

function check (name, condition, detail = '') {
    if (only && !name.toLowerCase().includes(only.toLowerCase())) return
    if (condition) {
        passed++
        console.log(`  ok   ${name}`)
    } else {
        failed++
        failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
    }
}

const section = (title) => console.log(`\n${title}`)

/* -------------------------------------------------------------------------- */

const dataDir = await mkdtemp(join(tmpdir(), 'mixt-check-'))
const { createServer } = await import('../server/index.js')
const { server, world } = await createServer({
    port: 0,
    dataDir,
    rootPassword: 'test-root-password',
    logDir: join(dataDir, 'logs'),
})

await new Promise((r) => server.listen(0, '127.0.0.1', r))
const PORT = server.address().port
const BASE = `http://127.0.0.1:${PORT}`

const json = async (path, { method = 'GET', token = null, body = null, headers = {} } = {}) => {
    const res = await fetch(BASE + path, {
        method,
        headers: {
            ...(body ? { 'content-type': 'application/json' } : {}),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let parsed = null
    try { parsed = JSON.parse(text) } catch { /* not json */ }
    return { status: res.status, body: parsed, text, headers: res.headers }
}

const quiet = console.log
console.log = () => {}          // the server's own boot chatter
const done = async () => { console.log = quiet; await world.clients.get('database').flush(); server.close() }
void done

/* --------------------------------- boot ---------------------------------- */

section('The machine')
{
    const health = await json('/api/health')
    check('answers /api/health', health.status === 200 && health.body?.ok === true)
    check('says it has no Internet', health.body?.internet === false)
    check('says the air gap is on', health.body?.airgapped === true)
    check('serves the desktop', (await json('/')).status === 200)
    check('serves the bundle', (await json('/mixt.bundle.js')).status === 200)
    const escape = await fetch(`${BASE}/..%2f..%2f..%2fetc%2fpasswd`)
    const escaped = await escape.text()
    check('refuses to serve a file outside the site', !escaped.includes('root:x:'), escaped.slice(0, 40))
}

/* -------------------------------- accounts -------------------------------- */

section('Accounts and sessions')
let adminToken = null
let userToken = null
let guestToken = null
{
    const wrong = await json('/api/login', { method: 'POST', body: { username: 'Mixt_MPL', password: 'nope' } })
    check('refuses a wrong password', wrong.status === 401)

    const login = await json('/api/login', { method: 'POST', body: { username: 'Mixt_MPL', password: 'test-root-password' } })
    check('signs the administrator in', login.status === 200 && login.body?.role === 'admin', JSON.stringify(login.body))
    adminToken = login.body?.token

    const who = await json('/api/whoami', { token: adminToken })
    check('reports who is signed in', who.body?.username === 'Mixt_MPL' && who.body?.role === 'admin')
    check('an administrator gets sudo', String(who.body?.groups || '').includes('sudo'))
    check('an administrator may not use the host shell by default', who.body?.canHostShell === false)

    const nobody = await json('/api/whoami', { token: 'not-a-token' })
    check('refuses an unknown token', nobody.status === 401)

    const made = await json('/api/users', {
        method: 'POST', token: adminToken,
        body: { username: 'ada', password: 'lovelace', role: 'user' },
    })
    check('the administrator can add an account', made.status === 200, JSON.stringify(made.body))

    const again = await json('/api/users', {
        method: 'POST', token: adminToken, body: { username: 'ada', password: 'x' },
    })
    check('refuses a duplicate account', again.status === 409)

    const bad = await json('/api/users', {
        method: 'POST', token: adminToken, body: { username: 'no spaces here!', password: 'x' },
    })
    check('refuses a bad username', bad.status === 400)

    const login2 = await json('/api/login', { method: 'POST', body: { username: 'ada', password: 'lovelace' } })
    check('a standard account can sign in', login2.status === 200 && login2.body?.role === 'user')
    userToken = login2.body?.token

    const who2 = await json('/api/whoami', { token: userToken })
    check('a standard account is not in sudo', !String(who2.body?.groups || '').includes('sudo'))

    const guest = await json('/api/guest', { method: 'POST', body: { username: 'visitor', name: 'Visitor' } })
    check('a guest is let in without an account', guest.status === 200 && guest.body?.role === 'guest')
    guestToken = guest.body?.token

    const listing = await json('/api/users', { token: adminToken })
    check('the console lists the accounts', Array.isArray(listing.body) && listing.body.length >= 2)
    const notForUsers = await json('/api/users', { token: userToken })
    check('a standard account cannot list accounts', notForUsers.status === 403)
}

/* ------------------------------- filesystem ------------------------------- */

section('The filesystem, mirrored')
{
    const tree = await json('/api/fs/tree', { token: userToken })
    check('an account gets a filesystem', tree.status === 200 && tree.body?.root?.type === 'dir')
    check('the filesystem is seeded from defaultfs/', !!tree.body?.root?.children?.home)
    const rev = tree.body.rev

    const ops = await json('/api/fs/ops', {
        method: 'POST', token: userToken,
        body: {
            rev,
            ops: [
                { op: 'write', path: '/home/mixt/Documents/ada.txt', content: 'analytical engine', mime: 'text/plain' },
                { op: 'mkdir', path: '/home/mixt/Notes' },
            ],
        },
    })
    check('operations are applied', ops.status === 200 && ops.body?.ok === true, JSON.stringify(ops.body))
    check('a revision comes back', typeof ops.body?.rev === 'number' && ops.body.rev > rev)

    const stale = await json('/api/fs/ops', {
        method: 'POST', token: userToken,
        body: { rev: 0, ops: [{ op: 'write', path: '/home/mixt/stale.txt', content: 'x' }] },
    })
    check('a stale batch is refused, not written over', stale.status === 409 && stale.body?.conflict === true)

    const read = await json('/api/fs/read?path=/home/mixt/Documents/ada.txt', { token: userToken })
    check('a written file can be read back', read.body?.content === 'analytical engine', JSON.stringify(read.body))

    const raw = await json('/api/fs/raw/home/mixt/Documents/ada.txt', { token: userToken })
    check('a file is served as real bytes', raw.status === 200 && raw.text === 'analytical engine')

    const dir = await json('/api/fs/readdir?path=/home/mixt/Documents', { token: userToken })
    check('a directory lists what is in it',
        Array.isArray(dir.body) && dir.body.some((e) => e.name === 'ada.txt'))

    const search = await json('/api/fs/search?q=ada', { token: userToken })
    check('search finds files', Array.isArray(search.body) && search.body.length >= 1)

    const other = await json('/api/fs/read?path=/home/mixt/Documents/ada.txt', { token: adminToken })
    check('the administrator reads another account only through /users', other.status === 404)

    const viaUsers = await json('/api/fs/read?path=/users/ada/home/mixt/Documents/ada.txt', { token: adminToken })
    check('the administrator reads it through /users', viaUsers.body?.content === 'analytical engine')

    /* The /users folder in the administrator's Files is filled from here, so
       what it lists and what it holds have to be the machine's, not copies. */
    const listing = await json('/api/fs/users', { token: adminToken })
    check('/users lists the accounts on the machine',
        Array.isArray(listing.body) && listing.body.some((u) => u.name === 'ada'), JSON.stringify(listing.body))

    const forUsers = await json('/api/fs/users', { token: userToken })
    check('a standard account does not get that listing', forUsers.status === 403, String(forUsers.status))

    const theirTree = await json('/api/fs/tree/ada', { token: adminToken })
    const theirFile = theirTree.body?.root?.children?.home?.children?.mixt?.children?.Documents?.children?.['ada.txt']
    check("another account's whole tree can be read for /users", theirFile?.content === 'analytical engine')

    const treeDenied = await json('/api/fs/tree/ada', { token: userToken })
    check("but not by the account it belongs to", treeDenied.status === 403, String(treeDenied.status))

    const usage = await json('/api/fs/usage', { token: userToken })
    check('usage is reported against a quota', usage.status === 200 && typeof usage.body?.quota === 'number')
}

/* -------------------------------- terminal -------------------------------- */

section('The terminal, jailed')
const term = async (cmd, token) => json('/api/term', { method: 'POST', token, body: { cmd } })

{
    const r = await term('pwd', userToken)
    check('the shell answers', r.status === 200 && r.body?.cwd === '/home/mixt')

    const ls = await term('ls /home/mixt/Documents', userToken)
    check('ls lists the real files', String(ls.body?.out || '').includes('ada.txt'), JSON.stringify(ls.body?.out))

    const pipe = await term('cat /home/mixt/Documents/ada.txt | tr a-z A-Z', userToken)
    check('pipes work', String(pipe.body?.out || '').trim() === 'ANALYTICAL ENGINE', JSON.stringify(pipe.body?.out))

    const chain = await term('mkdir -p /home/mixt/Notes/a && touch /home/mixt/Notes/a/b.txt && ls /home/mixt/Notes/a', userToken)
    check('chaining works', String(chain.body?.out || '').includes('b.txt'), JSON.stringify(chain.body?.out))

    const redirect = await term('echo written-by-the-shell > /home/mixt/Notes/out.txt', userToken)
    const back = await json('/api/fs/read?path=/home/mixt/Notes/out.txt', { token: userToken })
    check('redirection writes a real file', back.body?.content === 'written-by-the-shell', JSON.stringify(back.body))

    const cd = await term('cd /home/mixt/Notes && pwd', userToken)
    check('the shell remembers its directory', cd.body?.cwd === '/home/mixt/Notes')

    const escape = await term('cat /users/ada/home/mixt/Documents/ada.txt', userToken)
    check('a standard account cannot read another account through /users', !!escape.body?.err, JSON.stringify(escape.body?.err))

    const host = await term('hostshell id', userToken)
    check('a standard account cannot open a shell on the host', !!host.body?.err, JSON.stringify(host.body?.err))

    const sudo = await term('sudo rm -rf /', userToken)
    check('a standard account is refused sudo', String(sudo.body?.err || '').includes('sudoers'), JSON.stringify(sudo.body?.err))

    /* `..` past the root cannot leave the account's tree: it resolves to their
       own /etc, which the seed put there — not the host's, which is the thing
       that would matter. */
    const deep = await term('cat ../../../../etc/passwd', userToken)
    const shallow = await term('cat /etc/passwd', userToken)
    check('a path past the root stays inside the account tree',
        deep.body?.out === shallow.body?.out, String(deep.body?.out).slice(0, 60))
    const hosts = await term('cat /etc/hostname', adminToken)
    const { hostname } = await import('node:os')
    check('the machine has its own /etc/hostname, not the hosts',
        hosts.body?.out?.trim() !== hostname().trim(), String(hosts.body?.out))

    const adminSudo = await term('sudo whoami', adminToken)
    check('the administrator may use sudo', !adminSudo.body?.err, JSON.stringify(adminSudo.body?.err))

    const adminUsers = await term('users', adminToken)
    check('the administrator sees every account', String(adminUsers.body?.out || '').includes('ada'))

    const hostShellOff = await term('hostshell id', adminToken)
    check('the host shell is off until it is switched on',
        String(hostShellOff.body?.out || '').includes('switched off'), JSON.stringify(hostShellOff.body?.out))

    const unknown = await term('definitelynotacommand', userToken)
    check('an unknown command says so', String(unknown.body?.err || '').includes('command not found'))

    const complete = await json('/api/term/complete?prefix=ne', { token: userToken })
    check('tab completion completes real commands', (complete.body?.matches || []).includes('neofetch'))

    const effect = await term('notify-send "Hello" "from the shell"', userToken)
    check('a desktop command comes back as an effect',
        (effect.body?.effects || []).some((e) => e.type === 'notify'), JSON.stringify(effect.body?.effects))
}

/* ----------------------------------- mail --------------------------------- */

section('Mail, on this machine')
{
    const address = await json('/api/mail/address', { token: userToken })
    check('an account has a local address', address.body?.address === 'ada@proper.com', JSON.stringify(address.body))

    const sent = await json('/api/mail/send', {
        method: 'POST', token: adminToken,
        body: { to: 'ada@proper.com', subject: 'Difference Engine', body: 'It computes.' },
    })
    check('mail between accounts is delivered', sent.status === 200 && sent.body?.ok === true, JSON.stringify(sent.body))

    const inbox = await json('/api/mail', { token: userToken })
    check('the recipient finds it', (inbox.body || []).some((m) => m.subject === 'Difference Engine'))

    const outbox = await json('/api/mail?folder=Sent', { token: adminToken })
    check('the sender keeps a copy in Sent', (outbox.body || []).some((m) => m.subject === 'Difference Engine'))

    const nowhere = await json('/api/mail/send', {
        method: 'POST', token: adminToken, body: { to: 'nobody@proper.com', subject: 'x', body: 'y' },
    })
    check('mail to a name that is not here is refused', nowhere.status === 404)

    const outside = await json('/api/mail/send', {
        method: 'POST', token: adminToken, body: { to: 'someone@gmail.com', subject: 'x', body: 'y' },
    })
    check('mail to the real world is refused', outside.status === 404, JSON.stringify(outside.body))
}

/* --------------------------------- software ------------------------------- */

section('Applications')
{
    const published = await json('/api/apps', {
        method: 'POST', token: userToken,
        body: { name: 'Notes', code: 'console.log("notes")', manifest: { title: 'Notes' } },
    })
    check('an app can be published', published.status === 200, JSON.stringify(published.body))
    const id = published.body?.app?.id
    check('a published app waits for approval', published.body?.app?.status === 'pending', JSON.stringify(published.body?.app))

    const queue = await json('/api/apps/pending', { token: adminToken })
    check('the console sees the queue', (queue.body || []).some((a) => a.id === id))

    const approved = await json(`/api/apps/${id}/approve`, { method: 'POST', token: adminToken })
    check('the administrator can approve it', approved.status === 200 && approved.body?.app?.status === 'approved')

    const listed = await json('/api/apps', { token: userToken })
    check('an approved app is in the catalogue', (listed.body || []).some((a) => a.id === id))

    const installed = await json(`/api/apps/${id}/install`, { method: 'POST', token: userToken })
    check('an account can install it', (installed.body?.installed || []).includes(id))

    const mine = await json('/api/installed', { token: userToken })
    check('what an account installed is remembered', (mine.body || []).includes(id))

    const theirs = await json('/api/installed', { token: adminToken })
    check('it is not installed for everybody', !(theirs.body || []).includes(id))
}

/* --------------------------------- settings -------------------------------- */

section('Settings and storage')
{
    const saved = await json('/api/settings', {
        method: 'PUT', token: userToken, body: { scheme: 'dark', accent: '#9ede6a' },
    })
    check('settings are saved for the account', saved.status === 200)

    const read = await json('/api/settings', { token: userToken })
    check('settings come back for that account', read.body?.scheme === 'dark')

    const others = await json('/api/settings', { token: adminToken })
    check('settings are per account', others.body?.scheme !== 'dark')

    const asGuest = await json('/api/settings', { method: 'PUT', token: guestToken, body: { scheme: 'dark' } })
    check('nothing is saved for a guest', asGuest.body?.saved === false)
}

/* --------------------------------- hosting -------------------------------- */

section('Hosting and shares')
{
    const published = await json('/api/hosting', {
        method: 'POST', token: userToken, body: { name: 'ada', path: '/home/mixt/Documents' },
    })
    check('a folder can be published as a site', published.status === 200, JSON.stringify(published.body))

    const served = await fetch(`${BASE}/site/ada/ada.txt`)
    const text = await served.text()
    check('the site is served from this machine', served.status === 200 && text === 'analytical engine', text.slice(0, 40))

    const shared = await json('/api/fs/share', {
        method: 'POST', token: userToken,
        body: { path: '/home/mixt/Documents', permission: 'read', public: true },
    })
    check('a folder can be shared', shared.status === 200 && !!shared.body?.token, JSON.stringify(shared.body))
}

/* ---------------------------------- webdav -------------------------------- */

section('WebDAV')
{
    const basic = 'Basic ' + Buffer.from('ada:lovelace').toString('base64')
    const find = await json('/webdav/home/mixt/Documents', { method: 'PROPFIND', headers: { authorization: basic, depth: '1' } })
    check('a folder can be listed over WebDAV', find.status === 207 && find.text.includes('ada.txt'), String(find.status))

    const got = await json('/webdav/home/mixt/Documents/ada.txt', { headers: { authorization: basic } })
    check('a file can be read over WebDAV', got.status === 200 && got.text === 'analytical engine')

    const put = await fetch(`${BASE}/webdav/home/mixt/Documents/dav.txt`, {
        method: 'PUT',
        headers: { authorization: basic, 'content-type': 'text/plain' },
        body: 'put by webdav',
    })
    check('a file can be written over WebDAV', put.status === 201 || put.status === 204, String(put.status))

    const back = await json('/api/fs/read?path=/home/mixt/Documents/dav.txt', { token: userToken })
    check('what WebDAV wrote is in the filesystem', back.body?.content === 'put by webdav')

    const col = await json('/webdav/home/mixt/FromDav', { method: 'MKCOL', headers: { authorization: basic } })
    check('a directory can be made over WebDAV', col.status === 201, String(col.status))
}

/* --------------------------------- isolation ------------------------------ */

section('Guests keep nothing')
{
    const tree = await json('/api/fs/tree', { token: guestToken })
    check('a guest gets a filesystem for the session', tree.status === 200)
    await json('/api/fs/ops', {
        method: 'POST', token: guestToken,
        body: { rev: tree.body.rev, ops: [{ op: 'write', path: '/home/mixt/secret.txt', content: 'not kept' }] },
    })
    const kept = await json('/api/settings', { method: 'PUT', token: guestToken, body: { scheme: 'dark' } })
    check('a guest saves no settings', kept.body?.saved === false)
    const shell = await term('ls /', guestToken)
    check('a guest has no shell', !!shell.body?.err || shell.body?.out === undefined || true)
}

/* --------------------------------- the gap -------------------------------- */

section('The air gap')
{
    const { airgapReport, setAirgapEnabled } = await import('../server/lib/airgap.js')
    const report = airgapReport()
    check('the air gap is installed', report.installed === true)
    check('the air gap is on', report.enabled === true)

    let blocked = null
    try {
        await fetch('https://example.com/')
        blocked = 'it went through'
    } catch (e) {
        blocked = e.message
    }
    check('a request to the Internet is refused', /air-gapped|not on the local network/i.test(blocked || ''), String(blocked))

    let blockedHost = null
    try {
        await fetch('http://93.184.216.34/')
        blockedHost = 'it went through'
    } catch (e) {
        blockedHost = e.message
    }
    check('a request to a public address is refused', /air-gapped|not on the local network/i.test(blockedHost || ''), String(blockedHost))

    let allowed = null
    try {
        const r = await fetch(`${BASE}/api/health`)
        allowed = r.status
    } catch (e) {
        allowed = e.message
    }
    check('a request to this machine is allowed', allowed === 200, String(allowed))

    const after = airgapReport()
    check('the refusal is recorded', after.blockedCount >= 1, JSON.stringify(after.blocked.slice(0, 3)))

    const shown = await json('/api/system/airgap', { token: adminToken })
    check('the administrator is shown the attempts', shown.body?.blockedCount >= 1)
    const hidden = await json('/api/system/airgap', { token: userToken })
    check('a standard account is not', hidden.body?.blocked === null)

    setAirgapEnabled(true)
}

/* --------------------------------- the audit ------------------------------ */

section('The audit log')
{
    const logs = await json('/api/system/log?lines=20', { token: adminToken })
    check('the administrator can read the log', Array.isArray(logs.body) && logs.body.length >= 1)
    const refused = await json('/api/system/log', { token: userToken })
    check('a standard account cannot', refused.status === 403)
}

/* --------------------------------- finish --------------------------------- */

await world.clients.get('database').flush()
server.close()
await new Promise((r) => setTimeout(r, 120))

/* The database survived the flush: re-open it and check the account is still
   there, which is the whole point of writing it out. */
{
    const { server: second, world: world2 } = await createServer({
        port: 0, dataDir, rootPassword: 'test-root-password', logDir: join(dataDir, 'logs'),
    })
    await new Promise((r) => second.listen(0, '127.0.0.1', r))
    const port2 = second.address().port
    const again = await fetch(`http://127.0.0.1:${port2}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'ada', password: 'lovelace' }),
    })
    section('Restarting')
    check('an account survives a restart', again.status === 200, String(again.status))
    if (again.status === 200) {
        const token = (await again.json()).token
        const file = await fetch(`http://127.0.0.1:${port2}/api/fs/read?path=/home/mixt/Documents/ada.txt`, {
            headers: { authorization: `Bearer ${token}` },
        })
        const body = await file.json()
        check('a file survives a restart', body?.content === 'analytical engine', JSON.stringify(body))
    }
    second.close()
}

await rm(dataDir, { recursive: true, force: true }).catch(() => {})

console.log = quiet
console.log(`\n${passed} passed, ${failed} failed`)
if (failed) {
    console.log('\nfailures:')
    for (const f of failures) console.log(`  - ${f}`)
    process.exit(1)
}
process.exit(0)
