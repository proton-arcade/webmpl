import React, { useEffect, useMemo, useState } from 'react'
import { useOS } from '../os/store'
import { useVFS, HOME, vfs, join } from '../os/vfs'
import { AppIcon, Glyph } from '../shell/AppIcon'
import { openUrl } from '../os/bus'
import type { AppProps } from '../os/types'

interface Message {
  id: string
  from: string
  fromName: string
  to: string
  subject: string
  date: number
  body: string
  folder: 'Inbox' | 'Sent' | 'Drafts' | 'Trash' | 'Junk'
  read: boolean
  starred: boolean
  labels: string[]
}

const STORE = '/home/mixt/.config/mixtmail/messages.json'

const SEED: Message[] = [
  {
    id: 'm1',
    from: 'updates@mixtnet.com',
    fromName: 'Mixt Update Manager',
    to: 'you@mixtmail.com',
    subject: '3 optional applications are available',
    date: Date.now() - 3 * 3600_000,
    body:
      'Hello Mixt User,\n\nThree applications can be installed from the Software Manager: Drawing, Mail and News Reader.\n\nThey are small, they are green-adjacent, and they will not break anything. Open the Software Manager and look at the Updates tab.\n\nKind regards,\nThe Update Manager',
    folder: 'Inbox',
    read: false,
    starred: true,
    labels: ['system'],
  },
  {
    id: 'm2',
    from: 'hello@mixt.dev',
    fromName: 'Mixt Team',
    to: 'you@mixtmail.com',
    subject: 'Your window snapped correctly',
    date: Date.now() - 26 * 3600_000,
    body:
      'We noticed you dragged a window to the left edge of the screen and it filled exactly half.\n\nThat is the intended behaviour. Thank you for participating.\n\n— The window manager',
    folder: 'Inbox',
    read: true,
    starred: false,
    labels: ['desktop'],
  },
  {
    id: 'm3',
    from: 'orders@mixtcart.com',
    fromName: 'MixtCart',
    to: 'you@mixtmail.com',
    subject: 'Your digital downloads are ready',
    date: Date.now() - 2 * 86400_000,
    body:
      'Thanks for your order!\n\nYour wallpapers can be downloaded directly from the product pages. They will be saved to ~/Downloads, where they will sit quietly until you open the Files application.\n\nMixtCart',
    folder: 'Inbox',
    read: true,
    starred: false,
    labels: ['shop'],
  },
  {
    id: 'm4',
    from: 'petra@mixtnews.com',
    fromName: 'Petra Lindgren',
    to: 'you@mixtmail.com',
    subject: 'Re: desktop feature ideas',
    date: Date.now() - 4 * 86400_000,
    body:
      'Hi!\n\nLove the four workspaces. One request: can the panel clock show seconds? I time my tea with it.\n\n— Petra\nMixtNews, Desktop desk',
    folder: 'Inbox',
    read: false,
    starred: false,
    labels: ['work'],
  },
  {
    id: 'm5',
    from: 'dev@mixt.dev',
    fromName: 'mixt.dev',
    to: 'you@mixtmail.com',
    subject: 'Welcome to Mixt Web OS',
    date: Date.now() - 6 * 86400_000,
    body:
      'You are reading mail inside an operating system inside a browser tab.\n\nSome suggestions:\n\n  1. Open the terminal and run neofetch\n  2. Install Drawing from the Software Manager\n  3. Write a website inside the browser and visit it\n\nRegards,\nThe project',
    folder: 'Inbox',
    read: true,
    starred: true,
    labels: ['welcome'],
  },
  {
    id: 'm6',
    from: 'editor@mixtnews.com',
    fromName: 'MixtNews Editor',
    to: 'you@mixtmail.com',
    subject: 'Pitch accepted: “Why the browser is the new OS”',
    date: Date.now() - 8 * 86400_000,
    body: 'We loved the piece. It runs on the opinion page this week.\n\nPlease do not write another one about localStorage. One was enough.',
    folder: 'Inbox',
    read: true,
    starred: false,
    labels: ['work'],
  },
  {
    id: 'm7',
    from: 'you@mixtmail.com',
    fromName: 'You',
    to: 'petra@mixtnews.com',
    subject: 'Re: desktop feature ideas',
    date: Date.now() - 4 * 86400_000,
    body: 'Petra,\n\nRight-click the clock, choose preferences, tick “Show seconds”. Enjoy the tea.\n\n— Mixt',
    folder: 'Sent',
    read: true,
    starred: false,
    labels: [],
  },
]

function load(): Message[] {
  const raw = vfs.read(STORE)
  if (raw) {
    try {
      return JSON.parse(raw) as Message[]
    } catch {
      /* fall through */
    }
  }
  return SEED
}

function persist(messages: Message[]) {
  vfs.mkdirp('/home/mixt/.config/mixtmail')
  vfs.write(STORE, JSON.stringify(messages, null, 2), 'application/json')
}

export default function MailApp({ api }: AppProps) {
  const settings = useOS((s) => s.settings)
  const [messages, setMessages] = useState<Message[]>(load)
  const [folder, setFolder] = useState<Message['folder']>('Inbox')
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [composing, setComposing] = useState<null | { to: string; subject: string; body: string }>(null)
  const [sortDesc, setSortDesc] = useState(true)
  const [onlyUnread, setOnlyUnread] = useState(false)

  useEffect(() => {
    persist(messages)
  }, [messages])

  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const m of messages) out[m.folder] = (out[m.folder] ?? 0) + (m.read ? 0 : 1)
    return out
  }, [messages])

  const list = useMemo(() => {
    let items = messages.filter((m) => m.folder === folder)
    if (onlyUnread) items = items.filter((m) => !m.read)
    if (query.trim()) {
      const q = query.toLowerCase()
      items = items.filter((m) => (m.subject + m.fromName + m.from + m.body).toLowerCase().includes(q))
    }
    return items.sort((a, b) => (sortDesc ? b.date - a.date : a.date - b.date))
  }, [messages, folder, query, sortDesc, onlyUnread])

  const current = messages.find((m) => m.id === selected) ?? null

  useEffect(() => {
    api.setTitle(`${folder} — Mail${counts.Inbox ? ` (${counts.Inbox})` : ''}`)
  }, [folder, counts.Inbox])

  function patch(id: string, changes: Partial<Message>) {
    setMessages((all) => all.map((m) => (m.id === id ? { ...m, ...changes } : m)))
  }

  function send() {
    if (!composing || !composing.to.trim()) return
    const msg: Message = {
      id: `m${Date.now()}`,
      from: 'you@mixtmail.com',
      fromName: 'You',
      to: composing.to,
      subject: composing.subject || '(no subject)',
      date: Date.now(),
      body: composing.body,
      folder: 'Sent',
      read: true,
      starred: false,
      labels: [],
    }
    setMessages((all) => [...all, msg])
    setComposing(null)
    setFolder('Sent')
    setSelected(msg.id)
    useOS.getState().notify({ title: 'Mail', body: `Message to ${msg.to} sent.`, appId: 'mail' })
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--wm-window-bg)' }}>
      <div className="mixt-toolbar">
        <button className="btn-ghost" onClick={() => setComposing({ to: '', subject: '', body: `\n\n--\n${settings.fullName}\n${settings.username}@${settings.hostname}` })}>
          <Glyph name="Plus" size={15} /> Compose
        </button>
        <button className="btn-ghost" disabled={!current} onClick={() => current && patch(current.id, { read: !current.read })}>
          <Glyph name="Check" size={15} /> {current?.read ? 'Mark unread' : 'Mark read'}
        </button>
        <button className="btn-ghost" disabled={!current} onClick={() => current && patch(current.id, { starred: !current.starred })}>
          <Glyph name="Star" size={15} /> {current?.starred ? 'Unstar' : 'Star'}
        </button>
        <button
          className="btn-ghost"
          disabled={!current}
          onClick={() => {
            if (!current) return
            patch(current.id, { folder: current.folder === 'Trash' ? 'Inbox' : 'Trash' })
            setSelected(null)
          }}
        >
          <Glyph name="Trash2" size={15} /> {current?.folder === 'Trash' ? 'Restore' : 'Delete'}
        </button>
        <div style={{ flex: 1 }} />
        <input className="entry" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search mail…" style={{ width: 190 }} />
        <button className="btn-ghost" data-active={onlyUnread} onClick={() => setOnlyUnread(!onlyUnread)} title="Show unread only">
          <Glyph name="Mail" size={15} />
        </button>
        <button className="btn-ghost" onClick={() => setSortDesc(!sortDesc)} title="Toggle sort order">
          <Glyph name="ArrowLeftRight" size={15} />
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* folders */}
        <div style={{ width: 170, flex: 'none', borderRight: '1px solid rgba(0,0,0,0.14)', padding: '8px 6px', background: 'color-mix(in srgb, var(--wm-window-bg) 92%, #808890)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '0 6px 10px' }}>
            <AppIcon glyph="Mail" color="#4a6fe0" color2="#26409c" size={28} />
            <div>
              <div style={{ fontWeight: 600 }}>Mail</div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>you@mixtmail.com</div>
            </div>
          </div>
          {(['Inbox', 'Sent', 'Drafts', 'Junk', 'Trash'] as const).map((f) => (
            <div
              key={f}
              className="menu-item"
              style={{ background: folder === f ? 'color-mix(in srgb, var(--wm-accent) 40%, transparent)' : undefined }}
              onClick={() => {
                setFolder(f)
                setSelected(null)
              }}
            >
              <Glyph
                name={f === 'Inbox' ? 'Mail' : f === 'Sent' ? 'Upload' : f === 'Drafts' ? 'FileText' : f === 'Junk' ? 'Shield' : 'Trash2'}
                size={14}
              />
              <span style={{ flex: 1 }}>{f}</span>
              {!!counts[f] && <span style={{ background: 'var(--wm-accent)', color: '#14260a', borderRadius: 999, fontSize: 10.5, padding: '0 6px', fontWeight: 700 }}>{counts[f]}</span>}
            </div>
          ))}
          <div className="menu-sep" />
          <div className="menu-item" onClick={() => openUrl('https://mixtmail.com/')}>
            <Glyph name="Globe" size={14} /> Open webmail on the MixtNet
          </div>
          <div className="menu-item" onClick={() => useOS.getState().notify({ title: 'Mail', body: 'No new mail. The MixtNet is quiet today.' })}>
            <Glyph name="RefreshCw" size={14} /> Check for new mail
          </div>
          <div style={{ padding: '10px 8px 0', fontSize: 11.5, opacity: 0.65, lineHeight: 1.5 }}>
            Your mailbox is stored in ~/.config/mixtmail and survives reloads.
          </div>
        </div>

        {/* list */}
        <div style={{ width: 300, flex: 'none', borderRight: '1px solid rgba(0,0,0,0.14)', overflow: 'auto' }}>
          {list.length === 0 && <div style={{ padding: 14, opacity: 0.7 }}>Nothing in {folder}.</div>}
          {list.map((m) => (
            <div
              key={m.id}
              onClick={() => {
                setSelected(m.id)
                setComposing(null)
                patch(m.id, { read: true })
              }}
              style={{
                padding: '9px 12px',
                borderBottom: '1px solid rgba(0,0,0,0.08)',
                cursor: 'pointer',
                background: selected === m.id ? 'color-mix(in srgb, var(--wm-accent) 30%, transparent)' : undefined,
              }}
            >
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {!m.read && <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--wm-accent-dim)', flex: 'none' }} />}
                <span style={{ fontWeight: m.read ? 400 : 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                  {m.fromName}
                </span>
                <span style={{ fontSize: 11, opacity: 0.6 }}>
                  {new Date(m.date).toLocaleDateString([], { day: 'numeric', month: 'short' })}
                </span>
              </div>
              <div style={{ fontSize: 13, marginTop: 2, fontWeight: m.read ? 400 : 500 }}>{m.subject}</div>
              <div style={{ fontSize: 11.5, opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.body.split('\n')[0]}
              </div>
              {m.starred && <Glyph name="Star" size={12} />}
            </div>
          ))}
        </div>

        {/* reader */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 18 }}>
          {composing ? (
            <>
              <h2 style={{ marginTop: 0 }}>New message</h2>
              <input className="entry" placeholder="To" value={composing.to} onChange={(e) => setComposing({ ...composing, to: e.target.value })} style={{ width: '100%', marginBottom: 8 }} />
              <input className="entry" placeholder="Subject" value={composing.subject} onChange={(e) => setComposing({ ...composing, subject: e.target.value })} style={{ width: '100%', marginBottom: 8 }} />
              <textarea className="entry" value={composing.body} onChange={(e) => setComposing({ ...composing, body: e.target.value })} style={{ width: '100%', height: 260 }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="btn-mixt" onClick={send}>
                  <Glyph name="Upload" size={14} /> Send
                </button>
                <button className="btn-ghost" onClick={() => { setMessages((all) => [...all, { ...composing, id: `m${Date.now()}`, from: 'you@mixtmail.com', fromName: 'You', date: Date.now(), folder: 'Drafts', read: true, starred: false, labels: [] } as Message]); setComposing(null); setFolder('Drafts') }}>
                  Save to Drafts
                </button>
                <button className="btn-ghost" onClick={() => setComposing(null)}>
                  Discard
                </button>
              </div>
            </>
          ) : current ? (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ width: 42, height: 42, borderRadius: 999, background: `hsl(${(current.fromName.charCodeAt(0) * 13) % 360} 55% 55%)`, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700 }}>
                  {current.fromName[0]}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{current.subject}</div>
                  <div style={{ opacity: 0.75, fontSize: 12.5 }}>
                    {current.fromName} &lt;{current.from}&gt; → {current.to} · {new Date(current.date).toLocaleString()}
                  </div>
                </div>
                <button className="btn-ghost" onClick={() => patch(current.id, { starred: !current.starred })}>
                  <Glyph name="Star" size={15} />
                </button>
              </div>
              <div style={{ marginTop: 16, lineHeight: 1.75, fontSize: 13.8, whiteSpace: 'pre-wrap' }}>{current.body}</div>
              <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
                <button className="btn-ghost" onClick={() => setComposing({ to: current.from, subject: `Re: ${current.subject}`, body: `\n\nOn ${new Date(current.date).toLocaleString()}, ${current.fromName} wrote:\n> ${current.body.split('\n').join('\n> ')}` })}>
                  <Glyph name="RotateCcw" size={14} /> Reply
                </button>
                <button className="btn-ghost" onClick={() => setComposing({ to: '', subject: `Fwd: ${current.subject}`, body: `\n\n----- Forwarded message -----\nFrom: ${current.from}\n\n${current.body}` })}>
                  <Glyph name="Share" size={14} /> Forward
                </button>
                <button className="btn-ghost" onClick={() => patch(current.id, { folder: 'Trash' })}>
                  <Glyph name="Trash2" size={14} /> Delete
                </button>
              </div>
            </>
          ) : (
            <div style={{ opacity: 0.7 }}>Select a message to read it, or press Compose.</div>
          )}
        </div>
      </div>
    </div>
  )
}
