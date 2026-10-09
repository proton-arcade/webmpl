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

function headers(): Record<string, string> {
  const s = getSession()
  const h: Record<string, string> = { 'content-type': 'application/json' }
  if (s) h.authorization = `Bearer ${s.token}`
  return h
}

export async function online(): Promise<boolean> {
  try {
    const r = await fetch('/api/health')
    return r.ok
  } catch {
    return false
  }
}

export async function login(username: string, password: string): Promise<Session | null> {
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })
    if (!r.ok) return null
    const d = await r.json()
    const s: Session = { token: d.token, role: d.role, username: d.username }
    setSession(s)
    return s
  } catch {
    return null
  }
}

export async function guest(): Promise<Session | null> {
  try {
    const r = await fetch('/api/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    if (!r.ok) return null
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
