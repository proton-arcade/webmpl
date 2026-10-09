/* Mixt Web OS — non-static backend (dependency-free).
 *
 *   node server.js            → http://localhost:8080
 *
 * Serves the existing static site AND a small JSON API backed by data.json.
 * The frontend (src/os/api.ts) talks to /api/* when present and falls back to
 * the offline, localStorage-only mode when it is not — so the plain static
 * build keeps working unchanged.
 *
 * Auth model:
 *   - whitelisted users (username + password) created by the admin;
 *   - the administrator account `Mixt_MPL`, gated by the root password in
 *     ROOTPASS.md;
 *   - guests: allowed in, but given role "guest" and NOTHING is saved for them
 *     (no desktop layout, settings or mail) — the server refuses their writes
 *     and the client keeps them in memory only.
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = __dirname
const DB = process.env.MIXT_DB || path.join(ROOT, 'data.json')
const PORT = process.env.PORT || 8080

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
}

/* ------------------------------ persistence ------------------------------ */
function readRootPass() {
  try {
    const m = /`([^`]+)`/.exec(fs.readFileSync(path.join(ROOT, 'ROOTPASS.md'), 'utf8').split('\n').find((l) => l.includes('Current root password')) || '')
    return m ? m[1] : 'mixt-root'
  } catch { return 'mixt-root' }
}
const hash = (pw, salt) => crypto.createHash('sha256').update(`${salt}::${pw}`).digest('hex')
const newToken = () => crypto.randomBytes(16).toString('hex')

function seed() {
  const root = readRootPass()
  return {
    users: [
      { username: 'Mixt_MPL', role: 'admin', salt: 's-admin', hash: hash(root, 's-admin') },
      { username: 'demo', role: 'user', salt: 's-demo', hash: hash('demo', 's-demo') },
    ],
    sessions: {}, // token -> {username, role}
    apps: [],     // published apps: {id,name,author,status:'pending'|'approved',manifest}
    mail: {},     // username -> [mails]  (and 'guest' when the guest mailbox is on)
    settings: {}, // username -> saved settings (never for guests)
    guestMailbox: false, // the administrator can give guests one shared mailbox
  }
}
function load() {
  try { return JSON.parse(fs.readFileSync(DB, 'utf8')) } catch { return seed() }
}
function save(db) { fs.writeFileSync(DB, JSON.stringify(db, null, 2)) }

/* --------------------------------- helpers -------------------------------- */
function bodyOf(req) {
  return new Promise((res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => res(b)) })
}
function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(obj))
}
function sessionOf(req, db) {
  const h = req.headers.authorization || ''
  const t = h.replace(/^Bearer /, '')
  return db.sessions[t] || null
}
const tokenOf = (req) => (req.headers.authorization || '').replace(/^Bearer /, '')

/* Which mailbox a session may use, or null for none.
 *
 * A whitelisted account has one unless the administrator switched it off; a
 * guest has one only if the administrator switched the shared guest mailbox on.
 * Accounts created before the flag existed count as switched on. */
function mailboxFor(db, sess) {
  if (!sess) return null
  if (sess.role === 'guest') return db.guestMailbox ? 'guest' : null
  const u = db.users.find((x) => x.username === sess.username)
  if (!u || u.mailbox === false) return null
  return u.username
}

/* --------------------------------- router --------------------------------- */
/* A request target is attacker-controlled and need not be a URL: `GET http://`,
 * `GET ///` and friends make `new URL` throw ERR_INVALID_URL. Thrown inside the
 * request handler that is an uncaught exception, which takes the whole server
 * down — every session, every mailbox. So parse defensively, answer 400, and
 * keep going. */
function pathOf(req) {
  try {
    return new URL(req.url, 'http://localhost').pathname
  } catch {
    return null
  }
}

const server = http.createServer(async (req, res) => {
  const p = pathOf(req)
  if (p === null) return json(res, 400, { ok: false, error: 'malformed request target' })

  try {
    await route(req, res, p)
  } catch (e) {
    /* one broken request must never cost the server its life */
    console.error(`request ${req.method} ${req.url} failed:`, e && e.message)
    if (!res.headersSent) json(res, 500, { ok: false, error: 'internal error' })
    else try { res.end() } catch { /* already gone */ }
  }
})

async function route(req, res, p) {
  if (p.startsWith('/api/')) {
    const db = load()
    const sess = sessionOf(req, db)
    const raw = await bodyOf(req)
    let data = {}
    try { data = raw ? JSON.parse(raw) : {} } catch {}

    if (p === '/api/health') return json(res, 200, { ok: true })

    if (p === '/api/login' && req.method === 'POST') {
      const u = db.users.find((x) => x.username === (data.username || '').trim())
      if (!u || hash(data.password || '', u.salt) !== u.hash) return json(res, 401, { ok: false, error: 'wrong username or password' })
      const token = newToken()
      db.sessions[token] = { username: u.username, role: u.role }
      save(db)
      return json(res, 200, { ok: true, token, role: u.role, username: u.username })
    }

    /* A guest is still a guest — no account, nothing of theirs is persisted —
     * but they now sign in with a username, a name and a password, and the
     * server keeps a log of those sign-ins so the administrator can see who has
     * been using the machine instead of an anonymous extra live session. The
     * password is salted and hashed like any other; it is never stored plain. */
    if (p === '/api/guest' && req.method === 'POST') {
      const token = newToken()
      const name = String(data.name || '').trim()
      const username = String(data.username || '').trim() || 'guest'
      db.sessions[token] = { username, role: 'guest', name }
      ;(db.guestLog ||= []).push({
        username,
        name,
        at: Date.now(),
        salt: crypto.randomBytes(6).toString('hex'),
        hash: hash(String(data.password || ''), crypto.randomBytes(6).toString('hex')),
      })
      save(db)
      return json(res, 200, { ok: true, token, role: 'guest', username, name })
    }

    /* who has signed in as a guest, most recent last */
    if (p === '/api/guests' && req.method === 'GET') {
      if (!sess || sess.role !== 'admin') return json(res, 403, { ok: false, error: 'admin only' })
      return json(res, 200, (db.guestLog || []).map((g) => ({ username: g.username, name: g.name, at: g.at })))
    }

    if (p === '/api/session') return json(res, 200, sess ? { ok: true, ...sess } : { ok: false })

    if (p === '/api/users' && req.method === 'GET') {
      if (!sess || sess.role !== 'admin') return json(res, 403, { ok: false, error: 'admin only' })
      return json(res, 200, db.users.map((u) => ({ username: u.username, role: u.role, mailbox: u.mailbox !== false })))
    }

    if (p === '/api/users' && req.method === 'POST') {
      if (!sess || sess.role !== 'admin') return json(res, 403, { ok: false, error: 'admin only' })
      if (!/^[a-z0-9._-]{2,24}$/i.test(data.username || '')) return json(res, 400, { ok: false, error: 'bad username' })
      if (db.users.some((u) => u.username === data.username)) return json(res, 400, { ok: false, error: 'exists' })
      const salt = crypto.randomBytes(6).toString('hex')
      db.users.push({ username: data.username, role: data.role === 'admin' ? 'admin' : 'user', salt, hash: hash(data.password || '', salt) })
      save(db)
      return json(res, 200, { ok: true })
    }

    if (p === '/api/apps' && req.method === 'GET')
      return json(res, 200, (sess && sess.role === 'admin' ? db.apps : db.apps.filter((a) => a.status === 'approved')))

    if (p === '/api/apps' && req.method === 'POST') {
      /* Only a whitelisted account may publish: a guest has nothing to publish
       * under and no way to be held to it. */
      if (!sess || sess.role === 'guest' || !db.users.some((u) => u.username === sess.username))
        return json(res, 403, { ok: false, error: 'only whitelisted accounts can publish apps' })
      /* An app without its code is not an app — there would be nothing to run. */
      const code = String(data.code || '').trim()
      if (!code) return json(res, 400, { ok: false, error: 'the code of the app is required' })
      /* Anything anybody else publishes waits for approval. What the
       * administrator publishes from the console goes straight out approved —
       * there is nobody above them to approve it. */
      const byAdmin = sess.role === 'admin' && data.approved === true
      const id = 'app-' + crypto.randomBytes(4).toString('hex')
      db.apps.push({
        id,
        name: data.name || 'Untitled app',
        author: byAdmin ? String(data.author || sess.username) : sess.username,
        status: byAdmin ? 'approved' : 'pending',
        manifest: data.manifest || {},
        code,
      })
      save(db)
      return json(res, 200, { ok: true, id, status: byAdmin ? 'approved' : 'pending' })
    }

    if (/^\/api\/apps\/[^/]+\/approve$/.test(p) && req.method === 'POST') {
      if (!sess || sess.role !== 'admin') return json(res, 403, { ok: false, error: 'admin only' })
      const id = p.split('/')[3]
      const app = db.apps.find((a) => a.id === id)
      if (!app) return json(res, 404, { ok: false })
      app.status = 'approved'
      save(db)
      return json(res, 200, { ok: true })
    }

    /* reject = drop a submitted app from the queue */
    if (/^\/api\/apps\/[^/]+\/reject$/.test(p) && req.method === 'POST') {
      if (!sess || sess.role !== 'admin') return json(res, 403, { ok: false, error: 'admin only' })
      const id = p.split('/')[3]
      const i = db.apps.findIndex((a) => a.id === id)
      if (i < 0) return json(res, 404, { ok: false })
      db.apps.splice(i, 1)
      save(db)
      return json(res, 200, { ok: true })
    }

    /* everything an administrator console needs to show at a glance */
    if (p === '/api/stats' && req.method === 'GET') {
      if (!sess || sess.role !== 'admin') return json(res, 403, { ok: false, error: 'admin only' })
      return json(res, 200, {
        ok: true,
        users: db.users.length,
        admins: db.users.filter((u) => u.role === 'admin').length,
        sessions: Object.keys(db.sessions).length,
        appsPending: db.apps.filter((a) => a.status === 'pending').length,
        appsApproved: db.apps.filter((a) => a.status === 'approved').length,
        mailboxes: Object.keys(db.mail).length,
        savedSettings: Object.keys(db.settings).length,
        guestMailbox: db.guestMailbox === true,
        guestLogins: (db.guestLog || []).length,
      })
    }

    /* Set a new password for any whitelisted account. The old one stops working
     * immediately, so that account's other live sessions are dropped — except
     * the administrator's own, or they would lock themselves out mid-change.
     * Passwords are stored salted and hashed; the server can never show one. */
    if (/^\/api\/users\/[^/]+\/password$/.test(p) && req.method === 'POST') {
      if (!sess || sess.role !== 'admin') return json(res, 403, { ok: false, error: 'admin only' })
      const name = decodeURIComponent(p.split('/')[3])
      const u = db.users.find((x) => x.username === name)
      if (!u) return json(res, 404, { ok: false })
      const pw = String(data.password || '')
      if (!pw) return json(res, 400, { ok: false, error: 'a password is required' })
      u.salt = crypto.randomBytes(6).toString('hex')
      u.hash = hash(pw, u.salt)
      const me = tokenOf(req)
      for (const tk of Object.keys(db.sessions))
        if (db.sessions[tk].username === name && tk !== me) delete db.sessions[tk]
      save(db)
      return json(res, 200, { ok: true })
    }

    /* Switch a mailbox on or off — for a whitelisted account, or for guest
     * accounts as one shared mailbox. Switching off hides it; the mail itself is
     * kept, so switching back on brings it back. */
    if (/^\/api\/users\/[^/]+\/mailbox$/.test(p) && req.method === 'POST') {
      if (!sess || sess.role !== 'admin') return json(res, 403, { ok: false, error: 'admin only' })
      const name = decodeURIComponent(p.split('/')[3])
      const on = data.on !== false
      if (name === 'guest') {
        db.guestMailbox = on
        if (on) db.mail.guest ||= []
        save(db)
        return json(res, 200, { ok: true, on })
      }
      const u = db.users.find((x) => x.username === name)
      if (!u) return json(res, 404, { ok: false })
      u.mailbox = on
      if (on) db.mail[u.username] ||= []
      save(db)
      return json(res, 200, { ok: true, on })
    }

    /* remove a whitelisted account (never your own, never the last admin) */
    if (/^\/api\/users\/[^/]+\/remove$/.test(p) && req.method === 'POST') {
      if (!sess || sess.role !== 'admin') return json(res, 403, { ok: false, error: 'admin only' })
      const name = decodeURIComponent(p.split('/')[3])
      if (name === sess.username) return json(res, 400, { ok: false, error: 'you cannot remove your own account' })
      const i = db.users.findIndex((u) => u.username === name)
      if (i < 0) return json(res, 404, { ok: false })
      if (db.users[i].role === 'admin' && db.users.filter((u) => u.role === 'admin').length <= 1)
        return json(res, 400, { ok: false, error: 'that is the only administrator' })
      db.users.splice(i, 1)
      for (const t of Object.keys(db.sessions)) if (db.sessions[t].username === name) delete db.sessions[t]
      save(db)
      return json(res, 200, { ok: true })
    }

    if (p === '/api/settings') {
      if (!sess || sess.role === 'guest') return json(res, 403, { ok: false, error: 'guests are not saved' })
      if (req.method === 'GET') return json(res, 200, db.settings[sess.username] || null)
      db.settings[sess.username] = data
      save(db)
      return json(res, 200, { ok: true })
    }

    if (p === '/api/mail') {
      const box = mailboxFor(db, sess)
      if (!box) return json(res, 403, { ok: false, error: 'this session has no mailbox' })
      if (req.method === 'GET') return json(res, 200, db.mail[box] || [])
      ;(db.mail[box] ||= []).push(data)
      save(db)
      return json(res, 200, { ok: true })
    }

    /* Deliver a message to another account on this computer.
     *
     * The address is resolved against the whitelisted users: `demo@proper.com`
     * and bare `demo` both mean the account `demo`. There is no relay to the
     * outside world — this machine only carries mail between its own users.
     * The sender keeps a copy in Sent, exactly as a mail client would. */
    if (p === '/api/mail/send' && req.method === 'POST') {
      const box = mailboxFor(db, sess)
      if (!box) return json(res, 403, { ok: false, error: 'this session has no mailbox' })
      const to = String(data.to || '').trim()
      if (!to) return json(res, 400, { ok: false, error: 'no recipient' })
      const local = to.split('@')[0].toLowerCase()
      /* "guest" reaches the shared guest mailbox when it is switched on */
      let targetName = null
      if (local === 'guest' && db.guestMailbox) targetName = 'guest'
      else {
        const u = db.users.find((x) => x.username.toLowerCase() === local)
        if (!u) return json(res, 404, { ok: false, error: `no mailbox for ${local} on this computer` })
        if (u.mailbox === false) return json(res, 403, { ok: false, error: `${u.username} has no mailbox` })
        targetName = u.username
      }
      const now = Date.now()
      const id = 'srv' + now.toString(36) + crypto.randomBytes(3).toString('hex')
      const from = `${box}@proper.com`
      const address = `${targetName}@proper.com`
      const base = {
        from,
        fromName: box,
        to: address,
        subject: String(data.subject || '(no subject)'),
        date: now,
        body: String(data.body || ''),
        starred: false,
        labels: [],
      }
      ;(db.mail[targetName] ||= []).push({ ...base, id, folder: 'Inbox', read: false })
      ;(db.mail[box] ||= []).push({ ...base, id: id + 'c', folder: 'Sent', read: true })
      save(db)
      return json(res, 200, { ok: true, id, to: targetName })
    }

    return json(res, 404, { ok: false })
  }

  /* static */
  let file = p === '/' ? '/index.html' : p
  fs.readFile(path.join(ROOT, file), (e, buf) => {
    if (e) { res.writeHead(404); return res.end('404') }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
    res.end(buf)
  })
}

/* Last line of defence: something thrown outside a request (a bad timer, a
 * failed file write) logs and carries on instead of ending the process. */
process.on('uncaughtException', (e) => console.error('uncaught, server still up:', e && e.message))
process.on('unhandledRejection', (e) => console.error('unhandled rejection, server still up:', e && e.message))

server.listen(PORT, '0.0.0.0', () => console.log(`Mixt backend on http://localhost:${PORT}`))
