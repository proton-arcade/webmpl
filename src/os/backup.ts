/* Backing up an account.
 *
 * A backup is everything this browser holds for one account: the whole
 * filesystem, the desktop settings, and the mail cache. The server is not
 * involved — it only ever knows the account itself (username, password, role,
 * mailbox), never the files — so this is a file you download and keep.
 *
 * Restoring puts all of it back, replacing what is there. It asks before doing
 * that, because it is not undoable.
 */
import { useOS, sanitizeSettings } from './store'
import { useVFS, parseTree, currentOwner, vfsKey } from './vfs'
import { safeLocal } from './storage'
import { readMailCache, writeMailCache } from '../apps/mailstore'

export const BACKUP_KIND = 'mixt-account-backup'
export const BACKUP_VERSION = 1

export interface AccountBackup {
  kind: typeof BACKUP_KIND
  version: number
  username: string
  created: number
  /** the whole filesystem */
  filesystem: unknown
  /** desktop settings */
  settings: Record<string, unknown>
  /** cached mail, so the mailbox is not empty after a restore */
  mail: unknown
}

/** everything this browser holds for the signed-in account */
export function collectBackup(username: string): AccountBackup {
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    username: username || currentOwner() || 'account',
    created: Date.now(),
    filesystem: useVFS.getState().root,
    settings: { ...useOS.getState().settings },
    mail: readMailCache(username || currentOwner()),
  }
}

/** the file name a backup is offered under */
export function backupFileName(username: string): string {
  const who = (username || 'account').replace(/[^A-Za-z0-9._-]+/g, '-')
  const day = new Date().toISOString().slice(0, 10)
  return `mixt-backup-${who}-${day}.json`
}

export function describeBackup(b: AccountBackup): string {
  const when = new Date(b.created).toLocaleString()
  const bytes = JSON.stringify(b).length
  return `${b.username} · ${when} · ${(bytes / 1024).toFixed(0)} KB`
}

/** Is this text one of our backups? Returns the backup, or the reason not. */
export function parseBackup(text: string): { ok: true; backup: AccountBackup } | { ok: false; error: string } {
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'That file is not valid JSON, so it cannot be a backup.' }
  }
  if (!data || data.kind !== BACKUP_KIND)
    return { ok: false, error: 'That file is not a Mixt account backup.' }
  if (!data.filesystem || typeof data.filesystem !== 'object')
    return { ok: false, error: 'The backup has no filesystem in it.' }
  /* an old or hand-edited backup is still worth taking, as long as it parses */
  const tree = parseTree(JSON.stringify(data.filesystem))
  if (!tree) return { ok: false, error: 'The filesystem in that backup could not be read.' }
  return { ok: true, backup: { ...data, filesystem: tree } as AccountBackup }
}

/** Put a backup back. Replaces the mounted filesystem and the settings. */
export function restoreBackup(b: AccountBackup): { ok: boolean; error?: string } {
  try {
    const tree = parseTree(JSON.stringify(b.filesystem))
    if (!tree) return { ok: false, error: 'The filesystem in that backup could not be read.' }
    useVFS.setState((s) => ({ root: tree, revision: s.revision + 1 }))
    /* write it straight out, so a reload brings back the same files */
    const who = currentOwner()
    if (who) safeLocal.setItem(vfsKey(who), JSON.stringify(tree))
    if (b.settings && typeof b.settings === 'object') useOS.getState().setSettings(sanitizeSettings(b.settings as any))
    /* the mail cache is a file inside the filesystem, so it has to be written
       through the mailbox's own helper, not to a key nothing reads */
    if (Array.isArray(b.mail) && b.mail.length) writeMailCache(who || b.username, b.mail)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) }
  }
}

/** Offer the backup as a download. Returns false if the browser refused. */
export function downloadBackup(b: AccountBackup): boolean {
  try {
    const blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = backupFileName(b.username)
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    return true
  } catch {
    return false
  }
}

/** how much a backup of this account would hold */
export function backupSize(): string {
  const bytes = JSON.stringify(collectBackup(useOS.getState().settings.username)).length
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
