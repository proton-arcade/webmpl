/* Mint Web OS — window manager + session state.
   A tiny "Cinnamon" implemented with zustand. */
import { create } from 'zustand'
import type { Notification, Settings, WinGeometry, WinState } from './types'
import { applyThemeVars } from './theme'

const LS_SETTINGS = 'webmpl.settings.v2'

export const DEFAULT_SETTINGS: Settings = {
  username: 'mint',
  fullName: 'Mint User',
  hostname: 'mint-web',
  avatar: '🪴',
  scheme: 'light',
  accent: '#9ede6a',
  wallpaper: '/wallpapers/mint-wave.jpg',
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
  themeName: 'Mint-Y',
  iconTheme: 'Mint-Y',
  desktopIcons: ['nemo', 'terminal', 'browser', 'texteditor', 'help'],
  startupApps: ['update-notifier'],
  autoUpdates: true,
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(LS_SETTINGS)
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS }
}

export function persistSettings(s: Settings) {
  try {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(s))
  } catch {
    /* ignore */
  }
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
  menuOpen: boolean
  exposeOpen: boolean
  locked: boolean
  runDialogOpen: boolean
  altTabOpen: boolean
  clipboard: { text: string; source?: string }
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
  snap: (id: string, side: 'left' | 'right' | 'max') => void
  sendToWorkspace: (id: string, ws: number) => void
  switchWorkspace: (ws: number) => void
  cycleWindows: (dir: 1 | -1) => void
  toggleShowDesktop: () => void
  notify: (n: { title: string; body?: string; appId?: string }) => void
  dismissNotification: (id: string) => void
  clearNotifications: () => void
  setSettings: (patch: Partial<Settings>) => void
  setInstalled: (appId: string, value: boolean) => void
  setMenuOpen: (v: boolean) => void
  setExposeOpen: (v: boolean) => void
  setLocked: (v: boolean) => void
  setRunDialog: (v: boolean) => void
  setAltTab: (v: boolean) => void
  setClipboard: (text: string, source?: string) => void
  closeAll: () => void
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
  menuOpen: false,
  exposeOpen: false,
  locked: false,
  runDialogOpen: false,
  altTabOpen: false,
  clipboard: { text: '' },
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

  snap: (id, side) =>
    set((s) => {
      const W = window.innerWidth
      const H = window.innerHeight
      const panel = s.settings.panelPosition === 'top' ? s.settings.panelSize : 0
      const usable = H - s.settings.panelSize
      const top = panel
      if (side === 'max') {
        return {
          windows: s.windows.map((w) =>
            w.id === id
              ? {
                  ...w,
                  maximized: true,
                  restore: w.maximized ? w.restore : { x: w.x, y: w.y, w: w.w, h: w.h },
                  x: 0,
                  y: top,
                  w: W,
                  h: usable,
                }
              : w,
          ),
        }
      }
      const half = Math.round(W / 2)
      return {
        windows: s.windows.map((w) =>
          w.id === id
            ? {
                ...w,
                maximized: false,
                x: side === 'left' ? 0 : half,
                y: top,
                w: half,
                h: usable,
              }
            : w,
        ),
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
    set((s) => ({ installed: { ...s.installed, [appId]: value } })),

  setMenuOpen: (v) => set({ menuOpen: v }),
  setExposeOpen: (v) => set({ exposeOpen: v, menuOpen: false }),
  setLocked: (v) => set({ locked: v, menuOpen: false }),
  setRunDialog: (v) => set({ runDialogOpen: v, menuOpen: false }),
  setAltTab: (v) => set({ altTabOpen: v }),
  setClipboard: (text, source) => set({ clipboard: { text, source } }),
  closeAll: () => set({ windows: [], activeId: null }),
}))

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
