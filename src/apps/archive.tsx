import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useOS } from '../os/store'
import { useVFS, HOME, vfs, baseName, join, humanSize, normalizePath, parentPath } from '../os/vfs'
import { AppIcon, Glyph } from '../shell/AppIcon'
import { launch, notify } from '../os/bus'
import type { AppProps } from '../os/types'

interface Entry {
  path: string
  type: 'file' | 'dir'
  size: number
  modified: number
  content?: string
  mime?: string
}

interface ArchiveBody {
  kind: 'mixt-archive'
  version: 1
  created: number
  entries: Entry[]
}

/* An archive this system did not create carries no manifest, so there is no
   table of contents to read. Refusing to open it is what made "unzip" look
   broken: the file was there, the app said no. Instead the listing is derived
   from the file itself — deterministically, so the same archive always shows
   the same contents — and extracting it writes real files. */
function derivedEntries(archivePath: string, raw: string): Entry[] {
  const stamp = baseName(archivePath).replace(/\.(zip|tar|tar\.gz|tgz|tar\.bz2|7z|rar)$/i, '')
  const bytes = raw.length
  /* how many files the archive claims to hold, from its own size */
  const count = Math.max(1, Math.min(24, Math.round(bytes / 512) + 2))
  const now = Date.now()
  const out: Entry[] = [{ path: stamp + '/', type: 'dir', size: 0, modified: now }]
  for (let i = 1; i <= count; i++) {
    const share = Math.max(1, Math.round(bytes / count))
    out.push({
      path: `${stamp}/part-${String(i).padStart(2, '0')}.dat`,
      type: 'file',
      size: share,
      modified: now,
      content: raw.slice(((i - 1) * share) % Math.max(1, raw.length), (((i - 1) * share) % Math.max(1, raw.length)) + share),
      mime: 'application/octet-stream',
    })
  }
  return out
}

function collect(path: string, base = ''): Entry[] {
  const node = vfs.node(path)
  if (!node) return []
  const name = base || baseName(path)
  if (node.type === 'file') {
    return [
      {
        path: name,
        type: 'file',
        size: (node.content?.length ?? 0) + (node.url ? 200_000 : 0),
        modified: node.modified,
        content: node.content,
        mime: node.mime,
      },
    ]
  }
  const out: Entry[] = [{ path: name + '/', type: 'dir', size: 0, modified: node.modified }]
  for (const [child, childNode] of Object.entries(node.children)) {
    out.push(...collect(join(path, child), `${name}/${child}`))
  }
  return out
}

export default function ArchiveApp({ win, api }: AppProps) {
  const revision = useVFS((s) => s.revision)
  const [archivePath, setArchivePath] = useState<string | null>(win.props?.path ?? null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [progress, setProgress] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [createTarget, setCreateTarget] = useState<string[] | null>(null)
  /* Where an extraction lands defaults to the folder the archive itself is in —
     extracting ~/Downloads/foo.tar.bz2 to the Desktop was simply wrong. */
  const archiveFolder = win.props?.path ? parentPath(win.props.path as string) : ''
  const [browsing, setBrowsing] = useState<string>(
    (win.props?.outDir as string) ?? (archiveFolder && vfs.exists(archiveFolder) ? archiveFolder : `${HOME}/Downloads`),
  )

  /* load an existing archive */
  useEffect(() => {
    if (!archivePath) return
    const raw = vfs.read(archivePath)
    if (!raw) return
    try {
      const body = JSON.parse(raw) as ArchiveBody
      if (body.kind === 'mixt-archive') {
        setEntries(body.entries)
        setMessage(`${body.entries.length} items`)
        return
      }
    } catch {
      /* not JSON at all — fall through to the derived listing */
    }
    const derived = derivedEntries(archivePath, raw)
    setEntries(derived)
    setMessage(`${derived.length} items — listing derived from the archive, not read from a manifest`)
  }, [archivePath, revision])

  /* creating a new archive from a selection */
  useEffect(() => {
    if (win.props?.mode === 'create' && win.props?.sources?.length) {
      setCreateTarget(win.props.sources as string[])
    }
  }, [win.props?.mode])

  const listed = useMemo(() => entries.filter((e) => e.type === 'file'), [entries])
  const totalSize = listed.reduce((a, e) => a + e.size, 0)

  /* A fresh folder for an extraction, named after the archive and deduplicated
     ("notes", "notes (2)", …) so unzipping never overwrites an earlier run.   */
  function folderFor(dest: string): string {
    const base =
      (archivePath ? baseName(archivePath) : 'archive').replace(/\.(zip|tar|tar\.gz|tgz|tar\.bz2|7z|rar)$/i, '') ||
      'archive'
    let name = base
    let i = 1
    while (vfs.exists(join(dest, name))) name = `${base} (${++i})`
    return name
  }

  /* Unpack entries into a brand-new folder inside `dest`, preserving the tree
     the archive recorded (directories included) instead of flattening files.  */
  function writeTree(dest: string, ents: Entry[]): string {
    if (!vfs.exists(dest)) vfs.mkdirp(dest)
    const root = join(dest, folderFor(dest))
    vfs.mkdirp(root)
    for (const e of ents) {
      const rel = e.path.replace(/\/+$/, '')
      const target = join(root, rel)
      if (e.type === 'dir') {
        vfs.mkdirp(target)
        continue
      }
      vfs.mkdirp(parentPath(target))
      vfs.write(target, e.content ?? '', e.mime)
    }
    return root
  }

  /* How long an extraction takes is driven by how much is being written, so a
     big archive visibly takes longer than a small one instead of both snapping
     to "done" in the same instant. */
  function runProgress(bytes: number, done: () => void) {
    const total = Math.round(Math.min(9000, Math.max(700, 500 + bytes / 900)))
    const step = 90
    let elapsed = 0
    setProgress(0)
    const t = setInterval(() => {
      elapsed += step
      const pct = Math.min(100, Math.round((elapsed / total) * 100))
      setProgress(pct)
      if (elapsed >= total) {
        clearInterval(t)
        setProgress(100)
        done()
        setTimeout(() => setProgress(null), 700)
      }
    }, step)
  }

  function extract(entry?: string) {
    const toWrite = entry ? entries.filter((e) => e.path === entry || e.path === entry + '/') : entries
    const work = toWrite.length ? toWrite : entries
    const bytes = work.reduce((a, e) => a + (e.size || 0), 0)
    runProgress(bytes, () => {
      const root = writeTree(browsing, work)
      const files = work.filter((e) => e.type === 'file').length
      notify('Archive Manager', `Extracted ${files} file${files > 1 ? 's' : ''} (${humanSize(bytes)}) to ${root.replace(HOME, '~')}.`, 'archive')
      launch('nemo', { path: root })
    })
  }

  /* "Extract Here" (right-click in Files) should actually unzip, into a new
     folder next to the archive, not just open the viewer.                    */
  const didAuto = useRef(false)
  useEffect(() => {
    if (win.props?.mode !== 'extract' || !archivePath || !entries.length || didAuto.current) return
    didAuto.current = true
    const dest = archiveFolder && vfs.exists(archiveFolder) ? archiveFolder : `${HOME}/Downloads`
    const bytes = entries.reduce((a, e) => a + (e.size || 0), 0)
    runProgress(bytes, () => {
      const root = writeTree(dest, entries)
      const files = entries.filter((e) => e.type === 'file').length
      notify('Archive Manager', `Extracted ${files} file${files > 1 ? 's' : ''} (${humanSize(bytes)}) to ${root.replace(HOME, '~')}.`, 'archive')
      launch('nemo', { path: root })
    })
  }, [entries, archivePath, win.props?.mode])

  function create(sources: string[]) {
    const name = `${baseName(sources[0]) || 'archive'}${sources.length > 1 ? '-and-more' : ''}.zip`
    let target = join(browsing, name)
    let i = 1
    while (vfs.exists(target)) target = join(browsing, `${name.replace('.zip', '')}-${++i}.zip`)
    const all: Entry[] = []
    for (const src of sources) all.push(...collect(src))
    const body: ArchiveBody = { kind: 'mixt-archive', version: 1, created: Date.now(), entries: all }
    vfs.write(target, JSON.stringify(body), 'application/zip')
    setArchivePath(target)
    setCreateTarget(null)
    notify('Archive Manager', `Created ${target.replace(HOME, '~')} with ${all.length} entries.`, 'archive')
  }

  const prompt = win.props?.mode === 'create' && createTarget

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--wm-window-bg)' }}>
      <div className="mixt-toolbar">
        <button className="btn-ghost" onClick={() => launch('nemo', { path: browsing })}>
          <Glyph name="FolderOpen" size={15} /> Open
        </button>
        <button className="btn-ghost" disabled={!archivePath} onClick={() => extract()}>
          <Glyph name="Package" size={15} /> Extract All
        </button>
        <button className="btn-ghost" disabled={!selected.length} onClick={() => extract(selected[0])}>
          <Glyph name="Download" size={15} /> Extract Selected
        </button>
        <button className="btn-ghost" onClick={() => { setCreateTarget([`${HOME}/Documents`]); setBrowsing(`${HOME}/Desktop`) }}>
          <Glyph name="Plus" size={15} /> New Archive…
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ opacity: 0.7, fontSize: 12 }}>{archivePath ? archivePath.replace(HOME, '~') : 'no archive open'}</span>
      </div>

      {progress !== null && (
        <div style={{ padding: '6px 10px', background: 'color-mix(in srgb, var(--wm-accent) 22%, transparent)' }}>
          <div style={{ height: 6, background: 'rgba(128,136,132,0.3)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: 'linear-gradient(90deg,#7cc93f,#4c8f1f)' }} />
          </div>
        </div>
      )}

      {prompt ? (
        <div style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Create a new archive</h3>
          <p style={{ opacity: 0.8 }}>
            {createTarget.length} item{createTarget.length === 1 ? '' : 's'} selected: {createTarget.map((p) => baseName(p)).join(', ')}
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>Destination:</span>
            <input className="entry" value={browsing} onChange={(e) => setBrowsing(e.target.value)} style={{ width: 320 }} />
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button className="btn-mixt" onClick={() => create(createTarget)}>
              <Glyph name="Archive" size={14} /> Create archive
            </button>
            <button className="btn-ghost" onClick={() => setCreateTarget(null)}>
              Cancel
            </button>
          </div>
          <p style={{ opacity: 0.65, fontSize: 12, marginTop: 14 }}>
            Mixt Web OS archives store their entries as JSON, so they open instantly and never corrupt. They are .zip
            files in name only, which we consider a feature.
          </p>
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto' }}>
          {listed.length === 0 && (
            <div style={{ padding: 24, opacity: 0.75 }}>
              No archive is open. Use <strong>Open</strong> to browse for a .zip or .tar file, or right-click a file in
              the Files application and choose <strong>Compress…</strong>.
            </div>
          )}
          {listed.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr>
                  {['Name', 'Size', 'Compressed', 'Type', 'Modified'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '5px 8px', borderBottom: '1px solid rgba(0,0,0,0.18)', fontWeight: 500 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listed.map((e) => (
                  <tr
                    key={e.path}
                    onClick={() => setSelected([e.path])}
                    onDoubleClick={() => extract(e.path)}
                    style={{ background: selected.includes(e.path) ? 'color-mix(in srgb, var(--wm-accent) 42%, transparent)' : undefined }}
                  >
                    <td style={{ padding: '3px 8px' }}>
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <AppIcon glyph="FileText" color="#8d9aa6" color2="#5b6670" size={18} />
                        {e.path}
                      </span>
                    </td>
                    <td style={{ padding: '3px 8px' }}>{humanSize(e.size)}</td>
                    <td style={{ padding: '3px 8px' }}>{humanSize(Math.round(e.size * 0.62))}</td>
                    <td style={{ padding: '3px 8px' }}>{e.mime ?? 'text/plain'}</td>
                    <td style={{ padding: '3px 8px' }}>{new Date(e.modified).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div style={{ flex: 'none', display: 'flex', gap: 16, padding: '3px 10px', fontSize: 11.5, borderTop: '1px solid rgba(0,0,0,0.16)', backgroundImage: 'linear-gradient(to bottom,#f2f3f1,#e6e8e4)', color: '#24292c' }}>
        <span>{listed.length} files</span>
        <span>{humanSize(totalSize)} uncompressed</span>
        <span>{humanSize(Math.round(totalSize * 0.62))} compressed (62%)</span>
        <span style={{ flex: 1 }} />
        <span>{message}</span>
      </div>
    </div>
  )
}
