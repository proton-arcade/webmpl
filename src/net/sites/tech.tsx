import React from 'react'
import { A, Btn, Card, H, Img, Meta, Pill, SiteShell } from '../sitekit'
import { FILES } from '../downloads'
import type { PageCtx, SiteDef } from '../types'

/* ==========================================================================
   mixtos.com — the distribution that inspired all of this
   ========================================================================== */

function DownloadButton({ ctx, fileId, label }: { ctx: PageCtx; fileId: string; label?: string }) {
  const file = FILES.find((f) => f.id === fileId)!
  return (
    <Btn onClick={() => ctx.navigate(`https://mixtos.com/download/${file.filename}`)}>
      ⬇ {label ?? file.filename}
    </Btn>
  )
}

function MixtHome({ ctx }: { ctx: PageCtx }) {
  return (
    <SiteShell
      site={MIXTOS}
      ctx={ctx}
      nav={[
        { label: 'Home', href: 'https://mixtos.com/' },
        { label: 'Download', href: 'https://mixtos.com/download.php' },
        { label: 'Features', href: 'https://mixtos.com/features' },
        { label: 'Documentation', href: 'https://mixtos.com/documentation' },
      ]}
      maxWidth={980}
    >
      <div style={{ background: 'linear-gradient(120deg,#2f6b12,#61ad2b)', color: '#fff', borderRadius: 12, padding: '30px 26px', marginBottom: 20 }}>
        <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -0.6 }}>Mixt OS</div>
        <div style={{ opacity: 0.92, marginTop: 6, fontSize: 15.5, maxWidth: 620 }}>
          A modern, elegant and comfortable operating system which is both powerful and easy to use. This is the real
          project's homepage, honest — Mixt Web OS is a loving tribute that runs in your browser.
        </div>
        <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
          <Btn tone="grey" onClick={() => ctx.navigate('https://mixtos.com/download.php')}>
            Download
          </Btn>
          <Btn tone="outline" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.6)' }} onClick={() => ctx.navigate('https://mixtnews.com/article/mixt-shell-64')}>
            Read the release notes
          </Btn>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
        {[
          ['Mixt Shell', 'A traditional desktop with modern touches: panel, menu, applets, workspaces.', 'mixt-shell'],
          ['Software Manager', 'Tens of thousands of packages, one search box, zero command line required.', 'mixt-os'],
          ['Update Manager', 'Tiered safety levels so you decide how brave today is.', 'mixt-os'],
        ].map(([title, text, slug]) => (
          <Card key={title}>
            <H level={3}>{title}</H>
            <p style={{ color: '#39413b', lineHeight: 1.6 }}>{text}</p>
            <A ctx={ctx} href={`https://mixtpedia.org/article/${slug}`} style={{ textDecoration: 'none' }}>
              Learn more →
            </A>
          </Card>
        ))}
      </div>
    </SiteShell>
  )
}

function MixtDownload({ ctx }: { ctx: PageCtx }) {
  return (
    <SiteShell
      site={MIXTOS}
      ctx={ctx}
      nav={[
        { label: 'Home', href: 'https://mixtos.com/' },
        { label: 'Download', href: 'https://mixtos.com/download.php' },
      ]}
    >
      <H level={1}>Download Mixt OS</H>
      <p style={{ color: '#4a524d', maxWidth: 700 }}>
        Choose an edition below. Downloads are handled by the Web Browser and saved to <code>~/Downloads</code> — you can
        watch the progress in the browser's status bar and in the Files application.
      </p>
      {[
        ['mixtos-iso', 'Mixt Edition — 64-bit', '2.9 GB', 'The flagship edition, with the desktop you are using right now (allegedly).'],
        ['mixt-wallpaper-pack', 'Wallpaper pack', '18 MB', 'Three wallpapers for people who like green and geometry.'],
        ['mixtnet-spec', 'MixtNet protocol spec (PDF)', '420 kB', 'How the fictional internet inside this computer is put together.'],
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
   mixtdev.io — developer documentation
   ========================================================================== */

const CODE = {
  component: `// A MixtNet site is just a component tree.
export const MY_SITE: SiteDef = {
  domain: 'example.mixtnet',
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
      <h1>Hello MixtNet</h1>
      <a onClick={() => ctx.navigate('https://mixtpedia.org/')}>Go somewhere</a>
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
const page = await fetchAsText('https://mixtnews.com/')
console.log(page) // plain-text rendering of a MixtNet page`,
}

function mixtdevHome({ ctx }: { ctx: PageCtx }) {
  return (
    <SiteShell
      site={MIXTDEV}
      ctx={ctx}
      nav={[{ label: 'Docs', href: 'https://mixtdev.io/' }, { label: 'Protocol', href: 'https://mixtdev.io/protocol' }, { label: 'Shell', href: 'https://mixtdev.io/shell' }]}
    >
      <H level={1}>Build a site for the MixtNet</H>
      <p style={{ color: '#4a524d', maxWidth: 740, lineHeight: 1.7 }}>
        MixtNet has no servers. Every site is a React component and every navigation is a function call inside the
        browser's tab. That makes it the fastest web you will ever deploy to, and the easiest to break.
      </p>
      <H level={2}>Anatomy of a site</H>
      <pre style={{ background: '#1e2327', color: '#d7dbd8', padding: 14, borderRadius: 8, overflow: 'auto', fontSize: 12.5, lineHeight: 1.55 }}>{CODE.component}</pre>
      <H level={2}>Search integration</H>
      <p style={{ color: '#39413b', maxWidth: 740 }}>
        Add <code>title</code>, <code>keywords</code> and <code>snippet</code> to a page and it joins the inverted index
        immediately — the MixtNet portal picks it up without any crawling.
      </p>
      <H level={2}>Downloads</H>
      <p style={{ color: '#39413b' }}>
        Register a file in <code>downloads.ts</code> and link to it. The browser streams it into the virtual filesystem
        with a progress bar and a notification.
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <Btn onClick={() => ctx.navigate('https://mixtdev.io/protocol')}>Read the protocol spec</Btn>
        <Btn tone="grey" onClick={() => ctx.navigate('https://mixtdev.io/shell')}>
          Shell cheatsheet
        </Btn>
      </div>
    </SiteShell>
  )
}

/* ==========================================================================
   mixt.dev — about this operating system
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

function mixtHome({ ctx }: { ctx: PageCtx }) {
  return (
    <SiteShell
      site={MIXT}
      ctx={ctx}
      nav={[{ label: 'About', href: 'https://mixt.dev/' }, { label: 'Shortcuts', href: 'https://mixt.dev/shortcuts' }, { label: 'Download', href: 'https://mixt.dev/download' }]}
    >
      <H level={1}>Mixt Web OS</H>
      <p style={{ color: '#4a524d', maxWidth: 760, lineHeight: 1.75 }}>
        A complete desktop computer that runs inside a web page: window manager, panel, virtual filesystem, terminal,
        file manager, software store, media players and a browser that surfs a fictional internet. Styled after the Mixt desktop
        Mixt because green is a nice colour and because the Mixt Shell layout is a genuinely good idea.
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
            <li>The MixtNet sites and their contents</li>
            <li>The kernel version, the CPU and the battery</li>
            <li>The 2.9 GB ISO on mixtos.com</li>
            <li>The van that delivers your MixtCart order</li>
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
        Mixt Web OS is not an install — it is the page you are looking at. You can still download a tarball, because
        tarballs are comforting.
      </p>
      <div style={{ marginTop: 8 }}>
        <Btn onClick={() => ctx.navigate(`https://mixt.dev/download/${FILES.find((f) => f.id === 'mixt-source')!.filename}`)}>⬇ mixt-1.0.0.tar.gz</Btn>
      </div>
    </SiteShell>
  )
}

/* ==========================================================================
   site definitions
   ========================================================================== */

export const MIXTOS: SiteDef = {
  domain: 'mixtos.com',
  aliases: ['mixtos.org', 'mixt.com'],
  title: 'Mixt OS',
  glyph: 'Award',
  color: '#2f6b12',
  color2: '#1c4309',
  description: 'The homepage of the Mixt OS project: downloads, features and documentation.',
  tags: ['mixt', 'download', 'distro', 'iso'],
  defaultPath: '/',
  pages: [
    { path: '/', title: 'Mixt OS — home', keywords: ['mixt os', 'distro', 'distribution', 'homepage'], snippet: 'A modern, elegant and comfortable operating system.', render: (ctx) => <MixtHome ctx={ctx} /> },
    {
      path: '/download.php',
      title: 'Mixt OS — download',
      keywords: ['download', 'iso', 'mixt edition', 'mirror'],
      snippet: 'Download Mixt OS images: the ISO really downloads into your Downloads folder.',
      render: (ctx) => <MixtDownload ctx={ctx} />,
    },
    { path: '/features', title: 'Mixt OS — features', keywords: ['features', 'desktop', 'software manager'], snippet: 'What makes the distribution pleasant to use.', render: (ctx) => <MixtHome ctx={ctx} /> },
    { path: '/documentation', title: 'Mixt OS — documentation', keywords: ['documentation', 'wiki', 'manual'], snippet: 'Guides and manuals.', render: (ctx) => <MixtHome ctx={ctx} /> },
    {
      path: '/download',
      title: 'Mixt OS — downloading',
      keywords: ['download', 'progress'],
      snippet: 'Your download should have started.',
      render: (ctx) => (
        <SiteShell site={MIXTOS} ctx={ctx} nav={[{ label: 'Home', href: 'https://mixtos.com/' }]}>
          <H level={1}>Thank you for downloading</H>
          <p>The file is being written to ~/Downloads. Open the Files application to see it arrive.</p>
        </SiteShell>
      ),
    },
  ],
  text: () =>
    [
      'Mixt OS',
      '==========',
      '',
      'A modern, elegant and comfortable operating system which is both powerful and easy to use.',
      '',
      'Downloads (these really work in the browser):',
      ...FILES.filter((f) => f.from.startsWith('https://mixtos.com')).map((f) => `  - https://mixtos.com/download/${f.filename}  (${(f.size / 1e6).toFixed(1)} MB)`),
    ].join('\n'),
}

export const MIXTDEV: SiteDef = {
  domain: 'mixtdev.io',
  aliases: ['developer.mixt.com'],
  title: 'MixtDev',
  glyph: 'Code',
  color: '#1f2933',
  color2: '#0d1116',
  description: 'Developer documentation for the MixtNet: site format, search index, downloads and the shell API.',
  tags: ['docs', 'developer', 'api', 'documentation', 'tutorial'],
  defaultPath: '/',
  pages: [
    { path: '/', title: 'MixtDev — build a site', keywords: ['docs', 'api', 'tutorial', 'developers', 'site'], snippet: 'How to add a website to the MixtNet, with code.', render: (ctx) => mixtdevHome({ ctx }) },
    {
      path: '/protocol',
      title: 'MixtNet protocol specification',
      keywords: ['protocol', 'spec', 'url', 'routing', 'search index'],
      snippet: 'URLs, resolution rules, the search index and downloads.',
      render: (ctx) => (
        <SiteShell site={MIXTDEV} ctx={ctx} nav={[{ label: 'Docs', href: 'https://mixtdev.io/' }]}>
          <H level={1}>MixtNet protocol, version 1.0</H>
          <H level={2}>1. URLs</H>
          <p style={{ color: '#39413b', lineHeight: 1.7 }}>
            MixtNet URLs look exactly like real ones. A host that is not in the site registry resolves as a <em>real</em>{' '}
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
          <Btn onClick={() => ctx.navigate(`https://mixtdev.io/download/${FILES.find((f) => f.id === 'mixtnet-spec')!.filename}`)}>
            ⬇ Download this specification
          </Btn>
        </SiteShell>
      ),
    },
    {
      path: '/shell',
      title: 'MixtDev — the shell',
      keywords: ['shell', 'terminal', 'commands', 'pipes', 'bash'],
      snippet: 'Command reference for the built-in terminal, with a downloadable cheat sheet.',
      render: (ctx) => (
        <SiteShell site={MIXTDEV} ctx={ctx} nav={[{ label: 'Docs', href: 'https://mixtdev.io/' }]}>
          <H level={1}>The Mixt Web OS shell</H>
          <pre style={{ background: '#1e2327', color: '#d7dbd8', padding: 14, borderRadius: 8, overflow: 'auto', fontSize: 12.5, lineHeight: 1.55 }}>{CODE.shell}</pre>
          <H level={2}>Calling MixtNet from code</H>
          <pre style={{ background: '#1e2327', color: '#d7dbd8', padding: 14, borderRadius: 8, overflow: 'auto', fontSize: 12.5, lineHeight: 1.55 }}>{CODE.fetch}</pre>
          <div style={{ marginTop: 14 }}>
            <Btn onClick={() => ctx.navigate(`https://mixtdev.io/download/${FILES.find((f) => f.id === 'mixt-cheatsheet')!.filename}`)}>
              ⬇ Download the cheat sheet
            </Btn>
          </div>
        </SiteShell>
      ),
    },
  ],
  text: (path) =>
    path === '/shell'
      ? ['The Mixt Web OS shell', '====================', '', CODE.shell].join('\n')
      : ['MixtDev — build a site for the MixtNet', '=====================================', '', CODE.component].join('\n'),
}

export const MIXT: SiteDef = {
  domain: 'mixt.dev',
  aliases: ['mixtwebos.dev', 'mixtwebozos.local'],
  title: 'mixt.dev',
  glyph: 'Globe',
  color: '#4b8fd6',
  color2: '#245b93',
  description: 'About Mixt Web OS: what is real, what is pretend, keyboard shortcuts and a source download.',
  tags: ['about', 'mixt', 'desktop', 'shortcuts'],
  defaultPath: '/',
  pages: [
    { path: '/', title: 'mixt.dev — about Mixt Web OS', keywords: ['about', 'operating system', 'mixt', 'desktop in browser'], snippet: 'What Mixt Web OS is, what is real and what is pretend.', render: (ctx) => mixtHome({ ctx }) },
    { path: '/shortcuts', title: 'mixt.dev — keyboard shortcuts', keywords: ['shortcuts', 'keyboard', 'hotkeys'], snippet: 'Every keyboard shortcut the desktop understands.', render: (ctx) => mixtHome({ ctx }) },
    { path: '/download', title: 'mixt.dev — download', keywords: ['download', 'source', 'tarball'], snippet: 'Download the source tarball.', render: (ctx) => mixtHome({ ctx }) },
  ],
  text: () =>
    [
      'Mixt Web OS (mixt)',
      '====================',
      '',
      'A complete desktop computer inside a web page, styled after Mixt OS.',
      '',
      'Keyboard shortcuts:',
      ...SHORTCUTS.map(([k, v]) => `  ${k.padEnd(20)} ${v}`),
    ].join('\n'),
}

export const TECH_SITES = [MIXTOS, MIXTDEV, MIXT]
