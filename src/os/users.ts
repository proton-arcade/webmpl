/* Local user accounts.
 *
 * Created from the terminal with `/startup`. Accounts live in localStorage next
 * to everything else the OS saves, so they survive a reload — that is the
 * "saved in your cookies" part. Each account carries its own identity (name,
 * accent, wallpaper); logging in applies it to the session.
 *
 * Passwords are stored as a salted hash rather than in plain text. This is a
 * browser toy with no server, so it keeps honest secrets out of a JSON blob —
 * it is not, and cannot be, real authentication: anyone with devtools can read
 * the account list.
 */
import { safeLocal } from './storage'
import type { User } from './types'

const LS_USERS = 'mixt.users.v1'
const LS_ACTIVE = 'mixt.activeUser.v1'

/** FNV-1a with a per-account salt. Deliberately simple and synchronous. */
export function hashPassword(password: string, salt: string): string {
  let h = 0x811c9dc5
  const input = `${salt}::${password}`
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  // a second pass so short passwords are not trivially reversible
  let g = 0x9e3779b9
  for (let i = input.length - 1; i >= 0; i--) {
    g ^= input.charCodeAt(i)
    g = Math.imul(g, 0x85ebca6b) >>> 0
  }
  return `${h.toString(16).padStart(8, '0')}${g.toString(16).padStart(8, '0')}`
}

export function makeSalt(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

/** What a username may look like — the same rules the terminal prompt enforces. */
export function validateUsername(name: string): string | null {
  const n = name.trim().toLowerCase()
  if (!n) return 'a username cannot be empty'
  if (n.length < 2) return 'a username needs at least 2 characters'
  if (n.length > 24) return 'a username can be at most 24 characters'
  if (!/^[a-z0-9._-]+$/.test(n)) return 'use letters, numbers, dot, dash or underscore only'
  if (/^\d/.test(n)) return 'a username cannot start with a number'
  const reserved = ['root', 'system', 'admin', 'nobody', 'daemon', 'mixt']
  if (reserved.includes(n)) return `“${n}” is reserved by the system`
  return null
}

function isUser(v: any): v is User {
  return (
    v &&
    typeof v === 'object' &&
    typeof v.id === 'string' &&
    typeof v.username === 'string' &&
    /^[a-z0-9._-]+$/.test(v.username) &&
    typeof v.fullName === 'string' &&
    typeof v.passwordHash === 'string' &&
    typeof v.accent === 'string' &&
    typeof v.wallpaper === 'string' &&
    typeof v.created === 'number'
  )
}

export function loadUsers(): User[] {
  try {
    const raw = safeLocal.getItem(LS_USERS)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // a corrupt or hand-edited list must not break the boot
    const seen = new Set<string>()
    const out: User[] = []
    for (const entry of parsed) {
      if (!isUser(entry)) continue
      if (seen.has(entry.username)) continue
      seen.add(entry.username)
      out.push(entry)
    }
    return out
  } catch {
    return []
  }
}

export function saveUsers(users: User[]): void {
  try {
    safeLocal.setItem(LS_USERS, JSON.stringify(users))
  } catch {
    /* storage refused; the session keeps working in memory */
  }
}

export function loadActiveUserId(): string | null {
  try {
    return safeLocal.getItem(LS_ACTIVE) || null
  } catch {
    return null
  }
}

export function saveActiveUserId(id: string | null): void {
  try {
    if (id) safeLocal.setItem(LS_ACTIVE, id)
    else safeLocal.removeItem(LS_ACTIVE)
  } catch {
    /* ditto */
  }
}

export function checkPassword(user: User, password: string): boolean {
  if (!user.passwordHash) return true // no password set
  const salt = user.id
  return hashPassword(password, salt) === user.passwordHash
}

export const ACCENTS = ['#8ab658', '#5b8def', '#d98b3a', '#c2554f', '#8a6fd1', '#3fa79f']
