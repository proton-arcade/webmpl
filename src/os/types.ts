/* Core shared types for Mixt Web OS */

export type Scheme = 'light' | 'dark'

export interface WinGeometry {
  x: number
  y: number
  w: number
  h: number
}

export interface WinState extends WinGeometry {
  id: string
  appId: string
  title: string
  z: number
  minimized: boolean
  maximized: boolean
  /** geometry to restore after un-maximising */
  restore?: WinGeometry
  workspace: number
  /** per-window state (url, cwd, open file, ...) owned by the app */
  props: Record<string, any>
  createdAt: number
  opening?: boolean
}

export interface Notification {
  id: string
  appId?: string
  title: string
  body?: string
  time: number
}

export interface Settings {
  username: string
  fullName: string
  hostname: string
  avatar: string
  scheme: Scheme
  accent: string
  wallpaper: string
  panelPosition: 'bottom' | 'top'
  panelSize: number
  panelAutohide: boolean
  clock24: boolean
  clockSeconds: boolean
  volume: number
  muted: boolean
  wifi: boolean
  effects: boolean
  hotCorner: boolean
  focusMode: 'click' | 'sloppy'
  buttonSide: 'left' | 'right'
  themeName: string
  iconTheme: string
  desktopIcons: string[]
  startupApps: string[]
  autoUpdates: boolean
}

export interface AppProps {
  win: WinState
  api: {
    setTitle: (t: string) => void
    setProps: (p: Record<string, any>) => void
    close: () => void
    openApp: (appId: string, props?: Record<string, any>) => string | null
    notify: (n: { title: string; body?: string; appId?: string }) => void
  }
}

export type AppComponent = React.ComponentType<AppProps>

export interface AppDef {
  id: string
  name: string
  /** generic name, e.g. "Web Browser" */
  generic?: string
  comment: string
  /** lucide icon name resolved by AppIcon */
  glyph: string
  color: string
  color2?: string
  /** categories used by the menu & software manager */
  categories: string[]
  keywords?: string[]
  component: AppComponent
  defaultSize?: { w: number; h: number }
  minSize?: { w: number; h: number }
  /** false => available in the Software Manager as an installable extra */
  preinstalled?: boolean
  noTitlebar?: boolean
  singleton?: boolean
  desktop?: boolean
  resident?: boolean
}
