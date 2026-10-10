import React, { useEffect, useMemo, useState } from 'react'
import { useOS } from '../os/store'
import { AppIcon, Glyph } from '../shell/AppIcon'
import { openUrl } from '../os/bus'
import { serverMail, sendMail, type ServerMail } from '../os/api'
import { localAddress, USER_DOMAIN, GUEST_DOMAIN } from '../os/mailaddr'
import { readMailCache, writeMailCache } from './mailstore'
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


/* Seed mail is addressed to the account that is signed in, so two users on the
 * same machine each see their own inbox rather than one shared "you". */
function seed(me: string, name: string): Message[] {
  return [
  {
    id: 'm1',
    from: 'updates@Mixt.MPL',
    fromName: 'Mixt Update Manager',
    to: me,
    subject: '3 optional applications are available',
    date: Date.now() - 3 * 3600_000,
    body:
      'Hello ' + name + ',\n\nThree applications can be installed from the Software Manager: Drawing, Mail and News Reader.\n\nThey are small, they are green-adjacent, and they will not break anything. Open the Software Manager and look at the Updates tab.\n\nKind regards,\nThe Update Manager',
    folder: 'Inbox',
    read: false,
    starred: true,
    labels: ['system'],
  },
  {
    id: 'm2',
    from: 'hello@Mixt.MPL',
    fromName: 'Mixt Team',
    to: me,
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
    from: 'orders@Mixt.MPL',
    fromName: 'MixtCart',
    to: me,
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
    from: 'petra@Mixt.MPL',
    fromName: 'Petra Lindgren',
    to: me,
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
    from: 'dev@Mixt.MPL',
    fromName: 'mixt.dev',
    to: me,
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
    from: 'editor@Mixt.MPL',
    fromName: 'MixtNews Editor',
    to: me,
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
    from: me,
    fromName: name,
    to: 'petra@Mixt.MPL',
    subject: 'Re: desktop feature ideas',
    date: Date.now() - 4 * 86400_000,
    body: 'Petra,\n\nRight-click the clock, choose preferences, tick “Show seconds”. Enjoy the tea.\n\n— Mixt',
    folder: 'Sent',
    read: true,
    starred: false,
    labels: [],
  },
  ]
}

function load(user: string, me: string, name: string): Message[] {
  const cached = readMailCache(user)
  return cached.length ? (cached as unknown as Message[]) : seed(me, name)
}

/* Merge what the server holds into the local list. The server is the authority
 * for anything another user sent; the local copy is the offline cache. Ids
 * decide, so a message already stored locally is never shown twice. */
const FOLDERS: Message['folder'][] = ['Inbox', 'Sent', 'Drafts', 'Trash', 'Junk']
function mergeMail(all: Message[], remote: ServerMail[]): Message[] {
  const have = new Set(all.map((m) => m.id))
  const fresh = remote
    .filter((m) => !have.has(m.id))
    .map((m) => ({ ...m, folder: (FOLDERS.includes(m.folder as Message['folder']) ? m.folder : 'Inbox') as Message['folder'] }))
  return fresh.length ? [...all, ...fresh] : all
}

export default function MailApp({ api }: AppProps) {
  const settings = useOS((s) => s.settings)
  /* this account's address on this machine — @Mixt.MPL for a whitelisted
     account, NAME@Guest.MPL for a guest, both local to this computer */
  const me = localAddress(settings.username)
  const [messages, setMessages] = useState<Message[]>(() => load(settings.username, me, settings.fullName || settings.username))
  const [folder, setFolder] = useState<Message['folder']>('Inbox')
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [composing, setComposing] = useState<null | { to: string; subject: string; body: string }>(null)
  const [sortDesc, setSortDesc] = useState(true)
  const [onlyUnread, setOnlyUnread] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')

  useEffect(() => {
    writeMailCache(settings.username, messages)
  }, [messages, settings.username])

  /* pick up anything other users have sent since this window was opened */
  useEffect(() => {
    let alive = true
    ;(async () => {
      const remote = await serverMail()
      if (!alive || !remote) return
      setMessages((all) => mergeMail(all, remote))
    })()
    return () => {
      alive = false
    }
  }, [])

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

  /* Check for mail sent by the other accounts on this computer. */
  async function receive() {
    const remote = await serverMail()
    if (!remote) {
      useOS.getState().notify({ title: 'Mail', body: 'There is no mail server on this computer.', appId: 'mail' })
      return
    }
    const have = new Set(messages.map((m) => m.id))
    const fresh = remote.filter((m) => !have.has(m.id))
    if (fresh.length) setMessages((all) => mergeMail(all, remote))
    useOS.getState().notify({
      title: 'Mail',
      body: fresh.length === 1 ? '1 new message.' : `${fresh.length} new messages.`,
      appId: 'mail',
    })
  }

  /* Sending goes through the server, which drops the message into the
   * recipient's mailbox on this machine. With no server behind the page the
   * message is still kept in Sent — the app has to work as a plain static
   * site too — and the notification says so rather than claiming delivery. */
  async function send() {
    if (!composing || !composing.to.trim() || sending) return
    const to = composing.to.trim()
    const subject = composing.subject || '(no subject)'
    setSending(true)
    setSendError('')
    const res = await sendMail(to, subject, composing.body)
    if (!res.ok && res.error && !/no mail server/i.test(res.error)) {
      /* the server is there but will not take this address: keep the draft */
      setSending(false)
      setSendError(res.error)
      return
    }
    const msg: Message = {
      /* the server already stored a Sent copy under this id, so re-reading the
         mailbox later cannot duplicate it */
      id: res.ok && res.id ? `${res.id}c` : `m${Date.now()}`,
      from: me,
      fromName: settings.fullName || settings.username,
      to,
      subject,
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
    setSending(false)
    useOS.getState().notify({
      title: 'Mail',
      body: res.ok ? `Delivered to ${msg.to}.` : `No mail server here — kept in Sent for ${msg.to}.`,
      appId: 'mail',
    })
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--wm-window-bg)' }}>
      <div className="mixt-toolbar">
        <button className="btn-ghost" onClick={() => { setSendError(''); setComposing({ to: '', subject: '', body: `\n\n--\n${settings.fullName}\n${me}` }) }}>
          <Glyph name="Plus" size={15} /> Compose
        </button>
        <button className="btn-ghost" onClick={() => receive()} title="Collect mail sent by the other accounts on this computer">
          <Glyph name="RefreshCw" size={15} /> Receive
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
              <div style={{ fontSize: 11, opacity: 0.7 }}>{me}</div>
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
          <div className="menu-item" onClick={() => receive()}>
            <Glyph name="RefreshCw" size={14} /> Check for new mail
          </div>
          <div style={{ padding: '10px 8px 0', fontSize: 11.5, opacity: 0.65, lineHeight: 1.5 }}>
            Your mailbox is kept per account in ~/.config/mixtmail, and mail
            between accounts on this computer is delivered by the server.
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
              <div style={{ fontSize: 11.5, opacity: 0.65, margin: '8px 0 0' }}>
                From {me}. Mail never leaves this computer: an address ending in{' '}
                <b>@{USER_DOMAIN}</b> reaches a whitelisted account, and <b>@{GUEST_DOMAIN}</b>{' '}
                reaches a guest who signed in under that name.
              </div>
              {sendError && (
                <div style={{ color: '#c0392b', fontSize: 12.5, marginTop: 8 }}>
                  Not sent: {sendError}. The message is still here — change the address and try again.
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="btn-mixt" disabled={sending} onClick={send}>
                  <Glyph name="Upload" size={14} /> {sending ? 'Sending…' : 'Send'}
                </button>
                <button className="btn-ghost" onClick={() => { setMessages((all) => [...all, { ...composing, id: `m${Date.now()}`, from: me, fromName: settings.fullName || settings.username, date: Date.now(), folder: 'Drafts', read: true, starred: false, labels: [] } as Message]); setComposing(null); setFolder('Drafts') }}>
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
