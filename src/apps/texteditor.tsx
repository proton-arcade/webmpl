import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useOS } from '../os/store'
import { useVFS, HOME, vfs, baseName, join, parentPath, normalizePath, splitPath } from '../os/vfs'
import { Glyph } from '../shell/AppIcon'
import { Dialog } from './files'
import { notify } from '../os/bus'
import type { AppProps } from '../os/types'

interface Doc {
  id: string
  path: string | null
  name: string
  content: string
  saved: string
}

let docSeq = 0

export default function TextEditorApp({ win, api }: AppProps) {
  const revision = useVFS((s) => s.revision)
  const [docs, setDocs] = useState<Doc[]>(() => {
    const path = win.props?.path ?? null
    const content = path ? vfs.read(path) ?? '' : ''
    return [
      {
        id: `doc${++docSeq}`,
        path,
        name: path ? baseName(path) : 'Untitled Document 1',
        content,
        saved: content,
      },
    ]
  })
  const [activeId, setActiveId] = useState(docs[0].id)
  const [showOpen, setShowOpen] = useState(false)
  const [showSaveAs, setShowSaveAs] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [wrap, setWrap] = useState(true)
  const [preview, setPreview] = useState(false)
  const [fontSize, setFontSize] = useState(13)
  const [caret, setCaret] = useState({ line: 1, col: 1 })
  const areaRef = useRef<HTMLTextAreaElement>(null)

  const active = docs.find((d) => d.id === activeId) ?? docs[0]
  const dirty = active.content !== active.saved

  useEffect(() => {
    api.setTitle(`${dirty ? '• ' : ''}${active.name} — Text Editor`)
  }, [active.name, dirty])

  useEffect(() => {
    if (win.props?.path) {
      const existing = docs.find((d) => d.path === win.props!.path)
      if (existing) setActiveId(existing.id)
      else openPath(win.props.path)
    }
  }, [win.props?.path])

  function openPath(path: string) {
    const node = vfs.node(path)
    if (!node || node.type !== 'dir') {
      const content = vfs.read(path) ?? ''
      const doc: Doc = { id: `doc${++docSeq}`, path, name: baseName(path), content, saved: content }
      setDocs((d) => [...d, doc])
      setActiveId(doc.id)
    }
  }

  function patch(patchDoc: Partial<Doc>) {
    setDocs((list) => list.map((d) => (d.id === active.id ? { ...d, ...patchDoc } : d)))
  }

  function save(path?: string) {
    const target = path ?? active.path
    if (!target) {
      setShowSaveAs(true)
      return
    }
    vfs.write(target, active.content)
    setDocs((list) => list.map((d) => (d.id === active.id ? { ...d, path: target, name: baseName(target), saved: d.content } : d)))
    setShowSaveAs(false)
    api.notify({ title: 'Text Editor', body: `Saved ${target.replace(HOME, '~')}` })
  }

  function newDoc() {
    const doc: Doc = { id: `doc${++docSeq}`, path: null, name: `Untitled Document ${docSeq}`, content: '', saved: '' }
    setDocs((d) => [...d, doc])
    setActiveId(doc.id)
  }

  function closeDoc(id: string) {
    const doc = docs.find((d) => d.id === id)
    if (doc && doc.content !== doc.saved && !window.confirm(`Save changes to ${doc.name} before closing?`)) {
      // user chose cancel → do nothing
      return
    }
    setDocs((list) => {
      const remaining = list.filter((d) => d.id !== id)
      if (!remaining.length) {
        api.close()
        return list
      }
      if (activeId === id) setActiveId(remaining[0].id)
      return remaining
    })
  }

  function updateCaret() {
    const el = areaRef.current
    if (!el) return
    const upto = el.value.slice(0, el.selectionStart)
    const lines = upto.split('\n')
    setCaret({ line: lines.length, col: lines[lines.length - 1].length + 1 })
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const ctrl = e.ctrlKey || e.metaKey
    if (ctrl && e.key.toLowerCase() === 's') {
      e.preventDefault()
      save()
    } else if (ctrl && e.key.toLowerCase() === 'o') {
      e.preventDefault()
      setShowOpen(true)
    } else if (ctrl && e.key.toLowerCase() === 'n') {
      e.preventDefault()
      newDoc()
    } else if (ctrl && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      setFindOpen(true)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const el = areaRef.current!
      const start = el.selectionStart
      const value = el.value
      const next = value.slice(0, start) + '  ' + value.slice(el.selectionEnd)
      patch({ content: next })
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 2
      })
    }
  }

  const stats = useMemo(() => {
    const words = active.content.trim() ? active.content.trim().split(/\s+/).length : 0
    return { words, chars: active.content.length, lines: active.content.split('\n').length }
  }, [active.content])

  const matches = findText ? (active.content.match(new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) ?? []).length : 0

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--wm-window-bg)' }}>
      {/* toolbar */}
      <div className="mixt-toolbar">
        <button className="btn-ghost" title="New (Ctrl+N)" onClick={newDoc}>
          <Glyph name="File" size={15} />
          <Glyph name="Plus" size={11} />
        </button>
        <button className="btn-ghost" title="Open (Ctrl+O)" onClick={() => setShowOpen(true)}>
          <Glyph name="FolderOpen" size={15} />
        </button>
        <button className="btn-ghost" title="Save (Ctrl+S)" onClick={() => save()}>
          <Glyph name="Save" size={15} />
        </button>
        <div style={{ width: 1, height: 20, background: 'rgba(0,0,0,0.15)', margin: '0 4px' }} />
        <button className="btn-ghost" title="Find and replace (Ctrl+F)" data-active={findOpen} onClick={() => setFindOpen(!findOpen)}>
          <Glyph name="Search" size={15} />
        </button>
        <button className="btn-ghost" title="Word wrap" data-active={wrap} onClick={() => setWrap(!wrap)}>
          <Glyph name="Type" size={15} />
        </button>
        <button className="btn-ghost" title="Markdown preview" data-active={preview} onClick={() => setPreview(!preview)}>
          <Glyph name="FileCode" size={15} />
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn-ghost" title="Smaller text" onClick={() => setFontSize((f) => Math.max(10, f - 1))}>
          A−
        </button>
        <button className="btn-ghost" title="Larger text" onClick={() => setFontSize((f) => Math.min(22, f + 1))}>
          A+
        </button>
      </div>

      {/* tab bar */}
      <div style={{ display: 'flex', gap: 2, background: 'color-mix(in srgb, var(--wm-window-bg) 90%, #808890)', padding: '4px 6px 0', overflow: 'auto' }}>
        {docs.map((d) => (
          <div
            key={d.id}
            onClick={() => setActiveId(d.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              borderTopLeftRadius: 6,
              borderTopRightRadius: 6,
              background: d.id === activeId ? 'var(--wm-window-bg)' : 'rgba(0,0,0,0.06)',
              cursor: 'pointer',
              fontSize: 12.5,
              whiteSpace: 'nowrap',
            }}
          >
            <Glyph name="FileText" size={13} />
            {d.name}
            {d.content !== d.saved && <span style={{ color: '#b8532f' }}>•</span>}
            <span
              onClick={(e) => {
                e.stopPropagation()
                closeDoc(d.id)
              }}
              style={{ opacity: 0.6 }}
            >
              <Glyph name="X" size={12} />
            </span>
          </div>
        ))}
        <button className="btn-ghost" onClick={newDoc} title="New tab">
          <Glyph name="Plus" size={14} />
        </button>
      </div>

      {/* find bar */}
      {findOpen && (
        <div className="mixt-toolbar" style={{ gap: 6, paddingTop: 6, paddingBottom: 6 }}>
          <input className="entry" autoFocus placeholder="Find" value={findText} onChange={(e) => setFindText(e.target.value)} />
          <input className="entry" placeholder="Replace with" value={replaceText} onChange={(e) => setReplaceText(e.target.value)} />
          <span style={{ opacity: 0.75, fontSize: 12 }}>{matches} matches</span>
          <button
            className="btn-ghost"
            onClick={() => {
              if (!findText) return
              patch({ content: active.content.replaceAll(findText, replaceText) })
            }}
          >
            Replace all
          </button>
          <button className="btn-ghost" onClick={() => setFindOpen(false)}>
            <Glyph name="X" size={13} />
          </button>
        </div>
      )}

      {/* editor */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {preview ? (
          <MarkdownPreview text={active.content} />
        ) : (
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            <div
              style={{
                flex: 'none',
                width: 46,
                padding: '10px 8px 10px 0',
                textAlign: 'right',
                fontFamily: 'var(--font-mono)',
                fontSize,
                lineHeight: 1.5,
                color: 'rgba(128,136,132,0.85)',
                background: 'color-mix(in srgb, var(--wm-window-bg) 94%, #808890)',
                borderRight: '1px solid rgba(0,0,0,0.12)',
                overflow: 'hidden',
                userSelect: 'none',
              }}
            >
              {Array.from({ length: Math.max(1, active.content.split('\n').length) }).map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <textarea
              ref={areaRef}
              value={active.content}
              wrap={wrap ? 'soft' : 'off'}
              spellCheck={false}
              onChange={(e) => {
                patch({ content: e.target.value })
                updateCaret()
              }}
              onKeyUp={updateCaret}
              onClick={updateCaret}
              onKeyDown={onKeyDown}
              style={{
                flex: 1,
                minHeight: 0,
                border: 'none',
                outline: 'none',
                resize: 'none',
                padding: 10,
                fontFamily: 'var(--font-mono)',
                fontSize,
                lineHeight: 1.5,
                background: 'transparent',
                color: 'var(--wm-window-fg)',
                whiteSpace: wrap ? 'pre-wrap' : 'pre',
              }}
            />
          </div>
        )}
      </div>

      {/* status bar */}
      <div style={{ flex: 'none', display: 'flex', gap: 14, padding: '3px 10px', fontSize: 11.5, borderTop: '1px solid rgba(0,0,0,0.16)', backgroundImage: 'linear-gradient(to bottom,#f2f3f1,#e6e8e4)', color: '#24292c' }}>
        <span>{active.path ? active.path.replace(HOME, '~') : 'Not saved yet'}</span>
        <span style={{ flex: 1 }} />
        <span>Ln {caret.line}, Col {caret.col}</span>
        <span>{stats.lines} lines</span>
        <span>{stats.words} words</span>
        <span>UTF-8</span>
        <span>Plain Text</span>
        <span>{dirty ? 'Modified' : 'Saved'}</span>
      </div>

      {showOpen && <OpenDialog onClose={() => setShowOpen(false)} onOpen={(p) => { openPath(p); setShowOpen(false) }} />}
      {showSaveAs && <SaveAsDialog initialName={active.name} onClose={() => setShowSaveAs(false)} onSave={(p) => save(p)} />}
    </div>
  )
}

function MarkdownPreview({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  return (
    <div
      style={{ flex: 1, overflow: 'auto', padding: '18px 22px', lineHeight: 1.7, fontSize: 14 }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/** A small Markdown renderer: headings, bold/italic, code, lists, quotes, links. */
function renderMarkdown(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (s: string) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code style="background:rgba(128,136,132,0.22);padding:1px 5px;border-radius:4px">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a style="color:#1b6ac9">$1</a>')

  const lines = md.split('\n')
  const out: string[] = []
  let inList = false
  let inCode = false
  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        out.push('</pre>')
        inCode = false
      } else {
        out.push('<pre style="background:rgba(128,136,132,0.16);padding:10px;border-radius:7px;overflow:auto">')
        inCode = true
      }
      continue
    }
    if (inCode) {
      out.push(esc(line))
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1].length
      const size = [26, 21, 17, 15][level - 1]
      out.push(`<div style="font-size:${size}px;font-weight:${level <= 2 ? 700 : 600};margin:${level === 1 ? '4px 0 10px' : '16px 0 6px'}">${inline(heading[2])}</div>`)
      continue
    }
    const li = /^\s*[-*]\s+(.*)$/.exec(line)
    if (li) {
      if (!inList) {
        out.push('<ul style="margin:6px 0 6px 18px">')
        inList = true
      }
      out.push(`<li>${inline(li[1])}</li>`)
      continue
    }
    if (inList) {
      out.push('</ul>')
      inList = false
    }
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      out.push(`<blockquote style="border-left:3px solid var(--wm-accent);margin:8px 0;padding:2px 12px;opacity:.85">${inline(quote[1])}</blockquote>`)
      continue
    }
    if (/^---+$/.test(line.trim())) {
      out.push('<hr style="border:none;border-top:1px solid rgba(0,0,0,0.18);margin:14px 0">')
      continue
    }
    if (!line.trim()) {
      out.push('<div style="height:8px"></div>')
      continue
    }
    out.push(`<div>${inline(line)}</div>`)
  }
  if (inList) out.push('</ul>')
  if (inCode) out.push('</pre>')
  return out.join('\n')
}

function OpenDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (path: string) => void }) {
  const revision = useVFS((s) => s.revision)
  const [path, setPath] = useState(`${HOME}/Documents`)
  const [selected, setSelected] = useState<string | null>(null)
  const entries = (vfs.list(path) ?? []).filter((e) => e.node.type === 'file')
  return (
    <Dialog title="Open File" width={520} onClose={onClose}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
        <button className="btn-ghost" onClick={() => setPath(parentPath(path))}>
          <Glyph name="ChevronUp" size={15} />
        </button>
        <button className="btn-ghost" onClick={() => setPath(HOME)}>
          <Glyph name="Home" size={14} />
        </button>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{path.replace(HOME, '~')}</span>
      </div>
      <div style={{ height: 240, overflow: 'auto', border: '1px solid rgba(0,0,0,0.18)', borderRadius: 6, padding: 4 }}>
        {entries.map((e) => (
          <div
            key={e.name}
            className="menu-item"
            style={{ background: selected === e.name ? 'color-mix(in srgb, var(--wm-accent) 38%, transparent)' : undefined }}
            onClick={() => setSelected(e.name)}
            onDoubleClick={() => onOpen(join(path, e.name))}
          >
            <Glyph name="FileText" size={14} />
            <span style={{ flex: 1 }}>{e.name}</span>
            <span style={{ opacity: 0.6, fontSize: 11.5 }}>{(e.node as any).mime}</span>
          </div>
        ))}
        {(vfs.list(path) ?? [])
          .filter((e) => e.node.type === 'dir')
          .map((e) => (
            <div key={e.name} className="menu-item" onDoubleClick={() => setPath(join(path, e.name))} onClick={() => setPath(join(path, e.name))}>
              <Glyph name="Folder" size={14} />
              <span style={{ flex: 1 }}>{e.name}</span>
            </div>
          ))}
        {entries.length === 0 && <div style={{ padding: 12, opacity: 0.7 }}>No text files in this folder.</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-mixt" disabled={!selected} onClick={() => selected && onOpen(join(path, selected))}>
          Open
        </button>
      </div>
      <div style={{ fontSize: 11.5, opacity: 0.65, marginTop: 6, textAlign: 'right' }}>{revision} filesystem revision</div>
    </Dialog>
  )
}

function SaveAsDialog({ initialName, onClose, onSave }: { initialName: string; onClose: () => void; onSave: (path: string) => void }) {
  const [path, setPath] = useState(`${HOME}/Documents`)
  const [name, setName] = useState(initialName)
  return (
    <Dialog title="Save File As" width={520} onClose={onClose}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
        <button className="btn-ghost" onClick={() => setPath(parentPath(path))}>
          <Glyph name="ChevronUp" size={15} />
        </button>
        <button className="btn-ghost" onClick={() => setPath(HOME)}>
          <Glyph name="Home" size={14} />
        </button>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{path.replace(HOME, '~')}</span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {[`${HOME}/Documents`, `${HOME}/Desktop`, `${HOME}/Downloads`, HOME].map((p) => (
          <button key={p} className="btn-ghost" onClick={() => setPath(p)}>
            {baseName(p) || 'Home'}
          </button>
        ))}
      </div>
      <input className="entry" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', marginTop: 12 }} autoFocus />
      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
        Will be saved to {join(path, name).replace(HOME, '~')}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-mixt" onClick={() => onSave(join(path, name))}>
          Save
        </button>
      </div>
    </Dialog>
  )
}
