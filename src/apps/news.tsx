import React, { useEffect, useMemo, useState } from 'react'
import { useOS } from '../os/store'
import { useVFS, HOME, vfs, join } from '../os/vfs'
import { AppIcon, Glyph } from '../shell/AppIcon'
import { openUrl } from '../os/bus'
import type { AppProps } from '../os/types'
import { safeLocal } from '../os/storage'

interface Feed {
  id: string
  title: string
  url: string
  glyph: string
  color: string
  color2?: string
  description: string
  items: { title: string; summary: string; url: string; date: string; tag: string }[]
}

const FEEDS: Feed[] = [
  {
    id: 'mixtnews',
    title: 'MixtNews',
    url: 'https://mixtnews.com/',
    glyph: 'Newspaper',
    color: '#b8532f',
    color2: '#7a2f14',
    description: 'Desktop and internet news, updated whenever the authors feel like it.',
    items: [
      { title: 'Mixt Shell 6.4 lands with smoother window animations', summary: 'The new release focuses on latency: unmaximising a window now takes a single frame on modest hardware.', url: 'https://mixtnews.com/article/mixt-shell-64', date: '2 Oct', tag: 'Desktop' },
      { title: 'MixtNet passes one billion virtual page views', summary: 'A network that exists entirely inside a browser tab has crossed a milestone nobody was counting.', url: 'https://mixtnews.com/article/mixtnet-billion', date: '29 Sep', tag: 'Internet' },
      { title: 'Opinion: the browser is the new operating system', summary: 'Every decade or so, the platform underneath our software quietly changes name.', url: 'https://mixtnews.com/article/browser-as-os', date: '27 Sep', tag: 'Opinion' },
      { title: 'Kernel 6.8 brings better power management to laptops', summary: 'Idle draw drops again, and the scheduler learns a few new tricks for hybrid CPUs.', url: 'https://mixtnews.com/article/kernel-68', date: '24 Sep', tag: 'Technology' },
      { title: 'Running a desktop at 60 frames per second in a single thread', summary: 'No workers, no WebAssembly: just careful state updates and a very small virtual DOM diff.', url: 'https://mixtnews.com/article/js-at-60fps', date: '21 Sep', tag: 'Development' },
      { title: 'The surprising history of mixt in the kitchen', summary: 'Before it was a colour, mixt was a flavour — and it still makes the best lemonade.', url: 'https://mixtnews.com/article/mixt-recipes', date: '18 Sep', tag: 'Culture' },
    ],
  },
  {
    id: 'mixtpedia',
    title: 'MixtPedia — featured',
    url: 'https://mixtpedia.org/',
    glyph: 'BookOpen',
    color: '#3b4c5a',
    color2: '#1f2933',
    description: 'Articles from the free encyclopaedia that ships with the MixtNet.',
    items: [
      { title: 'Mixt OS', summary: 'A community-driven distribution known for its green branding and its focus on usability.', url: 'https://mixtpedia.org/article/mixt-os', date: 'featured', tag: 'Operating systems' },
      { title: 'Mixt Shell (desktop environment)', summary: 'The Mixt desktop shell, providing a panel, a menu and a window manager.', url: 'https://mixtpedia.org/article/mixt-shell', date: 'featured', tag: 'Desktop' },
      { title: 'Virtual file system', summary: 'An abstraction layer that presents a uniform interface to different storage back-ends.', url: 'https://mixtpedia.org/article/virtual-file-system', date: 'featured', tag: 'Computer science' },
      { title: 'Web browser', summary: 'An application that retrieves, parses and renders documents from the World Wide Web.', url: 'https://mixtpedia.org/article/web-browser', date: 'featured', tag: 'Software' },
      { title: 'Terminal emulator', summary: 'A program that emulates a character-based video terminal inside a window.', url: 'https://mixtpedia.org/article/terminal-emulator', date: 'featured', tag: 'Software' },
    ],
  },
  {
    id: 'mixtube',
    title: 'Mixtube — trending',
    url: 'https://mixtube.com/',
    glyph: 'Video',
    color: '#c0392b',
    color2: '#7c1d12',
    description: 'What the MixtNet is watching right now, allegedly.',
    items: [
      { title: 'Installing Mixt Web OS (and why nothing needed installing)', summary: 'A walkthrough of the boot process, from the splash to the panel applets.', url: 'https://mixtube.com/watch/v1', date: '3 days', tag: 'Mixt Tips' },
      { title: 'Snapping windows with a pointer capture in React', summary: 'Pointer capture, transform-based dragging and the snap-preview rectangle.', url: 'https://mixtube.com/watch/v2', date: '1 week', tag: 'Frontend Kitchen' },
      { title: 'I wrote a shell in TypeScript and it has pipes', summary: 'Tokenisation, pipelines and redirection in about 500 lines.', url: 'https://mixtube.com/watch/v3', date: '2 weeks', tag: 'Terminal Velocity' },
      { title: 'Review: the 2048 clone inside the browser inside the OS', summary: 'It is 2048. It has arrow-key support. Ten out of ten.', url: 'https://mixtube.com/watch/v5', date: '1 month', tag: 'Arcade Corner' },
    ],
  },
  {
    id: 'mixtcart',
    title: 'MixtCart — new arrivals',
    url: 'https://mixtcart.com/',
    glyph: 'ShoppingBag',
    color: '#2f9e8f',
    color2: '#14705f',
    description: 'Products from the shop, including the ones that download into your file manager.',
    items: [
      { title: 'Tux plush toy — $19.50', summary: 'Seventeen centimetres of unstoppable penguin. Embroidered beak, weighted base.', url: 'https://mixtcart.com/product/tux-plush', date: 'in stock', tag: 'Toys' },
      { title: 'Wallpaper pack (3 images) — Free', summary: 'The wave, the facets and the leaf. Yours to download immediately.', url: 'https://mixtcart.com/product/wallpaper-pack', date: 'digital', tag: 'Digital' },
      { title: 'Mechanical keyboard, 87 keys — $84.90', summary: 'Tactile brown switches, PBT caps, a volume knob that actually turns.', url: 'https://mixtcart.com/product/keyboard', date: 'in stock', tag: 'Hardware' },
      { title: 'Shell cheat sheet (PDF) — Free', summary: 'Pipes, redirects and the commands you always look up.', url: 'https://mixtcart.com/product/cheatsheet', date: 'digital', tag: 'Digital' },
    ],
  },
]

const READ_KEY = 'mixt.news.read'

export default function NewsApp({ api }: AppProps) {
  const settings = useOS((s) => s.settings)
  const [feedId, setFeedId] = useState(FEEDS[0].id)
  const [selected, setSelected] = useState<string | null>(null)
  const [read, setRead] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(safeLocal.getItem(READ_KEY) ?? '[]')
      return Array.isArray(saved) ? saved.filter((v) => typeof v === 'string') : []
    } catch {
      return []
    }
  })
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'list' | 'cards'>('cards')
  const vfsRev = useVFS((s) => s.revision)

  const feed = FEEDS.find((f) => f.id === feedId)!
  const items = useMemo(() => {
    let list = feed.items
    if (query.trim()) {
      const q = query.toLowerCase()
      list = FEEDS.flatMap((f) => f.items).filter((i) => (i.title + i.summary + i.tag).toLowerCase().includes(q))
    }
    return list
  }, [feed, query])

  const current = items.find((i) => i.url === selected) ?? null

  useEffect(() => {
    api.setTitle(`${feed.title} — News Reader`)
  }, [feed.title])

  useEffect(() => {
    safeLocal.setItem(READ_KEY, JSON.stringify(read))
  }, [read])

  function markRead(url: string) {
    if (!read.includes(url)) setRead((r) => [...r, url])
  }

  const unreadCount = FEEDS.flatMap((f) => f.items).filter((i) => !read.includes(i.url)).length

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, background: 'var(--wm-window-bg)' }}>
      <div style={{ width: 200, flex: 'none', borderRight: '1px solid rgba(0,0,0,0.14)', padding: '10px 6px', overflow: 'auto', background: 'color-mix(in srgb, var(--wm-window-bg) 92%, #808890)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '0 6px 10px' }}>
          <AppIcon glyph="BookOpen" color="#d9694a" color2="#96361c" size={28} />
          <div>
            <div style={{ fontWeight: 600 }}>Feeds</div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>{unreadCount} unread</div>
          </div>
        </div>
        {FEEDS.map((f) => {
          const unread = f.items.filter((i) => !read.includes(i.url)).length
          return (
            <div
              key={f.id}
              className="menu-item"
              style={{ background: feedId === f.id ? 'color-mix(in srgb, var(--wm-accent) 40%, transparent)' : undefined }}
              onClick={() => {
                setFeedId(f.id)
                setSelected(null)
                setQuery('')
              }}
            >
              <Glyph name={f.glyph} size={14} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.title}</span>
              {unread > 0 && <span style={{ background: 'var(--wm-accent)', color: '#14260a', borderRadius: 999, fontSize: 10.5, padding: '0 6px', fontWeight: 700 }}>{unread}</span>}
            </div>
          )
        })}
        <div className="menu-sep" />
        <div className="menu-item" onClick={() => { setQuery(''); setRead(FEEDS.flatMap((f) => f.items).map((i) => i.url)) }}>
          <Glyph name="Check" size={14} /> Mark everything read
        </div>
        <div className="menu-item" onClick={() => openUrl(feed.url)}>
          <Glyph name="Globe" size={14} /> Open feed site
        </div>
        <div style={{ padding: '10px 8px 0', fontSize: 11.5, opacity: 0.65, lineHeight: 1.5 }}>
          Feeds are fetched from the MixtNet and cached in your browser ({vfsRev} filesystem revisions so far).
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div className="mixt-toolbar">
          <input className="entry" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all feeds…" style={{ width: 220 }} />
          <button className="btn-ghost" data-active={view === 'cards'} onClick={() => setView('cards')} title="Card view">
            <Glyph name="LayoutGrid" size={15} />
          </button>
          <button className="btn-ghost" data-active={view === 'list'} onClick={() => setView('list')} title="List view">
            <Glyph name="List" size={15} />
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn-ghost" onClick={() => setSelected(null)}>
            <Glyph name="Home" size={15} /> All items
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
            {current ? (
              <article style={{ maxWidth: 640 }}>
                <button className="btn-ghost" onClick={() => setSelected(null)}>
                  <Glyph name="ChevronLeft" size={15} /> Back to {query ? 'results' : feed.title}
                </button>
                <h1 style={{ fontSize: 23, marginBottom: 4 }}>{current.title}</h1>
                <div style={{ opacity: 0.7, fontSize: 12.5, marginBottom: 12 }}>
                  {current.tag} · {current.date} · {current.url.replace(/^https?:\/\//, '').split('/')[0]}
                </div>
                <p style={{ fontSize: 15.5, lineHeight: 1.7 }}>{current.summary}</p>
                <p style={{ lineHeight: 1.7, opacity: 0.85 }}>
                  This is the summary carried by the feed. The full article — with its own layout, comments and
                  illustrations — lives on the MixtNet, where it is updated whenever the author feels productive.
                </p>
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button className="btn-mixt" onClick={() => openUrl(current.url)}>
                    <Glyph name="Globe" size={14} /> Read the full article
                  </button>
                  <button className="btn-ghost" onClick={() => markRead(current.url)}>
                    <Glyph name="Check" size={14} /> Mark read
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      const text = `${current.title}\n\n${current.summary}\n\nSource: ${current.url}\n`
                      vfs.mkdirp(`${HOME}/Documents`)
                      vfs.write(join(`${HOME}/Documents`, `feed-${current.title.slice(0, 24).replace(/[^\w]+/g, '-').toLowerCase()}.txt`), text)
                      useOS.getState().notify({ title: 'News Reader', body: 'The article summary was saved to ~/Documents.', appId: 'news' })
                    }}
                  >
                    <Glyph name="Save" size={14} /> Save summary
                  </button>
                </div>
                <div style={{ marginTop: 18, fontSize: 12.5, opacity: 0.65 }}>
                  Saved articles end up in ~/Documents, ready for the Text Editor.
                </div>
              </article>
            ) : view === 'cards' ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 12 }}>
                {items.map((item) => (
                  <div
                    key={item.url}
                    onClick={() => {
                      setSelected(item.url)
                      markRead(item.url)
                    }}
                    style={{
                      border: '1px solid rgba(0,0,0,0.14)',
                      borderRadius: 9,
                      overflow: 'hidden',
                      cursor: 'pointer',
                      background: 'color-mix(in srgb, var(--wm-window-bg) 96%, #ffffff)',
                    }}
                  >
                    <div style={{ height: 84, background: `linear-gradient(135deg, ${feed.color}, ${feed.color2 ?? feed.color})`, display: 'grid', placeItems: 'center' }}>
                      <AppIcon glyph={feed.glyph} color="rgba(255,255,255,0.3)" color2="rgba(255,255,255,0.1)" size={40} />
                    </div>
                    <div style={{ padding: 10 }}>
                      <div style={{ fontWeight: read.includes(item.url) ? 400 : 700, fontSize: 13.5, lineHeight: 1.35 }}>{item.title}</div>
                      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {item.summary}
                      </div>
                      <div style={{ fontSize: 11.5, opacity: 0.6, marginTop: 6 }}>
                        {item.tag} · {item.date}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={item.url}
                      onClick={() => {
                        setSelected(item.url)
                        markRead(item.url)
                      }}
                      style={{ cursor: 'pointer', borderBottom: '1px solid rgba(0,0,0,0.08)' }}
                    >
                      <td style={{ padding: '7px 8px', fontWeight: read.includes(item.url) ? 400 : 700, width: '45%' }}>{item.title}</td>
                      <td style={{ padding: '7px 8px', opacity: 0.75 }}>{item.summary}</td>
                      <td style={{ padding: '7px 8px', opacity: 0.6, whiteSpace: 'nowrap' }}>{item.tag}</td>
                      <td style={{ padding: '7px 8px', opacity: 0.6, whiteSpace: 'nowrap' }}>{item.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div style={{ flex: 'none', padding: '3px 10px', fontSize: 11.5, borderTop: '1px solid rgba(0,0,0,0.16)', backgroundImage: 'linear-gradient(to bottom,#f2f3f1,#e6e8e4)', color: '#24292c' }}>
          {items.length} items · {unreadCount} unread across {FEEDS.length} feeds · reading as {settings.fullName}
        </div>
      </div>
    </div>
  )
}
