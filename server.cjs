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
    mail: {},     // mailbox key -> [mails]; keys are usernames, or guest:<name> for a guest
    settings: {}, // username -> saved settings (never for guests)
    guestMailbox: false, // the administrator can give guests a mailbox each
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

/* Mail is carried only between accounts on this machine. There is no relay to
 * the outside world and nothing here resolves in DNS: `.mpl` is not a real
 * top-level domain, and the server never opens a socket to deliver anything.
 * Two domains, both invented and both local:
 *
 *   whitelisted accounts   name@Mixt.MPL
 *   guests                 NAME@Guest.MPL
 *
 * A guest's address is their own, so two people sharing a machine do not read
 * each other's mail the way one shared guest mailbox made them. */
const GUEST_DOMAIN = 'Guest.MPL'
const USER_DOMAIN = 'Mixt.MPL'

/** the mailbox key a session writes to and reads from, or null for none */
function mailboxFor(db, sess) {
  if (!sess) return null
  /* Guests get one each, keyed so it cannot collide with a real account. The
     administrator's guest-mailbox switch still governs whether guests get one
     at all. Accounts created before the flag existed count as switched on. */
  if (sess.role === 'guest') {
    if (!db.guestMailbox) return null
    const name = String(sess.username || '').trim() || 'guest'
    return `guest:${name.toLowerCase()}`
  }
  const u = db.users.find((x) => x.username === sess.username)
  if (!u || u.mailbox === false) return null
  return u.username
}

/** the address a mailbox key is reached at */
function addressOf(key) {
  if (key.startsWith('guest:')) return `${key.slice(6)}@${GUEST_DOMAIN}`
  return `${key}@${USER_DOMAIN}`
}

/**
 * Resolve an address somebody typed to a mailbox key.
 *
 * Returns { key } on success, or { status, error } when it cannot be delivered
 * to. The two are kept apart because they mean different things to the person
 * who typed the address: 404 is "there is nobody by that name here", 403 is
 * "that person is here but their mailbox is switched off". Collapsing them into
 * one answer would tell somebody their colleague does not exist.
 */
function resolveAddress(db, to) {
  const raw = String(to || '').trim()
  const at = raw.lastIndexOf('@')
  const local = (at < 0 ? raw : raw.slice(0, at)).toLowerCase()
  const domain = at < 0 ? '' : raw.slice(at + 1).toLowerCase()
  if (!raw || !local) return { status: 400, error: 'no recipient' }

  if (domain === GUEST_DOMAIN.toLowerCase()) {
    /* A guest address only exists while the administrator has guest mail on.
       Guests are not accounts, so there is no name to look up: with the switch
       off, nobody by that name is reachable. */
    if (!db.guestMailbox) return { status: 404, error: `no mailbox for ${local} on this computer` }
    return { key: `guest:${local}` }
  }

  /* a bare local part, or an address on the account domain */
  if (domain && domain !== USER_DOMAIN.toLowerCase())
    return { status: 404, error: `no mailbox for ${local} on this computer` }
  const u = db.users.find((x) => x.username.toLowerCase() === local)
  if (!u) return { status: 404, error: `no mailbox for ${local} on this computer` }
  if (u.mailbox === false) return { status: 403, error: `${u.username} has no mailbox` }
  return { key: u.username }
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
      /* A guest's own mailbox, when the administrator has guest mail switched
         on: NAME@Guest.MPL, reached only from inside this machine. */
      if (db.guestMailbox) db.mail[`guest:${username.toLowerCase()}`] ||= []
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
     * accounts as a group, each of which then gets one of their own. Switching
     * off hides it; the mail itself is kept, so switching back on brings it
     * back. */
    if (/^\/api\/users\/[^/]+\/mailbox$/.test(p) && req.method === 'POST') {
      if (!sess || sess.role !== 'admin') return json(res, 403, { ok: false, error: 'admin only' })
      const name = decodeURIComponent(p.split('/')[3])
      const on = data.on !== false
      if (name === 'guest') {
        /* Guests now get a mailbox each, created when they sign in, so
           switching this on no longer creates one shared box. Switching it off
           keeps the mailboxes and their mail, so switching back on brings the
           mail back — the same way it works for a whitelisted account. */
        db.guestMailbox = on
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

    /* Deliver a message to another mailbox on this computer.
     *
     * The address is resolved against the mailboxes that exist here:
     * `demo@Mixt.MPL` and bare `demo` both mean the account `demo`, and
     * `sam@Guest.MPL` means the guest signed in as sam. There is no relay to
     * the outside world and no DNS lookup — this machine only carries mail
     * between its own mailboxes. The sender keeps a copy in Sent, exactly as a
     * mail client would. */
    if (p === '/api/mail/send' && req.method === 'POST') {
      const box = mailboxFor(db, sess)
      if (!box) return json(res, 403, { ok: false, error: 'this session has no mailbox' })
      const to = String(data.to || '').trim()
      if (!to) return json(res, 400, { ok: false, error: 'no recipient' })
      const resolved = resolveAddress(db, to)
      if (!resolved.key) return json(res, resolved.status, { ok: false, error: resolved.error })
      const targetKey = resolved.key
      const now = Date.now()
      const id = 'srv' + now.toString(36) + crypto.randomBytes(3).toString('hex')
      const from = addressOf(box)
      const address = addressOf(targetKey)
      const base = {
        from,
        fromName: box.startsWith('guest:') ? box.slice(6) : box,
        to: address,
        subject: String(data.subject || '(no subject)'),
        date: now,
        body: String(data.body || ''),
        starred: false,
        labels: [],
      }
      ;(db.mail[targetKey] ||= []).push({ ...base, id, folder: 'Inbox', read: false })
      ;(db.mail[box] ||= []).push({ ...base, id: id + 'c', folder: 'Sent', read: true })
      save(db)
      return json(res, 200, { ok: true, id, to: address })
    }

    return json(res, 404, { ok: false })
  }

  /* The development build.
   *
   * dev.html loads /src/main.tsx, which is TypeScript containing JSX. Only the
   * Vite dev server can turn that into something a browser will run — this
   * server has no transform pipeline, so handing the file back raw (which is
   * what it used to do, as `application/octet-stream`) produced a blank page
   * and a console full of MIME errors. Starting the backend and then opening
   * /dev.html on this port simply did not work.
   *
   * So anything the development build needs is forwarded to Vite. Run
   * `npm run dev` alongside `node server.cjs` and this port serves the live
   * source build; if Vite is not running the page says so instead of failing
   * silently. */
  if (isDevPath(p)) return proxyToDev(req, res)

  /* static */
  let file = p === '/' ? '/index.html' : p
  fs.readFile(path.join(ROOT, file), (e, buf) => {
    if (e) { res.writeHead(404); return res.end('404') }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
    res.end(buf)
  })
}

/* Where the Vite dev server is expected. Override with MIXT_DEV. */
const DEV_UPSTREAM = process.env.MIXT_DEV || 'http://127.0.0.1:3000'

/* Request paths that only Vite can answer: the module graph it builds. */
const DEV_PREFIXES = ['/src/', '/@vite/', '/@react-refresh', '/@id/', '/@fs/', '/node_modules/']

function isDevPath(p) {
  return DEV_PREFIXES.some((pre) => p === pre || p.startsWith(pre))
}

/* Forward to Vite, preserving method, headers and body. On a connection
 * refusal — Vite is not running — answer with a page that explains what to do
 * rather than an empty 502. */
function proxyToDev(req, res) {
  const upstream = new URL(DEV_UPSTREAM)
  const up = http.request(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: upstream.host },
    },
    (r) => {
      res.writeHead(r.statusCode, r.headers)
      r.pipe(res)
    },
  )
  up.on('error', () => {
    res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' })
    res.end(
      '<!doctype html><meta charset="utf-8"><title>Development build unavailable</title>' +
        '<div style="font:14px system-ui,sans-serif;max-width:36em;margin:20vh auto;line-height:1.65;color:#2b2b2b">' +
        '<h1 style="font-size:19px;margin:0 0 .6em">The development build needs Vite</h1>' +
        '<p>This page serves the TypeScript sources, which only the Vite dev ' +
        'server can compile. Start it next to the backend:</p>' +
        '<pre style="background:#f2f2f2;padding:10px 12px;border-radius:6px">npm run dev</pre>' +
        '<p>Then reload this page. The published site needs no build step and ' +
        'is ready now at <a href="/index.html">/index.html</a>.</p></div>',
    )
  })
  req.pipe(up)
}

/* Last line of defence: something thrown outside a request (a bad timer, a
 * failed file write) logs and carries on instead of ending the process. */
process.on('uncaughtException', (e) => console.error('uncaught, server still up:', e && e.message))
process.on('unhandledRejection', (e) => console.error('unhandled rejection, server still up:', e && e.message))

server.listen(PORT, '0.0.0.0', () => console.log(`Mixt backend on http://localhost:${PORT}`))
