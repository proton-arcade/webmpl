import React from 'react'
import { A, Btn, Card, H, Img, Meta, NotFound, Pill, SiteShell } from '../sitekit'
import type { PageCtx, SiteDef } from '../types'

/* ==========================================================================
   mixtnet.com — the portal / search engine
   ========================================================================== */

function PortalHome({ ctx }: { ctx: PageCtx }) {
  const [q, setQ] = React.useState('')
  const go = () => ctx.navigate(`mixtnet://search?q=${encodeURIComponent(q)}`)
  const headlines = [
    { title: 'Mixt Shell 6.4 lands with smoother window animations', href: 'https://mixtnews.com/article/mixt-shell-64', tag: 'Desktop' },
    { title: 'MixtNet passes one billion virtual page views', href: 'https://mixtnews.com/article/mixtnet-billion', tag: 'Internet' },
    { title: 'Why the browser is the new operating system', href: 'https://mixtnews.com/article/browser-as-os', tag: 'Opinion' },
  ]
  return (
    <SiteShell site={MIXTNET} ctx={ctx} nav={[{ label: 'Search', href: 'https://mixtnet.com/' }, { label: 'News', href: 'https://mixtnews.com/' }, { label: 'Encyclopaedia', href: 'https://mixtpedia.org/' }, { label: 'Shop', href: 'https://mixtcart.com/' }]} maxWidth={880}>
      <div style={{ textAlign: 'center', padding: '26px 0 18px' }}>
        <div style={{ fontSize: 46, fontWeight: 800, letterSpacing: -1.4, color: '#3b6f18' }}>mixtnet</div>
        <div style={{ color: '#66706a', marginTop: 4 }}>The friendly index of the MixtNet — every site, one search box</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 18 }}>
          <input
            className="entry"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && go()}
            placeholder="Search with Mixtsfox…"
            style={{ width: 420, padding: '9px 13px', fontSize: 14 }}
          />
          <Btn onClick={go}>Search</Btn>
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap', fontSize: 12 }}>
          {['mixt os', 'mixt-shell desktop', 'mixt recipes', 'how do browsers work'].map((s) => (
            <A key={s} ctx={ctx} href={`mixtnet://search?q=${encodeURIComponent(s)}`} style={{ background: '#eef4e8', borderRadius: 999, padding: '3px 11px', color: '#2c6b12', textDecoration: 'none' }}>
              {s}
            </A>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
        <Card>
          <H level={3}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>📰 MixtNet News</span>
          </H>
          {headlines.map((h) => (
            <div key={h.href} style={{ padding: '9px 0', borderTop: '1px solid #eef0ec' }}>
              <A ctx={ctx} href={h.href} style={{ fontSize: 14.5, fontWeight: 500, textDecoration: 'none', color: '#1b6ac9' }}>
                {h.title}
              </A>
              <div style={{ marginTop: 3 }}>
                <Pill>{h.tag}</Pill>
              </div>
            </div>
          ))}
          <div style={{ marginTop: 10 }}>
            <A ctx={ctx} href="https://mixtnews.com/" style={{ fontSize: 13 }}>
              All stories →
            </A>
          </div>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card>
            <H level={3}>☀️ Mixtville weather</H>
            <div style={{ fontSize: 30, fontWeight: 700 }}>21°</div>
            <Meta>Partly cloudy · feels like 22° · humidity 48%</Meta>
            <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, fontSize: 12, textAlign: 'center' }}>
              {['Mon 22°', 'Tue 24°', 'Wed 19°', 'Thu 17°'].map((d) => (
                <div key={d} style={{ background: '#f4f7f1', borderRadius: 6, padding: '6px 2px' }}>{d}</div>
              ))}
            </div>
          </Card>
          <Card>
            <H level={3}>🧭 Sites</H>
            {[
              ['mixtpedia.org', 'The free encyclopaedia'],
              ['mixtnews.com', 'News, analysis and opinion'],
              ['mixtube.com', 'Video, all of it'],
              ['mixtbook.com', 'People you may know'],
              ['mixtcart.com', 'Shop for mixty things'],
              ['mixtmaps.com', 'Get directions'],
              ['mixtmail.com', 'Webmail'],
              ['mixtgames.com', 'Play in your browser'],
              ['mixtdev.io', 'Docs for builders'],
              ['mixtos.com', 'The real distribution'],
              ['mixt.dev', 'About this operating system'],
            ].map(([domain, desc]) => (
              <div key={domain} style={{ padding: '4px 0', fontSize: 12.5 }}>
                <A ctx={ctx} href={`https://${domain}/`} style={{ fontWeight: 500, textDecoration: 'none' }}>
                  {domain}
                </A>
                <div style={{ color: '#77807a', fontSize: 11.5 }}>{desc}</div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </SiteShell>
  )
}

/* ==========================================================================
   mixtpedia.org — the encyclopaedia
   ========================================================================== */

interface Article {
  slug: string
  title: string
  category: string
  summary: string
  infobox?: [string, string][]
  sections: { h: string; p: string[] }[]
  see?: string[]
}

export const ARTICLES: Article[] = [
  {
    slug: 'mixt-os',
    title: 'Mixt OS',
    category: 'Operating systems',
    summary: 'Mixt OS is a community-driven distribution in the Mixt family, known for its green branding and its focus on being usable straight out of the box.',
    infobox: [
      ['Developer', 'Mixt OS project'],
      ['First release', '27 August 2006'],
      ['Default desktop', 'the Mixt Shell'],
      ['Package manager', 'mixtinstall'],
      ['License', 'GPL and other free licences'],
    ],
    sections: [
      {
        h: 'Overview',
        p: [
          'Mixt OS ships a complete set of everyday software, including a web browser, office suite pack, media players and configuration tools, so that a new install is immediately useful.',
          'Unlike many distributions, Mixt is conservative about change: the Mixt Shell keeps familiar desktop metaphors such as a panel, a main menu and virtual workspaces, while adding a modern compositor and applets.',
        ],
      },
      {
        h: 'Release cycle',
        p: [
          'Mixt follows long-term support releases for its main editions, publishing point releases roughly every six months that include updated kernels and refreshed artwork.',
          'Each edition is supported for five years with security updates, and the update manager is famous for its tiered safety levels that let users choose how brave to be.',
        ],
      },
      {
        h: 'In this operating system',
        p: [
          'Mixt Web OS borrows the Mixt visual language: the mixt green accent, the Mixt-Y window decorations and the three-dollar-bill layout of its window controls.',
          'The whole distribution here is implemented in TypeScript and React rather than C, but the window manager behaves much like the Mixt Shell: snapping, workspaces, alt-tab and a panel with applets.',
        ],
      },
    ],
    see: ['mixt-shell', 'window-manager', 'virtual-file-system', 'mixt-kernel'],
  },
  {
    slug: 'mixt-shell',
    title: 'Mixt Shell (desktop environment)',
    category: 'Desktop environments',
    summary: 'The Mixt Shell is the desktop for Mixt, providing a panel, a menu, a window manager and a set of applets.',
    infobox: [
      ['Developer', 'Mixt OS team'],
      ['First release', '2011'],
      ['Written in', 'C, JavaScript, TypeScript (Nemo, applets)'],
      ['Toolkit', 'GTK 3'],
    ],
    sections: [
      {
        h: 'Design',
        p: [
          'It favours a traditional panel and menu over an overview-heavy workflow, so it feels familiar to anyone who has used a taskbar-based system.',
          'Its compositor handles window effects, and its settings modules are grouped into a single System Settings application.',
        ],
      },
      {
        h: 'Applets, desklets and extensions',
        p: [
          'Applets live in the panel: clock, network, sound, battery, workspace switcher and menu all speak a JavaScript API.',
          'In Mixt Web OS every one of those applets is a React component reading from a small zustand store that acts as the session bus.',
        ],
      },
    ],
    see: ['mixt-os', 'window-manager', 'javascript'],
  },
  {
    slug: 'virtual-file-system',
    title: 'Virtual file system',
    category: 'Computer science',
    summary: 'A virtual file system (VFS) is an abstraction layer that presents a uniform interface to different storage back-ends, from disk partitions to network shares and in-memory trees.',
    sections: [
      {
        h: 'Purpose',
        p: [
          'The kernel exposes a single tree of paths; drivers below the VFS translate operations such as open, read, write and unlink into whatever the underlying storage understands.',
          'This lets a USB stick, a network share and a pseudo-filesystem such as /proc appear side by side.',
        ],
      },
      {
        h: 'Virtual file systems in the browser',
        p: [
          'Mixt Web OS implements its own VFS in TypeScript: a tree of directories and files stored in localStorage, with copy-on-write-ish helpers for move, copy and trash.',
          'Every application — the file manager, the terminal, the text editor and the browser downloader — talks to the same API, which is exactly what a real VFS buys you.',
        ],
      },
    ],
    see: ['mixt-kernel', 'localstorage', 'mixt-os'],
  },
  {
    slug: 'web-browser',
    title: 'Web browser',
    category: 'Software',
    summary: 'A web browser is an application that retrieves, parses and renders documents from the World Wide Web, running scripts and enforcing a security model between sites.',
    infobox: [
      ['First browser', 'WorldWideWeb (1990)'],
      ['Core components', 'Networking, HTML/CSS parser, layout engine, JavaScript engine'],
    ],
    sections: [
      {
        h: 'Pipeline',
        p: [
          'A URL is resolved through DNS, fetched over HTTP, and the response is tokenised into a document object model. CSS is applied, layout computes geometry, and painting produces pixels.',
          'JavaScript runs in a sandboxed realm, with an event loop that coordinates tasks, microtasks, timers and rendering frames.',
        ],
      },
      {
        h: 'Security model',
        p: [
          'Browsers enforce the same-origin policy: documents from one origin cannot read data from another unless the server opts in with CORS headers.',
          'Frames are an explicit opt-in mechanism, and many large sites refuse to be embedded at all by sending X-Frame-Options or a frame-ancestors policy.',
        ],
      },
      {
        h: 'Browsers as platforms',
        p: [
          'Because browsers ship a sandbox, a filesystem API, WebGL, WebAudio and workers, entire operating systems can be built inside a tab — which is what this encyclopaedia is running on.',
        ],
      },
    ],
    see: ['http', 'javascript', 'localstorage', 'mixt-os'],
  },
  {
    slug: 'terminal-emulator',
    title: 'Terminal emulator',
    category: 'Software',
    summary: 'A terminal emulator is a program that emulates a character-based video terminal, letting users run a shell and text-mode applications in a window.',
    sections: [
      {
        h: 'How it works',
        p: [
          'Historically a glass terminal spoke a serial protocol to a minicomputer. Emulators reproduce that protocol — escape sequences and all — inside a graphical window.',
          'The shell reads commands, forks processes and connects their standard streams to the terminal device.',
        ],
      },
      {
        h: 'In Mixt Web OS',
        p: [
          'The built-in terminal implements a shell in TypeScript: pipes, redirection, tab completion, history and about ninety commands, all against the virtual filesystem.',
          'Type "neofetch" in it — everyone does.',
        ],
      },
    ],
    see: ['mixt-kernel', 'virtual-file-system'],
  },
  {
    slug: 'javascript',
    title: 'JavaScript',
    category: 'Programming languages',
    summary: 'JavaScript is a high-level, just-in-time compiled programming language that conforms to the ECMAScript standard and powers interactive behaviour on the web.',
    infobox: [
      ['Designed by', 'Brendan Eich (1995)'],
      ['Paradigm', 'Multi-paradigm: event-driven, functional, imperative'],
      ['Typing', 'Dynamic, weak'],
    ],
    sections: [
      {
        h: 'Language',
        p: [
          'The language mixes prototype-based objects, first-class functions, closures, promises and, since ES2015, classes and modules.',
          'Its single-threaded event loop is the reason promises and async/await are so central: code waits without blocking the rendering of the page.',
        ],
      },
      {
        h: 'Beyond the page',
        p: [
          'Embedded engines run JavaScript in databases, spacecraft dashboards and, of course, in this operating system, where React reconciles the virtual DOM sixty times a second.',
        ],
      },
    ],
    see: ['web-browser', 'mixt-shell'],
  },
  {
    slug: 'localstorage',
    title: 'Web Storage (localStorage)',
    category: 'Web technology',
    summary: 'Web Storage provides a synchronous key/value store in the browser, persisted per origin, with a typical quota of five to ten megabytes.',
    sections: [
      {
        h: 'Properties',
        p: [
          'localStorage stores strings and survives reloads and restarts; sessionStorage is scoped to a tab. Both are synchronous, which makes them simple but potentially costly for large writes.',
          'Data is scoped to the origin, so another website can never read your files.',
        ],
      },
      {
        h: 'Used as a disk here',
        p: [
          'Mixt Web OS serialises its entire virtual filesystem into localStorage under the key mixt.vfs.v2, which is why documents you write survive a reboot.',
        ],
      },
    ],
    see: ['virtual-file-system', 'web-browser'],
  },
  {
    slug: 'window-manager',
    title: 'Window manager',
    category: 'Desktop environments',
    summary: 'A window manager controls the placement and decoration of windows, deciding how they are moved, resized, stacked, snapped and switched between.',
    sections: [
      {
        h: 'Responsibilities',
        p: [
          'Stacking window managers keep an ordered list of windows per workspace and forward pointer and keyboard events; compositing managers additionally render each window into an off-screen buffer to allow transparency and effects.',
          'Modern managers implement edge snapping, tiling shortcuts, and expose-style overviews.',
        ],
      },
      {
        h: 'This one',
        p: [
          'Mixt Web OS has a stacking, compositing-free window manager in about four hundred lines: absolute positions, z-order integers, eight resize handles, edge-snapping with a preview rectangle and four workspaces.',
        ],
      },
    ],
    see: ['mixt-shell', 'mixt-os'],
  },
  {
    slug: 'mixt-kernel',
    title: 'Mixt kernel',
    category: 'Operating systems',
    summary: 'The Mixt kernel is the core of the Mixt family of systems, managing processes, memory, devices, filesystems and networking.',
    infobox: [
      ['Initial release', '17 September 1991'],
      ['Written in', 'C, assembly, Rust (recently)'],
      ['Licence', 'GPL-2.0-only'],
    ],
    sections: [
      {
        h: 'Subsystems',
        p: [
          'The scheduler decides which task runs, the memory manager hands out pages and swaps, the VFS layer above the block devices presents the file tree, and network stacks move packets between interfaces.',
          'Device drivers make up the majority of the source tree.',
        ],
      },
      {
        h: 'Not present here, but imitated',
        p: [
          'Mixt Web OS has no kernel — but /var/log/boot.log, uname -a and the process list in System Monitor all pretend convincingly.',
        ],
      },
    ],
    see: ['mixt-os', 'virtual-file-system', 'terminal-emulator'],
  },
  {
    slug: 'http',
    title: 'HTTP',
    category: 'Web technology',
    summary: 'HTTP is the application-layer protocol of the web: a request carries a method, a URL and headers; a response carries a status code, headers and a body.',
    sections: [
      {
        h: 'Verbs and codes',
        p: [
          'GET, POST, PUT, PATCH, DELETE and HEAD cover most interactions. Status codes group into informational, success, redirection, client error and server error classes.',
          'HTTP/2 multiplexes many requests over one connection; HTTP/3 moves that to QUIC over UDP.',
        ],
      },
      {
        h: 'CORS and frames',
        p: [
          'Cross-origin reads are blocked unless the response includes Access-Control-Allow-Origin. Cross-origin embedding is blocked unless the site allows it via frame-ancestors.',
          'MixtNet sidesteps all of this by not leaving the tab at all.',
        ],
      },
    ],
    see: ['web-browser', 'javascript'],
  },
]

function articleText(a: Article) {
  return [
    `${a.title} — MixtPedia`,
    '='.repeat(Math.min(70, a.title.length + 10)),
    '',
    a.summary,
    '',
    ...a.sections.flatMap((s) => [s.h, '-'.repeat(s.h.length), ...s.p, '']),
    a.infobox ? 'Infobox: ' + a.infobox.map(([k, v]) => `${k}: ${v}`).join(' | ') : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function ArticlePage({ ctx, slug }: { ctx: PageCtx; slug: string }) {
  const article = ARTICLES.find((a) => a.slug === slug)
  if (!article) return <NotFound ctx={ctx} site={MIXTPEDIA} />
  return (
    <SiteShell
      site={MIXTPEDIA}
      ctx={ctx}
      nav={[
        { label: 'Main page', href: 'https://mixtpedia.org/' },
        { label: 'All articles', href: 'https://mixtpedia.org/all' },
        { label: 'Random', href: 'https://mixtpedia.org/random' },
      ]}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 1fr', gap: 20 }}>
        <div>
          <H level={1} style={{ borderBottom: '1px solid #dfe3dd', paddingBottom: 8 }}>
            {article.title}
          </H>
          <Meta>
            From MixtPedia, the free encyclopaedia · Category: {article.category}
          </Meta>
          <p style={{ fontSize: 14.5, lineHeight: 1.65, marginTop: 14 }}>{article.summary}</p>
          {article.sections.map((s) => (
            <section key={s.h}>
              <H level={2}>{s.h}</H>
              {s.p.map((para, i) => (
                <p key={i} style={{ fontSize: 14, lineHeight: 1.7, color: '#2c332e' }}>
                  {para}
                </p>
              ))}
            </section>
          ))}
          {article.see && (
            <>
              <H level={2}>See also</H>
              <ul style={{ fontSize: 14, lineHeight: 1.9 }}>
                {article.see.map((slug2) => {
                  const other = ARTICLES.find((a) => a.slug === slug2)
                  if (!other) return null
                  return (
                    <li key={slug2}>
                      <A ctx={ctx} href={`https://mixtpedia.org/article/${slug2}`} style={{ textDecoration: 'none' }}>
                        {other.title}
                      </A>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
        <aside>
          {article.infobox && (
            <Card style={{ background: '#f7faf4' }}>
              <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 8 }}>{article.title}</div>
              <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
                <tbody>
                  {article.infobox.map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ padding: '3px 0', color: '#66706a', verticalAlign: 'top', paddingRight: 8 }}>{k}</td>
                      <td style={{ padding: '3px 0' }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          <Card style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 6 }}>Random article</div>
            <A
              ctx={ctx}
              href={`https://mixtpedia.org/article/${ARTICLES[Math.floor(Math.random() * ARTICLES.length)].slug}`}
              style={{ textDecoration: 'none' }}
            >
              Surprise me →
            </A>
          </Card>
        </aside>
      </div>
    </SiteShell>
  )
}

/* ==========================================================================
   mixtnews.com — the newspaper
   ========================================================================== */

interface Story {
  slug: string
  title: string
  section: string
  author: string
  date: string
  lead: string
  body: string[]
}

export const STORIES: Story[] = [
  {
    slug: 'mixt-shell-64',
    title: 'Mixt Shell 6.4 lands with smoother window animations',
    section: 'Desktop',
    author: 'Petra Lindgren',
    date: '2 October 2026',
    lead: 'The new release focuses on latency: unmaximising a window now takes a single frame on modest hardware.',
    body: [
      'After six months of work on the compositor, the Mixt Shell team has published 6.4. The headline change is a rewritten window-resize path that avoids a full relayout when only the frame grows.',
      '"We measured unmaximise latency on a five-year-old laptop," said one maintainer. "It used to spend 42 milliseconds deciding where to put things. Now it is 8."',
      'Also included: a reworked sound applet, a search provider for applets and desklets, and a set of Mixt-Y colour updates that finally make dark titlebars look right on every wallpaper.',
      'Regular users will notice the small things: menus feel attached to their buttons, tooltips no longer appear under the pointer, and the workspace switcher animates in the direction you expect.',
    ],
  },
  {
    slug: 'mixtnet-billion',
    title: 'MixtNet passes one billion virtual page views',
    section: 'Internet',
    author: 'Owen Mbeki',
    date: '29 September 2026',
    lead: 'A network that exists entirely inside a browser tab has crossed a milestone nobody was counting.',
    body: [
      'When the first version of the MixtNet went live there were three sites: a portal, an encyclopaedia stub and a weather page that returned the same forecast for every city.',
      'Since then the index has grown to a dozen properties, including a video site, a social network, a shop, a map service and this newspaper.',
      'Analysts point out that time-on-site figures are trivially high, because leaving the MixtNet requires closing the window. One researcher describes the phenomenon as "a captive audience of one".',
      'The network plans to celebrate by adding another site.',
    ],
  },
  {
    slug: 'browser-as-os',
    title: 'Opinion: the browser is the new operating system',
    section: 'Opinion',
    author: 'Dana Whitfield',
    date: '27 September 2026',
    lead: 'Every decade or so, the platform underneath our software quietly changes name.',
    body: [
      'Mainframes begat minicomputers, minicomputers begat personal computers, and personal computers begat phones. Each generation kept the previous one inside an emulator at first.',
      'Today the browser ships a sandbox, a storage layer, a graphics pipeline, an audio workstation, a network stack and a scheduler. That is a plausible definition of an operating system, even if it has no ring zero.',
      'The interesting question is not whether a web page can run a desktop, but which parts of the desktop it should keep. Panel? Absolutely. Manpage syntax? Debatable.',
      'The Mixt Web OS experiment answers by imitation: everything looks like a 2010s Mixt desktop, and everything runs in JavaScript.',
    ],
  },
  {
    slug: 'kernel-68',
    title: 'Kernel 6.8 brings better power management to laptops',
    section: 'Technology',
    author: 'Ravi Iyer',
    date: '24 September 2026',
    lead: 'Idle draw drops again, and the scheduler learns a few new tricks for hybrid CPUs.',
    body: [
      'The new kernel improves idle handling for chips with a mix of performance and efficiency cores, and adds a driver for a family of USB-C docks that previously required out-of-tree patches.',
      'Distributions following the long-term-support cadence will pick the release up in their next point update.',
    ],
  },
  {
    slug: 'js-at-60fps',
    title: 'Running a desktop at 60 frames per second in a single thread',
    section: 'Development',
    author: 'Mira Castellan',
    date: '21 September 2026',
    lead: 'No workers, no WebAssembly: just careful state updates and a very small virtual DOM diff.',
    body: [
      'A window manager is a strange application: it is mostly idle, then it must react to a pointer move within one frame or the drag feels sticky.',
      'The trick is to keep the draggable geometry out of the React tree. Pointer events write directly to a ref and to a CSS transform; React only hears about the final position.',
      'The same pattern applies to resize handles, panel autohide and the workspace switcher. The result is a desktop that costs about four milliseconds per frame while dragging an alert-heavy window.',
      'The author admits the filesystem will not thank you: every write serialises the entire tree into localStorage.',
    ],
  },
  {
    slug: 'mixt-recipes',
    title: 'The surprising history of mixt in the kitchen',
    section: 'Culture',
    author: 'Hélène Dubois',
    date: '18 September 2026',
    lead: 'Before it was a colour, mixt was a flavour — and it still makes the best lemonade.',
    body: [
      'Mixt has been cultivated for at least three thousand years, and its tendency to hybridise made it a favourite of gardeners long before it became a favourite of open-source branding departments.',
      'The classic combination is lemon, sugar and a great deal of ice. Our test kitchen adds a pinch of salt, which sounds wrong and is not.',
      'Full recipe: see the file recipe-mixt-lemonade.md in your home directory, where a suspiciously well-informed Documents folder has been waiting all along.',
    ],
  },
]

function storyText(s: Story) {
  return [`${s.title}`, `${s.section} · ${s.author} · ${s.date}`, '', s.lead, '', ...s.body].join('\n')
}

function NewsHome({ ctx }: { ctx: PageCtx }) {
  const [lead, ...rest] = STORIES
  return (
    <SiteShell
      site={MIXTNEWS}
      ctx={ctx}
      nav={[
        { label: 'Front page', href: 'https://mixtnews.com/' },
        { label: 'Desktop', href: 'https://mixtnews.com/section/desktop' },
        { label: 'Opinion', href: 'https://mixtnews.com/section/opinion' },
      ]}
      footer={<span>© {new Date().getFullYear()} MixtNews — printed on recycled pixels.</span>}
    >
      <div style={{ borderBottom: '3px double #d7dbd4', paddingBottom: 10, marginBottom: 16, display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <span style={{ fontSize: 12.5, color: '#77807a' }}>{new Date().toDateString()}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12.5, color: '#77807a' }}>Late edition · Mixtville</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 22 }}>
        <div>
          <A ctx={ctx} href={`https://mixtnews.com/article/${lead.slug}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <H level={1}>{lead.title}</H>
          </A>
          <Meta>
            {lead.section} · {lead.author} · {lead.date}
          </Meta>
          <Img alt={lead.section} height={190} style={{ margin: '12px 0' }} />
          <p style={{ fontSize: 15, lineHeight: 1.6 }}>{lead.lead}</p>
          <p style={{ fontSize: 13.5, color: '#4a524d', lineHeight: 1.65 }}>{lead.body[0]}</p>
          <A ctx={ctx} href={`https://mixtnews.com/article/${lead.slug}`}>
            Continue reading →
          </A>
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, borderBottom: '1px solid #d7dbd4', paddingBottom: 6 }}>More stories</div>
          {rest.map((s) => (
            <div key={s.slug} style={{ padding: '10px 0', borderBottom: '1px solid #eef0ec' }}>
              <A ctx={ctx} href={`https://mixtnews.com/article/${s.slug}`} style={{ fontWeight: 500, textDecoration: 'none', fontSize: 14 }}>
                {s.title}
              </A>
              <Meta>
                {s.section} · {s.date}
              </Meta>
            </div>
          ))}
        </div>
      </div>
    </SiteShell>
  )
}

function NewsArticle({ ctx, slug }: { ctx: PageCtx; slug: string }) {
  const story = STORIES.find((s) => s.slug === slug)
  if (!story) return <NotFound ctx={ctx} site={MIXTNEWS} />
  const related = STORIES.filter((s) => s.slug !== slug && s.section === story.section).slice(0, 3)
  const comments = [
    ['tux_fan_92', 'Finally some good news about window animations. My old laptop thanks you.'],
    ['mixtyfresh', 'I installed this on my grandmother\u2019s computer and she now runs the terminal for fun.'],
    ['anonymous_coward', 'Am I the only one who still uses workspaces the wrong way round?'],
    ['gr8googlymoogly', 'Great article. Subscribed to the RSS feed of a website that cannot be reached from outside this operating system.'],
  ]
  return (
    <SiteShell
      site={MIXTNEWS}
      ctx={ctx}
      nav={[
        { label: 'Front page', href: 'https://mixtnews.com/' },
        { label: story.section, href: `https://mixtnews.com/section/${story.section.toLowerCase()}` },
      ]}
    >
      <div style={{ maxWidth: 720 }}>
        <Pill>{story.section}</Pill>
        <H level={1} style={{ marginTop: 10 }}>
          {story.title}
        </H>
        <Meta>
          By {story.author} · {story.date} · 4 min read
        </Meta>
        <Img alt={story.section} height={230} style={{ margin: '16px 0' }} />
        <p style={{ fontSize: 16.5, lineHeight: 1.62, fontWeight: 500 }}>{story.lead}</p>
        {story.body.map((p, i) => (
          <p key={i} style={{ fontSize: 15, lineHeight: 1.75, color: '#2b332e' }}>
            {p}
          </p>
        ))}
      </div>
      {related.length > 0 && (
        <>
          <H level={2}>Related</H>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 12 }}>
            {related.map((s) => (
              <Card key={s.slug} onClick={() => ctx.navigate(`https://mixtnews.com/article/${s.slug}`)} style={{ cursor: 'pointer' }}>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{s.title}</div>
                <Meta>{s.date}</Meta>
              </Card>
            ))}
          </div>
        </>
      )}
      <H level={2}>{comments.length} comments</H>
      {comments.map(([who, what]) => (
        <div key={who} style={{ borderTop: '1px solid #eef0ec', padding: '10px 0', fontSize: 13.5 }}>
          <strong style={{ color: '#3b6f18' }}>{who}</strong>
          <div style={{ marginTop: 3, color: '#39413b' }}>{what}</div>
        </div>
      ))}
      <CommentBox />
    </SiteShell>
  )
}

function CommentBox() {
  const [text, setText] = React.useState('')
  const [sent, setSent] = React.useState<string[]>([])
  return (
    <div style={{ marginTop: 16 }}>
      <textarea
        className="entry"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a comment…"
        style={{ width: '100%', height: 70, resize: 'vertical' }}
      />
      <div style={{ marginTop: 8 }}>
        <Btn
          onClick={() => {
            if (!text.trim()) return
            setSent((s) => [...s, text.trim()])
            setText('')
          }}
        >
          Post comment
        </Btn>
      </div>
      {sent.map((c, i) => (
        <div key={i} style={{ borderTop: '1px solid #eef0ec', padding: '10px 0', fontSize: 13.5 }}>
          <strong style={{ color: '#4c8f1f' }}>you</strong>
          <div style={{ marginTop: 3 }}>{c}</div>
        </div>
      ))}
    </div>
  )
}

/* ==========================================================================
   site definitions
   ========================================================================== */

export const MIXTNET: SiteDef = {
  domain: 'mixtnet.com',
  aliases: ['mixt.net', 'mixtnet'],
  title: 'MixtNet',
  glyph: 'Compass',
  color: '#61ad2b',
  color2: '#2f6b12',
  description: 'The friendly index of the MixtNet, with search, news, weather and a directory of sites.',
  tags: ['search', 'portal', 'home page', 'directory'],
  defaultPath: '/',
  pages: [
    { path: '/', title: 'MixtNet — search the web', keywords: ['search engine', 'portal', 'home'], snippet: 'Search the MixtNet, browse the directory and check the weather.', render: (ctx) => <PortalHome ctx={ctx} /> },
  ],
  text: (path, query) => {
    if (path === '/' || path === '') {
      return [
        '                     MIXTNET',
        '============================================',
        ' Search:  https://mixtnet.com/  (or use Mixtsfox Search in the browser)',
        '',
        ' Sites on the MixtNet',
        '   mixtpedia.org   the free encyclopaedia',
        '   mixtnews.com    news, analysis, opinion',
        '   mixtube.com     video',
        '   mixtbook.com    social',
        '   mixtcart.com    shop',
        '   mixtmaps.com    maps',
        '   mixtmail.com    webmail',
        '   mixtgames.com   browser games',
        '   mixtdev.io      developer docs',
        '   mixtos.com   the distribution that inspired this',
        '   mixt.dev      about this operating system',
      ].join('\n')
    }
    return `MixtNet: no text version of ${path}`
  },
}

export const MIXTPEDIA: SiteDef = {
  domain: 'mixtpedia.org',
  aliases: ['wikipedia.org', 'en.wikipedia.org'],
  title: 'MixtPedia',
  glyph: 'BookOpen',
  color: '#3b4c5a',
  color2: '#1f2933',
  description: 'The free encyclopaedia of computing, written one article at a time.',
  tags: ['encyclopaedia', 'articles', 'reference'],
  defaultPath: '/',
  pages: [
    {
      path: '/',
      title: 'MixtPedia — main page',
      keywords: ['encyclopaedia', 'articles', 'reference', 'wiki'],
      snippet: 'Main page of the free encyclopaedia with featured and recent articles.',
      render: (ctx) => (
        <SiteShell site={MIXTPEDIA} ctx={ctx} nav={[{ label: 'All articles', href: 'https://mixtpedia.org/all' }, { label: 'Random', href: 'https://mixtpedia.org/random' }]}>
          <div style={{ background: '#f7faf4', border: '1px solid #dfe3dd', borderRadius: 10, padding: 18, marginBottom: 20 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#2f6b12' }}>Welcome to MixtPedia</div>
            <div style={{ color: '#5c665f', marginTop: 4 }}>
              The free encyclopaedia that anybody can read, because it ships with the operating system. {ARTICLES.length} articles and counting.
            </div>
          </div>
          <H level={2}>Featured article</H>
          <Card>
            <A ctx={ctx} href="https://mixtpedia.org/article/mixt-os" style={{ fontSize: 17, fontWeight: 600, textDecoration: 'none' }}>
              Mixt OS
            </A>
            <p style={{ lineHeight: 1.7, color: '#39413b' }}>{ARTICLES[0].summary}</p>
            <A ctx={ctx} href="https://mixtpedia.org/article/mixt-os">
              Read the article →
            </A>
          </Card>
          <H level={2}>All articles</H>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 10 }}>
            {ARTICLES.map((a) => (
              <Card key={a.slug} style={{ cursor: 'pointer' }} onClick={() => ctx.navigate(`https://mixtpedia.org/article/${a.slug}`)}>
                <div style={{ fontWeight: 500 }}>{a.title}</div>
                <Meta>{a.category}</Meta>
              </Card>
            ))}
          </div>
        </SiteShell>
      ),
    },
    {
      path: '/all',
      title: 'MixtPedia — all articles',
      keywords: ['index', 'list', 'all pages'],
      snippet: 'Every article in the encyclopaedia, grouped by category.',
      render: (ctx) => (
        <SiteShell site={MIXTPEDIA} ctx={ctx}>
          <H level={1}>All articles</H>
          <ul style={{ lineHeight: 2 }}>
            {ARTICLES.map((a) => (
              <li key={a.slug}>
                <A ctx={ctx} href={`https://mixtpedia.org/article/${a.slug}`} style={{ textDecoration: 'none' }}>
                  {a.title}
                </A>{' '}
                <span style={{ color: '#8a938d', fontSize: 12 }}>— {a.category}</span>
              </li>
            ))}
          </ul>
        </SiteShell>
      ),
    },
    {
      path: '/random',
      title: 'MixtPedia — random article',
      keywords: ['random', 'surprise'],
      snippet: 'A random article from the encyclopaedia.',
      render: (ctx) => {
        const a = ARTICLES[Math.floor(Math.random() * ARTICLES.length)]
        return <ArticlePage ctx={ctx} slug={a.slug} />
      },
    },
    {
      path: '/article',
      title: 'MixtPedia article',
      keywords: ['article', 'mixt os', 'mixt shell', 'browser', 'javascript', 'terminal', 'kernel', 'http', 'localstorage'],
      snippet: 'Encyclopaedia article on computing topics.',
      render: (ctx) => {
        const slug = ctx.path.split('/')[2] ?? 'mixt-os'
        return <ArticlePage ctx={ctx} slug={slug} />
      },
    },
  ],
  deepEntries: ARTICLES.map((a) => ({
    url: `https://mixtpedia.org/article/${a.slug}`,
    title: a.title,
    snippet: a.summary,
    keywords: [a.category, ...(a.see ?? []), ...a.sections.map((s) => s.h)],
  })),
  text: (path) => {
    const slug = path.split('/')[2]
    const article = ARTICLES.find((a) => a.slug === slug)
    if (!article) {
      return ['MixtPedia — main page', '=====================', '', 'Articles:', ...ARTICLES.map((a) => `  - https://mixtpedia.org/article/${a.slug}  (${a.title})`)].join('\n')
    }
    return articleText(article)
  },
}

export const MIXTNEWS: SiteDef = {
  domain: 'mixtnews.com',
  aliases: ['news.mixt.com'],
  title: 'MixtNews',
  glyph: 'Newspaper',
  color: '#b8532f',
  color2: '#7a2f14',
  description: 'News, analysis and opinion about desktops, browsers and the MixtNet.',
  tags: ['news', 'articles', 'headlines'],
  defaultPath: '/',
  pages: [
    { path: '/', title: 'MixtNews — front page', keywords: ['news', 'headlines', 'newspaper', 'today'], snippet: 'The front page of MixtNews with the latest desktop and internet stories.', render: (ctx) => <NewsHome ctx={ctx} /> },
    {
      path: '/article',
      title: 'MixtNews — story',
      keywords: ['story', 'article', 'mixt shell', 'kernel', 'browser as operating system'],
      snippet: 'A MixtNews story.',
      render: (ctx) => <NewsArticle ctx={ctx} slug={ctx.path.split('/')[2] ?? STORIES[0].slug} />,
    },
    {
      path: '/section',
      title: 'MixtNews — section',
      keywords: ['desktop', 'opinion', 'technology', 'development', 'culture'],
      snippet: 'Stories from one section of the newspaper.',
      render: (ctx) => {
        const section = decodeURIComponent(ctx.path.split('/')[2] ?? '').toLowerCase()
        const list = STORIES.filter((s) => s.section.toLowerCase() === section)
        return (
          <SiteShell site={MIXTNEWS} ctx={ctx} nav={[{ label: 'Front page', href: 'https://mixtnews.com/' }]}>
            <H level={1} style={{ textTransform: 'capitalize' }}>
              {section || 'All sections'}
            </H>
            {list.length === 0 ? (
              <p>No stories in that section yet.</p>
            ) : (
              list.map((s) => (
                <Card key={s.slug} style={{ marginBottom: 10, cursor: 'pointer' }} onClick={() => ctx.navigate(`https://mixtnews.com/article/${s.slug}`)}>
                  <div style={{ fontWeight: 600, fontSize: 16 }}>{s.title}</div>
                  <Meta>
                    {s.author} · {s.date}
                  </Meta>
                  <p style={{ margin: '8px 0 0', color: '#39413b' }}>{s.lead}</p>
                </Card>
              ))
            )}
          </SiteShell>
        )
      },
    },
  ],
  deepEntries: STORIES.map((s) => ({
    url: `https://mixtnews.com/article/${s.slug}`,
    title: s.title,
    snippet: s.lead,
    keywords: [s.section, s.author, s.date, ...s.body.slice(0, 1)],
  })),
  text: (path) => {
    if (path === '/' || path === '') {
      return ['MIXTNEWS — front page', '', ...STORIES.map((s, i) => `${i + 1}. ${s.title}\n   ${s.section} · ${s.date}\n   https://mixtnews.com/article/${s.slug}`)].join('\n')
    }
    const slug = path.split('/')[2]
    const story = STORIES.find((s) => s.slug === slug)
    return story ? storyText(story) : 'MixtNews: no such story.'
  },
}

export const PORTAL_SITES = [MIXTNET, MIXTPEDIA, MIXTNEWS]
