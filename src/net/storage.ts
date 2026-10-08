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

const BOOKMARKS = '/home/mint/.config/mintnet/bookmarks.json'
const HISTORY = '/home/mint/.config/mintnet/history.json'

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
    { url: 'https://mintnet.com/', title: 'MintNet', added: Date.now() },
    { url: 'https://mintpedia.org/article/linux-mint', title: 'Linux Mint — MintPedia', added: Date.now() },
    { url: 'https://mintnews.com/', title: 'MintNews', added: Date.now() },
  ]
  saveBookmarks(defaults)
  return defaults
}

export function saveBookmarks(list: Bookmark[]) {
  vfs.mkdirp('/home/mint/.config/mintnet')
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
  vfs.mkdirp('/home/mint/.config/mintnet')
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

export function titleFor(url: string, fallback = 'MintNet') {
  return fallback
}
