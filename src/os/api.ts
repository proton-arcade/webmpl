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

export async function guest(): Promise<Session | null> {
  try {
    const r = await fetch('/api/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    if (!r.ok || !isJson(r)) return null
    const d = await r.json()
    const s: Session = { token: d.token, role: d.role, username: d.username }
    setSession(s)
    return s
  } catch {
    return null
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

export async function publishApp(name: string, manifest: Record<string, unknown> = {}): Promise<boolean> {
  try {
    const r = await fetch('/api/apps', { method: 'POST', headers: headers(), body: JSON.stringify({ name, manifest }) })
    return r.ok
  } catch {
    return false
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
