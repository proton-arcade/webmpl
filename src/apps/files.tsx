import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useOS } from '../os/store'
import {
  HOME, baseName, countNodes, humanSize, join, nodeSize, normalizePath, parentPath, splitPath, vfs,
} from '../os/vfs'
import type { VNode } from '../os/vfs'
import { AppIcon, FileIcon, Glyph } from '../shell/AppIcon'
import { Popup, usePopup, type MenuItem } from '../shell/ContextMenu'
import { appForFile, launch, notify } from '../os/bus'
import { getApp, isInstalled } from './registry'
import { useVFS } from '../os/vfs'
import type { AppProps } from '../os/types'

type ViewMode = 'icons' | 'list' | 'compact'
type SortKey = 'name' | 'size' | 'type' | 'modified'

interface Clip {
  op: 'copy' | 'cut'
  paths: string[]
}

/* The Trash is a real folder at ~/.local/share/Trash/files, but none of that
   path is worth putting in front of anybody: it is plumbing. The sidebar and
   the path bar both just call it "Trash", and the hidden folders it happens to
   live inside stay out of reach unless "Show Hidden Files" is switched on. */
export const TRASH_PATH = `${HOME}/.local/share/Trash/files`

const PLACES: { label: string; path: string; glyph: string; color: string }[] = [
  { label: 'Home', path: HOME, glyph: 'Home', color: '#61ad2b' },
  { label: 'Desktop', path: `${HOME}/Desktop`, glyph: 'Monitor', color: '#5f9bd8' },
  { label: 'Documents', path: `${HOME}/Documents`, glyph: 'FileText', color: '#5f9bd8' },
  { label: 'Downloads', path: `${HOME}/Downloads`, glyph: 'Download', color: '#61ad2b' },
  { label: 'Music', path: `${HOME}/Music`, glyph: 'Music', color: '#b06ee8' },
  { label: 'Pictures', path: `${HOME}/Pictures`, glyph: 'Image', color: '#4aa8a0' },
  { label: 'Videos', path: `${HOME}/Videos`, glyph: 'Video', color: '#e8664a' },
  { label: 'Trash', path: TRASH_PATH, glyph: 'Trash2', color: '#7d8a95' },
  { label: 'File System', path: '/', glyph: 'HardDrive', color: '#7d8a95' },
]

export function inTrash(p: string): boolean {
  return p === TRASH_PATH || p.startsWith(TRASH_PATH + '/')
}

/* A path is hidden if any segment of it starts with a dot. */
export function isHiddenPath(p: string): boolean {
  return splitPath(p).some((seg) => seg.startsWith('.'))
}

/* The crumbs for the path bar. The Trash collapses to a single crumb so the
   bar reads "🗑 Trash" instead of ".local › share › Trash › files". */
export function crumbsFor(p: string): { label: string; target: string }[] {
  if (inTrash(p)) {
    const rest = splitPath(p).slice(splitPath(TRASH_PATH).length)
    return [
      { label: 'Trash', target: TRASH_PATH },
      ...rest.map((seg, i) => ({
        label: seg,
        target: `${TRASH_PATH}/${rest.slice(0, i + 1).join('/')}`,
      })),
    ]
  }
  return splitPath(p).map((seg, i) => ({
    label: seg,
    target: '/' + splitPath(p).slice(0, i + 1).join('/'),
  }))
}

function mimeLabel(node: VNode, name: string) {
  if (node.type === 'dir') return 'Folder'
  const mime = node.mime ?? 'text/plain'
  if (mime.startsWith('image/')) return 'Image'
  if (mime.startsWith('audio/')) return 'Audio'
  if (mime.startsWith('video/')) return 'Video'
  if (mime.includes('zip')) return 'Archive'
  if (name.endsWith('.md')) return 'Markdown'
  const ext = name.includes('.') ? name.split('.').pop()!.toUpperCase() + ' file' : 'Plain text'
  return ext
}

export default function FilesApp({ win, api }: AppProps) {
  const revision = useVFS((s) => s.revision)
  const settings = useOS((s) => s.settings)
  const setClipboard = useOS((s) => s.setClipboard)

  const [path, setPath] = useState<string>(win.props?.path ?? HOME)
  const [history, setHistory] = useState<string[]>([win.props?.path ?? HOME])
  const [histIdx, setHistIdx] = useState(0)
  const [view, setView] = useState<ViewMode>('icons')
  const [showHidden, setShowHidden] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [selection, setSelection] = useState<string[]>([])
  const [clip, setClip] = useState<Clip | null>(null)
  /* what is being dragged, and which folder is currently highlighted as the
     drop target — both are state so the view can show where it will land */
  const [dragging, setDragging] = useState<string[]>([])
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [propsFor, setPropsFor] = useState<string | 'folder' | null>(null)
  const popup = usePopup<string>()
  const listRef = useRef<HTMLDivElement>(null)
  const [q, setQ] = useState('')

  const { getNode, list: listDir, mkdir, remove, move, copy, writeFile } = useVFSHelpers()

  useEffect(() => {
    api.setTitle(`${baseName(path) === '/' ? 'File System' : baseName(path)} — ${settings.username}`)
  }, [path])

  useEffect(() => {
    if (win.props?.path && win.props.path !== path) navigate(win.props.path, false)
  }, [win.props?.path])

  const entries = useMemo(() => {
    const all = listDir(path) ?? []
    let filtered = all.filter((e) => showHidden || !e.name.startsWith('.'))
    if (search.trim()) {
      const s = search.toLowerCase()
      filtered = filtered.filter((e) => e.name.toLowerCase().includes(s))
    }
    const sorted = [...filtered].sort((a, b) => {
      if (a.node.type !== b.node.type) return a.node.type === 'dir' ? -1 : 1
      switch (sortKey) {
        case 'size':
          return nodeSize(b.node) - nodeSize(a.node)
        case 'modified':
          return b.node.modified - a.node.modified
        case 'type':
          return mimeLabel(a.node, a.name).localeCompare(mimeLabel(b.node, b.name)) || a.name.localeCompare(b.name)
        default:
          return a.name.localeCompare(b.name, undefined, { numeric: true })
      }
    })
    return sorted
  }, [path, listDir, showHidden, search, sortKey, revision])

  function navigate(target: string, pushHistory = true) {
    const node = getNode(target)
    if (!node || node.type !== 'dir') {
      notify('Files', `“${target}” is not a folder any more.`)
      return
    }
    /* Hidden folders stay closed until the user asks for them. The Trash is the
       one exception: it lives under a hidden path but has its own place in the
       sidebar, so it is always reachable. */
    if (!showHidden && isHiddenPath(target) && !inTrash(target)) {
      notify('Files', 'That folder is hidden. Switch on View → Show Hidden Files to open it.')
      return
    }
    setPath(target)
    setSelection([])
    setSearch('')
    if (pushHistory) {
      setHistory((h) => [...h.slice(0, histIdx + 1), target])
      setHistIdx((i) => i + 1)
    }
  }

  function goBack() {
    if (histIdx > 0) {
      setHistIdx(histIdx - 1)
      setPath(history[histIdx - 1])
      setSelection([])
    }
  }
  function goForward() {
    if (histIdx < history.length - 1) {
      setHistIdx(histIdx + 1)
      setPath(history[histIdx + 1])
      setSelection([])
    }
  }
  function goUp() {
    const parent = parentPath(path)
    if (parent !== path || path !== '/') navigate(parent)
  }

  function openEntry(name: string) {
    const target = join(path, name)
    const node = getNode(target)
    if (!node) return
    if (node.type === 'dir') {
      navigate(target)
      return
    }
    const appId = appForFile(target)
    if (!appId) {
      notify('Files', `There is no application installed for “${name}”.\nOpen the Software Manager to find one.`)
      return
    }
    // Double-clicking an archive unzips it into a fresh folder beside itself.
    if (appId === 'archive') {
      launch('archive', { path: target, mode: 'extract' })
      return
    }
    launch(appId, { path: target })
  }

  /** Where a dragged item lands. Dropping on a folder moves into it; dropping
   *  on empty space moves into the folder being looked at. */
  /** `fromEvent` is the payload the drag itself carries. Reading it rather than
   *  only the state matters: a drop can land before the state set at dragstart
   *  has been rendered, and a handler that trusts that stale state quietly
   *  moves nothing. */
  function dropInto(targetName: string | null, fromEvent?: string) {
    /* The drag carries full paths, so a drop works no matter which window or
       folder it came from — including one this window is not showing. */
    const carried = (fromEvent ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s.startsWith('/') ? s : join(path, s)))
    const sources = carried.length ? carried : dragging.map((n) => join(path, n))
    setDragging([])
    setDropTarget(null)
    if (!sources.length) return
    const destDir = targetName ? join(path, targetName) : path
    const destNode = getNode(destDir)
    if (!destNode || destNode.type !== 'dir') {
      notify('Files', `“${targetName ?? path}” is not a folder, so nothing was moved there.`)
      return
    }
    let moved = 0
    let skipped = 0
    for (const from of sources) {
      if (parentPath(from) === destDir) continue // already where it is being dropped
      if (from === destDir || destDir.startsWith(`${from}/`)) {
        skipped++ // a folder cannot be dropped inside itself
        continue
      }
      const to = join(destDir, baseName(from))
      if (getNode(to)) {
        skipped++ // something of that name is already there
        continue
      }
      if (vfs.mv(from, to)) moved++
      else skipped++
    }
    setSelection([])
    if (moved) notify('Files', `Moved ${moved} item${moved === 1 ? '' : 's'} to ${destDir.replace(HOME, '~')}.`)
    if (skipped) notify('Files', `${skipped} item${skipped === 1 ? '' : 's'} could not be moved — a folder cannot go inside itself, and nothing is overwritten.`)
  }

  function select(name: string, e: React.MouseEvent) {
    if (e.ctrlKey || e.metaKey) {
      setSelection((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]))
    } else if (e.shiftKey && selection.length) {
      const names = entries.map((en) => en.name)
      const a = names.indexOf(selection[selection.length - 1])
      const b = names.indexOf(name)
      const [from, to] = a < b ? [a, b] : [b, a]
      setSelection(names.slice(from, to + 1))
    } else {
      setSelection([name])
    }
  }

  function newFolder() {
    let name = 'New Folder'
    let i = 1
    while (getNode(join(path, name))) name = `New Folder ${++i}`
    mkdir(join(path, name))
    setSelection([name])
    setRenaming(name)
    setRenameValue(name)
  }

  function newDocument(kind: 'Empty Document' | 'Text File' | 'Markdown File') {
    const ext = kind === 'Markdown File' ? '.md' : kind === 'Text File' ? '.txt' : '.txt'
    let name = `${kind.replace(' File', '')}${ext}`
    let i = 1
    while (getNode(join(path, name))) name = `${kind.replace(' File', '')} ${++i}${ext}`
    writeFile(join(path, name), '')
    setSelection([name])
    setRenaming(name)
    setRenameValue(name)
  }

  function trashSelected() {
    for (const name of selection) {
      if (vfs.trash(join(path, name))) vfs.rm(join(path, name))
    }
    notify('Files', `${selection.length} item${selection.length > 1 ? 's' : ''} moved to Trash.`)
    setSelection([])
  }

  function deleteSelected() {
    if (!window.confirm(`Permanently delete ${selection.length} item(s)? This cannot be undone.`)) return
    selection.forEach((name) => remove(join(path, name)))
    setSelection([])
  }

  function paste() {
    if (!clip) return
    for (const src of clip.paths) {
      const dest = join(path, uniqueName(baseName(src)))
      if (clip.op === 'copy') copy(src, dest)
      else move(src, dest)
    }
    if (clip.op === 'cut') setClip(null)
    notify('Files', `Pasted ${clip.paths.length} item(s).`)
  }

  function uniqueName(name: string) {
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    let candidate = name
    let i = 1
    while (getNode(join(path, candidate))) candidate = `${stem} (copy ${i++})${ext}`
    return candidate
  }

  function rename(name: string) {
    const trimmed = renameValue.trim()
    setRenaming(null)
    if (!trimmed || trimmed === name) return
    const dest = join(path, trimmed)
    if (getNode(dest)) {
      notify('Files', `A file named “${trimmed}” already exists in this folder.`)
      return
    }
    move(join(path, name), dest)
    setSelection([trimmed])
  }

  function compress(name: string) {
    launch('archive', { mode: 'create', sources: [join(path, name)], outDir: path })
  }

  const selectedItems = selection.map((name) => ({ name, node: getNode(join(path, name))! })).filter((x) => x.node)
  const totalSize = entries.reduce((a, e) => a + nodeSize(e.node), 0)

  function menuItems(): MenuItem[] {
    const anySelected = selection.length > 0
    const single = selection.length === 1 ? selectedItems[0] : null
    return [
      ...(anySelected
        ? [
            { label: 'Open', icon: <Glyph name="FolderOpen" size={14} />, onClick: () => openEntry(selection[0]) },
            ...(single && single.node.type === 'file'
              ? [
                  {
                    label: 'Open With',
                    icon: <Glyph name="AppWindow" size={14} />,
                    submenu: appMenuFor(join(path, single.name)),
                  },
                ]
              : []),
            { separator: true },
            {
              label: 'Cut',
              icon: <Glyph name="Scissors" size={14} />,
              accel: 'Ctrl+X',
              onClick: () => {
                setClip({ op: 'cut', paths: selection.map((n) => join(path, n)) })
                setClipboard(selection.join('\n'), 'files')
              },
            },
            {
              label: 'Copy',
              icon: <Glyph name="Copy" size={14} />,
              accel: 'Ctrl+C',
              onClick: () => {
                setClip({ op: 'copy', paths: selection.map((n) => join(path, n)) })
                setClipboard(selection.join('\n'), 'files')
              },
            },
            {
              label: 'Rename…',
              icon: <Glyph name="Type" size={14} />,
              accel: 'F2',
              disabled: selection.length !== 1,
              onClick: () => {
                setRenaming(selection[0])
                setRenameValue(selection[0])
              },
            },
            {
              label: 'Copy Path',
              icon: <Glyph name="Link" size={14} />,
              onClick: () => setClipboard(join(path, selection[0]), 'files'),
            },
            { separator: true },
            {
              label: 'Compress…',
              icon: <Glyph name="Archive" size={14} />,
              disabled: selection.length !== 1,
              onClick: () => compress(selection[0]),
            },
            ...(appForFile(join(path, selection[0])) === 'archive'
              ? [
                  {
                    label: 'Extract Here',
                    icon: <Glyph name="Package" size={14} />,
                    onClick: () => launch('archive', { mode: 'extract', path: join(path, selection[0]) }),
                  },
                ]
              : []),
            { label: 'Open in Terminal', icon: <Glyph name="Terminal" size={14} />, onClick: () => launch('terminal', { cwd: path }) },
            { separator: true },
            { label: 'Move to Trash', icon: <Glyph name="Trash2" size={14} />, accel: 'Del', onClick: trashSelected },
            { label: 'Delete Permanently', icon: <Glyph name="X" size={14} />, accel: 'Shift+Del', onClick: deleteSelected },
            { separator: true },
            {
              label: 'Properties',
              icon: <Glyph name="Info" size={14} />,
              disabled: selection.length !== 1,
              onClick: () => setPropsFor(selection[0]),
            },
          ]
        : [
            { label: 'New Folder', icon: <Glyph name="Folder" size={14} />, onClick: newFolder },
            {
              label: 'New Document',
              icon: <Glyph name="FileText" size={14} />,
              submenu: [
                { label: 'Empty Document', onClick: () => newDocument('Empty Document') },
                { label: 'Text File', onClick: () => newDocument('Text File') },
                { label: 'Markdown File', onClick: () => newDocument('Markdown File') },
              ],
            },
            { separator: true },
            {
              label: 'Paste',
              icon: <Glyph name="Clipboard" size={14} />,
              accel: 'Ctrl+V',
              disabled: !clip,
              onClick: paste,
            },
            { separator: true },
            { label: 'Select All', accel: 'Ctrl+A', onClick: () => setSelection(entries.map((e) => e.name)) },
            { label: 'Open in Terminal', icon: <Glyph name="Terminal" size={14} />, onClick: () => launch('terminal', { cwd: path }) },
            { separator: true },
            { label: showHidden ? 'Hide Hidden Files' : 'Show Hidden Files', accel: 'Ctrl+H', onClick: () => setShowHidden(!showHidden) },
            { label: 'Properties', icon: <Glyph name="Info" size={14} />, onClick: () => setPropsFor('folder') },
          ]),
    ]
  }

  function appMenuFor(target: string): MenuItem[] {
    const items: MenuItem[] = []
    for (const app of appsForFile(target)) {
      items.push({
        label: app.name,
        icon: <AppIcon glyph={app.glyph} color={app.color} color2={app.color2} size={14} rounded={0.3} />,
        onClick: () => launch(app.id, { path: target }),
      })
    }
    items.push({ separator: true })
    items.push({
      label: 'Choose another application…',
      onClick: () => notify('Files', 'Only the applications in this list can open that file type in the web edition.'),
    })
    return items
  }

  function appsForFile(target: string) {
    const primary = appForFile(target)
    const list = ['xed', 'terminal', 'imageviewer', 'mediaplayer', 'archive']
      .map((id) => getApp(id))
      /* An app that is not on this machine is not a way to open the file.
         This list used to be offered verbatim, so VLC — which is a download,
         not part of the system — turned up in "Open With" on a machine that
         had never downloaded it, and choosing it opened nothing. */
      .filter((app) => !!app && isInstalled(app.id))
    return list.sort((a, b) => (a!.id === primary ? -1 : b!.id === primary ? 1 : 0)) as any[]
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--wm-window-bg)' }}>
      {/* toolbar */}
      <div className="mixt-toolbar" style={{ gap: 3 }}>
        <button className="btn-ghost" title="Back" disabled={histIdx === 0} onClick={goBack} style={{ opacity: histIdx === 0 ? 0.45 : 1 }}>
          <Glyph name="ChevronLeft" size={17} />
        </button>
        <button className="btn-ghost" title="Forward" disabled={histIdx >= history.length - 1} onClick={goForward} style={{ opacity: histIdx >= history.length - 1 ? 0.45 : 1 }}>
          <Glyph name="ChevronRight" size={17} />
        </button>
        <button className="btn-ghost" title="Up" onClick={goUp}>
          <Glyph name="ChevronUp" size={17} />
        </button>
        <button className="btn-ghost" title="Home" onClick={() => navigate(HOME)}>
          <Glyph name="Home" size={15} />
        </button>
        <button className="btn-ghost" title="Reload" onClick={() => setSelection([])}>
          <Glyph name="RefreshCw" size={14} />
        </button>

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', background: 'var(--wm-entry-bg)', border: '1px solid rgba(0,0,0,0.25)', borderRadius: 5, padding: '2px 6px', margin: '0 6px', minWidth: 0, overflow: 'hidden' }}>
          {/* the drive icon is the root of the filesystem, and it is a button:
              it used to be decoration, so clicking it did nothing */}
          <button
            className="btn-ghost"
            title="File System"
            onClick={() => navigate('/')}
            style={{ padding: '1px 5px', opacity: splitPath(path).length === 0 ? 0.6 : 1 }}
          >
            <Glyph name="HardDrive" size={13} />
          </button>
          {splitPath(path).length === 0 ? (
            <span style={{ padding: '0 6px' }}>File System</span>
          ) : (
            crumbsFor(path).map((c, i, arr) => (
              <React.Fragment key={c.target}>
                <button
                  className="btn-ghost"
                  style={{ padding: '1px 6px' }}
                  onClick={() => navigate(c.target)}
                >
                  {c.target === HOME ? '🏠' : c.target === TRASH_PATH ? '🗑 Trash' : c.label}
                </button>
                {i < arr.length - 1 && <span style={{ opacity: 0.5 }}>›</span>}
              </React.Fragment>
            ))
          )}
        </div>

        {searchOpen ? (
          <input
            className="entry"
            autoFocus
            placeholder="Search this folder…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => !search && setSearchOpen(false)}
            style={{ width: 170 }}
          />
        ) : (
          <button className="btn-ghost" title="Search" onClick={() => setSearchOpen(true)}>
            <Glyph name="Search" size={15} />
          </button>
        )}
        <button className="btn-ghost" title="List view" data-active={view === 'list'} onClick={() => setView(view === 'list' ? 'icons' : 'list')}>
          <Glyph name="List" size={15} />
        </button>
        <button className="btn-ghost" title="Grid view" data-active={view === 'icons'} onClick={() => setView(view === 'icons' ? 'list' : 'icons')}>
          <Glyph name="Grid3x3" size={15} />
        </button>
        <button className="btn-ghost" title="Sort" onClick={(e) => popup.open(e, 'sort')}>
          <Glyph name="ArrowLeftRight" size={15} />
          <Glyph name="ChevronDown" size={12} />
        </button>
        <button className="btn-ghost" title="New folder" onClick={newFolder}>
          <Glyph name="Folder" size={15} />
          <Glyph name="Plus" size={11} />
        </button>
        <button className="btn-ghost" title="Menu" onClick={(e) => popup.open(e, 'toolbar')}>
          <Glyph name="MoreVertical" size={15} />
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* sidebar */}
        <div style={{ width: 176, flex: 'none', background: 'color-mix(in srgb, var(--wm-window-bg) 88%, #808890)', borderRight: '1px solid rgba(0,0,0,0.18)', overflow: 'auto', padding: '8px 6px' }}>
          <SidebarGroup title="Places">
            {PLACES.map((p) => (
              <div
                key={p.path}
                className="menu-item"
                style={{ padding: '4px 7px', background: path === p.path ? 'color-mix(in srgb, var(--wm-accent) 32%, transparent)' : undefined }}
                onClick={() => navigate(p.path)}
              >
                <Glyph name={p.glyph} size={15} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.label}</span>
              </div>
            ))}
          </SidebarGroup>
          <SidebarGroup title="Devices">
            <div className="menu-item" style={{ padding: '4px 7px' }}>
              <Glyph name="HardDrive" size={15} />
              <span style={{ flex: 1 }}>64 GB Volume</span>
            </div>
            <div className="menu-item" style={{ padding: '4px 7px' }} onClick={() => notify('Files', 'MixtNet drives are mounted read-only in the web edition.')}>
              <Glyph name="Network" size={15} />
              <span style={{ flex: 1 }}>MixtNet</span>
            </div>
          </SidebarGroup>
        </div>

        {/* main view */}
        <div
          ref={listRef}
          style={{ flex: 1, minWidth: 0, overflow: 'auto', position: 'relative' }}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Delete' && selection.length) e.shiftKey ? deleteSelected() : trashSelected()
            if (e.key === 'F2' && selection.length === 1) {
              setRenaming(selection[0])
              setRenameValue(selection[0])
            }
            if (e.key === 'Enter' && selection.length) openEntry(selection[0])
            if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              setSelection(entries.map((en) => en.name))
            }
            if (e.key === 'c' && (e.ctrlKey || e.metaKey) && selection.length) setClip({ op: 'copy', paths: selection.map((n) => join(path, n)) })
            if (e.key === 'x' && (e.ctrlKey || e.metaKey) && selection.length) setClip({ op: 'cut', paths: selection.map((n) => join(path, n)) })
            if (e.key === 'v' && (e.ctrlKey || e.metaKey)) paste()
            if (e.key === 'h' && (e.ctrlKey || e.metaKey)) setShowHidden((s) => !s)
          }}
          onContextMenu={(e) => {
            // Right-clicking the empty background drops the selection and shows
            // the folder menu (New / Paste / …), like a real file manager.
            if (e.target === e.currentTarget) setSelection([])
            popup.open(e, 'context')
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelection([])
          }}
          /* dropping on the empty background moves into the folder being
             looked at — that is how you drag something out of a subfolder */
          onDragOver={(e) => {
            if (!dragging.length) return
            e.preventDefault()
            setDropTarget(null)
          }}
          onDrop={(e) => {
            const carried = e.dataTransfer?.getData?.('text/plain') ?? ''
            if (!dragging.length && !carried) return
            e.preventDefault()
            dropInto(null, carried)
          }}
        >
          {entries.length === 0 ? (
            <div style={{ display: 'grid', placeItems: 'center', height: '100%', opacity: 0.55, gap: 8 }}>
              <div style={{ textAlign: 'center' }}>
                <Glyph name="FolderOpen" size={44} />
                <div style={{ marginTop: 8 }}>{search ? 'No files match your search.' : 'This folder is empty.'}</div>
              </div>
            </div>
          ) : view === 'icons' ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: 12, alignContent: 'flex-start' }}>
              {entries.map((en) => {
                const selected = selection.includes(en.name)
                return (
                  <div
                    key={en.name}
                    className="desktop-icon"
                    data-selected={selected}
                    draggable
                    onDragStart={(e) => {
                      /* dragging an unselected item drags just that one */
                      const names = selection.includes(en.name) ? selection : [en.name]
                      setDragging(names)
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', names.map((n) => join(path, n)).join('\n'))
                    }}
                    onDragEnd={() => {
                      setDragging([])
                      setDropTarget(null)
                    }}
                    onDragOver={(e) => {
                      if (en.node.type !== 'dir') return
                      e.preventDefault()
                      e.stopPropagation()
                      setDropTarget(en.name)
                    }}
                    onDragLeave={() => setDropTarget((d) => (d === en.name ? null : d))}
                    onDrop={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      dropInto(en.node.type === 'dir' ? en.name : null, e.dataTransfer?.getData?.('text/plain'))
                    }}
                    style={{
                      color: 'var(--wm-window-fg)',
                      width: 104,
                      outline: dropTarget === en.name ? '2px solid var(--wm-accent)' : undefined,
                      borderRadius: dropTarget === en.name ? 8 : undefined,
                      opacity: dragging.includes(en.name) ? 0.45 : 1,
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      select(en.name, e)
                    }}
                    onDoubleClick={() => openEntry(en.name)}
                    onContextMenu={(e) => {
                      if (!selection.includes(en.name)) setSelection([en.name])
                      popup.open(e, 'context')
                    }}
                  >
                    <FileIcon node={{ type: en.node.type, mime: (en.node as any).mime, name: en.name }} size={46} />
                    {renaming === en.name ? (
                      <input
                        className="entry"
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => rename(en.name)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') rename(en.name)
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                        style={{ width: 92, fontSize: 11.5, padding: '1px 4px' }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <div className="label" style={{ textShadow: 'none', color: 'inherit' }}>
                        {en.name}
                        {clip?.paths.some((p) => p === join(path, en.name)) && clip.op === 'cut' && (
                          <span style={{ opacity: 0.6 }}> (cut)</span>
                        )}
                      </div>
                    )}
                    <div style={{ fontSize: 10.5, opacity: 0.55 }}>
                      {en.node.type === 'dir' ? `${Object.keys((en.node as any).children).length} items` : humanSize(nodeSize(en.node))}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, background: 'color-mix(in srgb, var(--wm-window-bg) 92%, #808890)', zIndex: 1 }}>
                  {([
                    ['name', 'Name'],
                    ['size', 'Size'],
                    ['type', 'Type'],
                    ['modified', 'Modified'],
                  ] as [SortKey, string][]).map(([key, label]) => (
                    <th
                      key={key}
                      style={{ textAlign: 'left', padding: '5px 8px', borderBottom: '1px solid rgba(0,0,0,0.2)', cursor: 'pointer', fontWeight: 500 }}
                      onClick={() => setSortKey(key)}
                    >
                      {label}
                      {sortKey === key ? ' ▾' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((en) => {
                  const selected = selection.includes(en.name)
                  return (
                    <tr
                      key={en.name}
                      draggable
                      onDragStart={(e) => {
                        const names = selection.includes(en.name) ? selection : [en.name]
                        setDragging(names)
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', names.map((n) => join(path, n)).join('\n'))
                      }}
                      onDragEnd={() => {
                        setDragging([])
                        setDropTarget(null)
                      }}
                      onDragOver={(e) => {
                        if (en.node.type !== 'dir') return
                        e.preventDefault()
                        e.stopPropagation()
                        setDropTarget(en.name)
                      }}
                      onDragLeave={() => setDropTarget((d) => (d === en.name ? null : d))}
                      onDrop={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        dropInto(en.node.type === 'dir' ? en.name : null, e.dataTransfer?.getData?.('text/plain'))
                      }}
                      style={{
                        background: selected
                          ? 'color-mix(in srgb, var(--wm-accent) 45%, transparent)'
                          : dropTarget === en.name
                            ? 'color-mix(in srgb, var(--wm-accent) 25%, transparent)'
                            : undefined,
                        cursor: 'default',
                        opacity: dragging.includes(en.name) ? 0.45 : 1,
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        select(en.name, e)
                      }}
                      onDoubleClick={() => openEntry(en.name)}
                      onContextMenu={(e) => {
                        if (!selection.includes(en.name)) setSelection([en.name])
                        popup.open(e, 'context')
                      }}
                    >
                      <td style={{ padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 7 }}>
                        <FileIcon node={{ type: en.node.type, mime: (en.node as any).mime, name: en.name }} size={20} />
                        {renaming === en.name ? (
                          <input
                            className="entry"
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => rename(en.name)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') rename(en.name)
                              if (e.key === 'Escape') setRenaming(null)
                            }}
                            style={{ fontSize: 12, padding: '1px 4px' }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span>{en.name}</span>
                        )}
                      </td>
                      <td style={{ padding: '3px 8px', opacity: 0.8 }}>{en.node.type === 'dir' ? `${Object.keys((en.node as any).children).length} items` : humanSize(nodeSize(en.node))}</td>
                      <td style={{ padding: '3px 8px', opacity: 0.8 }}>{mimeLabel(en.node, en.name)}</td>
                      <td style={{ padding: '3px 8px', opacity: 0.8 }}>{new Date(en.node.modified).toLocaleString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* status bar */}
      <div
        style={{
          flex: 'none',
          padding: '3px 10px',
          fontSize: 11.5,
          borderTop: '1px solid rgba(0,0,0,0.18)',
          display: 'flex',
          gap: 14,
          backgroundImage: 'linear-gradient(to bottom, #f2f3f1, #e6e8e4)',
          color: '#24292c',
        }}
      >
        <span>
          {selection.length
            ? `${selection.length} of ${entries.length} selected`
            : `${entries.length} item${entries.length === 1 ? '' : 's'}${search ? ' (filtered)' : ''}`}
        </span>
        {selection.length === 1 && <span>{humanSize(nodeSize(selectedItems[0].node))}</span>}
        <span style={{ flex: 1 }} />
        <span>{humanSize(totalSize)} in this folder</span>
        <span>Free space: 8.4 GB</span>
      </div>

      {/* context menus */}
      {popup.state && popup.state.data === 'sort' && (
        <Popup
          x={popup.state.x}
          y={popup.state.y}
          onClose={popup.close}
          items={
            [
              ...([['name', 'Sort by Name'], ['size', 'Sort by Size'], ['type', 'Sort by Type'], ['modified', 'Sort by Modified']] as [SortKey, string][]).map(
                ([key, label]) => ({ label, checked: sortKey === key, onClick: () => setSortKey(key) }),
              ),
              { separator: true },
              { label: showHidden ? 'Hide hidden files' : 'Show hidden files', checked: showHidden, onClick: () => setShowHidden(!showHidden) },
            ] as MenuItem[]
          }
        />
      )}
      {popup.state && popup.state.data === 'toolbar' && (
        <Popup
          x={popup.state.x}
          y={popup.state.y - 210}
          onClose={popup.close}
          items={[
            { label: 'New Folder', icon: <Glyph name="Folder" size={14} />, onClick: newFolder },
            { label: 'New Text File', icon: <Glyph name="FileText" size={14} />, onClick: () => newDocument('Text File') },
            { separator: true },
            { label: 'Open in Terminal', icon: <Glyph name="Terminal" size={14} />, onClick: () => launch('terminal', { cwd: path }) },
            { label: 'Open Current Folder as Root', icon: <Glyph name="Shield" size={14} />, onClick: () => notify('Files', 'This shell already runs as the owner of every file.') },
            { separator: true },
            {
              label: 'Empty Trash',
              icon: <Glyph name="Trash2" size={14} />,
              onClick: () => {
                const trash = getNode(TRASH_PATH)
                if (trash?.type === 'dir') {
                  for (const name of Object.keys(trash.children)) remove(join(TRASH_PATH, name))
                }
                notify('Files', 'Trash emptied.')
              },
            },
            {
              label: 'Restore Default Folders',
              onClick: () => {
                for (const d of ['Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Videos', 'Public', 'Templates']) {
                  if (!getNode(join(HOME, d))) mkdir(join(HOME, d))
                }
                notify('Files', 'The standard home folders are back in place.')
              },
            },
            { separator: true },
            { label: 'Properties', icon: <Glyph name="Info" size={14} />, onClick: () => setPropsFor('folder') },
          ]}
        />
      )}
      {popup.state && popup.state.data === 'context' && (
        <Popup x={popup.state.x} y={popup.state.y} onClose={popup.close} items={menuItems()} />
      )}

      {/* properties dialogs */}
      {propsFor === 'folder' && (
        <FolderPropertiesDialog path={path} entries={entries} onClose={() => setPropsFor(null)} />
      )}
      {propsFor && propsFor !== 'folder' && (
        <PropertiesDialog path={join(path, propsFor)} onClose={() => setPropsFor(null)} />
      )}
    </div>
  )
}

function SidebarGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.6, padding: '4px 8px' }}>{title}</div>
      {children}
    </div>
  )
}

function PropertiesDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const node = vfs.node(path)
  if (!node) return null
  const isDir = node.type === 'dir'
  return (
    <Dialog title={isDir ? 'Folder Properties' : 'File Properties'} onClose={onClose}>
      <div style={{ display: 'flex', gap: 14 }}>
        <FileIcon node={{ type: node.type, mime: (node as any).mime, name: baseName(path) }} size={52} />
        <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>
          <div><strong>{baseName(path)}</strong></div>
          <div>Type: {isDir ? 'Folder' : node.type === 'file' ? (node.mime ?? 'text/plain') : 'unknown'}</div>
          <div>Location: {parentPath(path)}</div>
          <div>Size: {humanSize(nodeSize(node))}{isDir ? ` (${countNodes(node)} items)` : ''}</div>
          <div>Modified: {new Date(node.modified).toLocaleString()}</div>
          <div>Owner: mixt (1000)</div>
          <div>Permissions: {isDir ? 'drwxr-xr-x' : '-rw-r--r--'}</div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn-mixt" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  )
}

function FolderPropertiesDialog({ path, entries, onClose }: { path: string; entries: any[]; onClose: () => void }) {
  const folders = entries.filter((e) => e.node.type === 'dir').length
  const files = entries.length - folders
  const size = entries.reduce((a, e) => a + nodeSize(e.node), 0)
  return (
    <Dialog title="Folder Properties" onClose={onClose}>
      <div style={{ display: 'flex', gap: 14 }}>
        <FileIcon node={{ type: 'dir' }} size={52} />
        <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>
          <div><strong>{baseName(path) === '/' ? 'File System' : baseName(path)}</strong></div>
          <div>Location: {path}</div>
          <div>Contains: {folders} folders, {files} files</div>
          <div>Size: {humanSize(size)}</div>
          <div>Free space: 8.4 GB of 10 GB</div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn-mixt" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  )
}

export function Dialog({ title, children, onClose, width = 430 }: { title: string; children: React.ReactNode; onClose: () => void; width?: number }) {
  const settings = useOS((s) => s.settings)
  return (
    <div
      style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.32)', display: 'grid', placeItems: 'center', zIndex: 50 }}
      onMouseDown={onClose}
    >
      <div
        style={{
          width,
          background: 'var(--wm-window-bg)',
          color: 'var(--wm-window-fg)',
          border: '1px solid rgba(0,0,0,0.45)',
          borderRadius: 7,
          boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ height: 30, display: 'flex', alignItems: 'center', padding: '0 8px', backgroundImage: 'linear-gradient(to bottom, #4b5054, #35393c)', color: '#f0f2ef', fontWeight: 500 }}>
          <span style={{ flex: 1 }}>{title}</span>
          <button className="wm-btn close" onClick={onClose}>
            <Glyph name="X" size={11} />
          </button>
        </div>
        <div style={{ padding: 14 }}>{children}</div>
      </div>
    </div>
  )
}

/** Small helper hook so the component can use the VFS store without prop drilling. */
function useVFSHelpers() {
  const vfsRev = useVFS((st) => st.revision)
  const s = useVFS.getState()
  return useMemo(
    () => ({
      getNode: (p: string) => s.getNode(p),
      list: (p: string) => s.list(p),
      mkdir: (p: string) => s.mkdir(p),
      remove: (p: string) => s.remove(p),
      move: (a: string, b: string) => s.move(a, b),
      copy: (a: string, b: string) => s.copy(a, b),
      writeFile: (p: string, c: string, m?: string) => s.writeFile(p, c, m),
    }),
    [vfsRev],
  )
}
