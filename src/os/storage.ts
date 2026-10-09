/* Mixt Web OS — safe access to browser storage.
 *
 * Web storage is not always there. A browser can refuse it entirely:
 *
 *   • an <iframe> without `allow-same-origin` (preview panes, docs embeds,
 *     sandboxed dashboards) makes every access to localStorage throw a
 *     SecurityError — even reading the property;
 *   • A private-mode browser, or a device with a full disk, throws
 *     QuotaExceededError on every write;
 *   • a user can simply switch it off.
 *
 * Plain `localStorage.getItem(...)` in that situation throws, and a throw
 * during boot used to mean a white page: no desktop, no message, nothing.
 * Every read and write in the OS therefore goes through this module, which
 * never throws. When the real store is unavailable the values live in memory
 * for the session, so the OS still behaves consistently — it just forgets
 * everything on reload, which is exactly what a blocked browser deserves.
 *
 * Nothing here should be cached: the smoke test swaps the globals out to
 * simulate a browser that denies storage, and the next call must notice.
 */

export interface SafeStore {
  /** true when the browser actually gave us a store (persists across reloads) */
  readonly available: boolean
  getItem(key: string): string | null
  /** returns true when the value reached real storage */
  setItem(key: string, value: string): boolean
  removeItem(key: string): void
  /** every key in the store, defensive against a store that throws mid-iteration */
  keys(): string[]
}

const memory = {
  local: new Map<string, string>(),
  session: new Map<string, string>(),
}

function pick(name: 'localStorage' | 'sessionStorage'): Storage | undefined {
  try {
    const store = (globalThis as any)?.[name]
    // touch it: in a blocked context the property itself throws
    if (!store) return undefined
    void store.length
    return store as Storage
  } catch {
    return undefined
  }
}

function createStore(name: 'localStorage' | 'sessionStorage'): SafeStore {
  const fallback = memory[name === 'localStorage' ? 'local' : 'session']

  return {
    get available() {
      const store = pick(name)
      if (!store) return false
      try {
        return typeof store.setItem === 'function'
      } catch {
        return false
      }
    },

    getItem(key) {
      const store = pick(name)
      if (store) {
        try {
          const value = store.getItem(key)
          if (value !== null) return value
        } catch {
          /* fall through to memory */
        }
      }
      return fallback.get(key) ?? null
    },

    setItem(key, value) {
      const store = pick(name)
      if (store) {
        try {
          store.setItem(key, value)
          return true
        } catch {
          /* quota, private mode, blocked mid-session — keep it in memory */
        }
      }
      fallback.set(key, value)
      return false
    },

    removeItem(key) {
      const store = pick(name)
      if (store) {
        try {
          store.removeItem(key)
        } catch {
          /* ignore */
        }
      }
      fallback.delete(key)
    },

    keys() {
      const out: string[] = []
      const store = pick(name)
      if (store) {
        try {
          for (let i = 0; i < store.length; i++) {
            const key = store.key(i)
            if (key) out.push(key)
          }
        } catch {
          /* ignore */
        }
      }
      for (const key of fallback.keys()) if (!out.includes(key)) out.push(key)
      return out
    },
  }
}

export const safeLocal = createStore('localStorage')
export const safeSession = createStore('sessionStorage')

/** True when the OS can keep anything at all. Used by the recovery screen. */
export function storageAvailable() {
  return safeLocal.available || safeSession.available
}

/** Forgets the OS: settings, filesystem and legacy keys. Used by the recovery
 *  screen when a saved state cannot be loaded. */
export function clearSavedData() {
  for (const store of [safeLocal, safeSession]) {
    for (const key of store.keys()) {
      if (key.startsWith('mixt.') || key.startsWith('webmpl.')) store.removeItem(key)
    }
  }
}
