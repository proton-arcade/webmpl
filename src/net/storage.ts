import { vfs, join } from '../os/vfs'

export interface Bookmark {
  url: string
  title: string
  added: number
}

export interface HistoryEntry {
  url: string
  title: string
  time: number
}

const BOOKMARKS = '/home/mixt/.config/mixtnet/bookmarks.json'
const HISTORY = '/home/mixt/.config/mixtnet/history.json'

function read<T>(path: string, fallback: T): T {
  const raw = vfs.read(path)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function loadBookmarks(): Bookmark[] {
  const b = read<Bookmark[]>(BOOKMARKS, [])
  if (b.length) return b
  // first run: a few sensible defaults
  const defaults: Bookmark[] = [
    { url: 'https://mixtnet.com/', title: 'MixtNet', added: Date.now() },
    { url: 'https://mixtpedia.org/article/mixt-os', title: 'Mixt OS — MixtPedia', added: Date.now() },
    { url: 'https://mixtnews.com/', title: 'MixtNews', added: Date.now() },
    /* Not a website: a page from this project, served from the same folder as
       the desktop. Bookmarked so the tools that ship here can actually be
       found, rather than only reached by somebody who knows the path. */
    { url: 'converter', title: 'Site Converter', added: Date.now() },
  ]
  saveBookmarks(defaults)
  return defaults
}

export function saveBookmarks(list: Bookmark[]) {
  vfs.mkdirp('/home/mixt/.config/mixtnet')
  vfs.write(BOOKMARKS, JSON.stringify(list, null, 2), 'application/json')
}

export function loadHistory(): HistoryEntry[] {
  return read<HistoryEntry[]>(HISTORY, [])
}

export function pushHistory(entry: HistoryEntry) {
  const list = loadHistory()
  if (list[0]?.url === entry.url) {
    list[0].time = entry.time
  } else {
    list.unshift(entry)
  }
  vfs.mkdirp('/home/mixt/.config/mixtnet')
  vfs.write(HISTORY, JSON.stringify(list.slice(0, 300), null, 2), 'application/json')
}

export function clearHistory() {
  vfs.write(HISTORY, '[]', 'application/json')
}

export function prettyHost(url: string) {
  try {
    const u = new URL(url)
    return u.host.replace(/^www\./, '')
  } catch {
    return url.replace(/^about:/, '')
  }
}

export function prettyPath(url: string) {
  try {
    const u = new URL(url)
    return u.pathname === '/' ? '' : u.pathname
  } catch {
    return ''
  }
}

export function titleFor(url: string, fallback = 'MixtNet') {
  return fallback
}
