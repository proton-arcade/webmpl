/* One-time migration for the Mixt rename.
 *
 * Anyone who used the previous release has `webmpl.*` keys in local/session
 * storage and a home directory at /home/mint. This moves both, so the rename
 * does not throw away their settings, files or high scores.
 *
 * It runs as a side effect of being imported, which is why main.tsx imports it
 * before anything that reads the stores. Calling it again is harmless.
 *
 * Storage access goes through os/storage, so a browser that refuses web
 * storage entirely (private mode, sandboxed frame) simply skips the migration
 * instead of failing to boot.
 */
import { safeLocal, safeSession, type SafeStore } from './storage'

const OLD_PREFIX = 'webmpl.'
const NEW_PREFIX = 'mixt.'
const VFS_KEY = 'mixt.vfs.v2'

function migrateStore(store: SafeStore) {
  for (const key of store.keys()) {
    if (!key.startsWith(OLD_PREFIX)) continue
    const next = NEW_PREFIX + key.slice(OLD_PREFIX.length)
    if (store.getItem(next) === null) {
      const value = store.getItem(key)
      if (value !== null) store.setItem(next, value)
    }
    store.removeItem(key)
  }
}

/** /home/mint → /home/mixt, inside the persisted filesystem tree. */
function migrateHome() {
  const raw = safeLocal.getItem(VFS_KEY)
  if (!raw || !raw.includes('"mint"')) return
  safeLocal.setItem(
    VFS_KEY,
    raw.split('"mint"').join('"mixt"').split('/home/mint').join('/home/mixt'),
  )
}

export function migrateBranding() {
  try {
    migrateStore(safeLocal)
  } catch {
    /* anything at all — the app still works */
  }
  try {
    migrateStore(safeSession)
  } catch {
    /* ignore */
  }
  try {
    migrateHome()
  } catch {
    /* ignore */
  }
}

migrateBranding()
