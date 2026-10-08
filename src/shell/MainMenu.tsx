import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useOS, isInstalled } from '../os/store'
import { APPS, CATEGORIES, getApp } from '../apps/registry'
import { AppIcon, Glyph } from './AppIcon'
import { launch, notify } from '../os/bus'
import { HOME, vfs } from '../os/vfs'
import type { AppDef } from '../os/types'

export default function MainMenu({ onClose }: { onClose: () => void }) {
  const settings = useOS((s) => s.settings)
  const installed = useOS((s) => s.installed)
  const [category, setCategory] = useState('All Applications')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [context, setContext] = useState<{ x: number; y: number; app: AppDef } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const S = useOS.getState()

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const available = useMemo(
    () => APPS.filter((a) => a.preinstalled !== false || !!installed[a.id]),
    [installed],
  )

  const list = useMemo(() => {
    let items = available
    if (query.trim()) {
      const q = query.toLowerCase()
      items = items.filter((a) =>
        [a.name, a.generic ?? '', a.comment, a.id, ...(a.keywords ?? [])].join(' ').toLowerCase().includes(q),
      )
      return items.sort((a, b) => a.name.localeCompare(b.name))
    }
    if (category === 'Favourites') return items.filter((a) => settings.desktopIcons.includes(a.id))
    if (category === 'All Applications') return items.sort((a, b) => a.name.localeCompare(b.name))
    return items.filter((a) => a.categories.includes(category)).sort((a, b) => a.name.localeCompare(b.name))
  }, [available, category, query, settings.desktopIcons])

  const places = [
    { label: 'Home Folder', path: HOME, glyph: 'Home' },
    { label: 'Documents', path: `${HOME}/Documents`, glyph: 'FileText' },
    { label: 'Pictures', path: `${HOME}/Pictures`, glyph: 'Image' },
    { label: 'Downloads', path: `${HOME}/Downloads`, glyph: 'Download' },
    { label: 'Recent Files', path: `${HOME}/Desktop`, glyph: 'Clock' },
    { label: 'Trash', path: `${HOME}/.local/share/Trash/files`, glyph: 'Trash2' },
  ]

  const recentApps = useOS.getState().windows.slice(-5).map((w) => getApp(w.appId)).filter(Boolean) as AppDef[]
  const highlighted = list.find((a) => a.id === selected) ?? list[0]

  const activate = (app: AppDef) => {
    launch(app.id, {})
    onClose()
  }

  return (
    <>
      <div
        style={{
          position: 'fixed',
          left: 8,
          [settings.panelPosition === 'top' ? 'top' : 'bottom']: settings.panelSize + 6,
          zIndex: 165000,
          width: 660,
          maxWidth: '96vw',
          maxHeight: 'min(620px, 78vh)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--wm-menu-bg)',
          color: 'var(--wm-menu-fg)',
          border: '1px solid rgba(0,0,0,0.4)',
          borderRadius: 10,
          boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        } as any}
        className="anim-pop"
      >
        {/* search */}
        <div style={{ padding: 10, backgroundImage: 'linear-gradient(to bottom,#4b5054,#35393c)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ width: 34, height: 34, borderRadius: 999, background: 'linear-gradient(135deg,#9ede6a,#3b6f18)', display: 'grid', placeItems: 'center', fontSize: 17 }}>
            {settings.avatar}
          </div>
          <div style={{ color: '#eef2ef', fontSize: 12.5, lineHeight: 1.25 }}>
            <div style={{ fontWeight: 600 }}>{settings.fullName}</div>
            <div style={{ opacity: 0.8 }}>
              {settings.username}@{settings.hostname}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <input
            ref={inputRef}
            className="entry"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && highlighted) activate(highlighted)
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                const i = list.findIndex((a) => a.id === highlighted?.id)
                setSelected(list[Math.min(list.length - 1, i + 1)]?.id ?? null)
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                const i = list.findIndex((a) => a.id === highlighted?.id)
                setSelected(list[Math.max(0, i - 1)]?.id ?? null)
              }
            }}
            placeholder="Type to search applications…"
            style={{ width: 250 }}
          />
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* categories */}
          <div style={{ width: 176, flex: 'none', overflow: 'auto', borderRight: '1px solid rgba(0,0,0,0.14)', padding: '6px 4px', background: 'color-mix(in srgb, var(--wm-menu-bg) 92%, #808890)' }}>
            {CATEGORIES.map((cat) => (
              <div
                key={cat}
                className="menu-item"
                style={{ background: category === cat && !query ? 'color-mix(in srgb, var(--wm-accent) 42%, transparent)' : undefined }}
                onClick={() => {
                  setCategory(cat)
                  setQuery('')
                }}
              >
                <Glyph
                  name={
                    cat === 'All Applications'
                      ? 'Grid3x3'
                      : cat === 'Favourites'
                        ? 'Star'
                        : cat === 'Accessories'
                          ? 'Calculator'
                          : cat === 'Graphics'
                            ? 'Image'
                            : cat === 'Internet'
                              ? 'Globe'
                              : cat === 'Games'
                                ? 'Gamepad2'
                                : cat === 'Sound & Video'
                                  ? 'Music'
                                  : cat === 'System'
                                    ? 'Settings'
                                    : cat === 'Preferences'
                                      ? 'Wrench'
                                      : 'Shield'
                  }
                  size={14}
                />
                <span style={{ flex: 1 }}>{cat}</span>
              </div>
            ))}
            <div className="menu-sep" />
            <div style={{ fontSize: 10.5, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 9px' }}>Places</div>
            {places.map((p) => (
              <div
                key={p.path}
                className="menu-item"
                onClick={() => {
                  launch('nemo', { path: p.path })
                  onClose()
                }}
              >
                <Glyph name={p.glyph} size={14} />
                <span style={{ flex: 1 }}>{p.label}</span>
              </div>
            ))}
          </div>

          {/* applications */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, overflow: 'auto', padding: '6px 6px 0' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(196px,1fr))', gap: 2 }}>
                {list.map((app) => (
                  <div
                    key={app.id}
                    className="menu-item"
                    style={{ background: highlighted?.id === app.id ? 'color-mix(in srgb, var(--wm-accent) 34%, transparent)' : undefined }}
                    onMouseEnter={() => setSelected(app.id)}
                    onClick={() => activate(app)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setContext({ x: e.clientX, y: e.clientY, app })
                    }}
                  >
                    <AppIcon glyph={app.glyph} color={app.color} color2={app.color2} size={30} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{app.name}</span>
                  </div>
                ))}
                {list.length === 0 && (
                  <div style={{ padding: 16, opacity: 0.7 }}>
                    No applications match “{query}”. Try the Software Manager.
                  </div>
                )}
              </div>

              {!query && category === 'All Applications' && recentApps.length > 0 && (
                <>
                  <div style={{ fontSize: 10.5, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5, padding: '10px 4px 4px' }}>
                    Recently used
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', paddingBottom: 8 }}>
                    {recentApps.filter((a, i, arr) => arr.findIndex((b) => b.id === a.id) === i).map((app) => (
                      <div key={app.id} className="menu-item" style={{ width: 'auto' }} onClick={() => activate(app)}>
                        <AppIcon glyph={app.glyph} color={app.color} color2={app.color2} size={22} />
                        <span>{app.name}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* description strip */}
            <div style={{ borderTop: '1px solid rgba(0,0,0,0.14)', padding: '8px 10px', minHeight: 54 }}>
              {highlighted ? (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <AppIcon glyph={highlighted.glyph} color={highlighted.color} color2={highlighted.color2} size={34} />
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {highlighted.name}
                      {highlighted.generic && highlighted.name !== highlighted.generic ? (
                        <span style={{ fontWeight: 400, opacity: 0.65 }}> — {highlighted.generic}</span>
                      ) : null}
                    </div>
                    <div style={{ opacity: 0.8, fontSize: 12.5 }}>{highlighted.comment}</div>
                  </div>
                </div>
              ) : (
                <div style={{ opacity: 0.7 }}>Select an application</div>
              )}
            </div>

            {/* bottom bar */}
            <div style={{ display: 'flex', gap: 4, padding: 8, borderTop: '1px solid rgba(0,0,0,0.14)', background: 'color-mix(in srgb, var(--wm-menu-bg) 92%, #808890)' }}>
              <button className="btn-ghost" onClick={() => { launch('mixtinstall', {}); onClose() }}>
                <Glyph name="ShoppingBag" size={15} /> Software Manager
              </button>
              <div style={{ flex: 1 }} />
              <button className="btn-ghost" title="Lock screen" onClick={() => { S.setLocked(true); onClose() }}>
                <Glyph name="Lock" size={15} />
              </button>
              <button
                className="btn-ghost"
                title="Log out"
                onClick={() => {
                  onClose()
                  window.dispatchEvent(new CustomEvent('mixt:session', { detail: 'logout' }))
                }}
              >
                <Glyph name="LogOut" size={15} />
              </button>
              <button
                className="btn-ghost"
                title="Restart"
                onClick={() => {
                  onClose()
                  window.dispatchEvent(new CustomEvent('mixt:session', { detail: 'reboot' }))
                }}
              >
                <Glyph name="RefreshCw" size={15} />
              </button>
              <button
                className="btn-ghost"
                title="Shut down"
                onClick={() => {
                  onClose()
                  window.dispatchEvent(new CustomEvent('mixt:session', { detail: 'shutdown' }))
                }}
              >
                <Glyph name="Power" size={15} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* outside click closes */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 164999 }} onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />

      {/* application context menu */}
      {context && (
        <div
          className="menu-popup anim-pop"
          style={{ position: 'fixed', left: Math.min(context.x, window.innerWidth - 240), top: Math.min(context.y, window.innerHeight - 200), zIndex: 170000 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="menu-item" onClick={() => { launch(context.app.id, {}); onClose() }}>
            <Glyph name="Play" size={14} /> Open
          </div>
          {!settings.desktopIcons.includes(context.app.id) && (
            <div
              className="menu-item"
              onClick={() => {
                S.setSettings({ desktopIcons: [...settings.desktopIcons, context.app.id] })
                notify('Desktop', `${context.app.name} added to the desktop.`)
                setContext(null)
              }}
            >
              <Glyph name="Monitor" size={14} /> Add to desktop
            </div>
          )}
          <div
            className="menu-item"
            onClick={() => {
              notify('Panel', `“${context.app.name}” is already available from the quick launch area.`)
              setContext(null)
            }}
          >
            <Glyph name="Plus" size={14} /> Pin to panel
          </div>
          <div className="menu-sep" />
          <div
            className="menu-item"
            onClick={() => {
              launch('mixtinstall', { focus: context.app.id })
              onClose()
            }}
          >
            <Glyph name="ShoppingBag" size={14} /> Open in Software Manager
          </div>
          <div
            className="menu-item"
            onClick={() => {
              launch('terminal', { cwd: HOME })
              onClose()
            }}
          >
            <Glyph name="Terminal" size={14} /> Open in Terminal
          </div>
        </div>
      )}
    </>
  )
}
