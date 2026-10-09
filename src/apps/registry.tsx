import type { AppDef } from '../os/types'

import FilesApp from './files'
import TerminalApp from './terminal'
import BrowserApp from './browser'
import SoftwareApp from './software'
import SettingsApp from './settings'
import TextEditorApp from './texteditor'
import CalculatorApp from './calculator'
import SystemMonitorApp from './system-monitor'
import MediaPlayerApp from './mediaplayer'
import MixtPlayerApp from './mixtplayer'
import ImageViewerApp from './imageviewer'
import WeatherApp from './weather'
import ArchiveApp from './archive'
import HelpApp from './help'
import AboutApp from './about'
import ScreenshotApp from './screenshot'
import PaintApp from './paint'
import MailApp from './mail'
import NewsApp from './news'
import AdminApp from './admin'
import * as backend from '../os/api'

export const APPS: AppDef[] = [
  {
    id: 'nemo',
    name: 'Files',
    generic: 'File Manager',
    comment: 'Browse the files and folders on this computer',
    glyph: 'FolderOpen',
    color: '#e8b64c',
    color2: '#c98f18',
    categories: ['Accessories', 'System'],
    keywords: ['nemo', 'explorer', 'folder', 'documents', 'trash'],
    component: FilesApp,
    defaultSize: { w: 940, h: 620 },
    desktop: true,
  },
  {
    id: 'terminal',
    name: 'Terminal',
    /* A guest gets no shell: it is the one place on this machine where anything
       could be typed at the system. */
    noGuest: true,
    generic: 'Terminal Emulator',
    comment: 'Run commands, scripts and system tools',
    glyph: 'Terminal',
    color: '#3a4046',
    color2: '#20242a',
    categories: ['Accessories', 'System'],
    keywords: ['bash', 'shell', 'console', 'command', 'mixt-terminal'],
    component: TerminalApp,
    defaultSize: { w: 780, h: 480 },
    desktop: true,
  },
  {
    id: 'browser',
    name: 'Mixtsfox',
    generic: 'Web Browser',
    comment: 'Browse MixtNet or the wider web — tabs, bookmarks, Mixtsfox Search',
    glyph: 'Globe',
    color: '#4a7fe8',
    color2: '#2b4fb0',
    categories: ['Internet'],
    keywords: ['browser', 'mixtsfox', 'mixtnet', 'web', 'internet', 'surf'],
    component: BrowserApp,
    defaultSize: { w: 1080, h: 720 },
    desktop: true,
  },
  {
    id: 'mixtinstall',
    name: 'Software Manager',
    generic: 'Package Manager',
    comment: 'Install and remove applications',
    glyph: 'ShoppingBag',
    color: '#61ad2b',
    color2: '#3b6f18',
    categories: ['System', 'Administration'],
    keywords: ['install', 'apps', 'packages', 'apt', 'store'],
    component: SoftwareApp,
    defaultSize: { w: 940, h: 620 },
  },
  {
    id: 'settings',
    name: 'System Settings',
    comment: 'Configure appearance, panel, desktop and hardware',
    glyph: 'Settings',
    color: '#7d8a95',
    color2: '#4d565e',
    categories: ['System', 'Preferences', 'Administration'],
    keywords: ['control centre', 'config', 'theme', 'wallpaper', 'display'],
    component: SettingsApp,
    defaultSize: { w: 980, h: 640 },
  },
  {
    id: 'xed',
    name: 'Text Editor',
    generic: 'Text Editor',
    comment: 'Write documents, notes and code',
    glyph: 'FileText',
    color: '#5f9bd8',
    color2: '#2f5f96',
    categories: ['Accessories'],
    keywords: ['xed', 'gedit', 'notepad', 'editor', 'write'],
    component: TextEditorApp,
    defaultSize: { w: 900, h: 620 },
    desktop: true,
  },
  {
    id: 'calculator',
    name: 'Calculator',
    comment: 'Solve everyday maths, with history and programmer mode',
    glyph: 'Calculator',
    color: '#e0793a',
    color2: '#a8521c',
    categories: ['Accessories'],
    keywords: ['math', 'sum', 'numbers', 'mixt-calculator'],
    component: CalculatorApp,
    defaultSize: { w: 380, h: 560 },
    minSize: { w: 340, h: 460 },
  },
  {
    id: 'system-monitor',
    name: 'System Monitor',
    comment: 'Watch processes, CPU, memory and network usage',
    glyph: 'Activity',
    color: '#8b5cf6',
    color2: '#5b21b6',
    categories: ['System', 'Administration'],
    keywords: ['tasks', 'processes', 'top', 'htop', 'performance'],
    component: SystemMonitorApp,
    defaultSize: { w: 880, h: 600 },
  },
  /* Ships with the system: audio and video open here unless the user installs
     something else and chooses it in System Settings. */
  {
    id: 'mixtplayer',
    name: 'Mixt Player',
    generic: 'Media Player',
    comment: 'Play the music and videos in your home folder',
    glyph: 'Play',
    color: '#4a7fd0',
    color2: '#2a5396',
    categories: ['Sound & Video'],
    keywords: ['music', 'player', 'audio', 'video', 'media', 'mp3'],
    component: MixtPlayerApp,
    defaultSize: { w: 780, h: 520 },
  },
  {
    id: 'mediaplayer',
    name: 'VLC media player',
    generic: 'Media Player',
    comment: 'Play music and video from your library',
    glyph: 'Cone',
    color: '#ff8800',
    color2: '#e8590c',
    categories: ['Sound & Video'],
    keywords: ['vlc', 'music', 'player', 'audio', 'video', 'mp3'],
    preinstalled: false,
    component: MediaPlayerApp,
    defaultSize: { w: 900, h: 600 },
  },
  {
    id: 'imageviewer',
    name: 'Image Viewer',
    generic: 'Image Viewer',
    comment: 'Look at pictures with zoom and rotation',
    glyph: 'Image',
    color: '#4aa8a0',
    color2: '#0f766e',
    categories: ['Graphics'],
    keywords: ['xviewer', 'photos', 'pictures', 'jpeg', 'png'],
    component: ImageViewerApp,
    defaultSize: { w: 880, h: 620 },
  },
  {
    id: 'weather',
    name: 'Weather',
    comment: 'Forecasts for cities around the world, straight from MixtNet',
    glyph: 'CloudSun',
    color: '#48b0d8',
    color2: '#1f6f96',
    categories: ['Internet', 'Accessories'],
    keywords: ['forecast', 'temperature', 'rain', 'climate'],
    preinstalled: false,
    component: WeatherApp,
    defaultSize: { w: 780, h: 600 },
  },
  {
    id: 'archive',
    name: 'Archive Manager',
    generic: 'Archive Manager',
    comment: 'Create and extract .zip and .tar archives',
    glyph: 'Archive',
    color: '#d8a13a',
    color2: '#8a5f0c',
    categories: ['Accessories', 'System'],
    keywords: ['zip', 'tar', 'compress', 'extract', 'file-roller'],
    component: ArchiveApp,
    defaultSize: { w: 820, h: 540 },
  },
  {
    id: 'screenshot',
    name: 'Screenshot',
    comment: 'Grab the screen, a window or the desktop background',
    glyph: 'Camera',
    color: '#616a75',
    color2: '#3b4149',
    categories: ['Accessories', 'Graphics'],
    keywords: ['capture', 'grab', 'png', 'print screen'],
    component: ScreenshotApp,
    defaultSize: { w: 560, h: 470 },
    minSize: { w: 480, h: 400 },
  },
  {
    id: 'help',
    name: 'Help',
    generic: 'Help & Documentation',
    comment: 'A guided tour of Mixt Web OS',
    glyph: 'HelpCircle',
    color: '#3fa89a',
    color2: '#17685e',
    categories: ['Accessories', 'System'],
    keywords: ['welcome', 'guide', 'docs', 'manual', 'help'],
    component: HelpApp,
    defaultSize: { w: 860, h: 620 },
    desktop: true,
  },
  {
    id: 'about',
    name: 'About This Computer',
    comment: 'System information, hardware and thanks',
    glyph: 'Info',
    color: '#4b8fd6',
    color2: '#215a95',
    categories: ['System', 'Preferences'],
    keywords: ['neofetch', 'system info', 'specs', 'version'],
    component: AboutApp,
    defaultSize: { w: 700, h: 540 },
  },

  /* ------- installable extras (Software Manager) ------- */
  {
    id: 'paint',
    name: 'Drawing',
    generic: 'Drawing',
    comment: 'Paint with brushes, shapes and text',
    glyph: 'Paintbrush',
    color: '#3f8ee0',
    color2: '#1b5aa0',
    categories: ['Graphics'],
    keywords: ['paint', 'draw', 'sketch', 'canvas'],
    component: PaintApp,
    defaultSize: { w: 980, h: 660 },
    preinstalled: false,
  },
  {
    id: 'mail',
    name: 'Mail',
    generic: 'Email Client',
    comment: 'Read and write mail through MixtMail',
    glyph: 'Mail',
    color: '#4a6fe0',
    color2: '#26409c',
    categories: ['Internet'],
    keywords: ['email', 'inbox', 'thunderbird'],
    component: MailApp,
    defaultSize: { w: 900, h: 620 },
    preinstalled: false,
  },
  {
    id: 'news',
    name: 'News Reader',
    generic: 'News Reader',
    comment: 'Follow MixtNet news feeds offline',
    glyph: 'BookOpen',
    color: '#d9694a',
    color2: '#96361c',
    categories: ['Internet'],
    keywords: ['rss', 'feeds', 'headlines', 'articles'],
    component: NewsApp,
    defaultSize: { w: 900, h: 620 },
    preinstalled: false,
  },
  {
    id: 'administration',
    name: 'Administration',
    generic: 'Administrator Console',
    comment: 'Approve published apps, manage whitelisted accounts and inspect the server',
    glyph: 'ShieldCheck',
    color: '#6fa34c',
    color2: '#4a7231',
    categories: ['Administration', 'System'],
    keywords: ['admin', 'administrator', 'approve', 'users', 'server', 'root', 'privileged'],
    component: AdminApp,
    defaultSize: { w: 900, h: 620 },
    preinstalled: true,
    adminOnly: true,
  },
]

const byId = new Map(APPS.map((a) => [a.id, a]))
export function getApp(id: string): AppDef | undefined {
  return byId.get(id)
}
export function searchApps(q: string): AppDef[] {
  const s = q.trim().toLowerCase()
  const pool = visibleApps()
  if (!s) return pool
  return pool.filter((a) =>
    [a.name, a.generic ?? '', a.comment, a.id, ...(a.keywords ?? []), ...a.categories]
      .join(' ')
      .toLowerCase()
      .includes(s),
  )
}

/* Apps that only the administrator account may see. Everyone else gets the
   same list minus these, in the menu, the Software Manager and Settings. */
export function isAdmin(): boolean {
  return backend.getSession()?.role === 'admin'
}
export function isGuest(): boolean {
  return backend.getSession()?.role === 'guest'
}
export function visibleApps(): AppDef[] {
  const guest = isGuest()
  return APPS.filter((a) => (a.adminOnly ? isAdmin() : true) && (a.noGuest ? !guest : true))
}

export const CATEGORIES = [
  'All Applications',
  'Favourites',
  'Accessories',
  'Graphics',
  'Internet',
  'Sound & Video',
  'System',
  'Preferences',
  'Administration',
]
