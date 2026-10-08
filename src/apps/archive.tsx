import React, { useEffect, useMemo, useState } from 'react'
import { useOS } from '../os/store'
import { useVFS, HOME, vfs, baseName, join, humanSize, normalizePath } from '../os/vfs'
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
  kind: 'webmpl-archive'
  version: 1
  created: number
  entries: Entry[]
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
  const [browsing, setBrowsing] = useState<string>((win.props?.outDir as string) ?? `${HOME}/Desktop`)

  /* load an existing archive */
  useEffect(() => {
    if (!archivePath) return
    const raw = vfs.read(archivePath)
    if (!raw) return
    try {
      const body = JSON.parse(raw) as ArchiveBody
      if (body.kind === 'webmpl-archive') {
        setEntries(body.entries)
        setMessage(`${body.entries.length} items`)
      }
    } catch {
      setEntries([
        { path: baseName(archivePath), type: 'file', size: raw.length, modified: Date.now(), content: raw },
      ])
      setMessage('Unrecognised archive format — showing raw contents')
    }
  }, [archivePath, revision])

  /* creating a new archive from a selection */
  useEffect(() => {
    if (win.props?.mode === 'create' && win.props?.sources?.length) {
      setCreateTarget(win.props.sources as string[])
    }
  }, [win.props?.mode])

  const listed = useMemo(() => entries.filter((e) => e.type === 'file'), [entries])
  const totalSize = listed.reduce((a, e) => a + e.size, 0)

  function extract(entry?: string) {
    const dest = browsing
    if (!vfs.exists(dest)) vfs.mkdirp(dest)
    const toWrite = entry ? listed.filter((e) => e.path === entry) : listed
    let n = 0
    for (const e of toWrite) {
      const target = join(dest, e.path.split('/').pop()!)
      let candidate = target
      let i = 1
      while (vfs.exists(candidate)) candidate = target.replace(/(\.\w+)?$/, (m) => ` (${++i})${m ?? ''}`)
      vfs.write(candidate, e.content ?? '', e.mime)
      n++
    }
    notify('Archive Manager', `Extracted ${n} file${n > 1 ? 's' : ''} to ${dest.replace(HOME, '~')}.`, 'archive')
    setProgress(100)
    setTimeout(() => setProgress(null), 600)
  }

  function create(sources: string[]) {
    const name = `${baseName(sources[0]) || 'archive'}${sources.length > 1 ? '-and-more' : ''}.zip`
    let target = join(browsing, name)
    let i = 1
    while (vfs.exists(target)) target = join(browsing, `${name.replace('.zip', '')}-${++i}.zip`)
    const all: Entry[] = []
    for (const src of sources) all.push(...collect(src))
    const body: ArchiveBody = { kind: 'webmpl-archive', version: 1, created: Date.now(), entries: all }
    vfs.write(target, JSON.stringify(body), 'application/zip')
    setArchivePath(target)
    setCreateTarget(null)
    notify('Archive Manager', `Created ${target.replace(HOME, '~')} with ${all.length} entries.`, 'archive')
  }

  const prompt = win.props?.mode === 'create' && createTarget

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--wm-window-bg)' }}>
      <div className="mint-toolbar">
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
            <button className="btn-mint" onClick={() => create(createTarget)}>
              <Glyph name="Archive" size={14} /> Create archive
            </button>
            <button className="btn-ghost" onClick={() => setCreateTarget(null)}>
              Cancel
            </button>
          </div>
          <p style={{ opacity: 0.65, fontSize: 12, marginTop: 14 }}>
            Mint Web OS archives store their entries as JSON, so they open instantly and never corrupt. They are .zip
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
