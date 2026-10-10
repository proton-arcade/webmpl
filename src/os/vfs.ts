/* Mixt Web OS — virtual filesystem, mirrored to the server.
   Everything inside the OS reads and writes through this module.
   The tree in memory is a *mirror* of the one on the server: reads are a
   property lookup, which is what keeps twenty applications instant, and every
   change is streamed back as an operation by os/sync.ts. A copy is kept in
   this browser as a cache so the desktop appears at once, and the server's
   tree replaces it the moment it arrives. A guest has neither: nothing they do
   leaves the session. */
import { create } from 'zustand'
import { safeLocal } from './storage'
import { DEFAULT_FILESYSTEM, DefaultNode } from './defaultfs'
import { WALLPAPERS } from './wallpapers'
import * as sync from './sync'
import * as api from './api'

export interface VFileNode {
  type: 'file'
  content: string
  mime?: string
  /** external url (images/wallpapers) instead of inline content */
  url?: string
  created: number
  modified: number
}
export interface VDirNode {
  type: 'dir'
  children: Record<string, VNode>
  created: number
  modified: number
}
export type VNode = VFileNode | VDirNode

/* Every account has its own filesystem, stored under its own key in this
 * browser. Nothing about the files goes to the server — the server only knows
 * the account itself (username, password, role, mailbox). A guest gets a
 * filesystem for the session too, so it behaves like a real one, but it is
 * never written to disk. */
const LS_PREFIX = 'mixt.vfs.v2'
/** the key one account's filesystem lives under */
export function vfsKey(owner: string): string {
  return owner ? `${LS_PREFIX}:${owner}` : `${LS_PREFIX}:anonymous`
}
/** the shared key every session used before filesystems were per-account */
const LEGACY_KEY = 'mixt.vfs.v2'

let owner = ''
/** whose filesystem is mounted right now */
export function currentOwner(): string {
  return owner
}

const now = () => Date.now()

export function file(content: string, mime = 'text/plain', url?: string): VFileNode {
  return { type: 'file', content, mime, url, created: now(), modified: now() }
}
export function dir(children: Record<string, VNode> = {}): VDirNode {
  return { type: 'dir', children, created: now(), modified: now() }
}

/* ------------------------------- path utils ------------------------------- */
export function normalizeHome(p: string, home: string) {
  if (!p) return home
  if (p === '~') return home
  if (p.startsWith('~/')) return home + p.slice(1)
  return p
}

export function normalizePath(p: string, cwd: string, home: string): string {
  let path = normalizeHome(p.trim(), home)
  if (!path.startsWith('/')) path = join(cwd, path)
  const parts: string[] = []
  for (const seg of path.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return '/' + parts.join('/')
}

export function join(...parts: string[]) {
  return parts
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '') || '/'
}

export function parentPath(p: string) {
  if (p === '/') return '/'
  return p.replace(/\/[^/]*$/, '') || '/'
}

export function baseName(p: string) {
  if (p === '/') return '/'
  return p.replace(/\/+$/, '').split('/').pop() || '/'
}

export function splitPath(p: string) {
  return p.split('/').filter(Boolean)
}

export function humanSize(n: number) {
  if (n < 1000) return `${n} bytes`
  const units = ['kB', 'MB', 'GB', 'TB']
  let v = n / 1000
  let i = 0
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}

export function nodeSize(n: VNode): number {
  if (n.type === 'file') return (n.url ? 240_000 : 0) + (n.content?.length ?? 0)
  return Object.values(n.children ?? {}).reduce((a, c) => a + nodeSize(c), 0)
}

export function countNodes(n: VNode): number {
  if (n.type === 'file') return 1
  return Object.values(n.children ?? {}).reduce((a, c) => a + countNodes(c), 0)
}

/* --------------------------------- seeds --------------------------------- */

/* The default user's file share on the hosted site, and the manifest that
 * lists the path of every directory and file in it. Kept as strings here so the
 * manifest is a real file the user can open and edit. */
const SHARE_LEAF = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2c6 4 8 9 4 14-3 4-9 3-11-1 4 1 7-1 7-1s-4 0-6-4c3 1 6 0 6 0s-4-2-4-6c2 2 4 2 4 2z" fill="#6cab37"/></svg>'
const SHARE_INDEX_HTML = "<!doctype html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\">\n  <title>Mixt \u2014 hosted share</title>\n  <link rel=\"stylesheet\" href=\"src/style.css\">\n</head>\n<body>\n  <h1>Mixt share</h1>\n  <p>Served from /srv/www. Every path this page uses comes from <code>mixt/index.js</code>.</p>\n  <script src=\"mixt/index.js\"></script>\n  <script src=\"src/main.js\"></script>\n</body>\n</html>\n"
const SHARE_MAIN_JS = "/* Reads the manifest and fills the page in. No path is written here: they\n * all come from mixt/index.js, which is the one file to edit. */\n(function () {\n  var files = (typeof ALL_FILES !== 'undefined' && ALL_FILES) || []\n  var list = document.createElement('ul')\n  files.forEach(function (f) {\n    var li = document.createElement('li')\n    li.textContent = f\n    list.appendChild(li)\n  })\n  document.body.appendChild(list)\n})()\n"
const SHARE_CSS = "body { font-family: system-ui, sans-serif; margin: 2rem; }\nh1 { color: #4b7a1c; }\ncode { background: #eef4e6; padding: 0 4px; }\n"
/* The record describing the hosted site, in INI form: a [Website] section with
 * one key per line, so it can be read by hand or by anything that parses INI.
 * `Path` is where the files live, `Server` is what answers for them. */
const SHARE_WEBSITE_INI = `[Website]
URL=http://mixt-desktop.local/
Server=Mixt Static 1.0
Path=/srv/www
Description=The share this machine serves. Edit index.html and the files under mixt/ to change what it publishes.
keywords=mixt,share,hosted,static
`

const SHARE_MANIFEST = "/* Every path this site serves, in one place.\n *\n * Nothing else in the site hard-codes a location: they all come from here.\n * Move a file, rename a folder, add a track \u2014 change it in this one file and\n * the hosted pages follow. Paths are absolute inside the virtual filesystem.\n */\nvar ROOT = '/srv/www/mixt'\n\nvar PATHS = {\n  root: ROOT,\n\n  audio: {\n    dir: ROOT + '/audio',\n    chime: ROOT + '/audio/chime.ogg',\n    notify: ROOT + '/audio/notify.wav',\n    startup: ROOT + '/audio/startup.ogg'\n  },\n\n  text: {\n    dir: ROOT + '/text',\n    welcome: ROOT + '/text/welcome.txt',\n    readme: ROOT + '/text/readme.txt',\n    notes: ROOT + '/text/notes.txt'\n  },\n\n  images: {\n    dir: ROOT + '/images',\n    banner: ROOT + '/images/banner.png',\n    leaf: ROOT + '/images/leaf.svg'\n  },\n\n  video: {\n    dir: ROOT + '/video',\n    intro: ROOT + '/video/intro.mp4'\n  }\n}\n\n/* A flat list of every directory and every file, for anything that wants to\n   walk the tree without knowing its shape. */\nvar ALL_DIRS = [PATHS.root, PATHS.audio.dir, PATHS.text.dir, PATHS.images.dir, PATHS.video.dir]\nvar ALL_FILES = [\n  PATHS.audio.chime, PATHS.audio.notify, PATHS.audio.startup,\n  PATHS.text.welcome, PATHS.text.readme, PATHS.text.notes,\n  PATHS.images.banner, PATHS.images.leaf,\n  PATHS.video.intro\n]\n\nif (typeof module !== 'undefined') module.exports = { PATHS: PATHS, ALL_DIRS: ALL_DIRS, ALL_FILES: ALL_FILES }\n"

const SHARE_WELCOME = "Welcome to the Mixt Web OS file share.\n\nThese are the files the hosted site starts with: three sounds, three text\nfiles, two images and one video. They are ordinary files in the virtual\nfilesystem, so you can open, edit, move or delete them from the Files\napplication like anything else in your home folder.\n\nWhere each one lives is listed in ../index.js - that file is the single\nplace the site looks for them.\n"

const SHARE_README = "README - the default file directory\n==================================\n\nThis directory is the default user's share on the hosted site. Everything\nthe site plays, shows or links to is served from here.\n\n  audio/    sounds the site plays\n  text/     plain text the site shows\n  images/   pictures and drawings\n  video/    anything that moves\n\nTo add a file: drop it in the right folder, then add its path to\n../index.js. The site reads that file and nothing else, so a file that is\nnot listed there is not served.\n"

const SHARE_NOTES = "Notes\n-----\n\n- index.js is the manifest. If a file is missing from the site but present\n  here, it is almost certainly missing from index.js.\n- Filenames are case-sensitive.\n- The audio and video files are silent placeholders: they exist so the\n  paths are real and can be replaced with your own recordings.\n"

/**
 * The default filesystem — what a brand-new account and a guest both start
 * with.
 *
 * The tree itself is not written here. It lives in the `defaultfs/` folder at
 * the root of the repository, beside index.html and the README, as ordinary
 * files; `scripts/gen-defaultfs.mjs` reads that folder and generates
 * src/os/defaultfs.ts from it. So the default filesystem can be read, edited
 * and diffed like any other part of the repository, and adding a file to it
 * means adding a file there — not editing a TypeScript module.
 *
 * Only the parts that are computed rather than stored are added here:
 *
 *   • the wallpapers, listed once from WALLPAPERS and shown in both places
 *     they appear, so adding a background needs no edit here;
 *   • /usr/share/applications, which the application index fills in later;
 *   • the hosted share under /srv/www, built from the same constants
 *     ensureWebShare() migrates, so there is one copy of it;
 *   • /bin, which holds placeholders rather than real executables.
 *
 * Nothing here reaches the network: the generated module is compiled into the
 * bundle, so the desktop can build a whole filesystem with no server at all.
 */
function fromDefault(nodes: Record<string, DefaultNode>): Record<string, VNode> {
  const out: Record<string, VNode> = {}
  for (const name of Object.keys(nodes)) {
    const n = nodes[name]
    out[name] =
      n.type === 'dir'
        ? dir(fromDefault(n.children || {}))
        : file(n.content || '', n.mime || 'text/plain')
  }
  return out
}

function seedTree(): VDirNode {
  const wallChildren: Record<string, VNode> = {}
  for (const w of WALLPAPERS) {
    wallChildren[w] = {
      type: 'file',
      content: '',
      mime: 'image/jpeg',
      url: `wallpapers/${w}`,
      created: now(),
      modified: now(),
    }
  }

  const root = dir(fromDefault(DEFAULT_FILESYSTEM))

  /* the same backgrounds in both places they are offered */
  const share = (root.children.usr as VDirNode)?.children?.share as VDirNode | undefined
  if (share) {
    share.children.backgrounds = dir({ ...wallChildren })
    share.children.applications = dir({})
  }
  const mixtHome = (root.children.home as VDirNode)?.children?.mixt as VDirNode | undefined
  const pictures = mixtHome?.children?.Pictures as VDirNode | undefined
  if (pictures) pictures.children.Wallpapers = dir({ ...wallChildren })

  /* Where the site is hosted. Everything under /srv/www/mixt belongs to the
   * default user's share, and index.js is the manifest that lists the path of
   * every directory and file so the whole tree can be rearranged from one
   * place instead of by hunting through the site's source. */
  root.children.srv = dir({
    www: dir({
      'index.html': file(SHARE_INDEX_HTML, 'text/html'),
      'website.ini': file(SHARE_WEBSITE_INI, 'text/plain'),
      src: dir({
        'main.js': file(SHARE_MAIN_JS, 'text/javascript'),
        'style.css': file(SHARE_CSS, 'text/css'),
      }),
      mixt: dir({
        'index.js': file(SHARE_MANIFEST, 'text/javascript'),
        audio: dir({
          'chime.ogg': file('', 'audio/ogg'),
          'notify.wav': file('', 'audio/wav'),
          'startup.ogg': file('', 'audio/ogg'),
        }),
        text: dir({
          'welcome.txt': file(SHARE_WELCOME),
          'readme.txt': file(SHARE_README),
          'notes.txt': file(SHARE_NOTES),
        }),
        images: dir({
          'banner.png': file('', 'image/png'),
          'leaf.svg': file(SHARE_LEAF, 'image/svg+xml'),
        }),
        video: dir({
          'intro.mp4': file('', 'video/mp4'),
        }),
      }),
    }),
  })

  root.children.bin = dir({
    bash: file('<binary>', 'application/x-executable'),
    ls: file('<binary>', 'application/x-executable'),
    nemo: file('<binary>', 'application/x-executable'),
    xed: file('<binary>', 'application/x-executable'),
  })

  return root
}

/* --------------------------------- state --------------------------------- */
interface VFSState {
  root: VDirNode
  revision: number
  /** mount points for pseudo filesystems (kept out of localStorage) */
  getNode: (path: string) => VNode | null
  list: (path: string) => { name: string; node: VNode }[] | null
  mkdir: (path: string) => boolean
  writeFile: (path: string, content: string, mime?: string, url?: string) => boolean
  touch: (path: string) => boolean
  remove: (path: string) => boolean
  move: (from: string, to: string) => boolean
  copy: (from: string, to: string) => boolean
  exists: (path: string) => boolean
  reset: () => void
  persist: () => void
}

/* ------------------------- reading a saved tree --------------------------- */
/* A saved tree is JSON that some other build wrote. It can be truncated by an
 * interrupted write, edited by hand, or written by an older release with a
 * different shape. A directory without a `children` map used to crash the very
 * first render — which is a white page on every boot until the browser is
 * cleared. So the blob is checked node by node on the way in: junk is dropped,
 * every directory gets a children map, and a blob that cannot be understood
 * falls back to the seed filesystem. */

const MAX_DEPTH = 64
const stamp = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : now())

/** Asset urls point at files that ship next to index.html. Older builds saved
 *  them root-absolute ('/wallpapers/…'), which breaks when the site is served
 *  from a subdirectory, so they are kept relative. */
const assetUrl = (url: string) => url.replace(/^\/(?=wallpapers\/|logo\.svg)/, '')

export function sanitizeNode(raw: any, depth = 0): VNode | null {
  if (!raw || typeof raw !== 'object') return null

  if (raw.type === 'file') {
    return {
      type: 'file',
      content: typeof raw.content === 'string' ? raw.content : '',
      mime: typeof raw.mime === 'string' ? raw.mime : 'text/plain',
      url: typeof raw.url === 'string' ? assetUrl(raw.url) : undefined,
      created: stamp(raw.created),
      modified: stamp(raw.modified),
    }
  }

  if (raw.type === 'dir' || (!raw.type && typeof raw.children === 'object' && raw.children)) {
    const children: Record<string, VNode> = {}
    if (depth <= MAX_DEPTH) {
      for (const [name, child] of Object.entries(raw.children ?? {})) {
        if (!name || name === '.' || name === '..' || name.includes('/')) continue
        const node = sanitizeNode(child, depth + 1)
        if (node) children[name] = node
      }
    }
    return { type: 'dir', children, created: stamp(raw.created), modified: stamp(raw.modified) }
  }

  return null
}

/** Parses a persisted tree, returning something the OS can always walk. */
export function parseTree(raw: string | null | undefined): VDirNode {
  if (raw) {
    try {
      const tree = sanitizeNode(JSON.parse(raw))
      if (tree && tree.type === 'dir') return tree
    } catch {
      /* corrupted store — start fresh */
    }
  }
  return seedTree()
}

/** Read one account's saved filesystem. `null` when it has never been saved. */
export function savedTreeOf(who: string): string | null {
  return safeLocal.getItem(vfsKey(who))
}

/** every account with a filesystem saved in this browser */
export function savedOwners(): string[] {
  return safeLocal
    .keys()
    .filter((k) => k.startsWith(`${LS_PREFIX}:`))
    .map((k) => k.slice(LS_PREFIX.length + 1))
    .filter((who) => who !== 'anonymous')
    .sort()
}

function loadRoot(who = owner): VDirNode {
  const mine = safeLocal.getItem(vfsKey(who))
  if (mine !== null) return parseTree(mine)
  /* The first account to boot on a browser that already had files under the
     old shared key inherits them, so nothing anybody saved is thrown away. */
  const legacy = safeLocal.getItem(LEGACY_KEY)
  if (legacy !== null && who) {
    safeLocal.setItem(vfsKey(who), legacy)
    return parseTree(legacy)
  }
  return parseTree(null)
}

let persistTimer: any = null

/**
 * A change has been made to the tree in memory.
 *
 * Two things happen, and they are different jobs. The tree is written into this
 * browser so a reload is instant and a brief outage costs nothing; and the
 * change is queued for the server, which is what makes it real, shared with
 * every other session signed in as this account, and permanent. A guest gets
 * neither.
 */
function schedulePersist(get: () => VFSState, op?: sync.FsOp) {
  clearTimeout(persistTimer)
  const who = owner
  /* a guest's edits are never written out, so the timer does not need to run */
  if (!persistsFor(who)) return
  if (op) sync.enqueue(op)
  persistTimer = setTimeout(() => {
    if (persistsFor(who)) safeLocal.setItem(vfsKey(who), JSON.stringify(get().root))
  }, 350)
}

/* ---------------------------------------------------------------------------
 * /users — the administrator's view of everybody else's filesystem.
 *
 * Each account's tree is already saved under its own key, so there is nothing
 * to copy: this reads those trees straight out of storage and presents them as
 * one folder per account. It only resolves for an administrator, and it is read
 * only — writing into somebody else's files is not something this offers.
 * ------------------------------------------------------------------------- */

/** set when the signed-in session is the administrator */
let adminView = false
export function setAdminView(v: boolean) {
  adminView = v
}
export function isAdminView(): boolean {
  return adminView
}

export const USERS_DIR = '/users'

const overlayCache = new Map<string, { raw: string | null; tree: VDirNode | null }>()

/** another account's saved tree, parsed once per stored revision of it */
function otherTree(who: string): VDirNode | null {
  const raw = safeLocal.getItem(vfsKey(who))
  const hit = overlayCache.get(who)
  if (hit && hit.raw === raw) return hit.tree
  const tree = raw === null ? null : parseTree(raw)
  overlayCache.set(who, { raw, tree })
  return tree
}

/** Resolve a path under /users against the saved filesystems. */
function resolveUsers(path: string): VNode | null {
  const rest = path.slice(USERS_DIR.length)
  const segs = splitPath(rest)
  if (segs.length === 0) {
    /* the folder itself: one entry per account that has files here */
    const children: Record<string, VNode> = {}
    for (const who of savedOwners()) {
      const tree = otherTree(who)
      if (!tree) continue
      children[who] = tree
    }
    return dir(children)
  }
  let node: VNode | null = otherTree(segs[0])
  for (const seg of segs.slice(1)) {
    if (!node || node.type !== 'dir') return null
    node = node.children?.[seg] ?? null
  }
  return node
}

/** true for any path inside the administrator's /users view */
export function isUsersPath(path: string): boolean {
  return path === USERS_DIR || path.startsWith(`${USERS_DIR}/`)
}

/**
 * Whether the filesystem mounted for `who` is kept on this computer.
 *
 * A guest has no saved progress: everything they do lives in memory for as long
 * as the session lasts and is gone when they sign out, so a guest never gets a
 * key in storage. That is deliberate — a shared machine should not accumulate
 * one filesystem per person who sat down at it, and nothing a guest left
 * behind should be waiting for the next one.
 *
 * The mount owner for a guest is `anonymous`, which is a truthy string, so
 * testing `if (owner)` is not enough; this is the one place that decides.
 */
export function persistsFor(who: string | null | undefined): boolean {
  return !!who && who !== 'anonymous'
}

/** Write the mounted filesystem now, rather than waiting for the debounce. */
export function persistNow(root: VDirNode) {
  if (persistsFor(owner)) safeLocal.setItem(vfsKey(owner), JSON.stringify(root))
  /* Signing out is the moment the queue has to be empty: what the person who
     was here did should be on the server before the next person sits down. */
  void sync.flushNow()
}

/**
 * Replace the tree in memory with one the server sent.
 *
 * Used when the server's copy wins — on sign-in, and whenever somebody else
 * changed the tree and the stream told us about it. The local cache is updated
 * too, so a reload does not bring the old one back.
 */
export function replaceRoot(root: VDirNode) {
  if (!root || root.type !== 'dir') return
  useVFS.setState((s) => ({ root, revision: s.revision + 1 }))
  if (persistsFor(owner)) safeLocal.setItem(vfsKey(owner), JSON.stringify(root))
}

/** Directories read from storage always carry a children map, but a tree can
 *  also be handed in programmatically (imports, archives, tests). Repair it on
 *  first write instead of throwing on `undefined[name]`. */
function ensureChildren(dirNode: VDirNode): Record<string, VNode> {
  if (!dirNode.children) dirNode.children = {}
  return dirNode.children
}

export const useVFS = create<VFSState>()((set, get) => ({
  root: loadRoot(),
  revision: 0,

  getNode: (path) => {
    /* the administrator's /users folder is not part of their own tree — it is
       a window onto the trees the other accounts saved */
    if (adminView && isUsersPath(path)) return resolveUsers(path)
    if (path === '/' || path === '') return get().root
    let node: VNode = get().root
    for (const seg of splitPath(path)) {
      if (node.type !== 'dir') return null
      // `children` is guaranteed by parseTree(), but a tree can also be set
      // programmatically — a missing map means "no such file", not a crash.
      const next = node.children?.[seg]
      if (!next) return null
      node = next
    }
    return node
  },

  list: (path) => {
    const node = get().getNode(path)
    if (!node || node.type !== 'dir') return null
    const entries = Object.entries(node.children ?? {})
    /* the administrator sees /users at the root, next to /home and /srv. It is
       not in their own tree — it is the window onto everybody else's. */
    if (adminView && (path === '/' || path === '') && !entries.some(([n]) => n === 'users')) {
      const overlay = resolveUsers(USERS_DIR)
      if (overlay && overlay.type === 'dir') entries.push(['users', overlay])
    }
    return entries
      .map(([name, n]) => ({ name, node: n }))
      .sort((a, b) => {
        if (a.node.type !== b.node.type) return a.node.type === 'dir' ? -1 : 1
        return a.name.localeCompare(b.name, undefined, { numeric: true })
      })
  },

  mkdir: (path) => {
    if (isUsersPath(path)) return false // somebody else's files are not ours to change
    const parent = parentPath(path)
    const name = baseName(path)
    const p = get().getNode(parent)
    if (!p || p.type !== 'dir') return false
    const children = ensureChildren(p)
    if (children[name]) return false
    children[name] = dir({})
    p.modified = now()
    set((s) => ({ revision: s.revision + 1 }))
    schedulePersist(get, { op: 'mkdir', path })
    return true
  },

  writeFile: (path, content, mime = 'text/plain', url) => {
    if (isUsersPath(path)) return false // another account's files are read-only here
    const parent = parentPath(path)
    const name = baseName(path)
    const p = get().getNode(parent)
    if (!p || p.type !== 'dir') return false
    const children = ensureChildren(p)
    const existing = children[name]
    if (existing && existing.type === 'dir') return false
    if (existing && existing.type === 'file') {
      existing.content = content
      existing.mime = mime
      if (url !== undefined) existing.url = url
      existing.modified = now()
    } else {
      children[name] = { type: 'file', content, mime, url, created: now(), modified: now() }
    }
    p.modified = now()
    set((s) => ({ revision: s.revision + 1 }))
    schedulePersist(get, { op: 'write', path, content, mime })
    return true
  },

  touch: (path) => {
    const parent = parentPath(path)
    const name = baseName(path)
    const p = get().getNode(parent)
    if (!p || p.type !== 'dir') return false
    const children = ensureChildren(p)
    if (!children[name]) {
      children[name] = file('')
      set((s) => ({ revision: s.revision + 1 }))
      schedulePersist(get, { op: 'touch', path })
    }
    return true
  },

  remove: (path) => {
    if (isUsersPath(path)) return false
    const p = get().getNode(parentPath(path))
    const name = baseName(path)
    if (!p || p.type !== 'dir') return false
    const children = ensureChildren(p)
    if (!children[name]) return false
    delete children[name]
    p.modified = now()
    set((s) => ({ revision: s.revision + 1 }))
    schedulePersist(get, { op: 'remove', path })
    return true
  },

  move: (from, to) => {
    if (isUsersPath(from) || isUsersPath(to)) return false
    const srcParent = get().getNode(parentPath(from))
    const node = get().getNode(from)
    if (!node || !srcParent || srcParent.type !== 'dir') return false
    let destPath = to
    if (get().exists(to) && get().getNode(to)?.type === 'dir') {
      destPath = join(to, baseName(from))
    }
    const dstParent = get().getNode(parentPath(destPath))
    if (!dstParent || dstParent.type !== 'dir') return false
    delete ensureChildren(srcParent)[baseName(from)]
    ensureChildren(dstParent)[baseName(destPath)] = node
    node.modified = now()
    set((s) => ({ revision: s.revision + 1 }))
    /* The server needs the destination the client settled on, not the one it
       was given: `mv a b` where b is a directory means b/a. */
    schedulePersist(get, { op: 'move', path: from, to: destPath })
    return true
  },

  copy: (from, to) => {
    if (isUsersPath(to)) return false // reading from /users is fine, writing into it is not
    const node = get().getNode(from)
    if (!node) return false
    let destPath = to
    if (get().getNode(to)?.type === 'dir') destPath = join(to, baseName(from))
    const dstParent = get().getNode(parentPath(destPath))
    if (!dstParent || dstParent.type !== 'dir') return false
    ensureChildren(dstParent)[baseName(destPath)] = JSON.parse(JSON.stringify(node))
    set((s) => ({ revision: s.revision + 1 }))
    schedulePersist(get, { op: 'copy', path: from, to: destPath })
    return true
  },

  exists: (path) => !!get().getNode(path),

  reset: () => {
    const root = seedTree()
    set((s) => ({ root, revision: s.revision + 1 }))
    if (persistsFor(owner)) safeLocal.setItem(vfsKey(owner), JSON.stringify(root))
    /* The server throws its copy away and seeds a new one; the desktop takes
       whatever the server says it has afterwards. */
    sync.enqueue({ op: 'reset', path: '/' })
    void sync.flushNow()
  },

  persist: () => schedulePersist(get),
}))

/** home directory of the session user */
/** Walk the hosted share into a filesystem that predates it.
 *
 *  The tree is saved to localStorage and a saved tree replaces the seed
 *  outright, so a session that booted before /srv/www existed would never see
 *  it. This creates only what is missing, so anything the user has since added,
 *  edited or deleted is left exactly as they left it. */
export function ensureWebShare() {
  /* The manifest being present means the share is there — but an older share
     predates the website record, so that one is filled in either way. */
  const present = vfs.read('/srv/www/mixt/index.js') !== null
  if (present && vfs.read('/srv/www/website.ini') !== null) return
  const share: [string, string, string][] = [
    ['/srv/www/index.html', SHARE_INDEX_HTML, 'text/html'],
    ['/srv/www/website.ini', SHARE_WEBSITE_INI, 'text/plain'],
    ['/srv/www/src/main.js', SHARE_MAIN_JS, 'text/javascript'],
    ['/srv/www/src/style.css', SHARE_CSS, 'text/css'],
    ['/srv/www/mixt/index.js', SHARE_MANIFEST, 'text/javascript'],
    ['/srv/www/mixt/audio/chime.ogg', '', 'audio/ogg'],
    ['/srv/www/mixt/audio/notify.wav', '', 'audio/wav'],
    ['/srv/www/mixt/audio/startup.ogg', '', 'audio/ogg'],
    ['/srv/www/mixt/text/welcome.txt', SHARE_WELCOME, 'text/plain'],
    ['/srv/www/mixt/text/readme.txt', SHARE_README, 'text/plain'],
    ['/srv/www/mixt/text/notes.txt', SHARE_NOTES, 'text/plain'],
    ['/srv/www/mixt/images/banner.png', '', 'image/png'],
    ['/srv/www/mixt/images/leaf.svg', SHARE_LEAF, 'image/svg+xml'],
    ['/srv/www/mixt/video/intro.mp4', '', 'video/mp4'],
  ]
  for (const [path, content, mime] of share) {
    try {
      vfs.mkdirp(parentPath(path))
      if (vfs.read(path) === null) vfs.write(path, content, mime)
    } catch {
      /* a blocked or full store must not cost the user their session */
    }
  }
}

/**
 * Mount one account's filesystem.
 *
 * Called when somebody signs in, and again when they sign out. The filesystem
 * that is mounted is written out first, so signing out never loses what the
 * person who was signed in had just done. A guest's tree is kept in memory for
 * the session and simply dropped, which is what a guest is for.
 */
export function mountFilesystem(who: string) {
  if (who !== owner) persistNow(useVFS.getState().root)
  owner = who || ''
  /* Start mirroring for this account — but only if it is the one the session
     belongs to. Mounting anybody else's tree is a way of looking, not of
     being: an administrator browsing /users reads those files without
     becoming their author, and nothing they do there is sent to a server
     that would file it under the wrong name. A guest's mirror is never
     switched on at all, because a guest has nothing on the server. */
  const live = api.getSession()?.username
  sync.configure(persistsFor(owner) && live === owner ? owner : '', 0)
  const root = loadRoot(owner)
  useVFS.setState((s) => ({ root, revision: s.revision + 1 }))
  /* Saved from the moment the account first signs in, not only after something
     changes — this browser is the only copy of these files, and an account that
     has a filesystem should have one on disk. A guest is never written out. */
  if (persistsFor(owner)) persistNow(root)
  return root
}

export const HOME = '/home/mixt'
export const TRASH_DIR = '/home/mixt/.local/share/Trash/files'

/** imperative helpers usable outside React */
export const vfs = {
  node: (p: string) => useVFS.getState().getNode(p),
  list: (p: string) => useVFS.getState().list(p),
  read: (p: string) => {
    const n = useVFS.getState().getNode(p)
    if (!n || n.type !== 'file') return null
    return n.content
  },
  write: (p: string, c: string, mime?: string, url?: string) =>
    useVFS.getState().writeFile(p, c, mime, url),
  mkdir: (p: string) => useVFS.getState().mkdir(p),
  mkdirp: (p: string) => {
    /* Every level has to be built as an ABSOLUTE path. join() drops empty
     * segments, so starting from '' produced relative paths like 'srv/www' —
     * and parentPath('srv') is 'srv' itself, so the very first mkdir went
     * looking for its own parent, found nothing, and quietly failed. mkdirp
     * still returned true, so the caller had no way to know. Absolute paths put
     * '/' in front of every level, and the result now tells the truth. */
    const parts = splitPath(p)
    let cur = ''
    for (const part of parts) {
      cur += '/' + part
      if (!useVFS.getState().exists(cur)) useVFS.getState().mkdir(cur)
    }
    return useVFS.getState().exists(p)
  },
  rm: (p: string) => useVFS.getState().remove(p),
  mv: (a: string, b: string) => useVFS.getState().move(a, b),
  cp: (a: string, b: string) => useVFS.getState().copy(a, b),
  exists: (p: string) => useVFS.getState().exists(p),
  trash: (p: string) => {
    vfs.mkdirp('/home/mixt/.local/share/Trash/info')
    const name = baseName(p)
    const stamp = new Date().toISOString()
    useVFS.getState().writeFile(
      join('/home/mixt/.local/share/Trash/info', `${name}.trashinfo`),
      `[Trash Info]\nPath=${p}\nDeletionDate=${stamp}\n`,
    )
    return useVFS.getState().move(p, join(TRASH_DIR, name))
  },
  reset: () => useVFS.getState().reset(),
}
