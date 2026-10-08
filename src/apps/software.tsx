import React, { useMemo, useState } from 'react'
import { useOS } from '../os/store'
import { APPS, CATEGORIES, getApp, searchApps } from './registry'
import { AppIcon, Glyph } from '../shell/AppIcon'
import { launch, notify } from '../os/bus'
import type { AppDef, AppProps } from '../os/types'

const REVIEWS: Record<string, number> = {
  nemo: 4.6, terminal: 4.9, browser: 4.4, mintinstall: 4.2, settings: 4.0, xed: 4.3,
  calculator: 4.1, 'system-monitor': 4.5, mediaplayer: 4.0, imageviewer: 4.2, weather: 4.3,
  archive: 4.1, screenshot: 3.9, game2048: 4.8, help: 4.7, about: 4.4, paint: 4.5, mail: 4.2, news: 4.1,
}

const SIZES: Record<string, string> = {
  paint: '4.2 MB', mail: '12.1 MB', news: '7.8 MB',
}

export default function SoftwareApp({ win, api }: AppProps) {
  const installed = useOS((s) => s.installed)
  const setInstalled = useOS((s) => s.setInstalled)
  const [category, setCategory] = useState('Featured')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(win.props?.focus ?? null)
  const [installing, setInstalling] = useState<{ id: string; pct: number } | null>(null)
  const [tab, setTab] = useState<'catalog' | 'updates'>('catalog')

  const isInstalled = (app: AppDef) => app.preinstalled !== false || !!installed[app.id]

  const list = useMemo(() => {
    let items = [...APPS]
    if (query.trim()) {
      items = searchApps(query)
    } else if (category === 'Featured') {
      items = items.filter((a) => a.preinstalled !== false).slice(0, 12)
    } else if (category === 'Installed') {
      items = items.filter((a) => isInstalled(a))
    } else if (category === 'Available') {
      items = items.filter((a) => !isInstalled(a))
    } else if (category !== 'All') {
      items = items.filter((a) => a.categories.includes(category))
    }
    return items.sort((a, b) => a.name.localeCompare(b.name))
  }, [category, query, installed])

  const current = selected ? getApp(selected) : null

  function install(app: AppDef) {
    setInstalling({ id: app.id, pct: 0 })
    let pct = 0
    const timer = setInterval(() => {
      pct += 8 + Math.random() * 14
      if (pct >= 100) {
        clearInterval(timer)
        setInstalling(null)
        setInstalled(app.id, true)
        notify('Software Manager', `${app.name} has been installed.\nYou can find it in the Menu under ${app.categories[0]}.`, 'mintinstall')
      } else {
        setInstalling({ id: app.id, pct })
      }
    }, 220)
  }

  function remove(app: AppDef) {
    setInstalled(app.id, false)
    notify('Software Manager', `${app.name} has been removed.`, 'mintinstall')
    setSelected(null)
  }

  React.useEffect(() => {
    if (win.props?.focus) setSelected(win.props.focus)
  }, [win.props?.focus])

  React.useEffect(() => {
    api.setTitle(current ? `${current.name} — Software Manager` : 'Software Manager')
  }, [current?.id])

  const updates = APPS.filter((a) => a.preinstalled === false && !installed[a.id])

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, background: 'var(--wm-window-bg)' }}>
      {/* sidebar */}
      <div style={{ width: 190, flex: 'none', borderRight: '1px solid rgba(0,0,0,0.16)', padding: '10px 6px', overflow: 'auto', background: 'color-mix(in srgb, var(--wm-window-bg) 92%, #808890)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '0 6px 10px' }}>
          <AppIcon glyph="ShoppingBag" color="#61ad2b" color2="#3b6f18" size={28} />
          <div style={{ fontWeight: 600 }}>Software</div>
        </div>
        {[
          ['Featured', 'Star'],
          ['All', 'Grid3x3'],
          ['Installed', 'Check'],
          ['Available', 'Download'],
        ].map(([label, glyph]) => (
          <div
            key={label}
            className="menu-item"
            style={{ background: category === label && tab === 'catalog' ? 'color-mix(in srgb, var(--wm-accent) 40%, transparent)' : undefined }}
            onClick={() => {
              setCategory(label)
              setTab('catalog')
              setQuery('')
            }}
          >
            <Glyph name={glyph} size={15} />
            <span style={{ flex: 1 }}>{label}</span>
          </div>
        ))}
        <div
          className="menu-item"
          style={{ background: tab === 'updates' ? 'color-mix(in srgb, var(--wm-accent) 40%, transparent)' : undefined }}
          onClick={() => setTab('updates')}
        >
          <Glyph name="RefreshCw" size={15} />
          <span style={{ flex: 1 }}>Updates</span>
          {updates.length > 0 && (
            <span style={{ background: 'var(--wm-accent)', color: '#14260a', borderRadius: 999, fontSize: 10.5, padding: '0 6px', fontWeight: 700 }}>{updates.length}</span>
          )}
        </div>
        <div className="menu-sep" />
        <div style={{ fontSize: 10.5, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 9px' }}>Categories</div>
        {CATEGORIES.filter((c) => !['All Applications', 'Favourites'].includes(c)).map((c) => (
          <div
            key={c}
            className="menu-item"
            style={{ background: category === c && tab === 'catalog' ? 'color-mix(in srgb, var(--wm-accent) 40%, transparent)' : undefined }}
            onClick={() => {
              setCategory(c)
              setTab('catalog')
              setQuery('')
            }}
          >
            <span style={{ flex: 1 }}>{c}</span>
          </div>
        ))}
      </div>

      {/* main */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="mint-toolbar">
          <input className="entry" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the Software Manager…" style={{ flex: 1, maxWidth: 420 }} />
          <div style={{ flex: 1 }} />
          <span style={{ opacity: 0.7, fontSize: 12 }}>{APPS.filter(isInstalled).length} installed · {APPS.length} available</span>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
            {tab === 'updates' ? (
              <UpdatesPanel updates={updates} onInstall={install} installing={installing} />
            ) : (
              <>
                {query && <div style={{ opacity: 0.75, marginBottom: 8 }}>{list.length} results for “{query}”</div>}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: 10 }}>
                  {list.map((app) => (
                    <div
                      key={app.id}
                      onClick={() => setSelected(app.id)}
                      style={{
                        border: selected === app.id ? '2px solid var(--wm-accent)' : '1px solid rgba(0,0,0,0.16)',
                        borderRadius: 9,
                        padding: 12,
                        cursor: 'pointer',
                        background: 'color-mix(in srgb, var(--wm-window-bg) 95%, #ffffff)',
                        display: 'flex',
                        gap: 10,
                      }}
                    >
                      <AppIcon glyph={app.glyph} color={app.color} color2={app.color2} size={40} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.name}</div>
                        <div style={{ fontSize: 11.5, opacity: 0.7 }}>
                          ★ {(REVIEWS[app.id] ?? 4).toFixed(1)} · {isInstalled(app) ? 'Installed' : SIZES[app.id] ?? '2.4 MB'}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {app.comment}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {list.length === 0 && <div style={{ opacity: 0.7, padding: 20 }}>Nothing here. The MintNet is small but tidy.</div>}
              </>
            )}
          </div>

          {/* details */}
          {current && (
            <div style={{ width: 320, flex: 'none', borderLeft: '1px solid rgba(0,0,0,0.16)', overflow: 'auto', padding: 14 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <AppIcon glyph={current.glyph} color={current.color} color2={current.color2} size={54} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{current.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    ★ {(REVIEWS[current.id] ?? 4).toFixed(1)} · {current.categories[0]}
                  </div>
                </div>
              </div>
              <p style={{ opacity: 0.85, lineHeight: 1.55 }}>{current.comment}</p>

              <div style={{ borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
                <div style={{ height: 110, background: `linear-gradient(135deg, ${current.color}, ${current.color2 ?? current.color})`, display: 'grid', placeItems: 'center', color: '#fff' }}>
                  <AppIcon glyph={current.glyph} color="rgba(255,255,255,0.3)" color2="rgba(255,255,255,0.1)" size={54} />
                </div>
              </div>

              {installing?.id === current.id ? (
                <div>
                  <div style={{ fontSize: 12.5, marginBottom: 4 }}>Installing… {Math.round(installing.pct)}%</div>
                  <div style={{ height: 8, background: 'rgba(128,136,132,0.3)', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ width: `${installing.pct}%`, height: '100%', background: 'linear-gradient(90deg,#7cc93f,#4c8f1f)' }} />
                  </div>
                </div>
              ) : isInstalled(current) ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-mint" onClick={() => launch(current.id, {})}>
                    <Glyph name="Play" size={14} /> Launch
                  </button>
                  {current.preinstalled === false && (
                    <button className="btn-ghost" onClick={() => remove(current)}>
                      <Glyph name="Trash2" size={14} /> Remove
                    </button>
                  )}
                </div>
              ) : (
                <button className="btn-mint" onClick={() => install(current)}>
                  <Glyph name="Download" size={14} /> Install
                </button>
              )}

              <div className="menu-sep" />
              <table style={{ width: '100%', fontSize: 12.5 }}>
                <tbody>
                  <tr>
                    <td style={{ opacity: 0.65, padding: '3px 0' }}>Version</td>
                    <td>1.0.0</td>
                  </tr>
                  <tr>
                    <td style={{ opacity: 0.65, padding: '3px 0' }}>Download size</td>
                    <td>{SIZES[current.id] ?? '2.4 MB'}</td>
                  </tr>
                  <tr>
                    <td style={{ opacity: 0.65, padding: '3px 0' }}>Package</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{current.id}</td>
                  </tr>
                  <tr>
                    <td style={{ opacity: 0.65, padding: '3px 0' }}>Categories</td>
                    <td>{current.categories.join(', ')}</td>
                  </tr>
                </tbody>
              </table>

              <div style={{ marginTop: 12, fontSize: 12.5, opacity: 0.8 }}>
                <strong>Reviews</strong>
                <div style={{ marginTop: 6 }}>
                  “Exactly the application I needed, and I did not even have to compile it.” — tux_fan_92
                </div>
                <div style={{ marginTop: 6 }}>
                  “Five stars. Would install again, and did, after clicking Reset filesystem.” — mintyfresh
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function UpdatesPanel({
  updates,
  onInstall,
  installing,
}: {
  updates: AppDef[]
  onInstall: (app: AppDef) => void
  installing: { id: string; pct: number } | null
}) {
  return (
    <div style={{ maxWidth: 640 }}>
      <h2 style={{ marginTop: 0 }}>Updates</h2>
      <p style={{ opacity: 0.8 }}>
        Your system is up to date. The applications below are optional extras from the Mint repository, and they are
        one click away.
      </p>
      {updates.length === 0 && <div style={{ opacity: 0.7 }}>Everything available is already installed. Impressive.</div>}
      {updates.map((app) => (
        <div key={app.id} style={{ display: 'flex', gap: 12, alignItems: 'center', borderBottom: '1px solid rgba(0,0,0,0.12)', padding: '10px 0' }}>
          <AppIcon glyph={app.glyph} color={app.color} color2={app.color2} size={36} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{app.name}</div>
            <div style={{ fontSize: 12.5, opacity: 0.75 }}>{app.comment}</div>
            {installing?.id === app.id && (
              <div style={{ height: 6, background: 'rgba(128,136,132,0.3)', borderRadius: 999, marginTop: 6, overflow: 'hidden' }}>
                <div style={{ width: `${installing.pct}%`, height: '100%', background: 'var(--wm-accent)' }} />
              </div>
            )}
          </div>
          <button className="btn-mint" disabled={installing?.id === app.id} onClick={() => onInstall(app)}>
            {installing?.id === app.id ? 'Installing…' : 'Install'}
          </button>
        </div>
      ))}
    </div>
  )
}
