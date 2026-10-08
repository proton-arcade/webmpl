import React from 'react'
import { A, Btn, Card, H, Img, Meta, Pill, SiteShell } from '../sitekit'
import { FILES } from '../downloads'
import type { PageCtx, SiteDef } from '../types'

/* ==========================================================================
   linuxmint.com — the distribution that inspired all of this
   ========================================================================== */

function DownloadButton({ ctx, fileId, label }: { ctx: PageCtx; fileId: string; label?: string }) {
  const file = FILES.find((f) => f.id === fileId)!
  return (
    <Btn onClick={() => ctx.navigate(`https://linuxmint.com/download/${file.filename}`)}>
      ⬇ {label ?? file.filename}
    </Btn>
  )
}

function MintHome({ ctx }: { ctx: PageCtx }) {
  return (
    <SiteShell
      site={LINUXMINT}
      ctx={ctx}
      nav={[
        { label: 'Home', href: 'https://linuxmint.com/' },
        { label: 'Download', href: 'https://linuxmint.com/download.php' },
        { label: 'Features', href: 'https://linuxmint.com/features' },
        { label: 'Documentation', href: 'https://linuxmint.com/documentation' },
      ]}
      maxWidth={980}
    >
      <div style={{ background: 'linear-gradient(120deg,#2f6b12,#61ad2b)', color: '#fff', borderRadius: 12, padding: '30px 26px', marginBottom: 20 }}>
        <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -0.6 }}>Linux Mint</div>
        <div style={{ opacity: 0.92, marginTop: 6, fontSize: 15.5, maxWidth: 620 }}>
          A modern, elegant and comfortable operating system which is both powerful and easy to use. This is the real
          project's homepage, honest — Mint Web OS is a loving tribute that runs in your browser.
        </div>
        <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
          <Btn tone="grey" onClick={() => ctx.navigate('https://linuxmint.com/download.php')}>
            Download
          </Btn>
          <Btn tone="outline" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.6)' }} onClick={() => ctx.navigate('https://mintnews.com/article/cinnamon-64')}>
            Read the release notes
          </Btn>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
        {[
          ['Cinnamon', 'A traditional desktop with modern touches: panel, menu, applets, workspaces.', 'cinnamon-desktop'],
          ['Software Manager', 'Tens of thousands of packages, one search box, zero command line required.', 'linux-mint'],
          ['Update Manager', 'Tiered safety levels so you decide how brave today is.', 'linux-mint'],
        ].map(([title, text, slug]) => (
          <Card key={title}>
            <H level={3}>{title}</H>
            <p style={{ color: '#39413b', lineHeight: 1.6 }}>{text}</p>
            <A ctx={ctx} href={`https://mintpedia.org/article/${slug}`} style={{ textDecoration: 'none' }}>
              Learn more →
            </A>
          </Card>
        ))}
      </div>
    </SiteShell>
  )
}

function MintDownload({ ctx }: { ctx: PageCtx }) {
  return (
    <SiteShell
      site={LINUXMINT}
      ctx={ctx}
      nav={[
        { label: 'Home', href: 'https://linuxmint.com/' },
        { label: 'Download', href: 'https://linuxmint.com/download.php' },
      ]}
    >
      <H level={1}>Download Linux Mint</H>
      <p style={{ color: '#4a524d', maxWidth: 700 }}>
        Choose an edition below. Downloads are handled by the Web Browser and saved to <code>~/Downloads</code> — you can
        watch the progress in the browser's status bar and in the Files application.
      </p>
      {[
        ['linuxmint-22-iso', 'Cinnamon Edition — 64-bit', '2.9 GB', 'The flagship edition, with the desktop you are using right now (allegedly).'],
        ['mint-wallpaper-pack', 'Wallpaper pack', '18 MB', 'Three wallpapers for people who like green and geometry.'],
        ['mintnet-spec', 'MintNet protocol spec (PDF)', '420 kB', 'How the fictional internet inside this computer is put together.'],
      ].map(([fileId, title, size, blurb]) => (
        <Card key={fileId} style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{title}</div>
            <Meta>{size}</Meta>
            <div style={{ color: '#39413b', marginTop: 4 }}>{blurb}</div>
          </div>
          <DownloadButton ctx={ctx} fileId={fileId} label="Download" />
        </Card>
      ))}
      <Card style={{ background: '#fff8e6', border: '1px solid #f0dcae' }}>
        <strong>A note about honesty</strong>
        <p style={{ margin: '6px 0 0', color: '#5c5241' }}>
          The ISO is a placeholder: browsers cannot write 2.9 GB into localStorage. Everything else about the download —
          the progress, the file in your Downloads folder, the notification — is real.
        </p>
      </Card>
    </SiteShell>
  )
}

/* ==========================================================================
   mintdev.io — developer documentation
   ========================================================================== */

const CODE = {
  component: `// A MintNet site is just a component tree.
export const MY_SITE: SiteDef = {
  domain: 'example.mintnet',
  title: 'Example',
  glyph: 'Compass',
  color: '#61ad2b',
  defaultPath: '/',
  pages: [
    {
      path: '/',
      title: 'Example — home',
      keywords: ['example', 'demo'],
      snippet: 'A very small site.',
      render: (ctx) => <Home ctx={ctx} />,
    },
  ],
}

function Home({ ctx }: { ctx: PageCtx }) {
  return (
    <SiteShell site={MY_SITE} ctx={ctx}>
      <h1>Hello MintNet</h1>
      <a onClick={() => ctx.navigate('https://mintpedia.org/')}>Go somewhere</a>
    </SiteShell>
  )
}`,
  shell: `# The terminal is a real shell — pipes and redirection included.
ls -la ~/Documents
cat welcome.md | grep -i terminal
echo "new note" >> ~/Desktop/notes.txt
find / -name "*.ogg" | wc -l`,
  fetch: `// fetching from inside the OS
import { fetchAsText } from '../net'
const page = await fetchAsText('https://mintnews.com/')
console.log(page) // plain-text rendering of a MintNet page`,
}

function mintdevHome({ ctx }: { ctx: PageCtx }) {
  return (
    <SiteShell
      site={MINTDEV}
      ctx={ctx}
      nav={[{ label: 'Docs', href: 'https://mintdev.io/' }, { label: 'Protocol', href: 'https://mintdev.io/protocol' }, { label: 'Shell', href: 'https://mintdev.io/shell' }]}
    >
      <H level={1}>Build a site for the MintNet</H>
      <p style={{ color: '#4a524d', maxWidth: 740, lineHeight: 1.7 }}>
        MintNet has no servers. Every site is a React component and every navigation is a function call inside the
        browser's tab. That makes it the fastest web you will ever deploy to, and the easiest to break.
      </p>
      <H level={2}>Anatomy of a site</H>
      <pre style={{ background: '#1e2327', color: '#d7dbd8', padding: 14, borderRadius: 8, overflow: 'auto', fontSize: 12.5, lineHeight: 1.55 }}>{CODE.component}</pre>
      <H level={2}>Search integration</H>
      <p style={{ color: '#39413b', maxWidth: 740 }}>
        Add <code>title</code>, <code>keywords</code> and <code>snippet</code> to a page and it joins the inverted index
        immediately — the MintNet portal picks it up without any crawling.
      </p>
      <H level={2}>Downloads</H>
      <p style={{ color: '#39413b' }}>
        Register a file in <code>downloads.ts</code> and link to it. The browser streams it into the virtual filesystem
        with a progress bar and a notification.
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <Btn onClick={() => ctx.navigate('https://mintdev.io/protocol')}>Read the protocol spec</Btn>
        <Btn tone="grey" onClick={() => ctx.navigate('https://mintdev.io/shell')}>
          Shell cheatsheet
        </Btn>
      </div>
    </SiteShell>
  )
}

/* ==========================================================================
   webmpl.dev — about this operating system
   ========================================================================== */

const SHORTCUTS: [string, string][] = [
  ['Super / Menu key', 'Open the main menu'],
  ['Alt + Tab', 'Switch between windows'],
  ['Ctrl + Alt + T', 'Open a terminal'],
  ['Ctrl + Alt + ← / →', 'Previous / next workspace'],
  ['Super + D', 'Show the desktop'],
  ['Alt + F2', 'Run a command'],
  ['Alt + F4', 'Close the active window'],
  ['Super + ← / →', 'Snap the active window'],
  ['Ctrl + Alt + L', 'Lock the screen'],
]

function webmplHome({ ctx }: { ctx: PageCtx }) {
  return (
    <SiteShell
      site={WEBMPL}
      ctx={ctx}
      nav={[{ label: 'About', href: 'https://webmpl.dev/' }, { label: 'Shortcuts', href: 'https://webmpl.dev/shortcuts' }, { label: 'Download', href: 'https://webmpl.dev/download' }]}
    >
      <H level={1}>Mint Web OS</H>
      <p style={{ color: '#4a524d', maxWidth: 760, lineHeight: 1.75 }}>
        A complete desktop computer that runs inside a web page: window manager, panel, virtual filesystem, terminal,
        file manager, software store, media players and a browser that surfs a fictional internet. Styled after Linux
        Mint because green is a nice colour and because the Cinnamon layout is a genuinely good idea.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 8 }}>
        <Card>
          <H level={3}>What is real</H>
          <ul style={{ lineHeight: 1.8, color: '#39413b' }}>
            <li>Windows drag, resize, snap and maximise</li>
            <li>Files persist in your browser between visits</li>
            <li>The terminal implements pipes, redirects and ~90 commands</li>
            <li>Downloads land in ~/Downloads</li>
            <li>Settings, themes and wallpapers are yours to change</li>
          </ul>
        </Card>
        <Card>
          <H level={3}>What is pretend</H>
          <ul style={{ lineHeight: 1.8, color: '#39413b' }}>
            <li>The MintNet sites and their contents</li>
            <li>The kernel version, the CPU and the battery</li>
            <li>The 2.9 GB ISO on linuxmint.com</li>
            <li>The van that delivers your MintCart order</li>
          </ul>
        </Card>
      </div>
      <H level={2}>Keyboard shortcuts</H>
      <table style={{ width: '100%', fontSize: 13.5, borderCollapse: 'collapse' }}>
        <tbody>
          {SHORTCUTS.map(([k, v]) => (
            <tr key={k}>
              <td style={{ padding: '5px 8px 5px 0', width: 220 }}>
                <Pill>{k}</Pill>
              </td>
              <td style={{ padding: '5px 0', color: '#39413b' }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <H level={2}>Get it</H>
      <p style={{ color: '#39413b' }}>
        Mint Web OS is not an install — it is the page you are looking at. You can still download a tarball, because
        tarballs are comforting.
      </p>
      <div style={{ marginTop: 8 }}>
        <Btn onClick={() => ctx.navigate(`https://webmpl.dev/download/${FILES.find((f) => f.id === 'webmpl-source')!.filename}`)}>⬇ webmpl-1.0.0.tar.gz</Btn>
      </div>
    </SiteShell>
  )
}

/* ==========================================================================
   site definitions
   ========================================================================== */

export const LINUXMINT: SiteDef = {
  domain: 'linuxmint.com',
  aliases: ['linuxmint.org', 'mint.com'],
  title: 'Linux Mint',
  glyph: 'Award',
  color: '#2f6b12',
  color2: '#1c4309',
  description: 'The homepage of the Linux Mint project: downloads, features and documentation.',
  tags: ['linux', 'mint', 'download', 'distro', 'iso'],
  defaultPath: '/',
  pages: [
    { path: '/', title: 'Linux Mint — home', keywords: ['linux mint', 'distro', 'distribution', 'homepage'], snippet: 'A modern, elegant and comfortable operating system.', render: (ctx) => <MintHome ctx={ctx} /> },
    {
      path: '/download.php',
      title: 'Linux Mint — download',
      keywords: ['download', 'iso', 'cinnamon edition', 'mirror'],
      snippet: 'Download Linux Mint images: the ISO really downloads into your Downloads folder.',
      render: (ctx) => <MintDownload ctx={ctx} />,
    },
    { path: '/features', title: 'Linux Mint — features', keywords: ['features', 'desktop', 'software manager'], snippet: 'What makes the distribution pleasant to use.', render: (ctx) => <MintHome ctx={ctx} /> },
    { path: '/documentation', title: 'Linux Mint — documentation', keywords: ['documentation', 'wiki', 'manual'], snippet: 'Guides and manuals.', render: (ctx) => <MintHome ctx={ctx} /> },
    {
      path: '/download',
      title: 'Linux Mint — downloading',
      keywords: ['download', 'progress'],
      snippet: 'Your download should have started.',
      render: (ctx) => (
        <SiteShell site={LINUXMINT} ctx={ctx} nav={[{ label: 'Home', href: 'https://linuxmint.com/' }]}>
          <H level={1}>Thank you for downloading</H>
          <p>The file is being written to ~/Downloads. Open the Files application to see it arrive.</p>
        </SiteShell>
      ),
    },
  ],
  text: () =>
    [
      'Linux Mint',
      '==========',
      '',
      'A modern, elegant and comfortable operating system which is both powerful and easy to use.',
      '',
      'Downloads (these really work in the browser):',
      ...FILES.filter((f) => f.from.startsWith('https://linuxmint.com')).map((f) => `  - https://linuxmint.com/download/${f.filename}  (${(f.size / 1e6).toFixed(1)} MB)`),
    ].join('\n'),
}

export const MINTDEV: SiteDef = {
  domain: 'mintdev.io',
  aliases: ['developer.mint.com'],
  title: 'MintDev',
  glyph: 'Code',
  color: '#1f2933',
  color2: '#0d1116',
  description: 'Developer documentation for the MintNet: site format, search index, downloads and the shell API.',
  tags: ['docs', 'developer', 'api', 'documentation', 'tutorial'],
  defaultPath: '/',
  pages: [
    { path: '/', title: 'MintDev — build a site', keywords: ['docs', 'api', 'tutorial', 'developers', 'site'], snippet: 'How to add a website to the MintNet, with code.', render: (ctx) => mintdevHome({ ctx }) },
    {
      path: '/protocol',
      title: 'MintNet protocol specification',
      keywords: ['protocol', 'spec', 'url', 'routing', 'search index'],
      snippet: 'URLs, resolution rules, the search index and downloads.',
      render: (ctx) => (
        <SiteShell site={MINTDEV} ctx={ctx} nav={[{ label: 'Docs', href: 'https://mintdev.io/' }]}>
          <H level={1}>MintNet protocol, version 1.0</H>
          <H level={2}>1. URLs</H>
          <p style={{ color: '#39413b', lineHeight: 1.7 }}>
            MintNet URLs look exactly like real ones. A host that is not in the site registry resolves as a <em>real</em>{' '}
            URL and is opened in an embedded frame when the remote server permits embedding.
          </p>
          <H level={2}>2. Resolution</H>
          <p style={{ color: '#39413b', lineHeight: 1.7 }}>
            Input without a scheme and without dots is treated as a search query. Everything else is parsed by the{' '}
            <code>URL</code> class, matched against the registry and dispatched to a page renderer.
          </p>
          <H level={2}>3. Search</H>
          <p style={{ color: '#39413b', lineHeight: 1.7 }}>
            Pages contribute <code>title</code>, <code>keywords</code> and <code>snippet</code> fields to an inverted
            index built lazily on first search.
          </p>
          <H level={2}>4. Downloads</H>
          <Btn onClick={() => ctx.navigate(`https://mintdev.io/download/${FILES.find((f) => f.id === 'mintnet-spec')!.filename}`)}>
            ⬇ Download this specification
          </Btn>
        </SiteShell>
      ),
    },
    {
      path: '/shell',
      title: 'MintDev — the shell',
      keywords: ['shell', 'terminal', 'commands', 'pipes', 'bash'],
      snippet: 'Command reference for the built-in terminal, with a downloadable cheat sheet.',
      render: (ctx) => (
        <SiteShell site={MINTDEV} ctx={ctx} nav={[{ label: 'Docs', href: 'https://mintdev.io/' }]}>
          <H level={1}>The Mint Web OS shell</H>
          <pre style={{ background: '#1e2327', color: '#d7dbd8', padding: 14, borderRadius: 8, overflow: 'auto', fontSize: 12.5, lineHeight: 1.55 }}>{CODE.shell}</pre>
          <H level={2}>Calling MintNet from code</H>
          <pre style={{ background: '#1e2327', color: '#d7dbd8', padding: 14, borderRadius: 8, overflow: 'auto', fontSize: 12.5, lineHeight: 1.55 }}>{CODE.fetch}</pre>
          <div style={{ marginTop: 14 }}>
            <Btn onClick={() => ctx.navigate(`https://mintdev.io/download/${FILES.find((f) => f.id === 'mint-cheatsheet')!.filename}`)}>
              ⬇ Download the cheat sheet
            </Btn>
          </div>
        </SiteShell>
      ),
    },
  ],
  text: (path) =>
    path === '/shell'
      ? ['The Mint Web OS shell', '====================', '', CODE.shell].join('\n')
      : ['MintDev — build a site for the MintNet', '=====================================', '', CODE.component].join('\n'),
}

export const WEBMPL: SiteDef = {
  domain: 'webmpl.dev',
  aliases: ['mintwebos.dev', 'mintwebozos.local'],
  title: 'webmpl.dev',
  glyph: 'Globe',
  color: '#4b8fd6',
  color2: '#245b93',
  description: 'About Mint Web OS: what is real, what is pretend, keyboard shortcuts and a source download.',
  tags: ['about', 'webmpl', 'desktop', 'shortcuts'],
  defaultPath: '/',
  pages: [
    { path: '/', title: 'webmpl.dev — about Mint Web OS', keywords: ['about', 'operating system', 'webmpl', 'desktop in browser'], snippet: 'What Mint Web OS is, what is real and what is pretend.', render: (ctx) => webmplHome({ ctx }) },
    { path: '/shortcuts', title: 'webmpl.dev — keyboard shortcuts', keywords: ['shortcuts', 'keyboard', 'hotkeys'], snippet: 'Every keyboard shortcut the desktop understands.', render: (ctx) => webmplHome({ ctx }) },
    { path: '/download', title: 'webmpl.dev — download', keywords: ['download', 'source', 'tarball'], snippet: 'Download the source tarball.', render: (ctx) => webmplHome({ ctx }) },
  ],
  text: () =>
    [
      'Mint Web OS (webmpl)',
      '====================',
      '',
      'A complete desktop computer inside a web page, styled after Linux Mint.',
      '',
      'Keyboard shortcuts:',
      ...SHORTCUTS.map(([k, v]) => `  ${k.padEnd(20)} ${v}`),
    ].join('\n'),
}

export const TECH_SITES = [LINUXMINT, MINTDEV, WEBMPL]
