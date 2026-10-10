/* Mixt Web OS — window manager + session state.
   A tiny "Mixt Shell" implemented with zustand. */
import { create } from 'zustand'
import type { Notification, Settings, SnapZone, User, WinGeometry, WinState } from './types'
import { applyThemeVars } from './theme'
import { safeLocal } from './storage'
import { persistsFor } from './vfs'
import { getSession, putSettings, installed as serverInstalled } from './api'
import {
  checkPassword,
  hashPassword,
  loadActiveUserId,
  loadUsers,
  newId as newUserId,
  saveActiveUserId,
  saveUsers,
  validateUsername,
} from './users'

const LS_SETTINGS = 'mixt.settings.v2'
/* What an account has installed from the Software Manager. Per account, like
 * the filesystem: two people on one browser have installed different things,
 * and neither should inherit the other's. This used not to be saved at all, so
 * everything anybody installed vanished the moment the page was reloaded. */
const LS_INSTALLED = 'mixt.installed.v2'
export const installedKey = (who: string) => (who ? `${LS_INSTALLED}:${who}` : LS_INSTALLED)

let installedOwner = ''
export function loadInstalled(who: string) {
  installedOwner = who || ''
  let map: Record<string, boolean> = {}
  try {
    const raw = safeLocal.getItem(installedKey(who)) ?? safeLocal.getItem(LS_INSTALLED)
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) map = parsed
  } catch {
    /* unreadable saved state — nothing installed is a safe answer */
  }
  useOS.setState({ installed: map })
  /* What the account has installed lives on the server now, so it follows them
     to whichever machine on the network they sign in from. The copy in this
     browser is only what shows until the answer arrives — and it is replaced
     rather than merged, because an app uninstalled on another machine should
     not still be here. */
  void serverInstalled().then((ids) => {
    if (!ids) return
    const next: Record<string, boolean> = {}
    for (const id of ids) next[id] = true
    useOS.setState({ installed: next })
  })
  return map
}

function persistInstalled(map: Record<string, boolean>) {
  /* A guest has no saved progress, so what they installed lasts only as long as
     the session does. Writing it under `anonymous` would leave it waiting on the
     shared machine for whoever sits down next. */
  if (!persistsFor(installedOwner)) return
  try {
    safeLocal.setItem(installedKey(installedOwner), JSON.stringify(map))
  } catch {
    /* a blocked or full store must not break installing */
  }
}

/** Tell the server an app was installed or removed for this account. */
export function syncInstalled(appId: string, value: boolean) {
  if (getSession()?.role === 'guest') return
  void fetch(`/api/apps/${encodeURIComponent(appId)}/${value ? 'install' : 'uninstall'}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(getSession() ? { authorization: `Bearer ${getSession()!.token}` } : {}),
    },
  }).catch(() => { /* the local copy still works; it will sync next time */ })
}

export const DEFAULT_SETTINGS: Settings = {
  username: 'mixt',
  fullName: 'Mixt User',
  hostname: 'mixt-web',
  scheme: 'light',
  accent: '#9ede6a',
  wallpaper: 'wallpapers/mixt-wave.jpg',
  panelPosition: 'bottom',
  panelSize: 40,
  panelAutohide: false,
  clock24: false,
  clockSeconds: false,
  volume: 62,
  muted: false,
  wifi: true,
  effects: true,
  hotCorner: true,
  focusMode: 'click',
  buttonSide: 'right',
  desktopStyle: 'classic',
  themeName: 'Mixt-Y',
  iconTheme: 'Mixt-Y',
  desktopIcons: ['nemo', 'terminal', 'browser', 'texteditor', 'help'],
  startupApps: ['update-notifier'],
  autoUpdates: true,
  mediaApp: 'mixtplayer',
}

/** Every setting, checked against the default of its own type. A saved blob is
 *  written by whatever build the user last ran (or by hand, or by an older
 *  release with a different shape), so a field can be missing, null or the
 *  wrong type. Trusting it crashed the first render — a wallpaper of `null`
 *  was enough to leave a white page — so anything that does not match the
 *  default's type is replaced by the default. */
export function sanitizeSettings(raw: any): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS }
  if (!raw || typeof raw !== 'object') return out

  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const value = raw[key]
    if (value === undefined || value === null) continue
    const fallback = DEFAULT_SETTINGS[key]
    if (Array.isArray(fallback)) {
      if (Array.isArray(value)) (out as any)[key] = value.filter((v) => typeof v === 'string')
      continue
    }
    if (typeof fallback === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) (out as any)[key] = value
      continue
    }
    if (typeof fallback === 'boolean') {
      if (typeof value === 'boolean') (out as any)[key] = value
      continue
    }
    if (typeof value === 'string' && value.length) (out as any)[key] = value
  }

  // fields with a small set of legal values
  if (out.scheme !== 'light' && out.scheme !== 'dark') out.scheme = DEFAULT_SETTINGS.scheme
  if (out.panelPosition !== 'bottom' && out.panelPosition !== 'top') out.panelPosition = DEFAULT_SETTINGS.panelPosition
  if (out.buttonSide !== 'left' && out.buttonSide !== 'right') out.buttonSide = DEFAULT_SETTINGS.buttonSide
  if (out.focusMode !== 'click' && out.focusMode !== 'sloppy') out.focusMode = DEFAULT_SETTINGS.focusMode
  if (out.desktopStyle !== 'classic' && out.desktopStyle !== 'shelf') out.desktopStyle = DEFAULT_SETTINGS.desktopStyle
  if (!/^#[0-9a-f]{3,8}$/i.test(out.accent)) out.accent = DEFAULT_SETTINGS.accent
  // older builds saved root-absolute asset paths ('/wallpapers/…'); make them
  // relative so they still resolve when the site is served from a subdirectory
  out.wallpaper = out.wallpaper.replace(/^\/(?=wallpapers\/)/, '')
  out.panelSize = Math.min(96, Math.max(24, Math.round(out.panelSize) || DEFAULT_SETTINGS.panelSize))
  out.volume = Math.min(100, Math.max(0, Math.round(out.volume)))
  return out
}

function loadSettings(): Settings {
  try {
    const raw = safeLocal.getItem(LS_SETTINGS)
    if (raw) return sanitizeSettings(JSON.parse(raw))
  } catch {
    /* unreadable saved state — defaults are fine */
  }
  return { ...DEFAULT_SETTINGS }
}

export function persistSettings(s: Settings) {
  /* Settings are saved under one shared key, so a guest writing theirs would
     overwrite what the account before them left behind — and a guest has no
     saved progress by design. They still get working settings for the length
     of the session; they just are not the ones written to disk. */
  if (getSession()?.role === 'guest') return
  try {
    safeLocal.setItem(LS_SETTINGS, JSON.stringify(s))
  } catch {
    /* ignore */
  }
  /* …and on the server, under this account, so the panel, the wallpaper and
     the theme are the same on every machine they sign in from. */
  void putSettings(s)
}

/**
 * Take the settings the server has for this account.
 *
 * Called when somebody signs in. Without it an account that had set a dark
 * theme on the laptop got the browser's defaults on the phone, which is the
 * sort of thing that makes a computer feel like it does not know you.
 */
export function adoptServerSettings(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
  const settings = sanitizeSettings({ ...useOS.getState().settings, ...(raw as object) })
  try {
    safeLocal.setItem(LS_SETTINGS, JSON.stringify(settings))
  } catch {
    /* ignore */
  }
  applyThemeVars(settings)
  useOS.setState({ settings })
}

let idCounter = 0
const newId = (p = 'w') => `${p}${Date.now().toString(36)}${(idCounter++).toString(36)}`

interface OSState {
  windows: WinState[]
  activeId: string | null
  topZ: number
  workspace: number
  workspaceCount: number
  showDesktop: boolean
  settings: Settings
  notifications: Notification[]
  installed: Record<string, boolean>
  /** package id -> the version that has been updated to */
  updatesApplied: Record<string, string>
  /** role of the signed-in backend account, so menus can react to a sign-in
      that happens while the desktop is already running */
  serverRole: 'admin' | 'user' | 'guest' | null
  menuOpen: boolean
  exposeOpen: boolean
  locked: boolean
  runDialogOpen: boolean
  altTabOpen: boolean
  clipboard: { text: string; source?: string }
  /** local accounts created with `/startup` */
  users: User[]
  activeUserId: string | null
  /** virtual time offset so the fake clock feels alive but stable */
  bootTime: number

  openApp: (appId: string, props?: Record<string, any>, opts?: Partial<WinState>) => string | null
  closeWindow: (id: string) => void
  focusWindow: (id: string) => void
  minimize: (id: string) => void
  unminimize: (id: string) => void
  toggleMaximize: (id: string) => void
  toggleMinimize: (id: string) => void
  setGeometry: (id: string, g: Partial<Omit<WinState, 'id' | 'appId'>>) => void
  setTitle: (id: string, title: string) => void
  patchProps: (id: string, patch: Record<string, any>) => void
  snap: (id: string, zone: SnapZone) => void
  sendToWorkspace: (id: string, ws: number) => void
  switchWorkspace: (ws: number) => void
  cycleWindows: (dir: 1 | -1) => void
  toggleShowDesktop: () => void
  notify: (n: { title: string; body?: string; appId?: string }) => void
  dismissNotification: (id: string) => void
  clearNotifications: () => void
  setSettings: (patch: Partial<Settings>) => void
  setInstalled: (appId: string, value: boolean) => void
  applyUpdate: (appId: string, version: string) => void
  setServerRole: (r: 'admin' | 'user' | 'guest' | null) => void
  setMenuOpen: (v: boolean) => void
  setExposeOpen: (v: boolean) => void
  setLocked: (v: boolean) => void
  setRunDialog: (v: boolean) => void
  setAltTab: (v: boolean) => void
  setClipboard: (text: string, source?: string) => void
  closeAll: () => void

  /** create an account; returns the new user, or an error message */
  createUser: (input: {
    username: string
    fullName: string
    password: string
    accent: string
    wallpaper: string
  }) => { ok: true; user: User } | { ok: false; error: string }
  removeUser: (id: string) => void
  /** switch account; returns false when the password does not match */
  loginUser: (id: string, password: string) => boolean
  /** sign out of the current account and lock the screen */
  signOut: () => void
  activeUser: () => User | null
}

const geomCache = new Map<string, WinGeometry>()
let cascade = 0

export function defaultGeometry(appId: string) {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1280
  const h = typeof window !== 'undefined' ? window.innerHeight : 800
  const cached = geomCache.get(appId)
  const base = cached ?? { w: 900, h: 600 }
  const offset = (cascade++ % 8) * 28
  const width = Math.min(base.w, w - 40)
  const height = Math.min(base.h, h - 92)
  return {
    x: Math.max(8, Math.round((w - width) / 2 - 60) + offset),
    y: Math.max(8, Math.round((h - height) / 2 - 30) + offset),
    w: width,
    h: height,
  }
}

export function rememberGeometry(appId: string, g: WinGeometry) {
  geomCache.set(appId, g)
}

export const useOS = create<OSState>()((set, get) => ({
  windows: [],
  activeId: null,
  topZ: 10,
  workspace: 0,
  workspaceCount: 4,
  showDesktop: false,
  settings: loadSettings(),
  notifications: [],
  installed: {},
  updatesApplied: {},
  serverRole: null,
  menuOpen: false,
  exposeOpen: false,
  locked: false,
  runDialogOpen: false,
  altTabOpen: false,
  clipboard: { text: '' },
  users: loadUsers(),
  activeUserId: loadActiveUserId(),
  bootTime: Date.now(),

  openApp: (appId, props = {}, opts = {}) => {
    const { windows, topZ } = get()
    const existing = windows.find((w) => w.appId === appId && !opts.id)
    const def = opts.title ?? appId
    // Apps can request explicit per-window keys; otherwise re-focus the existing window
    // when the app declares itself a singleton (terminal/browser are not).
    const id = opts.id || newId('win')
    const g = opts.x !== undefined ? ({} as Partial<WinState>) : defaultGeometry(appId)
    const win: WinState = {
      id,
      appId,
      title: def,
      x: g.x ?? 60,
      y: g.y ?? 40,
      w: g.w ?? 900,
      h: g.h ?? 600,
      z: topZ + 1,
      minimized: false,
      maximized: false,
      workspace: get().workspace,
      props,
      createdAt: Date.now(),
      opening: true,
      ...opts,
    }
    set((s) => ({
      windows: [...s.windows, win],
      activeId: win.id,
      topZ: s.topZ + 1,
      showDesktop: false,
    }))
    setTimeout(() => {
      set((s) => ({
        windows: s.windows.map((w) => (w.id === id ? { ...w, opening: false } : w)),
      }))
    }, 180)
    return id
  },

  closeWindow: (id) => {
    const win = get().windows.find((w) => w.id === id)
    if (win) rememberGeometry(win.appId, { x: win.x, y: win.y, w: win.w, h: win.h })
    set((s) => {
      const windows = s.windows.filter((w) => w.id !== id)
      const active = s.activeId === id ? topWindow(windows, s.workspace)?.id ?? null : s.activeId
      return { windows, activeId: active }
    })
  },

  focusWindow: (id) => {
    const win = get().windows.find((w) => w.id === id)
    if (!win) return
    set((s) => ({
      activeId: id,
      topZ: s.topZ + 1,
      menuOpen: false,
      windows: s.windows.map((w) =>
        w.id === id
          ? { ...w, z: s.topZ + 1, minimized: false, workspace: s.workspace }
          : w,
      ),
    }))
  },

  minimize: (id) =>
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, minimized: true } : w)),
      activeId: s.activeId === id ? null : s.activeId,
    })),

  unminimize: (id) => {
    const win = get().windows.find((w) => w.id === id)
    if (!win) return
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id
          ? { ...w, minimized: false, z: s.topZ + 1, workspace: s.workspace }
          : w,
      ),
      activeId: id,
      topZ: s.topZ + 1,
      showDesktop: false,
    }))
  },

  toggleMinimize: (id) => {
    const w = get().windows.find((x) => x.id === id)
    if (!w) return
    if (w.minimized) get().unminimize(id)
    else get().minimize(id)
  },

  toggleMaximize: (id) =>
    set((s) => ({
      windows: s.windows.map((w) => {
        if (w.id !== id) return w
        if (w.maximized && w.restore) {
          return { ...w, maximized: false, ...w.restore, restore: undefined }
        }
        return {
          ...w,
          maximized: true,
          restore: { x: w.x, y: w.y, w: w.w, h: w.h },
        }
      }),
    })),

  setGeometry: (id, g) =>
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, ...g, maximized: false } : w)),
    })),

  setTitle: (id, title) =>
    set((s) => ({ windows: s.windows.map((w) => (w.id === id ? { ...w, title } : w)) })),

  patchProps: (id, patch) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, props: { ...w.props, ...patch } } : w,
      ),
    })),

  snap: (id, zone) =>
    set((s) => {
      const W = window.innerWidth
      const H = window.innerHeight
      // the panel takes its strip off the top or the bottom of the screen
      const top = s.settings.panelPosition === 'top' ? s.settings.panelSize : 0
      const usable = Math.max(120, H - s.settings.panelSize)
      const halfW = Math.round(W / 2)
      const halfH = Math.round(usable / 2)
      const bottomH = usable - halfH

      /* Eight zones: four halves, four corners, plus maximise. Every one of
         them keeps clear of the panel, so a window never lands on the bar. */
      const zones: Record<SnapZone, { x: number; y: number; w: number; h: number }> = {
        max: { x: 0, y: top, w: W, h: usable },
        left: { x: 0, y: top, w: halfW, h: usable },
        right: { x: halfW, y: top, w: W - halfW, h: usable },
        bottom: { x: 0, y: top + halfH, w: W, h: bottomH },
        tl: { x: 0, y: top, w: halfW, h: halfH },
        tr: { x: halfW, y: top, w: W - halfW, h: halfH },
        bl: { x: 0, y: top + halfH, w: halfW, h: bottomH },
        br: { x: halfW, y: top + halfH, w: W - halfW, h: bottomH },
      }
      const rect = zones[zone]

      return {
        windows: s.windows.map((w) => {
          if (w.id !== id) return w
          const willMax = zone === 'max'
          return {
            ...w,
            maximized: willMax,
            restore: willMax && !w.maximized ? { x: w.x, y: w.y, w: w.w, h: w.h } : w.restore,
            ...rect,
          }
        }),
      }
    }),

  sendToWorkspace: (id, ws) =>
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, workspace: ws } : w)),
      activeId: s.activeId === id ? null : s.activeId,
    })),

  switchWorkspace: (ws) =>
    set((s) => {
      const n = ((ws % s.workspaceCount) + s.workspaceCount) % s.workspaceCount
      const top = topWindow(s.windows.filter((w) => w.workspace === n), n)
      return { workspace: n, activeId: top?.id ?? null, menuOpen: false, showDesktop: false }
    }),

  cycleWindows: (dir) => {
    const s = get()
    const list = s.windows
      .filter((w) => w.workspace === s.workspace && !w.minimized)
      .sort((a, b) => b.z - a.z)
    if (list.length < 2) return
    const idx = list.findIndex((w) => w.id === s.activeId)
    const next = list[(((idx === -1 ? 0 : idx) + dir) % list.length + list.length) % list.length]
    if (next) get().focusWindow(next.id)
  },

  toggleShowDesktop: () =>
    set((s) => ({ showDesktop: !s.showDesktop, menuOpen: false })),

  notify: (n) =>
    set((s) => ({
      notifications: [
        ...s.notifications.filter((x) => !(x.appId === n.appId && x.title === n.title)),
        { id: newId('n'), time: Date.now(), ...n },
      ].slice(-4),
    })),

  dismissNotification: (id) =>
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })),

  clearNotifications: () => set({ notifications: [] }),

  setSettings: (patch) => {
    const settings = { ...get().settings, ...patch }
    persistSettings(settings)
    applyThemeVars(settings)
    set({ settings })
  },

  setInstalled: (appId, value) =>
    set((s) => {
      const installed = { ...s.installed, [appId]: value }
      persistInstalled(installed)
      syncInstalled(appId, value)
      return { installed }
    }),

  applyUpdate: (appId, version) =>
    set((s) => ({ updatesApplied: { ...s.updatesApplied, [appId]: version } })),

  setServerRole: (serverRole) => set({ serverRole }),

  setMenuOpen: (v) => set({ menuOpen: v }),
  setExposeOpen: (v) => set({ exposeOpen: v, menuOpen: false }),
  setLocked: (v) => set({ locked: v, menuOpen: false }),
  setRunDialog: (v) => set({ runDialogOpen: v, menuOpen: false }),
  setAltTab: (v) => set({ altTabOpen: v }),
  setClipboard: (text, source) => set({ clipboard: { text, source } }),
  closeAll: () => set({ windows: [], activeId: null }),

  /* ------------------------------- accounts ------------------------------- */
  createUser: ({ username, fullName, password, accent, wallpaper }) => {
    const name = username.trim().toLowerCase()
    const problem = validateUsername(name)
    if (problem) return { ok: false, error: problem }
    if (get().users.some((u) => u.username === name)) {
      return { ok: false, error: `an account called “${name}” already exists` }
    }
    const id = newUserId('user')
    const user: User = {
      id,
      username: name,
      fullName: fullName.trim() || name,
      passwordHash: password ? hashPassword(password, id) : '',
      accent: accent || DEFAULT_SETTINGS.accent,
      wallpaper: wallpaper || DEFAULT_SETTINGS.wallpaper,
      created: Date.now(),
    }
    const users = [...get().users, user]
    saveUsers(users)
    saveActiveUserId(id)
    set({ users, activeUserId: id, settings: applyUser(get().settings, user) })
    persistSettings(get().settings)
    return { ok: true, user }
  },

  removeUser: (id) => {
    const users = get().users.filter((u) => u.id !== id)
    saveUsers(users)
    const activeUserId = get().activeUserId === id ? (users[0]?.id ?? null) : get().activeUserId
    saveActiveUserId(activeUserId)
    set({ users, activeUserId })
  },

  loginUser: (id, password) => {
    const user = get().users.find((u) => u.id === id)
    if (!user) return false
    if (!checkPassword(user, password)) return false
    saveActiveUserId(id)
    set({ activeUserId: id, settings: applyUser(get().settings, user), locked: false })
    persistSettings(get().settings)
    return true
  },

  signOut: () => {
    saveActiveUserId(null)
    set({ activeUserId: null, locked: get().users.length > 0, windows: [], activeId: null })
  },

  activeUser: () => get().users.find((u) => u.id === get().activeUserId) ?? null,
}))

/** An account owns the visible identity of a session. */
function applyUser(settings: Settings, user: User): Settings {
  return {
    ...settings,
    username: user.username,
    fullName: user.fullName,
    accent: user.accent,
    wallpaper: user.wallpaper,
  }
}

function topWindow(windows: WinState[], ws: number) {
  return windows
    .filter((w) => w.workspace === ws && !w.minimized)
    .sort((a, b) => b.z - a.z)[0]
}

/** windows visible on the current workspace honoring "show desktop" */
export function visibleWindows(s: OSState): WinState[] {
  const list = s.windows.filter((w) => w.workspace === s.workspace)
  if (s.showDesktop) return []
  return list.filter((w) => !w.minimized)
}

export function isInstalled(s: OSState, appId: string, preinstalled?: boolean) {
  if (preinstalled !== false) return true
  return !!s.installed[appId]
}
