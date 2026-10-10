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

/* Everything data.json holds about one account, in one call.
 *
 * The password comes back as the salt and the hash because that is all the
 * server has; the field is here to show the record is complete, and it is not
 * something anybody can sign in with. */
export interface ServerRecord {
  account: {
    username: string
    role: 'admin' | 'user'
    mailbox: boolean
    address: string | null
    password: { salt: string | null; hash: string | null; algorithm: string }
  }
  mail: { box: string | null; messages: ServerMail[] }
  sessions: { token: string; role: string }[]
  apps: { id: string; name: string; author: string; status: string }[]
  settings: unknown
}

export async function userRecord(username: string): Promise<ServerRecord | null> {
  try {
    const r = await fetch(`/api/users/${encodeURIComponent(username)}/record`, { headers: headers() })
    if (!r.ok || !isJson(r)) return null
    const d = await r.json()
    return d && d.ok ? (d as ServerRecord) : null
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
