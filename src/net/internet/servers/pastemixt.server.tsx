/* A complete, self-contained server — the worked example for this directory.
 *
 * Everything about it lives in this one file: the machine's DNS records, its
 * open ports, and the website it serves. Drop a copy of this file in, change
 * the hostnames and the content, reload, and you have a new site on MixtNet.
 *
 * The site is a working pastebin: create a paste, it is stored locally, and
 * every paste is reachable at https://pastemixt.com/p/<id> — including from
 * the terminal, where `curl` gets the raw text back.
 */
import React from 'react'
import { defineServer } from '../types'
import { SiteShell, Btn, H, Pill, Meta } from '../../sitekit'
import type { PageCtx, SiteDef } from '../../types'
import { safeLocal } from '../../../os/storage'

interface Paste {
  id: string
  title: string
  body: string
  language: string
  created: number
  views: number
}

const KEY = 'mixt.pastemixt.pastes'
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

function load(): Paste[] {
  try {
    const raw = safeLocal.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as Paste[]) : []
  } catch {
    return []
  }
}

function save(pastes: Paste[]) {
  /* safeLocal never throws — a blocked or full store keeps pastes in memory */
  safeLocal.setItem(KEY, JSON.stringify(pastes.slice(0, 60)))
}

function newId(): string {
  let id = ''
  for (let i = 0; i < 6; i++) id += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return id
}

function ago(time: number) {
  const secs = Math.max(1, Math.floor((Date.now() - time) / 1000))
  if (secs < 60) return `${secs} seconds ago`
  if (secs < 3600) return `${Math.floor(secs / 60)} minutes ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)} hours ago`
  return `${Math.floor(secs / 86400)} days ago`
}

/** Seeded on first visit so the site is never empty. */
const SEED: Paste[] = [
  {
    id: 'hello1',
    title: 'welcome to pastemixt',
    body: 'Paste anything here — code, notes, a whole website.\n\nThis service runs on a single machine in the MixtNet registry.\nTry: curl https://pastemixt.com/raw/hello1',
    language: 'text',
    created: Date.now() - 1000 * 60 * 42,
    views: 12,
  },
  {
    id: 'shell1',
    title: 'useful shell pipeline',
    body: 'ls -la ~/Documents | sort -k5 -n | tail -5',
    language: 'bash',
    created: Date.now() - 1000 * 60 * 60 * 5,
    views: 4,
  },
]

function all(): Paste[] {
  const stored = load()
  if (stored.length) return stored
  save(SEED)
  return SEED
}

/* --------------------------------- pages ---------------------------------- */

function Nav({ ctx }: { ctx: PageCtx }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 18, fontSize: 13.5 }}>
      <a onClick={() => ctx.navigate('https://pastemixt.com/')}>recent</a>
      <a onClick={() => ctx.navigate('https://pastemixt.com/new')}>new paste</a>
      <a onClick={() => ctx.navigate('https://pastemixt.com/api')}>api</a>
      <a onClick={() => ctx.navigate('https://mixtnet.com/')}>mixtnet.com</a>
    </div>
  )
}

function Home({ ctx }: { ctx: PageCtx }) {
  const pastes = all()
  return (
    <SiteShell site={PASTEMIXT} ctx={ctx} maxWidth={780}>
      <Nav ctx={ctx} />
      <H>Recent pastes</H>
      <p style={{ color: '#5c665f', marginTop: -4 }}>
        {pastes.length} pastes stored on this machine. Nothing leaves the browser.
      </p>
      {pastes.map((paste) => (
        <div
          key={paste.id}
          onClick={() => ctx.navigate(`https://pastemixt.com/p/${paste.id}`)}
          style={{
            border: '1px solid #e0e4dd',
            borderLeft: '3px solid #7fbf3f',
            background: '#fff',
            borderRadius: 8,
            padding: '10px 14px',
            marginBottom: 8,
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <strong style={{ fontSize: 14.5 }}>{paste.title || 'untitled'}</strong>
            <span style={{ color: '#8a938c', fontSize: 12 }}>{ago(paste.created)}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
            <Pill>{paste.language}</Pill>
            <span style={{ color: '#8a938c', fontSize: 12 }}>
              /p/{paste.id} · {paste.body.length} bytes · {paste.views} views
            </span>
          </div>
        </div>
      ))}
      <Btn onClick={() => ctx.navigate('https://pastemixt.com/new')} style={{ marginTop: 10 }}>
        Create a paste
      </Btn>
    </SiteShell>
  )
}

function NewPaste({ ctx }: { ctx: PageCtx }) {
  const [title, setTitle] = React.useState('')
  const [language, setLanguage] = React.useState('text')
  const [body, setBody] = React.useState('')
  return (
    <SiteShell site={PASTEMIXT} ctx={ctx} maxWidth={780}>
      <Nav ctx={ctx} />
      <H>New paste</H>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="title"
          style={{ flex: 2, minWidth: 200, padding: '8px 10px', border: '1px solid #d8dcd5', borderRadius: 6 }}
        />
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          style={{ padding: '8px 10px', border: '1px solid #d8dcd5', borderRadius: 6, background: '#fff' }}
        >
          {['text', 'bash', 'javascript', 'typescript', 'python', 'json', 'markdown', 'css'].map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={14}
        placeholder="Paste your text here…"
        style={{
          width: '100%',
          fontFamily: 'var(--font-mono)',
          fontSize: 12.5,
          padding: 12,
          border: '1px solid #d8dcd5',
          borderRadius: 8,
        }}
      />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
        <Btn
          onClick={() => {
            const paste: Paste = {
              id: newId(),
              title: title.trim() || 'untitled',
              body,
              language,
              created: Date.now(),
              views: 0,
            }
            save([paste, ...all()])
            ctx.navigate(`https://pastemixt.com/p/${paste.id}`)
          }}
        >
          Paste it
        </Btn>
        <Meta>{body.length} bytes · stored in this browser</Meta>
      </div>
    </SiteShell>
  )
}

function ViewPaste({ ctx, id }: { ctx: PageCtx; id: string }) {
  const pastes = all()
  const paste = pastes.find((p) => p.id === id)
  if (!paste) {
    return (
      <SiteShell site={PASTEMIXT} ctx={ctx} maxWidth={780}>
        <Nav ctx={ctx} />
        <H>404 — no such paste</H>
        <p>
          There is nothing at <code>/p/{id}</code>. It may have expired, or the link may be wrong.
        </p>
        <Btn tone="grey" onClick={() => ctx.navigate('https://pastemixt.com/')}>
          Back to recent pastes
        </Btn>
      </SiteShell>
    )
  }
  return (
    <SiteShell site={PASTEMIXT} ctx={ctx} maxWidth={780}>
      <Nav ctx={ctx} />
      <H>{paste.title}</H>
      <Meta>
        /p/{paste.id} · {paste.language} · {paste.body.length} bytes · pasted {ago(paste.created)}
      </Meta>
      <pre
        style={{
          background: '#20262b',
          color: '#e6efe0',
          padding: 14,
          borderRadius: 8,
          overflow: 'auto',
          fontSize: 12.5,
          fontFamily: 'var(--font-mono)',
          marginTop: 12,
          whiteSpace: 'pre-wrap',
        }}
      >
        {paste.body || '(empty paste)'}
      </pre>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Btn tone="grey" onClick={() => ctx.openTab(`https://pastemixt.com/raw/${paste.id}`)}>
          Open raw
        </Btn>
        <Btn
          tone="outline"
          onClick={() => {
            save(all().filter((p) => p.id !== paste.id))
            ctx.navigate('https://pastemixt.com/')
          }}
        >
          Delete
        </Btn>
      </div>
    </SiteShell>
  )
}

function RawPaste({ ctx, id }: { ctx: PageCtx; id: string }) {
  const paste = all().find((p) => p.id === id)
  return (
    <SiteShell site={PASTEMIXT} ctx={ctx} plain maxWidth={780}>
      <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, whiteSpace: 'pre-wrap' }}>
        {paste ? paste.body : `404: no paste ${id}`}
      </pre>
    </SiteShell>
  )
}

function ApiPage({ ctx }: { ctx: PageCtx }) {
  return (
    <SiteShell site={PASTEMIXT} ctx={ctx} maxWidth={780}>
      <Nav ctx={ctx} />
      <H>The pastemixt API</H>
      <p>
        Three endpoints, no keys, no rate limits, no servers outside your browser.
      </p>
      <pre style={{ background: '#f4f6f2', padding: 12, borderRadius: 8, fontSize: 12.5 }}>
        {`GET  /              recent pastes
GET  /p/<id>         the rendered paste
GET  /raw/<id>       the raw text — this is what curl prints
GET  /new           the create form`}
      </pre>
      <H level={2}>From the terminal</H>
      <pre style={{ background: '#20262b', color: '#e6efe0', padding: 12, borderRadius: 8, fontSize: 12.5 }}>
        {`mixt@mixt-web:~$ curl https://pastemixt.com/raw/hello1
mixt@mixt-web:~$ dig pastemixt.com
mixt@mixt-web:~$ nmap pastemixt.com`}
      </pre>
      <p style={{ color: '#5c665f' }}>
        This machine is registered in the Internet directory at{' '}
        <code>src/net/internet/servers/pastemixt.server.tsx</code>.
      </p>
    </SiteShell>
  )
}

/* --------------------------------- site ----------------------------------- */

export const PASTEMIXT: SiteDef = {
  domain: 'pastemixt.com',
  title: 'pastemixt',
  glyph: 'Clipboard',
  color: '#6f7d86',
  color2: '#46525a',
  description: 'A pastebin that stores everything in your browser. Raw text at /raw/<id>.',
  tags: ['pastebin', 'code', 'text', 'share'],
  defaultPath: '/',
  pages: [
    { path: '/', title: 'pastemixt — recent pastes', keywords: ['paste', 'pastebin'], render: (ctx) => <Home ctx={ctx} /> },
    { path: '/new', title: 'New paste — pastemixt', render: (ctx) => <NewPaste ctx={ctx} /> },
    { path: '/p/:id', title: 'Paste — pastemixt', render: (ctx) => <ViewPaste ctx={ctx} id={ctx.path.split('/')[2] ?? ''} /> },
    { path: '/raw/:id', title: 'Raw paste — pastemixt', render: (ctx) => <RawPaste ctx={ctx} id={ctx.path.split('/')[2] ?? ''} /> },
    { path: '/api', title: 'API — pastemixt', keywords: ['api', 'curl'], render: (ctx) => <ApiPage ctx={ctx} /> },
  ],
  text: (path) => {
    const seg = path.split('/').filter(Boolean)
    const pastes = all()
    if (seg[0] === 'raw' || seg[0] === 'p') {
      const paste = pastes.find((p) => p.id === seg[1])
      if (!paste) return `404: no paste "${seg[1]}" on pastemixt.com`
      return seg[0] === 'raw' ? paste.body : `# ${paste.title}\n${paste.body}`
    }
    if (seg[0] === 'api') {
      return [
        'pastemixt API',
        '=============',
        'GET /            recent pastes',
        'GET /p/<id>      rendered paste',
        'GET /raw/<id>    raw text',
        'GET /new         create form',
      ].join('\n')
    }
    return [
      'pastemixt — recent pastes',
      '=========================',
      ...pastes.map((p) => `${p.id}  ${p.title}  (${p.body.length} bytes, ${ago(p.created)})`),
      '',
      'Try: curl https://pastemixt.com/raw/hello1',
    ].join('\n')
  },
}

/** The machine itself — DNS records, ports, operator, everything. */
export default defineServer({
  id: 'paste-01',
  hosts: ['pastemixt.com'],
  aliases: ['raw.pastemixt.com'],
  operator: 'a drop-in server (see README.md in this folder)',
  location: 'your browser',
  since: 'just now',
  os: 'MixtNetOS 4.2 LTS',
  software: 'pastemixtd 1.0',
  banner: 'pastemixtd/1.0 — 60 pastes max, no database',
  ports: [
    { port: 80, service: 'http' },
    { port: 443, service: 'https' },
    { port: 22, service: 'ssh' },
  ],
  records: { TXT: ['"v=spf1 -all"', '"drop a file in servers/ and you get one of these"'] },
  sites: [PASTEMIXT],
  notes: 'Self-contained example: delete this file and the domain stops resolving.',
})
