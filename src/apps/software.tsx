/* Software Manager — the application store.
 *
 * A proper storefront rather than a list with a side panel: a home page with a
 * featured banner, editor's picks and category shelves; a browsable catalogue
 * you can sort; and a full detail page per application with screenshots, a
 * rating you can leave yourself (saved in the browser), reviews, version
 * history and related apps.
 *
 * Screenshots are drawn from the app's own colours and icon — the OS ships no
 * images from anywhere external, so a "screenshot" is a mock of the window the
 * app actually opens.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { useOS } from '../os/store'
import { CATEGORIES, getApp, searchApps, visibleApps } from './registry'
import { hasUpdate, installedVersion, repoVersion, versionLabel } from './versions'
import * as backend from '../os/api'
import { AppIcon, Glyph } from '../shell/AppIcon'
import { launch, notify } from '../os/bus'
import { safeLocal } from '../os/storage'
import type { AppDef, AppProps } from '../os/types'

const LS_RATINGS = 'mixt.store.ratings.v1'

const REVIEWS: Record<string, number> = {
  nemo: 4.6, terminal: 4.9, browser: 4.4, mixtinstall: 4.2, settings: 4.0, xed: 4.3,
  calculator: 4.1, 'system-monitor': 4.5, mediaplayer: 4.0, imageviewer: 4.2, weather: 4.3,
  archive: 4.1, screenshot: 3.9, game2048: 4.8, help: 4.7, about: 4.4, paint: 4.5, mail: 4.2, news: 4.1,
}

const SIZES: Record<string, string> = {
  paint: '4.2 MB', mail: '12.1 MB', news: '7.8 MB', browser: '38.6 MB', nemo: '9.4 MB',
  terminal: '3.1 MB', mediaplayer: '15.2 MB', game2048: '1.8 MB', 'system-monitor': '2.9 MB',
}

const DEVELOPERS: Record<string, string> = {
  nemo: 'Mixt Desktop Team', terminal: 'Mixt Desktop Team', browser: 'Mixtsfox Project',
  mixtinstall: 'Mixt Desktop Team', settings: 'Mixt Desktop Team', xed: 'Mixt Editors',
  calculator: 'Mixt Accessories', 'system-monitor': 'Mixt Desktop Team', mediaplayer: 'Mixt Media',
  imageviewer: 'Mixt Media', weather: 'MixtNet Services', archive: 'Mixt Accessories',
  screenshot: 'Mixt Accessories', game2048: 'Mixt Games', help: 'Mixt Desktop Team',
  about: 'Mixt Desktop Team', paint: 'Mixt Graphics', mail: 'MixtNet Services', news: 'MixtNet Services',
}

const BLURBS: Record<string, string> = {
  nemo: 'The file manager that ships with the Mixt desktop. Browse the virtual filesystem, create and rename folders, drag files between windows, and open anything with the application that handles it. Supports list, icon and compact views, a location bar with history, and the Trash.',
  terminal: 'A real shell for the Mixt desktop: pipes, redirection, command chaining, tab completion and history. Includes the usual utilities — ls, cd, cat, grep, curl, ping, dig — plus mixtget, mixtinstall and /startup for creating user accounts.',
  browser: 'Mixtsfox renders the whole of MixtNet: a fictional internet with its own DNS, search engine and a few dozen sites. Bookmarks, history, tabs, downloads and a developer view are all here.',
  mixtinstall: 'The storefront itself. Browse the repository, read reviews, install and remove packages, and keep the optional extras up to date.',
  settings: 'Every knob the desktop has: appearance, panel, desktop, display, network, power, sound, user accounts and the filesystem.',
  xed: 'A plain text editor with syntax highlighting for the common languages, line numbers, find and replace, and a status bar that reports the encoding.',
  calculator: 'Basic, advanced and programmer modes. Keeps a tape of the last calculations so you can scroll back and reuse a result.',
  'system-monitor': 'Live CPU, memory, disk and network graphs, plus a process list you can sort and terminate.',
  mediaplayer: 'Plays the synthetic tracks in your Music folder. Visualiser, playlist, shuffle and repeat, with a seek bar that actually seeks.',
  imageviewer: 'Opens the wallpapers and anything in Pictures. Zoom, rotate, fit to window, and a thumbnail strip.',
  weather: 'Forecasts for the cities of MixtNet, refreshed from the built-in weather service.',
  archive: 'Create and extract .zip archives from the file manager. Shows the contents before you unpack them and lets you choose the destination.',
  screenshot: 'Capture the whole screen, the focused window or a region, then annotate and save to Pictures.',
  game2048: 'The tile game. Arrow keys or swipe, undo, best score saved per account.',
  help: 'The Mixt desktop guide: keyboard shortcuts, terminal commands, and what every panel applet does.',
  about: 'Version, kernel, browser engine, memory and the licences of everything that went into this build.',
  paint: 'A small bitmap editor: brushes, shapes, fill, picker, layers of undo, and save to Pictures.',
  mail: 'A mail client for the MixtNet mail service. Inbox, sent, drafts and compose, with the messages stored locally.',
  news: 'The MixtNet news reader, pulling from the built-in feeds.',
}

const CHANGELOG: Record<string, string[]> = {
  nemo: ['Compact view for long lists', 'Trash now survives a reload'],
  terminal: ['/startup creates user accounts', 'Tab completion covers the new commands'],
  browser: ['Rebranded as Mixtsfox', 'Downloads land in ~/Downloads'],
  mixtinstall: ['Storefront redesign with screenshots and ratings', 'Ratings are saved per browser'],
  game2048: ['Undo', 'Best score is kept per account'],
}

const TESTIMONIALS: [string, string][] = [
  ['tux_fan_92', 'Exactly the application I needed, and I did not even have to compile it.'],
  ['mixtyfresh', 'Five stars. Would install again, and did, after clicking Reset filesystem.'],
  ['ada', 'Runs on a static host with no backend. I checked the network tab.'],
  ['kernel_panic', 'Opened it from the menu, which is more than some desktops manage.'],
]

/* ------------------------------ saved ratings ------------------------------ */
function loadMyRatings(): Record<string, number> {
  try {
    const raw = safeLocal.getItem(LS_RATINGS)
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && v >= 1 && v <= 5) out[k] = Math.round(v)
    }
    return out
  } catch {
    return {}
  }
}
function saveMyRatings(r: Record<string, number>) {
  try {
    safeLocal.setItem(LS_RATINGS, JSON.stringify(r))
  } catch {
    /* storage refused — the rating just will not survive the reload */
  }
}

const sizeOf = (app: AppDef) => SIZES[app.id] ?? '2.4 MB'
const sizeBytes = (app: AppDef) => {
  const n = parseFloat(sizeOf(app))
  return sizeOf(app).endsWith('MB') ? n * 1024 * 1024 : n * 1024
}
const devOf = (app: AppDef) => DEVELOPERS[app.id] ?? 'Mixt Community'
const ratingOf = (app: AppDef) => REVIEWS[app.id] ?? 4.0

/* --------------------------------- pieces --------------------------------- */
function Stars({ value, size = 12, onRate }: { value: number; size?: number; onRate?: (n: number) => void }) {
  return (
    <span style={{ display: 'inline-flex', gap: 1, alignItems: 'center' }} title={onRate ? 'Click to rate' : undefined}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = value >= n - 0.25
        const half = !filled && value >= n - 0.75
        return (
          <span
            key={n}
            onClick={onRate ? (e) => { e.stopPropagation(); onRate(n) } : undefined}
            style={{
              fontSize: size,
              lineHeight: 1,
              cursor: onRate ? 'pointer' : 'default',
              color: filled || half ? '#e6a817' : 'rgba(128,136,132,0.45)',
            }}
          >
            {filled ? '★' : half ? '⯨' : '☆'}
          </span>
        )
      })}
    </span>
  )
}

/** A mock of the window the application opens — the store's "screenshot". */
function Screenshot({ app, variant = 0 }: { app: AppDef; variant?: number }) {
  const bars = [72, 46, 88, 58, 96, 40]
  return (
    <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.18)', background: 'var(--wm-entry-bg)', flex: 'none' }}>
      <div style={{ height: 20, background: 'linear-gradient(to bottom,#4b5054,#35393c)', display: 'flex', alignItems: 'center', gap: 5, padding: '0 7px' }}>
        {['#c2554f', '#d9a13a', '#7cc93f'].map((c) => (
          <span key={c} style={{ width: 8, height: 8, borderRadius: 999, background: c, display: 'block' }} />
        ))}
        <span style={{ color: '#eef2ef', fontSize: 10, marginLeft: 5, opacity: 0.9 }}>{app.name}</span>
      </div>
      <div
        style={{
          height: 108,
          background: `linear-gradient(${135 + variant * 40}deg, ${app.color}, ${app.color2 ?? app.color})`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          position: 'relative',
        }}
      >
        <AppIcon glyph={app.glyph} color="rgba(255,255,255,0.34)" color2="rgba(255,255,255,0.12)" size={46} />
        {variant % 2 === 1 && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 56 }}>
            {bars.map((h, i) => (
              <span key={i} style={{ width: 7, height: `${h}%`, background: 'rgba(255,255,255,0.35)', borderRadius: 2 }} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RatingHistogram({ value }: { value: number }) {
  // a deterministic spread around the average, so the store looks lived-in
  const weights = [1, 2, 3, 4, 5].map((star) => {
    const d = Math.abs(star - value)
    return Math.max(2, Math.round(120 * Math.exp(-(d * d) / 1.6)))
  })
  const total = weights.reduce((a, b) => a + b, 0)
  return (
    <div style={{ display: 'grid', gap: 3, marginTop: 6 }}>
      {[5, 4, 3, 2, 1].map((star) => {
        const w = weights[star - 1]
        return (
          <div key={star} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
            <span style={{ width: 10, opacity: 0.7 }}>{star}</span>
            <span style={{ color: '#e6a817', fontSize: 10 }}>★</span>
            <div style={{ flex: 1, height: 6, background: 'rgba(128,136,132,0.25)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: `${(w / total) * 100}%`, height: '100%', background: '#e6a817' }} />
            </div>
            <span style={{ width: 30, textAlign: 'right', opacity: 0.6 }}>{Math.round((w / total) * 100)}%</span>
          </div>
        )
      })}
    </div>
  )
}

/* ---------------------------------- app ----------------------------------- */
type Sort = 'featured' | 'rating' | 'name' | 'size'

export default function SoftwareApp({ win, api }: AppProps) {
  const installed = useOS((s) => s.installed)
  const serverRole = useOS((s) => s.serverRole)
  const setInstalled = useOS((s) => s.setInstalled)
  const [category, setCategory] = useState('Featured')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(win.props?.focus ?? null)
  const [installing, setInstalling] = useState<{ id: string; pct: number } | null>(null)
  const [tab, setTab] = useState<'catalog' | 'updates'>('catalog')
  const [sort, setSort] = useState<Sort>('featured')
  const [myRatings, setMyRatings] = useState<Record<string, number>>(loadMyRatings)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [published, setPublished] = useState<{ id: string; name: string; author: string; status: string }[]>([])
  const refreshPublished = () => backend.serverApps().then(setPublished)
  useEffect(() => {
    refreshPublished()
  }, [])
  const session = backend.getSession()
  const publish = () => {
    const name = window.prompt('Name of the app to publish for approval:')
    if (!name) return
    backend.publishApp(name).then((ok) => {
      notify('Software Manager', ok ? `“${name}” submitted for administrator approval.` : 'Publishing needs a whitelisted (non-guest) account.')
      refreshPublished()
    })
  }
  const approvePending = () => {
    const pend = published.find((a) => a.status === 'pending')
    if (!pend) return notify('Software Manager', 'Nothing pending approval.')
    backend.approveApp(pend.id).then(refreshPublished)
  }

  const isInstalled = (app: AppDef) => app.preinstalled !== false || !!installed[app.id]
  const updatesApplied = useOS((s) => s.updatesApplied)
  const applyUpdate = useOS((s) => s.applyUpdate)

  const list = useMemo(() => {
    let items = [...visibleApps()]
    if (query.trim()) items = searchApps(query)
    else if (category === 'Featured') items = items.filter((a) => a.preinstalled !== false)
    else if (category === 'Installed') items = items.filter(isInstalled)
    else if (category === 'Available') items = items.filter((a) => !isInstalled(a))
    else if (category !== 'All') items = items.filter((a) => a.categories.includes(category))

    switch (sort) {
      case 'rating':
        items.sort((a, b) => ratingOf(b) - ratingOf(a))
        break
      case 'name':
        items.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'size':
        items.sort((a, b) => sizeBytes(a) - sizeBytes(b))
        break
      default:
        items.sort((a, b) => Number(!!isInstalled(b)) - Number(!!isInstalled(a)) || ratingOf(b) - ratingOf(a))
    }
    return items
  }, [category, query, installed, sort])

  const current = selected ? getApp(selected) ?? null : null

  function install(app: AppDef) {
    if (installing) return
    setInstalling({ id: app.id, pct: 0 })
    let pct = 0
    const timer = setInterval(() => {
      pct += 7 + Math.random() * 13
      if (pct >= 100) {
        clearInterval(timer)
        setInstalling(null)
        setInstalled(app.id, true)
        notify('Software Manager', `${app.name} has been installed.\nYou can find it in the Menu under ${app.categories[0]}.`, 'mixtinstall')
      } else {
        setInstalling({ id: app.id, pct })
      }
    }, 170)
  }

  function update(app: AppDef) {
    if (installing) return
    setInstalling({ id: app.id, pct: 0 })
    let pct = 0
    const timer = setInterval(() => {
      pct += 9 + Math.random() * 15
      if (pct >= 100) {
        clearInterval(timer)
        setInstalling(null)
        const to = repoVersion(app.id)
        applyUpdate(app.id, to)
        notify('Update Manager', `${app.name} updated to ${to}.`, 'mixtinstall')
      } else {
        setInstalling({ id: app.id, pct })
      }
    }, 170)
  }

  function remove(app: AppDef) {
    setInstalled(app.id, false)
    setConfirmRemove(null)
    notify('Software Manager', `${app.name} has been removed.`, 'mixtinstall')
    setSelected(null)
  }

  function clearRating(appId: string) {
    const next = { ...myRatings }
    delete next[appId]
    setMyRatings(next)
    saveMyRatings(next)
  }

  function rate(appId: string, stars: number) {
    const next = { ...myRatings, [appId]: stars }
    setMyRatings(next)
    saveMyRatings(next)
    notify('Software Manager', `You rated ${getApp(appId)?.name ?? appId} ${stars} star${stars === 1 ? '' : 's'}.`, 'mixtinstall')
  }

  useEffect(() => {
    if (win.props?.focus) setSelected(win.props.focus)
  }, [win.props?.focus])

  useEffect(() => {
    api.setTitle(current ? `${current.name} — Software Manager` : 'Software Manager')
  }, [current?.id])

  /* An update is a package you already have where the repository has something
     newer. Extras you have never installed are not updates. */
  const updates = visibleApps().filter((a) => (a.preinstalled !== false || !!installed[a.id]) && hasUpdate(a.id, updatesApplied))
  const picks = useMemo(() => [...visibleApps()].sort((a, b) => ratingOf(b) - ratingOf(a)).slice(0, 4), [serverRole])
  const featured = picks[0]

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, background: 'var(--wm-window-bg)' }}>
      {/* ------------------------------- sidebar ------------------------------ */}
      <div style={{ width: 194, flex: 'none', borderRight: '1px solid rgba(0,0,0,0.16)', padding: '10px 6px', overflow: 'auto', background: 'color-mix(in srgb, var(--wm-window-bg) 92%, #808890)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '0 6px 10px' }}>
          <AppIcon glyph="ShoppingBag" color="#61ad2b" color2="#3b6f18" size={28} />
          <div>
            <div style={{ fontWeight: 600 }}>Software</div>
            <div style={{ fontSize: 10.5, opacity: 0.65 }}>Mixt repository</div>
          </div>
        </div>

        {([['Featured', 'Star'], ['All', 'Grid3x3'], ['Installed', 'Check'], ['Available', 'Download']] as [string, string][]).map(([label, glyph]) => (
          <div
            key={label}
            className="menu-item"
            style={{ background: category === label && tab === 'catalog' ? 'color-mix(in srgb, var(--wm-accent) 40%, transparent)' : undefined }}
            onClick={() => { setCategory(label); setTab('catalog'); setQuery(''); setSelected(null) }}
          >
            <Glyph name={glyph} size={15} />
            <span style={{ flex: 1 }}>{label}</span>
            <span style={{ fontSize: 10.5, opacity: 0.6 }}>
              {label === 'Installed' ? visibleApps().filter(isInstalled).length : label === 'Available' ? visibleApps().filter((a) => !isInstalled(a)).length : ''}
            </span>
          </div>
        ))}

        <div
          className="menu-item"
          style={{ background: tab === 'updates' ? 'color-mix(in srgb, var(--wm-accent) 40%, transparent)' : undefined }}
          onClick={() => { setTab('updates'); setSelected(null) }}
        >
          <Glyph name="RefreshCw" size={15} />
          <span style={{ flex: 1 }}>Updates</span>
          {updates.length > 0 && (
            <span style={{ background: 'var(--wm-accent)', color: '#14260a', borderRadius: 999, fontSize: 10.5, padding: '0 6px', fontWeight: 700 }}>{updates.length}</span>
          )}
        </div>

        <div
          className="menu-item"
          title={session?.role === 'admin' ? 'Approve a pending published app' : 'Publish an app for approval'}
          onClick={() => (session?.role === 'admin' ? approvePending() : publish())}
        >
          <Glyph name="Upload" size={15} />
          <span style={{ flex: 1 }}>Published</span>
          <span style={{ fontSize: 10.5, opacity: 0.6 }}>
            {published.filter((a) => a.status === 'approved').length}
            {session?.role === 'admin' ? ` · ${published.filter((a) => a.status === 'pending').length} pend` : ''}
          </span>
        </div>

        <div className="menu-sep" />
        <div style={{ fontSize: 10.5, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 9px' }}>Categories</div>
        {CATEGORIES.filter((c) => !['All Applications', 'Favourites'].includes(c)).map((c) => {
          const count = visibleApps().filter((a) => a.categories.includes(c)).length
          return (
            <div
              key={c}
              className="menu-item"
              style={{ background: category === c && tab === 'catalog' ? 'color-mix(in srgb, var(--wm-accent) 40%, transparent)' : undefined }}
              onClick={() => { setCategory(c); setTab('catalog'); setQuery(''); setSelected(null) }}
            >
              <span style={{ flex: 1 }}>{c}</span>
              <span style={{ fontSize: 10.5, opacity: 0.6 }}>{count}</span>
            </div>
          )
        })}
      </div>

      {/* -------------------------------- main -------------------------------- */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="mixt-toolbar">
          {current && (
            <button className="btn-ghost" onClick={() => setSelected(null)}>
              <Glyph name="ArrowLeft" size={15} /> Back
            </button>
          )}
          <input
            className="entry"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(null); setTab('catalog') }}
            placeholder="Search the store…"
            style={{ flex: 1, maxWidth: 380 }}
          />
          <div style={{ flex: 1 }} />
          {!current && tab === 'catalog' && (
            <select className="entry" value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ width: 168 }}>
              <option value="featured">Sort: Featured</option>
              <option value="rating">Sort: Top rated</option>
              <option value="name">Sort: Name</option>
              <option value="size">Sort: Size</option>
            </select>
          )}
          <span style={{ opacity: 0.7, fontSize: 12 }}>{visibleApps().filter(isInstalled).length} installed · {visibleApps().length} in the repository</span>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 14 }}>
          {current ? (
            <DetailPage
              app={current}
              installed={isInstalled(current)}
              installing={installing}
              myRating={myRatings[current.id]}
              onInstall={() => install(current)}
              onRate={(n) => rate(current.id, n)}
              onClear={() => clearRating(current.id)}
              onRemove={() => setConfirmRemove(current.id)}
              onPick={setSelected}
              related={visibleApps().filter((a) => a.id !== current.id && a.categories.some((c) => current.categories.includes(c))).slice(0, 4)}
            />
          ) : tab === 'updates' ? (
            <UpdatesPanel updates={updates} applied={updatesApplied} onUpdate={update} installing={installing} onOpen={setSelected} />
          ) : (
            <>
              {/* storefront home */}
              {!query && category === 'Featured' && featured && (
                <div
                  onClick={() => setSelected(featured.id)}
                  style={{
                    borderRadius: 12,
                    padding: 18,
                    marginBottom: 16,
                    cursor: 'pointer',
                    color: '#fff',
                    backgroundImage: `linear-gradient(120deg, ${featured.color}, ${featured.color2 ?? featured.color})`,
                    display: 'flex',
                    gap: 18,
                    alignItems: 'center',
                  }}
                >
                  <AppIcon glyph={featured.glyph} color="rgba(255,255,255,0.9)" color2="rgba(255,255,255,0.4)" size={64} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, opacity: 0.85 }}>Featured this week</div>
                    <div style={{ fontSize: 22, fontWeight: 700 }}>{featured.name}</div>
                    <div style={{ opacity: 0.92, maxWidth: 520, lineHeight: 1.5, marginTop: 2 }}>{featured.comment}</div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 10, alignItems: 'center', fontSize: 12.5 }}>
                      <Stars value={ratingOf(featured)} size={13} /> {ratingOf(featured).toFixed(1)} · {sizeOf(featured)} · {isInstalled(featured) ? 'Installed' : 'Free'}
                    </div>
                  </div>
                </div>
              )}

              {!query && category === 'Featured' && (
                <>
                  <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.7, margin: '4px 0 8px' }}>Editor’s picks</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(215px,1fr))', gap: 10, marginBottom: 18 }}>
                    {picks.map((app) => (
                      <div key={app.id} onClick={() => setSelected(app.id)} style={{ cursor: 'pointer' }}>
                        <Screenshot app={app} />
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                          <AppIcon glyph={app.glyph} color={app.color} color2={app.color2} size={22} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.name}</div>
                            <div style={{ fontSize: 11, opacity: 0.7 }}><Stars value={ratingOf(app)} size={10} /> {ratingOf(app).toFixed(1)}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.7, margin: '4px 0 8px' }}>
                {query ? `${list.length} results for “${query}”` : category}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(248px,1fr))', gap: 10 }}>
                {list.map((app) => (
                  <div
                    key={app.id}
                    onClick={() => setSelected(app.id)}
                    style={{
                      border: '1px solid rgba(0,0,0,0.16)',
                      borderRadius: 10,
                      padding: 12,
                      cursor: 'pointer',
                      background: 'color-mix(in srgb, var(--wm-window-bg) 95%, #ffffff)',
                      display: 'flex',
                      gap: 10,
                    }}
                  >
                    <AppIcon glyph={app.glyph} color={app.color} color2={app.color2} size={40} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.name}</div>
                      <div style={{ fontSize: 11.5, opacity: 0.72, display: 'flex', gap: 6, alignItems: 'center' }}>
                        <Stars value={ratingOf(app)} size={10} /> {ratingOf(app).toFixed(1)} · {isInstalled(app) ? 'Installed' : sizeOf(app)}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.8, marginTop: 3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {app.comment}
                      </div>
                    </div>
                    {installing?.id === app.id ? (
                      <div style={{ width: 46, fontSize: 11, textAlign: 'right', opacity: 0.8 }}>{Math.round(installing.pct)}%</div>
                    ) : (
                      <button
                        className="btn-ghost"
                        style={{ alignSelf: 'center', padding: '3px 9px', fontSize: 12 }}
                        onClick={(e) => { e.stopPropagation(); isInstalled(app) ? launch(app.id, {}) : install(app) }}
                      >
                        {isInstalled(app) ? 'Open' : 'Install'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {list.length === 0 && <div style={{ opacity: 0.7, padding: 20 }}>Nothing here. The MixtNet is small but tidy.</div>}
            </>
          )}
        </div>
      </div>

      {/* remove confirmation */}
      {confirmRemove && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 180000, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center' }} onClick={() => setConfirmRemove(null)}>
          <div className="wm-window" style={{ position: 'relative', width: 340, padding: 18, background: 'var(--wm-window-bg)', color: 'var(--wm-window-fg)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Remove {getApp(confirmRemove)?.name}?</div>
            <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.5 }}>
              The application will be removed from your Menu. Your files are not touched.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn-ghost" onClick={() => setConfirmRemove(null)}>Cancel</button>
              <button className="btn-mixt" onClick={() => remove(getApp(confirmRemove)!)}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------- detail page ------------------------------- */
function DetailPage({
  app, installed, installing, myRating, onInstall, onRate, onClear, onRemove, onPick, related,
}: {
  app: AppDef
  installed: boolean
  installing: { id: string; pct: number } | null
  myRating?: number
  onInstall: () => void
  onRate: (n: number) => void
  onClear: () => void
  onRemove: () => void
  onPick: (id: string) => void
  related: AppDef[]
}) {
  const [shot, setShot] = useState(0)
  const updatesApplied = useOS((s) => s.updatesApplied)
  const rating = ratingOf(app)
  return (
    <div style={{ maxWidth: 820 }}>
      {/* header */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <AppIcon glyph={app.glyph} color={app.color} color2={app.color2} size={72} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{app.name}</div>
          <div style={{ fontSize: 12.5, opacity: 0.75 }}>{devOf(app)} · {app.categories.join(', ')}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, fontSize: 12.5 }}>
            <Stars value={rating} size={13} />
            <span>{rating.toFixed(1)}</span>
            <span style={{ opacity: 0.6 }}>·</span>
            <span>{sizeOf(app)}</span>
            {installed && <span style={{ color: 'var(--wm-accent)', fontWeight: 600 }}>· Installed</span>}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch' }}>
          {installing?.id === app.id ? (
            <div style={{ width: 190 }}>
              <div style={{ fontSize: 12, marginBottom: 4 }}>Installing… {Math.round(installing.pct)}%</div>
              <div style={{ height: 8, background: 'rgba(128,136,132,0.3)', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{ width: `${installing.pct}%`, height: '100%', background: 'linear-gradient(90deg,#7cc93f,#4c8f1f)' }} />
              </div>
            </div>
          ) : installed ? (
            <>
              <button className="btn-mixt" onClick={() => launch(app.id, {})}>
                <Glyph name="Play" size={14} /> Launch
              </button>
              {app.preinstalled === false && (
                <button className="btn-ghost" onClick={onRemove}>
                  <Glyph name="Trash2" size={14} /> Remove
                </button>
              )}
            </>
          ) : (
            <button className="btn-mixt" onClick={onInstall}>
              <Glyph name="Download" size={14} /> Install
            </button>
          )}
        </div>
      </div>

      {/* screenshots */}
      <div style={{ display: 'flex', gap: 10, marginTop: 18, overflowX: 'auto', paddingBottom: 4 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} onClick={() => setShot(i)} style={{ opacity: shot === i ? 1 : 0.6, cursor: 'pointer', transition: 'opacity 120ms' }}>
            <Screenshot app={app} variant={i} />
          </div>
        ))}
      </div>

      {/* description */}
      <h3 style={{ marginBottom: 4 }}>About</h3>
      <p style={{ opacity: 0.88, lineHeight: 1.65, marginTop: 0 }}>{BLURBS[app.id] ?? app.comment}</p>

      <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', marginTop: 10 }}>
        <div style={{ width: 260 }}>
          <h3 style={{ marginBottom: 0 }}>Ratings</h3>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 30, fontWeight: 300 }}>{rating.toFixed(1)}</span>
            <Stars value={rating} size={14} />
          </div>
          <RatingHistogram value={rating} />
          <div style={{ marginTop: 10, fontSize: 12.5 }}>
            <div style={{ opacity: 0.75, marginBottom: 4 }}>Your rating</div>
            {myRating ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Stars value={myRating} size={16} onRate={onRate} />
                <button className="btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={onClear}>clear</button>
              </div>
            ) : (
              <Stars value={0} size={16} onRate={onRate} />
            )}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 240 }}>
          <h3 style={{ marginBottom: 4 }}>Details</h3>
          <table style={{ width: '100%', fontSize: 12.5 }}>
            <tbody>
              {([
                ['Version', versionLabel(app.id, updatesApplied)],
                ['Updated', 'today'],
                ['Download size', sizeOf(app)],
                ['Developer', devOf(app)],
                ['Package', app.id],
                ['Licence', 'MIT'],
              ] as [string, string][]).map(([k, v]) => (
                <tr key={k}>
                  <td style={{ opacity: 0.65, padding: '3px 12px 3px 0', whiteSpace: 'nowrap' }}>{k}</td>
                  <td style={{ fontFamily: k === 'Package' ? 'var(--font-mono)' : undefined }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {(CHANGELOG[app.id] ?? ['Stability improvements', 'Smaller download']).length > 0 && (
            <>
              <h3 style={{ marginBottom: 4, marginTop: 14 }}>What’s new</h3>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, opacity: 0.88, lineHeight: 1.6 }}>
                {(CHANGELOG[app.id] ?? ['Stability improvements', 'Smaller download']).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      {/* reviews */}
      <h3 style={{ marginBottom: 6, marginTop: 18 }}>Reviews</h3>
      <div style={{ display: 'grid', gap: 8 }}>
        {TESTIMONIALS.slice(0, 3).map(([who, text], i) => (
          <div key={who} style={{ border: '1px solid rgba(0,0,0,0.14)', borderRadius: 8, padding: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
              <strong>{who}</strong>
              <Stars value={Math.max(3, rating - (i === 2 ? 0.7 : 0))} size={11} />
            </div>
            <div style={{ fontSize: 12.5, opacity: 0.85, marginTop: 4, lineHeight: 1.5 }}>“{text}”</div>
          </div>
        ))}
      </div>

      {related.length > 0 && (
        <>
          <h3 style={{ marginBottom: 6, marginTop: 18 }}>Related</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 10 }}>
            {related.map((r) => (
              <div key={r.id} onClick={() => onPick(r.id)} style={{ cursor: 'pointer', display: 'flex', gap: 9, alignItems: 'center', border: '1px solid rgba(0,0,0,0.14)', borderRadius: 9, padding: 9 }}>
                <AppIcon glyph={r.glyph} color={r.color} color2={r.color2} size={30} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                  <div style={{ fontSize: 11, opacity: 0.7 }}><Stars value={ratingOf(r)} size={10} /> {ratingOf(r).toFixed(1)}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function UpdatesPanel({
  updates, applied, onUpdate, installing, onOpen,
}: {
  updates: AppDef[]
  applied: Record<string, string>
  onUpdate: (app: AppDef) => void
  installing: { id: string; pct: number } | null
  onOpen: (id: string) => void
}) {
  return (
    <div style={{ maxWidth: 680 }}>
      <h2 style={{ marginTop: 0 }}>Updates</h2>
      {updates.length === 0 ? (
        <p style={{ opacity: 0.8, lineHeight: 1.6 }}>
          Your system is up to date. Every installed package is at the newest version the Mixt repository has.
        </p>
      ) : (
        <p style={{ opacity: 0.8, lineHeight: 1.6 }}>
          {updates.length} installed package{updates.length === 1 ? ' has' : 's have'} a newer version in the Mixt
          repository. Optional extras you have not installed are listed in the catalogue, not here.
        </p>
      )}
      {updates.map((app) => (
        <div key={app.id} style={{ display: 'flex', gap: 12, alignItems: 'center', borderBottom: '1px solid rgba(0,0,0,0.12)', padding: '10px 0' }}>
          <AppIcon glyph={app.glyph} color={app.color} color2={app.color2} size={36} />
          <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => onOpen(app.id)}>
            <div style={{ fontWeight: 600 }}>{app.name}</div>
            <div style={{ fontSize: 12.5, opacity: 0.75, fontFamily: 'var(--font-mono)' }}>
              {installedVersion(app.id, applied)} → {repoVersion(app.id)}
            </div>
            {installing?.id === app.id && (
              <div style={{ height: 6, background: 'rgba(128,136,132,0.3)', borderRadius: 999, marginTop: 6, overflow: 'hidden' }}>
                <div style={{ width: `${installing.pct}%`, height: '100%', background: 'var(--wm-accent)' }} />
              </div>
            )}
          </div>
          <button className="btn-mixt" disabled={installing?.id === app.id} onClick={() => onUpdate(app)}>
            {installing?.id === app.id ? 'Updating…' : 'Update'}
          </button>
        </div>
      ))}
    </div>
  )
}