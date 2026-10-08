import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useOS } from '../os/store'
import { vfs, baseName, join } from '../os/vfs'
import { AppIcon, Glyph } from '../shell/AppIcon'
import { Popup, type MenuItem } from '../shell/ContextMenu'
import { HOME_URL, SITES, findSite, resolveUrl, searchMintNet, fetchAsText } from '../net'
import { FILES } from '../net/downloads'
import { loadBookmarks, loadHistory, pushHistory, saveBookmarks, clearHistory, type Bookmark } from '../net/storage'
import type { PageCtx, ResolvedUrl, SiteDef } from '../net/types'
import type { AppProps } from '../os/types'

interface Tab {
  id: string
  url: string
  title: string
  history: string[]
  idx: number
  zoom: number
  loading: boolean
  favicon?: { glyph: string; color: string }
}

interface Dl {
  id: string
  filename: string
  url: string
  received: number
  total: number
  done: boolean
  started: number
}

let tabSeq = 0
const newTabId = () => `tab${++tabSeq}`

export default function BrowserApp({ win, api }: AppProps) {
  const notify = useOS((s) => s.notify)
  const setClipboard = useOS((s) => s.setClipboard)

  const [tabs, setTabs] = useState<Tab[]>(() => [
    {
      id: newTabId(),
      url: win.props?.url ?? HOME_URL,
      title: 'New tab',
      history: [win.props?.url ?? HOME_URL],
      idx: 0,
      zoom: 1,
      loading: false,
    },
  ])
  const [activeId, setActiveId] = useState(() => tabs[0].id)
  const [urlText, setUrlText] = useState(win.props?.url ?? HOME_URL)
  const [urlFocus, setUrlFocus] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; kind: string } | null>(null)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => loadBookmarks())
  const [downloads, setDownloads] = useState<Dl[]>([])
  const [showDownloads, setShowDownloads] = useState(false)
  const [status, setStatus] = useState('')
  const [historyTick, setHistoryTick] = useState(0)
  const [pageMenu, setPageMenu] = useState<{ x: number; y: number; url?: string; text?: string } | null>(null)
  const urlRef = useRef<HTMLInputElement>(null)

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]
  const resolved = useMemo(() => resolveUrl(active.url), [active.url])
  const site = resolved.kind === 'site' ? findSite(resolved.domain) : undefined

  /* keep window title + url bar in sync */
  useEffect(() => {
    const label = active.title === 'New tab' ? 'New Tab' : active.title
    api.setTitle(`${label} — Web Browser`)
    setUrlText(active.url.startsWith('mintnet://') ? '' : active.url)
  }, [active.url, active.title])

  useEffect(() => {
    if (win.props?.url && win.props.url !== active.url) navigate(win.props.url, { newTab: false })
  }, [win.props?.url])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const focused = useOS.getState().activeId === win.id
      if (!focused) return
      if (e.ctrlKey && e.key.toLowerCase() === 't') {
        e.preventDefault()
        addTab(HOME_URL)
      } else if (e.ctrlKey && e.key.toLowerCase() === 'w') {
        e.preventDefault()
        closeTab(active.id)
      } else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        urlRef.current?.focus()
        urlRef.current?.select()
      } else if (e.altKey && e.key === 'ArrowLeft') {
        goBack()
      } else if (e.altKey && e.key === 'ArrowRight') {
        goForward()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ------------------------------ tab helpers ------------------------------ */
  function patchTab(id: string, patch: Partial<Tab>) {
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }

  function addTab(url = HOME_URL) {
    const tab: Tab = { id: newTabId(), url, title: 'New tab', history: [url], idx: 0, zoom: 1, loading: true }
    setTabs((ts) => [...ts, tab])
    setActiveId(tab.id)
    finishLoad(tab.id, url)
  }

  function closeTab(id: string) {
    setTabs((ts) => {
      const remaining = ts.filter((t) => t.id !== id)
      if (!remaining.length) {
        api.close()
        return ts
      }
      if (id === activeId) setActiveId(remaining[remaining.length - 1].id)
      return remaining
    })
  }

  function navigate(url: string, opts: { newTab?: boolean; replace?: boolean } = {}) {
    const target = resolveUrl(url)

    // downloads: a url whose last segment is a known file
    const last = target.path.split('/').filter(Boolean).pop() ?? ''
    const file = FILES.find((f) => f.filename === last)
    if (file) {
      startDownload(file.id, url)
      return
    }

    if (opts.newTab) {
      addTab(target.href)
      return
    }

    const tabId = active.id
    patchTab(tabId, { loading: true, url: target.href })
    setTabs((ts) =>
      ts.map((t) => {
        if (t.id !== tabId) return t
        const history = opts.replace ? [...t.history.slice(0, t.idx + 1)] : [...t.history.slice(0, t.idx + 1), target.href]
        return { ...t, url: target.href, history, idx: history.length - 1, loading: true }
      }),
    )
    finishLoad(tabId, target.href)
  }

  function finishLoad(tabId: string, url: string) {
    const r = resolveUrl(url)
    const s = r.kind === 'site' ? findSite(r.domain) : undefined
    let title = 'New tab'
    let favicon: Tab['favicon'] = undefined
    if (s) {
      const page = matchPage(s, r.path)
      title = page ? page.title : `Page not found — ${s.title}`
      favicon = { glyph: s.glyph, color: s.color }
    } else if (r.kind === 'search') {
      title = `${r.searchQuery} — MintNet search`
      favicon = { glyph: 'Search', color: '#61ad2b' }
    } else if (r.kind === 'about') {
      title = `about:${r.aboutPage}`
      favicon = { glyph: 'Info', color: '#7d8a95' }
    } else if (r.kind === 'real') {
      title = `${r.domain} (real website)`
      favicon = { glyph: 'Globe', color: '#4a7fe8' }
    }
    setTimeout(() => {
      patchTab(tabId, { loading: false, title, favicon })
      setStatus(`Loaded ${r.href}`)
      setTimeout(() => setStatus(''), 2600)
      pushHistory({ url: r.href, title, time: Date.now() })
      setHistoryTick((t) => t + 1)
    }, 260 + Math.random() * 320)
  }

  function goBack() {
    if (active.idx > 0) {
      const idx = active.idx - 1
      patchTab(active.id, { idx, url: active.history[idx] })
      finishLoad(active.id, active.history[idx])
    }
  }
  function goForward() {
    if (active.idx < active.history.length - 1) {
      const idx = active.idx + 1
      patchTab(active.id, { idx, url: active.history[idx] })
      finishLoad(active.id, active.history[idx])
    }
  }
  function reload() {
    patchTab(active.id, { loading: true })
    setStatus('Reloading…')
    finishLoad(active.id, active.url)
  }

  /* ------------------------------- downloads ------------------------------- */
  function startDownload(fileId: string, url: string) {
    const file = FILES.find((f) => f.id === fileId)
    if (!file) return
    const id = `dl${Date.now()}`
    setDownloads((d) => [...d, { id, filename: file.filename, url, received: 0, total: file.size, done: false, started: Date.now() }])
    setShowDownloads(true)
    setStatus(`Downloading ${file.filename}…`)

    const step = () => {
      setDownloads((list) =>
        list.map((d) => {
          if (d.id !== id) return d
          const speed = file.size / 26 // reaches 100% in about 1.6s of ticks
          const received = Math.min(file.size, d.received + speed * (0.6 + Math.random() * 0.8))
          if (received >= file.size) {
            if (!d.done) {
              const target = join('/home/mint/Downloads', file.filename)
              vfs.write(target, file.url ? '' : file.content, file.mime, file.url)
              notify({
                title: 'Download complete',
                body: `${file.filename}\nSaved to ~/Downloads`,
                appId: 'browser',
              })
              setStatus(`${file.filename} saved to ~/Downloads`)
            }
            return { ...d, received: file.size, done: true }
          }
          return { ...d, received }
        }),
      )
    }
    const timer = setInterval(() => {
      step()
      setDownloads((list) => {
        if (list.find((d) => d.id === id)?.done) {
          clearInterval(timer)
        }
        return list
      })
    }, 90)
  }

  /* ------------------------------ bookmarks -------------------------------- */
  function toggleBookmark() {
    const existing = bookmarks.find((b) => b.url === active.url)
    const next = existing
      ? bookmarks.filter((b) => b.url !== active.url)
      : [...bookmarks, { url: active.url, title: active.title, added: Date.now() }]
    setBookmarks(next)
    saveBookmarks(next)
    setStatus(existing ? 'Bookmark removed' : 'Bookmark added')
  }

  function suggestions() {
    const q = urlText.trim().toLowerCase()
    if (!q) return []
    const items: { label: string; sub: string; action: () => void; glyph: string }[] = []
    if (!/^https?:|^about:|^mintnet:/.test(urlText) && urlText.includes('.')) {
      items.push({ label: urlText, sub: 'Open this address', glyph: 'Globe', action: () => navigate(urlText) })
    }
    items.push({ label: urlText, sub: 'Search MintNet for this', glyph: 'Search', action: () => navigate(`mintnet://search?q=${encodeURIComponent(urlText)}`) })
    for (const b of bookmarks.filter((b) => (b.title + b.url).toLowerCase().includes(q)).slice(0, 4)) {
      items.push({ label: b.title, sub: b.url, glyph: 'Star', action: () => navigate(b.url) })
    }
    for (const h of loadHistory().filter((h) => (h.title + h.url).toLowerCase().includes(q)).slice(0, 5)) {
      items.push({ label: h.title, sub: h.url, glyph: 'Clock', action: () => navigate(h.url) })
    }
    for (const s of SITES.filter((s) => (s.title + s.domain).toLowerCase().includes(q)).slice(0, 4)) {
      items.push({ label: s.title, sub: `https://${s.domain}/`, glyph: s.glyph, action: () => navigate(`https://${s.domain}/`) })
    }
    return items.slice(0, 9)
  }

  const isBookmarked = bookmarks.some((b) => b.url === active.url)
  const activeDownload = downloads.find((d) => !d.done)
  const pageCtx: PageCtx = {
    path: resolved.path,
    query: resolved.query,
    url: active.url,
    tabId: active.id,
    navigate: (u) => navigate(u),
    openTab: (u) => navigate(u, { newTab: true }),
  }

  /* ------------------------------- rendering ------------------------------- */
  function renderPage() {
    if (active.loading) {
      return <LoadingPage site={site} />
    }
    switch (resolved.kind) {
      case 'site': {
        if (!site) return <ErrorPage msg="Site not found" />
        const page = matchPage(site, resolved.path)
        if (!page) {
          const NotFound = React.lazy ? null : null
          return pageNotFound(site, pageCtx, navigate)
        }
        return page.render(pageCtx)
      }
      case 'search':
        return (
          <SearchResults
            query={resolved.searchQuery ?? ''}
            ctx={pageCtx}
            navigate={navigate}
          />
        )
      case 'about':
        return renderAbout(resolved.aboutPage ?? 'home', navigate, bookmarks, downloads, historyTick)
      case 'real':
        return <RealWebPage url={active.url} ctx={pageCtx} navigate={navigate} />
      default:
        return <ErrorPage msg="Invalid address" />
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: '#e9ece7' }}>
      {/* tabs */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, padding: '4px 6px 0', background: 'linear-gradient(to bottom,#3d4247,#31363a)' }}>
        {tabs.map((t) => (
          <div
            key={t.id}
            onClick={() => {
              setActiveId(t.id)
              setUrlText(t.url)
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 9px',
              minWidth: 120,
              maxWidth: 210,
              borderTopLeftRadius: 7,
              borderTopRightRadius: 7,
              background: t.id === activeId ? '#e9ece7' : 'rgba(255,255,255,0.12)',
              color: t.id === activeId ? '#22282c' : '#e6eae6',
              cursor: 'pointer',
              fontSize: 12.5,
            }}
          >
            <AppIcon glyph={t.favicon?.glyph ?? 'Globe'} color={t.favicon?.color ?? '#7d8a95'} size={15} rounded={0.32} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.loading ? 'Loading…' : t.title}
            </span>
            <span
              onClick={(e) => {
                e.stopPropagation()
                closeTab(t.id)
              }}
              style={{ opacity: 0.65 }}
            >
              <Glyph name="X" size={12} />
            </span>
          </div>
        ))}
        <button className="btn-ghost" style={{ color: '#e9ece7' }} title="New tab (Ctrl+T)" onClick={() => addTab()}>
          <Glyph name="Plus" size={15} />
        </button>
      </div>

      {/* toolbar */}
      <div className="mint-toolbar" style={{ gap: 3 }}>
        <button className="btn-ghost" title="Back" onClick={goBack} style={{ opacity: active.idx > 0 ? 1 : 0.4 }}>
          <Glyph name="ChevronLeft" size={17} />
        </button>
        <button className="btn-ghost" title="Forward" onClick={goForward} style={{ opacity: active.idx < active.history.length - 1 ? 1 : 0.4 }}>
          <Glyph name="ChevronRight" size={17} />
        </button>
        <button className="btn-ghost" title="Reload" onClick={reload}>
          <Glyph name="RefreshCw" size={14} />
        </button>
        <button className="btn-ghost" title="Home" onClick={() => navigate(HOME_URL)}>
          <Glyph name="Home" size={15} />
        </button>

        <div style={{ flex: 1, position: 'relative', minWidth: 0, margin: '0 4px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'var(--wm-entry-bg)',
              border: '1px solid rgba(0,0,0,0.25)',
              borderRadius: 5,
              padding: '3px 8px',
            }}
          >
            <Glyph name={resolved.kind === 'real' ? 'Globe' : 'Lock'} size={13} />
            <input
              ref={urlRef}
              value={urlText}
              onChange={(e) => setUrlText(e.target.value)}
              onFocus={(e) => {
                setUrlFocus(true)
                e.target.select()
              }}
              onBlur={() => setTimeout(() => setUrlFocus(false), 160)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  navigate(urlText)
                  urlRef.current?.blur()
                }
                if (e.key === 'Escape') {
                  setUrlText(active.url)
                  urlRef.current?.blur()
                }
              }}
              placeholder="Search MintNet or enter an address"
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'inherit', font: 'inherit', minWidth: 0 }}
            />
            <span
              title={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
              onClick={toggleBookmark}
              style={{ color: isBookmarked ? '#d8a13a' : undefined, cursor: 'pointer' }}
            >
              <Glyph name="Star" size={14} />
            </span>
          </div>

          {urlFocus && urlText.trim() !== '' && (
            <div className="menu-popup anim-pop" style={{ position: 'absolute', top: 32, left: 0, right: 0, zIndex: 60 }}>
              {suggestions().map((s, i) => (
                <div
                  key={i}
                  className="menu-item"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    s.action()
                    urlRef.current?.blur()
                  }}
                >
                  <Glyph name={s.glyph} size={14} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
                  <span style={{ opacity: 0.55, fontSize: 11, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.sub}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <button className="btn-ghost" title="Downloads" onClick={() => setShowDownloads((v) => !v)} data-active={showDownloads}>
          <Glyph name="Download" size={15} />
          {downloads.length > 0 && (
            <span style={{ background: 'var(--wm-accent)', color: '#14260a', borderRadius: 999, fontSize: 10.5, padding: '0 5px', fontWeight: 700 }}>
              {downloads.length}
            </span>
          )}
        </button>
        <button className="btn-ghost" title="Menu" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY, kind: 'main' })}>
          <Glyph name="MoreVertical" size={15} />
        </button>
      </div>

      {/* download shelf */}
      {showDownloads && (
        <div style={{ background: '#f6f8f4', borderBottom: '1px solid rgba(0,0,0,0.18)', padding: '6px 10px', maxHeight: 150, overflow: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
            <strong style={{ fontSize: 12.5, flex: 1 }}>Downloads</strong>
            <button className="btn-ghost" onClick={() => setShowDownloads(false)}>
              <Glyph name="X" size={13} />
            </button>
          </div>
          {downloads.length === 0 && <div style={{ color: '#6a736d', fontSize: 12.5 }}>No downloads yet. Try linuxmint.com.</div>}
          {downloads.map((d) => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 12.5 }}>
              <Glyph name="File" size={14} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.filename}</span>
              <span style={{ width: 160, height: 6, background: '#dfe3dd', borderRadius: 999, overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${(d.received / d.total) * 100}%`, background: 'linear-gradient(90deg,#7cc93f,#4c8f1f)' }} />
              </span>
              <span style={{ width: 64, textAlign: 'right', color: '#5c665f' }}>
                {d.done ? 'done' : `${Math.round((d.received / d.total) * 100)}%`}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* page */}
      <div
        className="webdoc"
        style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#ffffff' }}
        onContextMenu={(e) => {
          const target = e.target as HTMLElement
          const anchor = target.closest('a') as HTMLAnchorElement | null
          e.preventDefault()
          setPageMenu({ x: e.clientX, y: e.clientY, url: anchor?.getAttribute('data-href') ?? undefined, text: window.getSelection()?.toString() })
        }}
      >
        <div style={{ zoom: active.zoom } as any}>{renderPage()}</div>
      </div>

      {/* status bar */}
      <div style={{ flex: 'none', height: 22, display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px', fontSize: 11.5, background: 'linear-gradient(to bottom,#f2f3f1,#e6e8e4)', borderTop: '1px solid rgba(0,0,0,0.15)', color: '#37402c' }}>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {status || (active.loading ? 'Contacting MintNet…' : `${resolved.href}`)}
        </span>
        {activeDownload && <span>Downloading {activeDownload.filename}…</span>}
        <span>zoom {(active.zoom * 100).toFixed(0)}%</span>
      </div>

      {/* menus */}
      {menu?.kind === 'main' && (
        <Popup
          x={menu.x}
          y={menu.y - 320}
          align="right"
          onClose={() => setMenu(null)}
          items={[
            { label: 'New tab', accel: 'Ctrl+T', icon: <Glyph name="Plus" size={14} />, onClick: () => addTab() },
            { label: 'New window', icon: <Glyph name="AppWindow" size={14} />, onClick: () => window.dispatchEvent(new CustomEvent('webmpl:launch', { detail: { appId: 'browser', props: { url: HOME_URL } } })) },
            { separator: true },
            { label: 'Bookmark this page', icon: <Glyph name="Star" size={14} />, onClick: toggleBookmark },
            { label: 'Show bookmarks', icon: <Glyph name="List" size={14} />, onClick: () => setMenu({ ...menu, kind: 'bookmarks' }) },
            { label: 'Show history', icon: <Glyph name="Clock" size={14} />, onClick: () => setMenu({ ...menu, kind: 'history' }) },
            { label: 'Downloads', icon: <Glyph name="Download" size={14} />, onClick: () => setShowDownloads(true) },
            { separator: true },
            {
              label: 'View page source',
              icon: <Glyph name="Code" size={14} />,
              onClick: async () => {
                const text = await fetchAsText(active.url)
                vfs.write(join('/home/mint/Documents', `source-${Date.now().toString().slice(-6)}.txt`), text)
                notify({ title: 'View source', body: 'A text rendering was saved to ~/Documents.', appId: 'browser' })
              },
            },
            {
              label: 'Zoom in',
              onClick: () => patchTab(active.id, { zoom: Math.min(2, +(active.zoom + 0.1).toFixed(2)) }),
            },
            {
              label: 'Zoom out',
              onClick: () => patchTab(active.id, { zoom: Math.max(0.6, +(active.zoom - 0.1).toFixed(2)) }),
            },
            { label: 'Reset zoom', onClick: () => patchTab(active.id, { zoom: 1 }) },
            { separator: true },
            {
              label: 'Copy page address',
              icon: <Glyph name="Link" size={14} />,
              onClick: () => setClipboard(active.url, 'browser'),
            },
            {
              label: 'Clear browsing history',
              icon: <Glyph name="Trash2" size={14} />,
              onClick: () => {
                clearHistory()
                setHistoryTick((t) => t + 1)
                setStatus('Browsing history cleared')
              },
            },
          ]}
        />
      )}
      {menu?.kind === 'bookmarks' && <BookmarkPopup x={menu.x} y={menu.y} bookmarks={bookmarks} onPick={(u) => navigate(u)} onClose={() => setMenu(null)} />}
      {menu?.kind === 'history' && <HistoryPopup x={menu.x} y={menu.y} tick={historyTick} onPick={(u) => navigate(u)} onClose={() => setMenu(null)} />}

      {pageMenu && (
        <PageContextMenu
          state={pageMenu}
          onClose={() => setPageMenu(null)}
          actions={{
            back: goBack,
            forward: goForward,
            reload,
            openInNewTab: (u: string) => navigate(u, { newTab: true }),
            bookmark: (u: string, title?: string) => {
              const next = [...bookmarks.filter((b) => b.url !== u), { url: u, title: title ?? u, added: Date.now() }]
              setBookmarks(next)
              saveBookmarks(next)
              setStatus('Bookmark added')
            },
            copy: (t: string) => setClipboard(t, 'browser'),
          }}
        />
      )}
    </div>
  )
}

/* ==========================================================================
   helper views
   ========================================================================== */

function matchPage(site: SiteDef, path: string) {
  const norm = path.replace(/\/+$/, '') || '/'
  return (
    site.pages.find((p) => p.path.replace(/\/+$/, '') === norm) ??
    site.pages.find((p) => p.path !== '/' && norm.startsWith(p.path.replace(/\/+$/, '') + '/')) ??
    site.pages.find((p) => p.path === '/' && norm === '/')
  )
}

function pageNotFound(site: SiteDef, ctx: PageCtx, navigate: (u: string) => void) {
  return (
    <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 40, textAlign: 'center' }}>
      <div>
        <div style={{ fontSize: 58, fontWeight: 800, color: site.color }}>404</div>
        <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>We could not find that page on {site.domain}</div>
        <p style={{ color: '#5c665f', maxWidth: 460, margin: '10px auto' }}>
          The MintNet could not resolve {ctx.path} on this site. It may have been moved, or it may never have existed,
          which is arguably worse.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button className="btn-mint" onClick={() => navigate(`https://${site.domain}/`)}>
            Back to {site.title}
          </button>
          <button className="btn-ghost" onClick={() => navigate('https://mintnet.com/')}>
            Search MintNet
          </button>
        </div>
      </div>
    </div>
  )
}

function LoadingPage({ site }: { site?: SiteDef }) {
  return (
    <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 60, color: '#6a736d' }}>
      <div style={{ textAlign: 'center' }}>
        <div className="spin" style={{ display: 'inline-block', marginBottom: 10 }}>
          {site ? (
            <AppIcon glyph={site.glyph} color={site.color} color2={site.color2} size={44} />
          ) : (
            <AppIcon glyph="Globe" color="#4a7fe8" size={44} />
          )}
        </div>
        <div>Contacting {site?.domain ?? 'MintNet'}…</div>
      </div>
    </div>
  )
}

function ErrorPage({ msg }: { msg: string }) {
  return (
    <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 40 }}>
      <div style={{ textAlign: 'center', color: '#5c665f' }}>
        <div style={{ fontSize: 22, fontWeight: 600, color: '#b8532f' }}>{msg}</div>
        <p>The address could not be understood. Try “mintnet.com” or a search phrase.</p>
      </div>
    </div>
  )
}

function SearchResults({ query, ctx, navigate }: { query: string; ctx: PageCtx; navigate: (u: string) => void }) {
  const [q, setQ] = React.useState(query)
  const [start] = React.useState(() => Date.now())
  const results = useMemo(() => searchMintNet(query), [query])
  const elapsed = (Date.now() - start) / 1000

  return (
    <div style={{ minHeight: '100%', background: '#fff' }}>
      <div style={{ borderBottom: '1px solid #e3e6e1', padding: '14px 22px', display: 'flex', gap: 14, alignItems: 'center' }}>
        <a onClick={() => navigate('https://mintnet.com/')} style={{ fontSize: 20, fontWeight: 800, color: '#3b6f18', cursor: 'pointer' }}>
          mintnet
        </a>
        <input
          className="entry"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && navigate(`mintnet://search?q=${encodeURIComponent(q)}`)}
          style={{ width: 420 }}
        />
        <button className="btn-mint" onClick={() => navigate(`mintnet://search?q=${encodeURIComponent(q)}`)}>
          Search
        </button>
      </div>
      <div style={{ padding: '16px 22px', maxWidth: 820 }}>
        <div style={{ color: '#77807a', fontSize: 12.5, marginBottom: 14 }}>
          About {results.length} results ({(elapsed + 0.04).toFixed(2)} seconds) for “{query}”
        </div>
        {results.length === 0 && (
          <div>
            <p style={{ fontSize: 15 }}>
              Your search did not match any documents on the MintNet.
            </p>
            <ul style={{ color: '#39413b', lineHeight: 1.8 }}>
              <li>Check your spelling.</li>
              <li>Try a broader term, such as “linux” or “browser”.</li>
              <li>Browse the directory at <a onClick={() => navigate('https://mintnet.com/')}>mintnet.com</a>.</li>
            </ul>
          </div>
        )}
        {results.map((r) => (
          <div key={r.url} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12.5, color: '#4c8f1f' }}>{r.site} · {r.url.replace(/^https?:\/\//, '')}</div>
            <a onClick={() => navigate(r.url)} style={{ fontSize: 17.5, cursor: 'pointer' }}>
              {r.title}
            </a>
            <div style={{ color: '#4a524d', marginTop: 3, lineHeight: 1.55 }}>{r.snippet}</div>
          </div>
        ))}
        {results.length > 0 && (
          <div style={{ marginTop: 26, color: '#77807a', fontSize: 12.5 }}>
            Results {results.length} · the MintNet index is small and proud of it.
          </div>
        )}
      </div>
    </div>
  )
}

function RealWebPage({ url, ctx, navigate }: { url: string; ctx: PageCtx; navigate: (u: string) => void }) {
  const [mode, setMode] = useState<'embed' | 'blocked'>('embed')
  const [attempts, setAttempts] = useState(0)
  const host = (() => {
    try {
      return new URL(url).host
    } catch {
      return url
    }
  })()

  useEffect(() => {
    // If the frame never fires load within a few seconds, assume the site
    // refused to be embedded (X-Frame-Options / frame-ancestors).
    const t = setTimeout(() => setMode('blocked'), 3800)
    return () => clearTimeout(t)
  }, [url, attempts])

  return (
    <div style={{ minHeight: '100%', background: '#f6f8f4' }}>
      <div style={{ background: '#fff8e6', borderBottom: '1px solid #f0dcae', padding: '8px 16px', fontSize: 12.5, color: '#5c5241', display: 'flex', gap: 10, alignItems: 'center' }}>
        <Glyph name="Globe" size={14} />
        <span style={{ flex: 1 }}>
          You have left the MintNet. <strong>{host}</strong> is a real website, loaded (if it allows it) in an embedded frame —
          a real internet inside the pretend internet.
        </span>
        <button className="btn-ghost" onClick={() => setAttempts((a) => a + 1)}>
          Retry
        </button>
        <button className="btn-ghost" onClick={() => navigate('https://mintnet.com/')}>
          Back to MintNet
        </button>
      </div>
      {mode === 'embed' ? (
        <iframe
          key={attempts}
          src={url}
          title={host}
          onLoad={() => setMode('embed')}
          style={{ width: '100%', height: 'calc(100vh - 220px)', border: 0, background: '#fff' }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      ) : (
        <div style={{ padding: 40, textAlign: 'center', color: '#4a524d' }}>
          <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>{host} refused to be embedded</div>
          <p style={{ maxWidth: 560, margin: '0 auto 16px' }}>
            Most large websites send <code>X-Frame-Options</code> or a <code>frame-ancestors</code> policy that forbids
            other pages from displaying them. That is exactly the sort of thing an operating system should respect.
          </p>
          <p style={{ maxWidth: 560, margin: '0 auto 18px', fontSize: 13 }}>
            If you are viewing this page outside the sandbox with a network connection, opening{' '}
            <a href={url} target="_blank" rel="noreferrer" style={{ color: '#1b6ac9' }}>
              {url}
            </a>{' '}
            in a new tab usually works.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="btn-mint" onClick={() => navigate('https://mintnet.com/')}>
              Search the MintNet instead
            </button>
            <button className="btn-ghost" onClick={() => setAttempts((a) => a + 1)}>
              Try embedding again
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function renderAbout(
  page: string,
  navigate: (u: string) => void,
  bookmarks: Bookmark[],
  downloads: any[],
  tick: number,
) {
  if (page === 'blank') return <div style={{ minHeight: '100%', background: '#fff' }} />
  if (page === 'downloads') {
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ marginTop: 0 }}>Downloads</h2>
        {downloads.length === 0 ? (
          <p>Nothing downloaded yet in this window.</p>
        ) : (
          downloads.map((d) => (
            <div key={d.id} style={{ padding: '6px 0', borderBottom: '1px solid #eef0ec' }}>
              {d.filename} — {d.done ? 'complete' : `${Math.round((d.received / d.total) * 100)}%`}
            </div>
          ))
        )}
        <p style={{ color: '#77807a', fontSize: 12.5 }}>Files are saved into ~/Downloads in your virtual filesystem.</p>
      </div>
    )
  }
  if (page === 'bookmarks') {
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ marginTop: 0 }}>Bookmarks</h2>
        {bookmarks.map((b) => (
          <div key={b.url} style={{ padding: '6px 0' }}>
            <a onClick={() => navigate(b.url)}>{b.title}</a> <span style={{ color: '#77807a', fontSize: 12 }}>{b.url}</span>
          </div>
        ))}
      </div>
    )
  }
  if (page === 'history') {
    const history = loadHistory()
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ marginTop: 0 }}>History</h2>
        {history.length === 0 && <p>No history yet.</p>}
        {history.slice(0, 60).map((h, i) => (
          <div key={i} style={{ padding: '4px 0', display: 'flex', gap: 10 }}>
            <span style={{ color: '#77807a', fontSize: 12, width: 130 }}>{new Date(h.time).toLocaleString()}</span>
            <a onClick={() => navigate(h.url)}>{h.title}</a>
          </div>
        ))}
      </div>
    )
  }
  if (page === 'version') {
    return (
      <div style={{ padding: 24, fontFamily: 'var(--font-mono)' }}>
        <h2 style={{ marginTop: 0, fontFamily: 'var(--font-sans)' }}>About MintNet Explorer</h2>
        <pre>{`MintNet Explorer 1.0.0
Engine: React 18 virtual DOM
Layout: CSS
JavaScript: your browser's engine
Sites: ${SITES.length} registered MintNet properties
Real web: embedded frames where permitted`}</pre>
      </div>
    )
  }
  // about:home — the new tab page
  const history = loadHistory().slice(0, 6)
  return (
    <div style={{ minHeight: '100%', background: 'linear-gradient(160deg,#f7faf4,#eef3e3)', padding: '46px 22px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 26 }}>
          <AppIcon glyph="Compass" color="#61ad2b" color2="#2f6b12" size={54} />
          <div style={{ fontSize: 30, fontWeight: 800, color: '#3b6f18', marginTop: 10 }}>MintNet Explorer</div>
          <div style={{ color: '#5c665f' }}>Type an address or search the MintNet</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 12, marginBottom: 26 }}>
          {SITES.map((s) => (
            <div
              key={s.domain}
              onClick={() => navigate(`https://${s.domain}/`)}
              style={{ background: '#fff', border: '1px solid #e3e6e1', borderRadius: 10, padding: 12, cursor: 'pointer', textAlign: 'center' }}
            >
              <AppIcon glyph={s.glyph} color={s.color} color2={s.color2} size={34} />
              <div style={{ fontWeight: 600, marginTop: 8, fontSize: 13.5 }}>{s.title}</div>
              <div style={{ fontSize: 11.5, color: '#77807a' }}>{s.domain}</div>
            </div>
          ))}
        </div>
        {bookmarks.length > 0 && (
          <>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Bookmarks</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
              {bookmarks.map((b) => (
                <span key={b.url} onClick={() => navigate(b.url)} style={{ background: '#fff', border: '1px solid #e3e6e1', borderRadius: 999, padding: '4px 12px', cursor: 'pointer', fontSize: 12.5 }}>
                  {b.title}
                </span>
              ))}
            </div>
          </>
        )}
        {history.length > 0 && (
          <>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Recently visited</div>
            {history.map((h, i) => (
              <div key={i} onClick={() => navigate(h.url)} style={{ cursor: 'pointer', padding: '4px 0', fontSize: 13 }}>
                {h.title} <span style={{ color: '#8a938d', fontSize: 11.5 }}>{h.url}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function BookmarkPopup({ x, y, bookmarks, onPick, onClose }: { x: number; y: number; bookmarks: Bookmark[]; onPick: (u: string) => void; onClose: () => void }) {
  const items: MenuItem[] = bookmarks.length
    ? bookmarks.map((b) => ({ label: b.title, icon: <Glyph name="Star" size={13} />, onClick: () => onPick(b.url) }))
    : [{ label: 'No bookmarks yet', disabled: true }]
  return <Popup x={x} y={y - 260} align="right" items={items} onClose={onClose} minWidth={260} />
}

function HistoryPopup({ x, y, tick, onPick, onClose }: { x: number; y: number; tick: number; onPick: (u: string) => void; onClose: () => void }) {
  const history = useMemo(() => loadHistory().slice(0, 14), [tick])
  const items: MenuItem[] = history.length
    ? history.map((h) => ({ label: h.title, accel: new Date(h.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), onClick: () => onPick(h.url) }))
    : [{ label: 'No history yet', disabled: true }]
  return <Popup x={x} y={y - 320} align="right" items={items} onClose={onClose} minWidth={280} />
}

function PageContextMenu({
  state,
  onClose,
  actions,
}: {
  state: { x: number; y: number; url?: string; text?: string }
  onClose: () => void
  actions: {
    back: () => void
    forward: () => void
    reload: () => void
    openInNewTab: (u: string) => void
    bookmark: (u: string, title?: string) => void
    copy: (t: string) => void
  }
}) {
  const items: MenuItem[] = state.url
    ? [
        { label: 'Open link in new tab', icon: <Glyph name="Plus" size={13} />, onClick: () => actions.openInNewTab(state.url!) },
        { label: 'Bookmark this link', icon: <Glyph name="Star" size={13} />, onClick: () => actions.bookmark(state.url!) },
        { label: 'Copy link address', icon: <Glyph name="Link" size={13} />, onClick: () => actions.copy(state.url!) },
        { separator: true },
        { label: 'Back', icon: <Glyph name="ChevronLeft" size={13} />, onClick: actions.back },
        { label: 'Reload', icon: <Glyph name="RefreshCw" size={13} />, onClick: actions.reload },
      ]
    : [
        ...(state.text ? [{ label: `Copy “${state.text.slice(0, 22)}…”`, icon: <Glyph name="Copy" size={13} />, onClick: () => actions.copy(state.text!) }, { separator: true }] : []),
        { label: 'Back', icon: <Glyph name="ChevronLeft" size={13} />, onClick: actions.back },
        { label: 'Forward', icon: <Glyph name="ChevronRight" size={13} />, onClick: actions.forward },
        { label: 'Reload', icon: <Glyph name="RefreshCw" size={13} />, onClick: actions.reload },
      ]
  return <Popup x={state.x} y={state.y} items={items} onClose={onClose} />
}
