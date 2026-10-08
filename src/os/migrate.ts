/* One-time migration for the Mixt rename.
 *
 * Anyone who used the previous release has `webmpl.*` keys in local/session
 * storage and a home directory at /home/mint. This moves both, so the rename
 * does not throw away their settings, files or high scores.
 *
 * It runs as a side effect of being imported, which is why main.tsx imports it
 * before anything that reads the stores. Calling it again is harmless.
 */
const OLD_PREFIX = 'webmpl.'
const NEW_PREFIX = 'mixt.'
const VFS_KEY = 'mixt.vfs.v2'

function migrateStore(store: Storage) {
  const keys: string[] = []
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i)
    if (key) keys.push(key)
  }
  for (const key of keys) {
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
  const raw = localStorage.getItem(VFS_KEY)
  if (!raw || !raw.includes('"mint"')) return
  localStorage.setItem(
    VFS_KEY,
    raw.split('"mint"').join('"mixt"').split('/home/mint').join('/home/mixt'),
  )
}

export function migrateBranding() {
  try {
    migrateStore(localStorage)
  } catch {
    /* private mode, quota, anything else — the app still works */
  }
  try {
    migrateStore(sessionStorage)
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
