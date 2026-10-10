/**
 * mixt.js — the runtime an application talks to.
 *
 * Every application in /usr/share/applications ships a main.js that describes
 * what it is and how it starts, but until now there was nothing on the other
 * side of that: a file could dispatch an event and hope. This is the other
 * side. It is installed as `window.mixt` and written into the filesystem at
 * /usr/share/mixt/mixt.js, so an application's own file can say what it uses
 * and a person can read the same thing on disk.
 *
 * The surface is deliberately small and deliberately synchronous where the
 * filesystem is: everything here reads and writes the same in-memory tree the
 * desktop is already showing, so a change is on screen immediately and there is
 * nothing to await. What it does NOT do is reach the network — there is no
 * fetch, no upload, no remote storage in this API. An application written
 * against mixt.js cannot leave this machine, which is the whole point of a
 * desktop that claims to be self-contained.
 *
 *   mixt.version              the API version, so a file can check
 *   mixt.apps.list()          what is installed and visible to this session
 *   mixt.apps.get(id)         one application's record
 *   mixt.apps.launch(id, p)   open it, returns the window id or null
 *   mixt.apps.open(path)      open a file with whatever handles it
 *   mixt.fs.read(path)        the text of a file, or null
 *   mixt.fs.write(path, text) true if it was written
 *   mixt.fs.list(path)        the entries of a directory, or null
 *   mixt.fs.exists(path)      is anything there
 *   mixt.fs.mkdir(path)       make a directory and its parents
 *   mixt.fs.remove(path)      delete outright
 *   mixt.fs.trash(path)       move to the Trash, the way the file manager does
 *   mixt.fs.move / copy       rename and duplicate
 *   mixt.notify(title, body)  a desktop notification
 *   mixt.terminal(cwd)        open a terminal, optionally somewhere specific
 *   mixt.whoami()             who is signed in, and what they may do
 *   mixt.mail.address()       this session's local address
 *
 * Nothing here throws. A missing path gives null, a refused write gives false —
 * an application calling into the OS should not have to wrap every line in a
 * try, and a failure it can see is one it can report.
 */
import { vfs, baseName, join, parentPath } from './vfs'
import { useOS } from './store'
import { getSession } from './api'
import { localAddress } from './mailaddr'
import { getApp, visibleApps } from '../apps/registry'
import { APP_INDEX } from './appindex'
import { notify as postNotification, openTerminal, appForFile } from './bus'

export const MIXT_SDK_VERSION = 1

/** where the runtime lives in the filesystem */
export const MIXT_SDK_PATH = '/usr/share/mixt/mixt.js'

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    /* The filesystem and the window store are both in memory and both can be
       handed something malformed by an application's own code. An error from
       in here should read as a failed call, not take the desktop down. */
    return fallback
  }
}

export interface MixtAppRecord {
  id: string
  name: string
  summary: string
  description: string
  categories: string[]
  installed: boolean
  running: boolean
}

export interface MixtFileRecord {
  name: string
  path: string
  type: 'dir' | 'file'
  size: number
  mime: string | null
  modified: number
}

function describeApp(id: string): MixtAppRecord | null {
  const app = getApp(id)
  if (!app) return null
  /* The one-line summary and the long description are the ones the menu, the
     store and /usr/share/applications all show, so they come from the same
     generated index rather than being worded a second time here. An app that
     is not in the index falls back to its generic name and comment. */
  const indexed = APP_INDEX.find((a) => a.id === id)
  const installed = useOS.getState().installed[id] !== false && app.preinstalled !== false
  const running = useOS.getState().windows.some((w) => w.appId === id)
  return {
    id: app.id,
    name: app.name,
    summary: indexed?.summary || app.generic || app.name,
    description: indexed?.description || app.comment,
    categories: Array.isArray(app.categories) ? [...app.categories] : [],
    installed,
    running,
  }
}

/** the runtime, as an object so it can be installed and inspected */
export const mixt = {
  version: MIXT_SDK_VERSION,

  apps: {
    /** every application this session is allowed to see, installed or not */
    list(): MixtAppRecord[] {
      return safe(
        () => visibleApps().map((a) => describeApp(a.id)!).filter(Boolean),
        [],
      )
    },
    get(id: string): MixtAppRecord | null {
      return safe(() => describeApp(id), null)
    },
    /** open an application; null when there is no such app or it cannot open */
    launch(id: string, props: Record<string, unknown> = {}): string | null {
      return safe(() => {
        if (!getApp(id)) return null
        return useOS.getState().openApp(id, props || {})
      }, null)
    },
    /** open a file with whatever application handles its type */
    open(path: string): string | null {
      return safe(() => {
        const appId = appForFile(path)
        if (!appId) return null
        return useOS.getState().openApp(appId, { path })
      }, null)
    },
  },

  fs: {
    read(path: string): string | null {
      return safe(() => {
        const node = vfs.node(path)
        if (!node || node.type !== 'file') return null
        return node.content
      }, null)
    },
    write(path: string, content: string, mime?: string): boolean {
      return safe(() => vfs.write(path, String(content ?? ''), mime), false)
    },
    list(path: string): MixtFileRecord[] | null {
      return safe(() => {
        const entries = vfs.list(path)
        if (!entries) return null
        return entries.map(({ name, node }) => ({
          name,
          path: join(path, name),
          type: node.type,
          size: node.type === 'file' ? (node.content || '').length : 0,
          mime: node.type === 'file' ? node.mime ?? null : null,
          modified: node.modified,
        }))
      }, null)
    },
    exists(path: string): boolean {
      return safe(() => vfs.exists(path), false)
    },
    mkdir(path: string): boolean {
      return safe(() => vfs.mkdirp(path), false)
    },
    remove(path: string): boolean {
      return safe(() => vfs.rm(path), false)
    },
    /** the way the file manager deletes: recoverable, with a .trashinfo record */
    trash(path: string): boolean {
      return safe(() => vfs.trash(path), false)
    },
    move(from: string, to: string): boolean {
      return safe(() => vfs.mv(from, to), false)
    },
    copy(from: string, to: string): boolean {
      return safe(() => vfs.cp(from, to), false)
    },
    /** the last component of a path, so a caller does not have to split it */
    basename(path: string): string {
      return safe(() => baseName(path), '')
    },
    dirname(path: string): string {
      return safe(() => parentPath(path), '/')
    },
  },

  /** a desktop notification; the body is optional */
  notify(title: string, body?: string): void {
    safe(() => postNotification(String(title), body == null ? undefined : String(body)), undefined)
  },

  /** open a terminal, optionally starting in a given directory */
  terminal(cwd?: string): string | null {
    return safe(() => {
      openTerminal(cwd)
      const wins = useOS.getState().windows.filter((w) => w.appId === 'terminal')
      return wins.length ? wins[wins.length - 1].id : null
    }, null)
  },

  /**
   * Who is signed in. The password is never part of this and never will be —
   * an application has no business asking, and the server does not give it out.
   */
  whoami(): { username: string; role: string; guest: boolean; address: string | null } {
    return safe(() => {
      const session = getSession()
      const settings = useOS.getState().settings
      const username = session?.username || settings.username || 'mixt'
      const guest = session?.role === 'guest'
      return {
        username,
        role: session?.role || 'user',
        guest,
        /* a guest gets an address only while the administrator has guest mail
           on, and this cannot know that from here — the mail app finds out by
           asking the server. So the address is what it would be, and null when
           there is no session at all. */
        address: session ? localAddress(username) : null,
      }
    }, { username: 'mixt', role: 'user', guest: false, address: null })
  },

  mail: {
    /** this session's address on this machine, or null with no session */
    address(): string | null {
      return safe(() => {
        const session = getSession()
        if (!session) return null
        return localAddress(session.username || useOS.getState().settings.username)
      }, null)
    },
  },
}

export type MixtSDK = typeof mixt

/** install the runtime on the window, once */
export function installSDK(win?: Window & { mixt?: unknown }): MixtSDK {
  const target = (win || (typeof window !== 'undefined' ? window : undefined)) as
    | (Window & { mixt?: unknown })
    | undefined
  if (target) {
    /* Frozen, so an application cannot quietly redefine the OS out from under
       the next one. It can still call everything. */
    target.mixt = Object.freeze(mixt)
  }
  return mixt
}

/**
 * The source written into the filesystem at /usr/share/mixt/mixt.js.
 *
 * It is documentation and a real file rather than a copy of this module: the
 * code that runs is compiled into the bundle, and shipping a second copy of it
 * as text would only give the two a chance to disagree. What is on disk says
 * exactly what the runtime offers and how to call it, which is what a person
 * reading an application's _Dependencies is looking for.
 */
export const MIXT_SDK_SOURCE = `/* mixt.js — the runtime an application talks to.
 *
 * Installed as window.mixt before any application starts. The code that runs is
 * compiled into the desktop bundle; this file is the record of what it offers,
 * so an application can list it as a dependency and a person can read what it
 * does without opening the source.
 *
 * Everything here is local. There is no fetch, no upload and no remote storage
 * in this API — an application written against mixt.js cannot leave this
 * machine. The filesystem calls are synchronous because they read and write the
 * same tree the desktop is showing, so a change is on screen immediately.
 *
 * Nothing here throws. A missing path gives null; a refused write gives false.
 */
var mixt = window.mixt

/* who is running, and what is installed */
mixt.version                      // 1 — check it before using something new
mixt.whoami()                     // {username, role, guest, address}
mixt.apps.list()                  // every app this session may see
mixt.apps.get('nemo')             // one app, or null
mixt.apps.launch('nemo', {})      // open it; the window id, or null
mixt.apps.open('/home/mixt/a.txt')// open a file with whatever handles it

/* the filesystem — the same tree the file manager is showing */
mixt.fs.read('/etc/hostname')             // text, or null
mixt.fs.write('/home/mixt/note.txt', 'hi')// true if written
mixt.fs.list('/home/mixt')                // entries, or null
mixt.fs.exists('/srv/www')                // true or false
mixt.fs.mkdir('/home/mixt/Projects/new')  // makes the parents too
mixt.fs.move(from, to)                    // rename
mixt.fs.copy(from, to)                    // duplicate
mixt.fs.trash(path)                       // to the Trash, recoverable
mixt.fs.remove(path)                      // delete outright
mixt.fs.basename('/a/b/c.txt')            // 'c.txt'
mixt.fs.dirname('/a/b/c.txt')             // '/a/b'

/* the rest of the desktop */
mixt.notify('Saved', 'The file is written.')
mixt.terminal('/srv/www')                 // open a terminal, optionally here
mixt.mail.address()                       // this session's local address
*/
`
