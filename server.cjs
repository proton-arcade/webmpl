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
const DB = path.join(ROOT, 'data.json')
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

    if (p === '/api/users' && req.method === 'GET')
      return json(res, 200, db.users.map((u) => ({ username: u.username, role: u.role })))

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
