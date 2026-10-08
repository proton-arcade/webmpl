import React, { useState } from 'react'
import { HOME, vfs } from '../os/vfs'
import { AppIcon, Glyph } from '../shell/AppIcon'
import { launch, openUrl } from '../os/bus'
import { HOME_URL } from '../net'
import type { AppProps } from '../os/types'

const TOPICS: { id: string; title: string; glyph: string; body: React.ReactNode }[] = [
  {
    id: 'welcome',
    title: 'Welcome to Mint Web OS',
    glyph: 'Home',
    body: (
      <>
        <Para>
          Everything you are looking at is a web page pretending, convincingly, to be a Linux Mint desktop. There is a
          window manager, a panel with applets, a virtual filesystem, a terminal, a software store, a media player and a
          browser that surfs a fictional internet called the MintNet.
        </Para>
        <Steps
          items={[
            ['Look at the panel', 'The bottom bar holds the menu, quick launch buttons, the window list, workspaces, the tray and the clock.'],
            ['Open the menu', 'Click the green button on the left of the panel, or press the Super key.'],
            ['Try the terminal', 'It implements around ninety commands, plus pipes and redirection.'],
            ['Go exploring', 'The MintNet has a dozen sites: search, encyclopaedia, news, video, social, shop, maps, mail and games.'],
          ]}
        />
        <Actions
          items={[
            ['Open the Terminal', () => launch('terminal', {})],
            ['Open the Files app', () => launch('nemo', {})],
            ['Browse the MintNet', () => launch('browser', { url: HOME_URL })],
          ]}
        />
      </>
    ),
  },
  {
    id: 'desktop',
    title: 'Windows, workspaces and the panel',
    glyph: 'AppWindow',
    body: (
      <>
        <Para>
          Windows behave like Cinnamon windows: drag the title bar to move, double-click it to maximise, drag to a screen
          edge to snap to half or full width. The eight invisible handles around the frame resize it.
        </Para>
        <List
          items={[
            'Alt + Tab switches windows; release Alt to focus the highlighted one.',
            'Ctrl + Alt + ← / → moves between the four workspaces.',
            'The dots in the panel show the current workspace; click them to jump.',
            'Clicking the dots area opens the window spread, showing every window at once.',
            'Super + D shows the desktop; Super + ← / → snaps the active window.',
            'Middle-click or right-click a window list button for more options.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'files',
    title: 'Files and folders',
    glyph: 'FolderOpen',
    body: (
      <>
        <Para>
          Your files live in a virtual filesystem stored in your browser's localStorage, mounted at <Code>/</Code> with
          your home directory at <Code>~/</Code> (that is <Code>{HOME}</Code>). Everything survives a reboot of the page;
          nothing is sent anywhere.
        </Para>
        <List
          items={[
            'Double-click to open; the Files app picks a sensible application for each file type.',
            'Right-click for Open With, Cut, Copy, Rename, Compress, Extract, Trash and Properties.',
            'Ctrl + H shows hidden files (start with a dot), Ctrl + A selects everything.',
            'The Trash lives in ~/.local/share/Trash — you can browse it, and empty it from the toolbar menu.',
            'Create new files from the desktop right-click menu; they appear as desktop icons immediately.',
          ]}
        />
        <Actions items={[['Open ~/Documents', () => launch('nemo', { path: `${HOME}/Documents` })]]} />
      </>
    ),
  },
  {
    id: 'terminal',
    title: 'The terminal',
    glyph: 'Terminal',
    body: (
      <>
        <Para>
          The terminal is a small shell written for this project. It understands pipes (<Code>|</Code>), output
          redirection (<Code>&gt;</Code> and <Code>&gt;&gt;</Code>), tab completion and command history.
        </Para>
        <Pre>{`mint@mint-web:~$ neofetch
mint@mint-web:~$ ls -la ~/Documents | wc -l
mint@mint-web:~$ echo "hello" > ~/Desktop/hello.txt
mint@mint-web:~$ apt search game
mint@mint-web:~$ sudo apt install paint
mint@mint-web:~$ curl https://mintnews.com/`}</Pre>
        <Para>
          <Code>apt install</Code> really installs applications: they appear in the menu straight away. <Code>curl</Code>{' '}
          fetches plain-text renderings of MintNet pages.
        </Para>
        <Actions items={[['Open the Terminal', () => launch('terminal', {})]]} />
      </>
    ),
  },
  {
    id: 'mintnet',
    title: 'The MintNet — an internet inside the OS',
    glyph: 'Globe',
    body: (
      <>
        <Para>
          The Web Browser opens two kinds of address. MintNet sites are rendered inside the app as React components —
          instant, offline and searchable. Anything else is treated as a real website and loaded in an embedded frame,
          when the remote server allows embedding.
        </Para>
        <List
          items={[
            'mintpedia.org — an encyclopaedia with articles on Linux, browsers, kernels and void* pointers to nowhere.',
            'mintnews.com — a newspaper with a front page, sections and comments.',
            'mintube.com — a video site with a working (fake) player and likes.',
            'mintcart.com — a shop with a cart, checkout, and receipts saved into ~/Documents.',
            'mintmaps.com — a procedurally drawn map with panning, zoom and directions.',
            'linuxmint.com — downloads that really land in ~/Downloads.',
            'webmpl.dev — documentation for this operating system, including every keyboard shortcut.',
          ]}
        />
        <Para>
          Search boxes on MintNet sites feed a real inverted index over titles and keywords. Try searching for
          “cinnamon desktop” or “virtual filesystem”.
        </Para>
        <Actions
          items={[
            ['Open the MintNet portal', () => launch('browser', { url: 'https://mintnet.com/' })],
            ['Search for “linux mint”', () => launch('browser', { url: 'mintnet://search?q=linux%20mint' })],
          ]}
        />
      </>
    ),
  },
  {
    id: 'software',
    title: 'Installing software',
    glyph: 'ShoppingBag',
    body: (
      <>
        <Para>
          The Software Manager installs applications into the menu. Three extras are waiting: <strong>Drawing</strong>,{' '}
          <strong>Mail</strong> and <strong>News Reader</strong>.
        </Para>
        <List
          items={[
            'Open the Updates tab to see everything that is not installed yet.',
            'Install with one click, or type sudo apt install paint in the terminal.',
            'Installed applications appear in the menu immediately, under their category.',
            'Reset your filesystem from Settings ▸ Privacy if you want a clean slate.',
          ]}
        />
        <Actions items={[['Open the Software Manager', () => launch('mintinstall', {})]]} />
      </>
    ),
  },
  {
    id: 'customise',
    title: 'Themes, backgrounds and the panel',
    glyph: 'Palette',
    body: (
      <>
        <Para>
          System Settings ▸ Appearance switches between the light and dark Mint-Y themes and eight accent colours. The
          accent colour flows through selections, switches and the panel menu button.
        </Para>
        <List
          items={[
            'Backgrounds: three wallpapers plus any PNG/JPG stored in ~/Pictures.',
            'Panel: move it to the top, resize it, auto-hide it, and change the clock format.',
            'Desktop: choose which applications get a desktop icon.',
            'Users: change your name, hostname and avatar — the terminal prompt follows along.',
          ]}
        />
        <Actions items={[['Open System Settings', () => launch('settings', {})]]} />
      </>
    ),
  },
  {
    id: 'shortcuts',
    title: 'Keyboard shortcuts',
    glyph: 'Type',
    body: (
      <>
        <Pre>{`Super                Open the main menu
Alt + Tab            Switch windows (release Alt to focus)
Ctrl + Alt + T       New terminal
Ctrl + Alt + ←/→     Previous / next workspace
Super + D            Show the desktop
Super + ←/→/↑        Snap left / right / maximise
Alt + F2             Run a command
Alt + F4             Close the active window
Ctrl + Alt + L       Lock the screen
Esc                  Close menus and dialogs`}</Pre>
        <Para>
          Inside the browser: Ctrl + T new tab, Ctrl + W close tab, Ctrl + L focus the address bar, Alt + ← back.
        </Para>
      </>
    ),
  },
  {
    id: 'honesty',
    title: 'What is real, what is pretend',
    glyph: 'Info',
    body: (
      <>
        <Para>Being honest about the seams makes them easier to enjoy.</Para>
        <List
          items={[
            'Real: window management, the filesystem (localStorage), the shell, the search index, downloads, themes, settings.',
            'Real: screen capture via the browser API, when the browser allows it.',
            'Pretend: the kernel version, the CPU, the battery, the network and the map.',
            'Pretend: every MintNet website and everything on it.',
            'Not present: a real network stack, real package archives and any telemetry whatsoever.',
          ]}
        />
        <Para>
          Nothing here talks to a server. You can close the tab, come back tomorrow, and your documents will be waiting.
        </Para>
        <div style={{ marginTop: 8, opacity: 0.7, fontSize: 12.5 }}>
          Filesystem now contains {Object.keys((vfs.node('/') as any)?.children ?? {}).length} top-level entries, and{' '}
          {new Date().getFullYear()} is going well.
        </div>
      </>
    ),
  },
]

function Para({ children }: { children: React.ReactNode }) {
  return <p style={{ lineHeight: 1.75, fontSize: 13.8, marginTop: 0 }}>{children}</p>
}
function Code({ children }: { children: React.ReactNode }) {
  return (
    <code style={{ background: 'rgba(128,136,132,0.18)', padding: '1px 5px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>
      {children}
    </code>
  )
}
function Pre({ children }: { children: string }) {
  return (
    <pre
      style={{
        background: '#1e2327',
        color: '#d7dbd8',
        padding: 12,
        borderRadius: 8,
        fontSize: 12.5,
        lineHeight: 1.55,
        overflow: 'auto',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {children}
    </pre>
  )
}
function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul style={{ lineHeight: 1.8, fontSize: 13.5, paddingLeft: 20 }}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}
function Steps({ items }: { items: [string, string][] }) {
  return (
    <ol style={{ lineHeight: 1.7, fontSize: 13.5, paddingLeft: 20 }}>
      {items.map(([title, text]) => (
        <li key={title} style={{ marginBottom: 6 }}>
          <strong>{title}</strong> — {text}
        </li>
      ))}
    </ol>
  )
}
function Actions({ items }: { items: [string, () => void][] }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
      {items.map(([label, action]) => (
        <button key={label} className="btn-mint" onClick={action}>
          <Glyph name="Play" size={13} /> {label}
        </button>
      ))}
    </div>
  )
}

export default function HelpApp({ api }: AppProps) {
  const [topic, setTopic] = useState(TOPICS[0].id)
  const current = TOPICS.find((t) => t.id === topic) ?? TOPICS[0]

  React.useEffect(() => {
    api.setTitle(`${current.title} — Help`)
  }, [current.id])

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, background: 'var(--wm-window-bg)' }}>
      <div style={{ width: 220, flex: 'none', borderRight: '1px solid rgba(0,0,0,0.16)', padding: '10px 6px', overflow: 'auto', background: 'color-mix(in srgb, var(--wm-window-bg) 92%, #808890)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '0 6px 12px' }}>
          <AppIcon glyph="HelpCircle" color="#3fa89a" color2="#17685e" size={30} />
          <div>
            <div style={{ fontWeight: 600 }}>Help</div>
            <div style={{ fontSize: 11.5, opacity: 0.7 }}>Mint Web OS 1.0</div>
          </div>
        </div>
        {TOPICS.map((t) => (
          <div
            key={t.id}
            className="menu-item"
            style={{ background: topic === t.id ? 'color-mix(in srgb, var(--wm-accent) 40%, transparent)' : undefined }}
            onClick={() => setTopic(t.id)}
          >
            <Glyph name={t.glyph} size={14} />
            <span style={{ flex: 1 }}>{t.title}</span>
          </div>
        ))}
        <div className="menu-sep" />
        <div className="menu-item" onClick={() => openUrl('https://webmpl.dev/shortcuts')}>
          <Glyph name="Globe" size={14} /> Read it on the MintNet
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: '20px 26px', maxWidth: 720 }}>
        <h1 style={{ marginTop: 0, fontSize: 24 }}>{current.title}</h1>
        {current.body}
      </div>
    </div>
  )
}
