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
    mail: {},     // username -> [mails]
    settings: {}, // username -> saved settings (never for guests)
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

/* --------------------------------- router --------------------------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const p = url.pathname

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

    if (p === '/api/guest' && req.method === 'POST') {
      const token = newToken()
      db.sessions[token] = { username: 'guest', role: 'guest' }
      save(db)
      return json(res, 200, { ok: true, token, role: 'guest', username: 'guest' })
    }

    if (p === '/api/session') return json(res, 200, sess ? { ok: true, ...sess } : { ok: false })

    if (p === '/api/users' && req.method === 'GET') {
      if (!sess || sess.role !== 'admin') return json(res, 403, { ok: false, error: 'admin only' })
      return json(res, 200, db.users.map((u) => ({ username: u.username, role: u.role })))
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
      if (!sess || sess.role === 'guest') return json(res, 403, { ok: false, error: 'whitelisted users only' })
      db.apps.push({ id: 'app-' + crypto.randomBytes(4).toString('hex'), name: data.name || 'Untitled app', author: sess.username, status: 'pending', manifest: data.manifest || {} })
      save(db)
      return json(res, 200, { ok: true })
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
      })
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
      if (!sess || sess.role === 'guest') return json(res, 403, { ok: false, error: 'guests are not saved' })
      if (req.method === 'GET') return json(res, 200, db.mail[sess.username] || [])
      ;(db.mail[sess.username] ||= []).push(data)
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
      if (!sess || sess.role === 'guest') return json(res, 403, { ok: false, error: 'guests are not saved' })
      const to = String(data.to || '').trim()
      if (!to) return json(res, 400, { ok: false, error: 'no recipient' })
      const local = to.split('@')[0].toLowerCase()
      const target = db.users.find((u) => u.username.toLowerCase() === local)
      if (!target) return json(res, 404, { ok: false, error: `no mailbox for ${local} on this computer` })
      const now = Date.now()
      const id = 'srv' + now.toString(36) + crypto.randomBytes(3).toString('hex')
      const from = `${sess.username}@proper.com`
      const address = `${target.username}@proper.com`
      const base = {
        from,
        fromName: sess.username,
        to: address,
        subject: String(data.subject || '(no subject)'),
        date: now,
        body: String(data.body || ''),
        starred: false,
        labels: [],
      }
      ;(db.mail[target.username] ||= []).push({ ...base, id, folder: 'Inbox', read: false })
      ;(db.mail[sess.username] ||= []).push({ ...base, id: id + 'c', folder: 'Sent', read: true })
      save(db)
      return json(res, 200, { ok: true, id, to: target.username })
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
})

server.listen(PORT, '0.0.0.0', () => console.log(`Mixt backend on http://localhost:${PORT}`))
