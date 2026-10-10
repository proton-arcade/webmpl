/* Client for the optional Mixt backend (server.cjs).
 *
 * The OS is still fully functional offline: every helper here fails soft and
 * returns null/[]/false when there is no server, so the plain static build is
 * unchanged. When `node server.cjs` is running on the same origin, these light
 * up: whitelisted logins, the administrator account, guests (which are never
 * saved), server-synced settings and published apps.
 */
export interface Session {
  token: string
  role: 'admin' | 'user' | 'guest'
  username: string
  /* a guest signs in with a name; it is shown so the session can be recognised */
  name?: string
}

const KEY = 'mixt.session.v1'

export function getSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}
export function setSession(s: Session | null) {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s))
    else sessionStorage.removeItem(KEY)
  } catch {
    /* guests & blocked storage simply don't persist */
  }
}

/** Who the desktop is signed in as, for display. */
export function roleLabel(s: Session | null = getSession()): string {
  if (!s) return 'Local user (no server)'
  if (s.role === 'admin') return 'Administrator'
  if (s.role === 'guest') return 'Guest session — nothing is saved'
  return 'Standard user'
}

/** Unix-style groups shown in System Settings → Account type. */
export function groups(s: Session | null = getSession()): string {
  return s && s.role === 'admin' ? 'adm, sudo, audio, video, plugdev' : 'audio, video, plugdev'
}

function headers(): Record<string, string> {
  const s = getSession()
  const h: Record<string, string> = { 'content-type': 'application/json' }
  if (s) h.authorization = `Bearer ${s.token}`
  return h
}

/* A dev server or any SPA host answers an unknown path with index.html — 200,
 * text/html. That must never be mistaken for the API, or the client shows a
 * login gate that can only fail. The real backend always answers JSON. */
function isJson(r: Response): boolean {
  return (r.headers.get('content-type') || '').includes('json')
}

export async function online(): Promise<boolean> {
  try {
    const r = await fetch('/api/health')
    return r.ok && isJson(r)
  } catch {
    return false
  }
}

/* One flat shape rather than a discriminated union: this project compiles with
 * strictNullChecks off, so TS cannot narrow `ok` and would reject res.error. */
export interface LoginResult {
  ok: boolean
  session?: Session
  error?: string
}

export async function login(username: string, password: string): Promise<LoginResult> {
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })
    if (!isJson(r)) return { ok: false, error: 'The Mixt server is not answering on this address.' }
    if (r.status === 401) return { ok: false, error: 'Wrong username or password.' }
    if (!r.ok) return { ok: false, error: `The server refused the login (${r.status}).` }
    const d = await r.json()
    const session: Session = { token: d.token, role: d.role, username: d.username }
    setSession(session)
    return { ok: true, session }
  } catch {
    return { ok: false, error: 'Cannot reach the Mixt server.' }
  }
}

/* A guest still gets no account and nothing of theirs is saved, but they sign in
 * with a username, a name and a password so the administrator can see who has
 * been using the machine rather than an anonymous extra live session. */
export interface GuestDetails {
  username?: string
  name?: string
  password?: string
}

export async function guest(details: GuestDetails = {}): Promise<Session | null> {
  try {
    const r = await fetch('/api/guest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(details),
    })
    if (!r.ok || !isJson(r)) return null
    const d = await r.json()
    const s: Session = { token: d.token, role: d.role, username: d.username, name: d.name }
    setSession(s)
    return s
  } catch {
    return null
  }
}

/* Who has signed in as a guest, and when. Administrator only. */
export interface GuestLogin {
  username: string
  name: string
  at: number
}

export async function guestLog(): Promise<GuestLogin[] | null> {
  try {
    const r = await fetch('/api/guests', { headers: headers() })
    if (!r.ok || !isJson(r)) return null
    const d = await r.json()
    /* Not every answer is a list: a refusal or an error comes back as an
       object, and handing that to a caller who maps over it is how a viewer
       ends up blank with no explanation. */
    return Array.isArray(d) ? (d as GuestLogin[]) : null
  } catch {
    return null
  }
}

/* Set a new password for a whitelisted account. The server hashes it; it can
 * never be read back, only replaced. */
export async function setUserPassword(username: string, password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`/api/users/${encodeURIComponent(username)}/password`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ password }),
    })
    if (!isJson(r)) return { ok: false, error: 'the server did not answer' }
    const d = await r.json()
    return d.ok ? { ok: true } : { ok: false, error: d.error }
  } catch {
    return { ok: false, error: 'cannot reach the server' }
  }
}

/* Switch an account's mailbox on or off. Pass 'guest' for the shared guest
 * mailbox. Switching off hides the mail; it is not deleted. */
export async function setMailbox(username: string, on: boolean): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`/api/users/${encodeURIComponent(username)}/mailbox`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ on }),
    })
    if (!isJson(r)) return { ok: false, error: 'the server did not answer' }
    const d = await r.json()
    return d.ok ? { ok: true } : { ok: false, error: d.error }
  } catch {
    return { ok: false, error: 'cannot reach the server' }
  }
}

export async function serverApps(): Promise<{ id: string; name: string; author: string; status: string }[]> {
  try {
    const r = await fetch('/api/apps', { headers: headers() })
    if (!r.ok || !isJson(r)) return []
    const d = await r.json()
    return Array.isArray(d) ? d : []
  } catch {
    return []
  }
}

/* Publishing takes the app's code with it: an app with no code is not an app.
 * Only whitelisted accounts may publish, and what the administrator publishes
 * from the console goes straight out approved. */
export async function publishApp(
  name: string,
  code: string,
  opts: { approved?: boolean; author?: string; manifest?: Record<string, unknown> } = {},
): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch('/api/apps', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ name, code, approved: opts.approved, author: opts.author, manifest: opts.manifest || {} }),
    })
    if (!isJson(r)) return { ok: false, error: 'the server did not answer' }
    const d = await r.json()
    return d.ok ? { ok: true } : { ok: false, error: d.error }
  } catch {
    return { ok: false, error: 'cannot reach the server' }
  }
}

export async function approveApp(id: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/apps/${id}/approve`, { method: 'POST', headers: headers() })
    return r.ok
  } catch {
    return false
  }
}

export async function getSettings(): Promise<unknown> {
  try {
    const r = await fetch('/api/settings', { headers: headers() })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

export async function putSettings(obj: unknown): Promise<void> {
  const s = getSession()
  if (!s || s.role === 'guest') return // guests are never saved
  try {
    await fetch('/api/settings', { method: 'PUT', headers: headers(), body: JSON.stringify(obj) })
  } catch {
    /* offline: keep local-only */
  }
}

/* ------------------------------- mail API -------------------------------- */
/* The server keeps one mailbox per whitelisted account. Guests have none: the
 * server refuses to store anything for them, so they get local-only mail. */
export interface ServerMail {
  id: string
  from: string
  fromName: string
  to: string
  subject: string
  date: number
  body: string
  folder: string
  read: boolean
  starred: boolean
  labels: string[]
}

export async function serverMail(): Promise<ServerMail[] | null> {
  try {
    const r = await fetch('/api/mail', { headers: headers() })
    if (!r.ok || !isJson(r)) return null
    const list = await r.json()
    return Array.isArray(list) ? (list as ServerMail[]) : null
  } catch {
    return null
  }
}

export interface SendResult {
  ok: boolean
  id?: string
  error?: string
}

/* Deliver to another account on this machine. `ok` is false with a reason when
 * there is no such mailbox, or when there is no server at all. */
export async function sendMail(to: string, subject: string, body: string): Promise<SendResult> {
  try {
    const r = await fetch('/api/mail/send', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ to, subject, body }),
    })
    if (!isJson(r)) return { ok: false, error: 'there is no mail server on this computer' }
    const out = await r.json()
    return out.ok ? { ok: true, id: out.id } : { ok: false, error: out.error || 'not delivered' }
  } catch {
    return { ok: false, error: 'there is no mail server on this computer' }
  }
}

/* --------------------------- administrator API --------------------------- */
/* Every call here is admin-only on the server; they return null/[] for anyone
   else so the console can render "not permitted" instead of guessing. */

export interface ServerUser {
  username: string
  role: 'admin' | 'user'
  mailbox: boolean
}
export interface ServerStats {
  users: number
  admins: number
  sessions: number
  appsPending: number
  appsApproved: number
  mailboxes: number
  savedSettings: number
  guestMailbox: boolean
  guestLogins: number
}

export async function allUsers(): Promise<ServerUser[] | null> {
  try {
    const r = await fetch('/api/users', { headers: headers() })
    if (!r.ok || !isJson(r)) return null
    const d = await r.json()
    return Array.isArray(d) ? d : null
  } catch {
    return null
  }
}

export async function addUser(username: string, password: string, admin: boolean): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch('/api/users', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ username, password, role: admin ? 'admin' : 'user' }),
    })
    if (!isJson(r)) return { ok: false, error: 'The Mixt server is not answering.' }
    const d = await r.json()
    if (r.ok && d.ok) return { ok: true }
    return { ok: false, error: d.error === 'exists' ? 'That username already exists.' : d.error === 'bad username' ? 'Usernames are 2-24 letters, digits, dot, dash or underscore.' : `The server refused it (${r.status}).` }
  } catch {
    return { ok: false, error: 'Cannot reach the Mixt server.' }
  }
}

export async function removeUser(username: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`/api/users/${encodeURIComponent(username)}/remove`, { method: 'POST', headers: headers() })
    if (!isJson(r)) return { ok: false, error: 'The Mixt server is not answering.' }
    const d = await r.json()
    if (r.ok && d.ok) return { ok: true }
    return { ok: false, error: d.error === 'that is the only administrator' ? 'That is the only administrator account.' : d.error === 'you cannot remove your own account' ? 'You cannot remove your own account.' : `The server refused it (${r.status}).` }
  } catch {
    return { ok: false, error: 'Cannot reach the Mixt server.' }
  }
}

export async function rejectApp(id: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/apps/${id}/reject`, { method: 'POST', headers: headers() })
    return r.ok
  } catch {
    return false
  }
}

export async function stats(): Promise<ServerStats | null> {
  try {
    const r = await fetch('/api/stats', { headers: headers() })
    if (!r.ok || !isJson(r)) return null
    return (await r.json()) as ServerStats
  } catch {
    return null
  }
}

/* ---------------------------------------------------------------------------
 * The server filesystem, the terminal and the machine.
 *
 * Mixt runs against a server on the local network: it holds the accounts, the
 * files, the mail and the terminal. The desktop keeps a mirror of the tree in
 * memory so every application stays instant, and streams its changes back —
 * see os/sync.ts. Nothing here reaches past this machine: the server is
 * air-gapped, and every address is a local one.
 * ------------------------------------------------------------------------- */

export interface FsOp {
  op: 'write' | 'mkdir' | 'touch' | 'remove' | 'move' | 'copy' | 'trash' | 'reset'
  path: string
  to?: string
  content?: string
  mime?: string
}

export interface OpsResult {
  ok: boolean
  rev?: number
  conflict?: boolean
  applied?: unknown[]
}

/** Send what changed. The revision is the one the tree was edited at. */
export async function fsOps(ops: FsOp[], rev: number): Promise<OpsResult> {
  try {
    const r = await fetch('/api/fs/ops', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ ops, rev }),
    })
    if (!isJson(r)) return { ok: false }
    const out = await r.json()
    if (r.status === 409) return { ok: false, conflict: true, rev: out.rev }
    return r.ok ? { ok: true, rev: out.rev, applied: out.applied } : { ok: false }
  } catch {
    return { ok: false }
  }
}

/** The whole tree, as the server holds it. */
export async function fsTree(): Promise<{ rev: number; root: unknown; username: string } | null> {
  try {
    const r = await fetch('/api/fs/tree', { headers: headers() })
    if (!r.ok || !isJson(r)) return null
    return await r.json()
  } catch {
    return null
  }
}

/**
 * Another account's whole tree, as the machine holds it.
 *
 * This is the administrator's /users window: their Files shows one folder per
 * account on the computer, and it is filled from here rather than from copies
 * left in this browser by people who happened to sign in on it.
 */
export async function fsTreeOf(username: string): Promise<{ root: unknown } | null> {
  try {
    const r = await fetch(`/api/fs/tree/${encodeURIComponent(username)}`, { headers: headers() })
    if (!r.ok || !isJson(r)) return null
    return await r.json()
  } catch {
    return null
  }
}

/** The accounts on this machine, as the /users folder. */
export async function fsUsers(): Promise<{ name: string; owner: string; role: string }[] | null> {
  try {
    const r = await fetch('/api/fs/users', { headers: headers() })
    if (!r.ok || !isJson(r)) return null
    const d = await r.json()
    return Array.isArray(d) ? d : null
  } catch {
    return null
  }
}

/** Throw the filesystem away and let the server seed a new one. */
export async function fsReset(): Promise<boolean> {
  try {
    const r = await fetch('/api/fs/ops', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ ops: [{ op: 'reset', path: '/' }], rev: null }),
    })
    return r.ok
  } catch {
    return false
  }
}

/** One file's bytes, by path. Used for the hosted share and for downloads. */
export function rawUrl(path: string): string {
  return `/api/fs/raw${path.startsWith('/') ? path : '/' + path}?token=${encodeURIComponent(getSession()?.token ?? '')}`
}

/* ------------------------------- the terminal ------------------------------ */

export interface TermEffect {
  type: string
  [key: string]: unknown
}

export interface TermResult {
  out: string
  err: string
  effects: TermEffect[]
  cwd: string
  clear: boolean
  exit: boolean
  rev: number
}

/**
 * Run one command line.
 *
 * The shell is on the server and runs as the signed-in account, so it can only
 * reach that account's own files. What comes back may carry effects — open a
 * window, change the wallpaper — because the server has no windows of its own.
 */
export async function term(cmd: string, stdin: string | null = null): Promise<TermResult> {
  try {
    const r = await fetch('/api/term', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ cmd, stdin }),
    })
    if (!r.ok || !isJson(r)) {
      return { out: '', err: 'The server did not answer that.', effects: [], cwd: '', clear: false, exit: false, rev: 0 }
    }
    const d = await r.json()
    return {
      out: d.out || '',
      err: d.err || '',
      effects: d.effects || [],
      cwd: d.cwd || '/home/mixt',
      clear: !!d.clear,
      exit: !!d.exit,
      rev: d.rev ?? 0,
    }
  } catch {
    return { out: '', err: 'Cannot reach the Mixt server.', effects: [], cwd: '/home/mixt', clear: false, exit: false, rev: 0 }
  }
}

/** Tab completion, answered by the server, so it completes real paths. */
export async function termComplete(prefix: string): Promise<string[]> {
  try {
    const r = await fetch(`/api/term/complete?prefix=${encodeURIComponent(prefix)}`, { headers: headers() })
    if (!r.ok || !isJson(r)) return []
    const d = await r.json()
    return Array.isArray(d.matches) ? d.matches : []
  } catch {
    return []
  }
}

export interface TermPrompt {
  user: string
  host: string
  cwd: string
  symbol: string
  guest: boolean
}

export async function termPrompt(): Promise<TermPrompt | null> {
  try {
    const r = await fetch('/api/term/prompt', { headers: headers() })
    if (!r.ok || !isJson(r)) return null
    return (await r.json()) as TermPrompt
  } catch {
    return null
  }
}

/* --------------------------------- the machine ---------------------------- */

export interface MachineInfo {
  machine: { name: string; hostname: string; domain: string; url: string; version: string }
  os: { platform: string; type: string; release: string; arch: string; uptime: number }
  cpu: { model: string; cores: number; speed: number; load: number[] }
  memory: { total: number; free: number; used: number; human: string }
  disk: { total: number; free: number; human: string } | null
  network: { interfaces: string[]; hostname: string; airgapped: boolean }
  process: { node: string; pid: number; uptime: number; rss: number }
  storage: { dataDir: string; blobs: { bytes: number; files: number }; nodes: number; database: unknown }
}

export async function machineInfo(): Promise<MachineInfo | null> {
  try {
    const r = await fetch('/api/system/info')
    if (!r.ok || !isJson(r)) return null
    return (await r.json()) as MachineInfo
  } catch {
    return null
  }
}

/** Hosting: publish a folder as a website on this machine. */
export async function hostedSites(): Promise<{ name: string; path: string; owner: string; url: string }[]> {
  try {
    const r = await fetch('/api/hosting', { headers: headers() })
    if (!r.ok || !isJson(r)) return []
    const d = await r.json()
    return Array.isArray(d) ? d : []
  } catch {
    return []
  }
}

export async function publishSite(name: string, path: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const r = await fetch('/api/hosting', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ name, path }),
    })
    if (!isJson(r)) return { ok: false, error: 'The Mixt server is not answering.' }
    const d = await r.json()
    return d.ok ? { ok: true, url: d.url } : { ok: false, error: d.error }
  } catch {
    return { ok: false, error: 'Cannot reach the Mixt server.' }
  }
}

export async function unpublishSite(name: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/hosting/${encodeURIComponent(name)}`, { method: 'DELETE', headers: headers() })
    return r.ok
  } catch {
    return false
  }
}

/** An application's code, so the desktop can run what was published. */
export async function appCode(id: string): Promise<string | null> {
  try {
    const r = await fetch(`/api/apps/${encodeURIComponent(id)}/code`, { headers: headers() })
    if (!r.ok || !isJson(r)) return null
    const d = await r.json()
    return typeof d.code === 'string' ? d.code : null
  } catch {
    return null
  }
}

/** This session's mail address, as the server has it. */
export async function mailAddress(): Promise<string | null> {
  try {
    const r = await fetch('/api/mail/address', { headers: headers() })
    if (!r.ok || !isJson(r)) return null
    const d = await r.json()
    return d.address ?? null
  } catch {
    return null
  }
}

export async function removeMail(id: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/mail/${encodeURIComponent(id)}`, { method: 'DELETE', headers: headers() })
    return r.ok
  } catch {
    return false
  }
}

export async function updateMail(id: string, patch: Record<string, unknown>): Promise<boolean> {
  try {
    const r = await fetch(`/api/mail/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(patch),
    })
    return r.ok
  } catch {
    return false
  }
}

/** End the session on the server as well as in this browser. */
export async function logout(): Promise<void> {
  try {
    await fetch('/api/logout', { method: 'POST', headers: headers() })
  } catch {
    /* the session ends here either way */
  }
  setSession(null)
  window.dispatchEvent(new CustomEvent('mixt:authchanged'))
}

/** What this account has installed, according to the server. `null` when the
    server cannot be asked, so a caller can tell "nothing installed" from "the
    server is not there" and keep its own copy in the second case. */
export async function installed(): Promise<string[] | null> {
  try {
    const r = await fetch('/api/installed', { headers: headers() })
    if (!r.ok || !isJson(r)) return null
    const d = await r.json()
    return Array.isArray(d) ? (d as string[]) : null
  } catch {
    return null
  }
}
