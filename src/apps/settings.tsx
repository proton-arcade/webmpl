import React, { useMemo, useState } from 'react'
import { useOS, DEFAULT_SETTINGS } from '../os/store'
import { useVFS, vfs, HOME, humanSize, nodeSize, join } from '../os/vfs'
import { AppIcon, Glyph } from '../shell/AppIcon'
import { Dialog } from './files'
import { APPS } from './registry'
import { notify } from '../os/bus'
import type { AppProps } from '../os/types'

const SECTIONS = [
  { id: 'appearance', label: 'Appearance', glyph: 'Palette', group: 'Look and feel' },
  { id: 'background', label: 'Backgrounds', glyph: 'Image', group: 'Look and feel' },
  { id: 'themes', label: 'Themes', glyph: 'Sparkles', group: 'Look and feel' },
  { id: 'panel', label: 'Panel', glyph: 'LayoutGrid', group: 'Look and feel' },
  { id: 'desktop', label: 'Desktop', glyph: 'Monitor', group: 'Look and feel' },
  { id: 'display', label: 'Display', glyph: 'Monitor', group: 'Hardware' },
  { id: 'sound', label: 'Sound', glyph: 'Volume2', group: 'Hardware' },
  { id: 'network', label: 'Network', glyph: 'Wifi', group: 'Hardware' },
  { id: 'power', label: 'Power Management', glyph: 'Zap', group: 'Hardware' },
  { id: 'clock', label: 'Date &amp; Time', glyph: 'Clock', group: 'System' },
  { id: 'startup', label: 'Startup Applications', glyph: 'Play', group: 'System' },
  { id: 'users', label: 'Users &amp; Groups', glyph: 'User', group: 'System' },
  { id: 'privacy', label: 'Privacy', glyph: 'Shield', group: 'System' },
  { id: 'info', label: 'System Info', glyph: 'Info', group: 'System' },
]

const ACCENTS: [string, string][] = [
  ['#9ede6a', 'Mint-Y'],
  ['#4a9be8', 'Mint-Y-Aqua'],
  ['#4aa8a0', 'Mint-Y-Teal'],
  ['#e0793a', 'Mint-Y-Orange'],
  ['#e05f8a', 'Mint-Y-Pink'],
  ['#8b5cf6', 'Mint-Y-Purple'],
  ['#e8b64c', 'Mint-Y-Sand'],
  ['#b8532f', 'Mint-Y-Red'],
]

export default function SettingsApp({ win, api }: AppProps) {
  const settings = useOS((s) => s.settings)
  const setSettings = useOS((s) => s.setSettings)
  const [page, setPage] = useState<string>(win.props?.page ?? 'appearance')
  const [confirmReset, setConfirmReset] = useState(false)

  React.useEffect(() => {
    if (win.props?.page && win.props.page !== page) setPage(win.props.page)
  }, [win.props?.page])

  React.useEffect(() => {
    const label = SECTIONS.find((s) => s.id === page)?.label.replace('&amp;', '&') ?? 'Settings'
    api.setTitle(`${label} — System Settings`)
  }, [page])

  const grouped = useMemo(() => {
    const out: { group: string; items: typeof SECTIONS }[] = []
    for (const s of SECTIONS) {
      const g = out.find((x) => x.group === s.group)
      if (g) g.items.push(s)
      else out.push({ group: s.group, items: [s] })
    }
    return out
  }, [])

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, background: 'var(--wm-window-bg)' }}>
      {/* sidebar */}
      <div style={{ width: 205, flex: 'none', overflow: 'auto', borderRight: '1px solid rgba(0,0,0,0.16)', padding: '10px 6px', background: 'color-mix(in srgb, var(--wm-window-bg) 92%, #808890)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '0 6px 12px' }}>
          <AppIcon glyph="Settings" color="#7d8a95" color2="#4d565e" size={30} />
          <div style={{ fontWeight: 600 }}>System Settings</div>
        </div>
        {grouped.map((g) => (
          <div key={g.group} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.6, padding: '4px 8px' }}>{g.group}</div>
            {g.items.map((s) => (
              <div
                key={s.id}
                className="menu-item"
                style={{ background: page === s.id ? 'color-mix(in srgb, var(--wm-accent) 40%, transparent)' : undefined }}
                onClick={() => setPage(s.id)}
              >
                <Glyph name={s.glyph} size={15} />
                <span style={{ flex: 1 }}>{s.label.replace('&amp;', '&')}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* content */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 20 }}>
        {page === 'appearance' && <Appearance />}
        {page === 'background' && <Background />}
        {page === 'themes' && <Themes />}
        {page === 'panel' && <PanelSection />}
        {page === 'desktop' && <DesktopSection />}
        {page === 'display' && <DisplaySection />}
        {page === 'sound' && <SoundSection />}
        {page === 'network' && <NetworkSection />}
        {page === 'power' && <PowerSection />}
        {page === 'clock' && <ClockSection />}
        {page === 'startup' && <StartupSection />}
        {page === 'users' && <UsersSection />}
        {page === 'privacy' && <PrivacySection onReset={() => setConfirmReset(true)} />}
        {page === 'info' && <InfoSection />}
      </div>

      {confirmReset && <ResetDialog onClose={() => setConfirmReset(false)} />}
    </div>
  )
}

/* ------------------------------- primitives ------------------------------- */

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 620 }}>
      <h2 style={{ margin: '0 0 2px', fontSize: 19, fontWeight: 600 }}>{title}</h2>
      {subtitle && <div style={{ opacity: 0.7, marginBottom: 14 }}>{subtitle}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>{children}</div>
    </div>
  )
}

function Card({ title, children, hint }: { title?: string; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.14)', borderRadius: 9, padding: 14, background: 'color-mix(in srgb, var(--wm-window-bg) 94%, #ffffff)' }}>
      {title && <div style={{ fontWeight: 600, marginBottom: 8 }}>{title}</div>}
      {children}
      {hint && <div style={{ opacity: 0.65, fontSize: 12, marginTop: 8 }}>{hint}</div>}
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '5px 0' }}>
      <div style={{ width: 210, flex: 'none' }}>
        <div>{label}</div>
        {hint && <div style={{ opacity: 0.6, fontSize: 11.5 }}>{hint}</div>}
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <span
      onClick={() => onChange(!value)}
      style={{
        display: 'inline-flex',
        width: 44,
        height: 24,
        borderRadius: 999,
        background: value ? 'var(--wm-accent)' : 'rgba(128,136,132,0.55)',
        padding: 3,
        cursor: 'pointer',
        transition: 'background .15s linear',
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 999,
          background: '#fff',
          transform: value ? 'translateX(20px)' : 'none',
          transition: 'transform .15s ease-out',
          boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
        }}
      />
    </span>
  )
}

function Select({ value, onChange, options }: { value: any; onChange: (v: any) => void; options: [any, string][] }) {
  return (
    <select className="entry" value={value} onChange={(e) => onChange(e.target.value)} style={{ minWidth: 160 }}>
      {options.map(([v, label]) => (
        <option key={String(v)} value={v}>
          {label}
        </option>
      ))}
    </select>
  )
}

function Slider({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: 220, accentColor: 'var(--wm-accent)' }} />
}

/* -------------------------------- sections -------------------------------- */

function Appearance() {
  const settings = useOS((s) => s.settings)
  const setSettings = useOS((s) => s.setSettings)
  return (
    <Section title="Appearance" subtitle="Choose a theme, an accent colour and the window button position.">
      <Card title="Style">
        <Row label="Theme">
          <div style={{ display: 'flex', gap: 10 }}>
            {(['light', 'dark'] as const).map((scheme) => (
              <div
                key={scheme}
                onClick={() => setSettings({ scheme, themeName: scheme === 'dark' ? 'Mint-Y-Dark' : 'Mint-Y' })}
                style={{
                  width: 132,
                  borderRadius: 8,
                  overflow: 'hidden',
                  border: settings.scheme === scheme ? '2px solid var(--wm-accent)' : '1px solid rgba(0,0,0,0.25)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ height: 54, background: scheme === 'dark' ? '#2f3336' : '#f7f8f6', padding: 6 }}>
                  <div style={{ height: 9, borderRadius: 3, background: scheme === 'dark' ? '#4b5054' : '#c9cec6' }} />
                  <div style={{ height: 22, marginTop: 5, borderRadius: 3, background: scheme === 'dark' ? '#3a3f42' : '#ffffff', border: '1px solid rgba(0,0,0,0.2)' }} />
                </div>
                <div style={{ padding: '5px 8px', fontSize: 12.5, textAlign: 'center', textTransform: 'capitalize' }}>{scheme}</div>
              </div>
            ))}
          </div>
        </Row>
        <Row label="Accent colour" hint="Used for selections, switches and highlights">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ACCENTS.map(([hex, name]) => (
              <div
                key={hex}
                title={name}
                onClick={() => setSettings({ accent: hex })}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 999,
                  background: hex,
                  cursor: 'pointer',
                  border: settings.accent === hex ? '3px solid var(--wm-window-fg)' : '1px solid rgba(0,0,0,0.3)',
                }}
              />
            ))}
          </div>
        </Row>
        <Row label="Window buttons" hint="Side of the title bar">
          <Select
            value={settings.buttonSide}
            onChange={(v) => setSettings({ buttonSide: v })}
            options={[
              ['right', 'Right (Mint default)'],
              ['left', 'Left (Ubuntu style)'],
            ]}
          />
        </Row>
      </Card>
      <Card title="Effects">
        <Row label="Desktop effects" hint="Animations when windows open">
          <Toggle value={settings.effects} onChange={(v) => setSettings({ effects: v })} />
        </Row>
        <Row label="Favourite applications" hint="Shown on the desktop">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {APPS.map((a) => (
              <span
                key={a.id}
                onClick={() =>
                  setSettings({
                    desktopIcons: settings.desktopIcons.includes(a.id)
                      ? settings.desktopIcons.filter((d) => d !== a.id)
                      : [...settings.desktopIcons, a.id],
                  })
                }
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 10px',
                  borderRadius: 999,
                  cursor: 'pointer',
                  border: '1px solid rgba(0,0,0,0.16)',
                  background: settings.desktopIcons.includes(a.id) ? 'color-mix(in srgb, var(--wm-accent) 34%, transparent)' : undefined,
                }}
              >
                <AppIcon glyph={a.glyph} color={a.color} color2={a.color2} size={18} />
                {a.name}
              </span>
            ))}
          </div>
        </Row>
      </Card>
    </Section>
  )
}

function Background() {
  const settings = useOS((s) => s.settings)
  const setSettings = useOS((s) => s.setSettings)
  const revision = useVFS((s) => s.revision)
  const wallpapers = Object.keys((vfs.node('/usr/share/backgrounds') as any)?.children ?? {})
  const pictures = useMemo(() => {
    const list = vfs.list(`${HOME}/Pictures`) ?? []
    const out: { name: string; url?: string }[] = []
    const walk = (path: string) => {
      for (const entry of vfs.list(path) ?? []) {
        const child = entry.node
        if (child.type === 'dir') walk(join(path, entry.name))
        else if ((child as any).mime?.startsWith('image/')) out.push({ name: entry.name, url: (child as any).url })
      }
    }
    walk(`${HOME}/Pictures`)
    return out
  }, [revision])

  const colours = ['#1f3a0e', '#20404a', '#2b2e31', '#3a2f4a', '#4a3a2f', '#5a6b4a']

  return (
    <Section title="Backgrounds" subtitle="Pick a wallpaper, or use a picture from ~/Pictures.">
      <Card title="Wallpapers">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 12 }}>
          {wallpapers.map((w) => {
            const url = `/wallpapers/${w}`
            return (
              <div key={w} onClick={() => setSettings({ wallpaper: url })} style={{ cursor: 'pointer' }}>
                <div
                  style={{
                    height: 92,
                    borderRadius: 8,
                    backgroundImage: `url(${url})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    border: settings.wallpaper === url ? '3px solid var(--wm-accent)' : '1px solid rgba(0,0,0,0.25)',
                  }}
                />
                <div style={{ fontSize: 12, marginTop: 4, textAlign: 'center', opacity: 0.85 }}>{w.replace('.jpg', '').replace('mint-', 'Mint ')}</div>
              </div>
            )
          })}
        </div>
      </Card>
      <Card title="Solid colours">
        <div style={{ display: 'flex', gap: 10 }}>
          {colours.map((c) => (
            <div
              key={c}
              onClick={() => setSettings({ wallpaper: c })}
              style={{
                width: 46,
                height: 32,
                borderRadius: 6,
                background: c,
                cursor: 'pointer',
                border: settings.wallpaper === c ? '3px solid var(--wm-accent)' : '1px solid rgba(0,0,0,0.3)',
              }}
            />
          ))}
        </div>
      </Card>
      <Card title="Your pictures" hint="Images in ~/Pictures can be used as backgrounds. Download wallpapers from mintcart.com to add more.">
        {pictures.length === 0 ? (
          <div style={{ opacity: 0.7 }}>No images found in ~/Pictures.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 10 }}>
            {pictures.map((p) => (
              <div key={p.name} onClick={() => p.url && setSettings({ wallpaper: p.url })} style={{ cursor: 'pointer' }}>
                <div
                  style={{
                    height: 70,
                    borderRadius: 6,
                    background: p.url ? `url(${p.url}) center/cover` : '#888',
                    border: settings.wallpaper === p.url ? '3px solid var(--wm-accent)' : '1px solid rgba(0,0,0,0.25)',
                  }}
                />
                <div style={{ fontSize: 11.5, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </Section>
  )
}

function Themes() {
  const settings = useOS((s) => s.settings)
  const setSettings = useOS((s) => s.setSettings)
  const themes: [string, string, string][] = [
    ['Mint-Y', 'light', '#9ede6a'],
    ['Mint-Y-Dark', 'dark', '#9ede6a'],
    ['Mint-Y-Aqua', 'light', '#4a9be8'],
    ['Mint-Y-Teal', 'light', '#4aa8a0'],
    ['Mint-Y-Purple', 'light', '#8b5cf6'],
    ['Mint-Y-Sand', 'light', '#e8b64c'],
  ]
  return (
    <Section title="Themes" subtitle="Themes bundle window decorations, controls and this accent colour.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 12 }}>
        {themes.map(([name, scheme, accent]) => (
          <div
            key={name}
            onClick={() => setSettings({ themeName: name, scheme: scheme as any, accent })}
            style={{
              border: settings.themeName === name ? '2px solid var(--wm-accent)' : '1px solid rgba(0,0,0,0.2)',
              borderRadius: 9,
              padding: 12,
              cursor: 'pointer',
              background: 'color-mix(in srgb, var(--wm-window-bg) 94%, #ffffff)',
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ width: 34, height: 34, borderRadius: 8, background: `linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 60%, #000))` }} />
              <div>
                <div style={{ fontWeight: 600 }}>{name}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{scheme === 'dark' ? 'Dark theme' : 'Light theme'}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <Card title="Other themes" hint="More themes can be installed from the Software Manager (coming soon, along with everything else).">
        <Row label="Icon theme">
          <Select
            value={settings.iconTheme}
            onChange={(v) => setSettings({ iconTheme: v })}
            options={[
              ['Mint-Y', 'Mint-Y'],
              ['Mint-Y-Sand', 'Mint-Y-Sand'],
              ['Mint-X', 'Mint-X (classic)'],
            ]}
          />
        </Row>
      </Card>
    </Section>
  )
}

function PanelSection() {
  const settings = useOS((s) => s.settings)
  const setSettings = useOS((s) => s.setSettings)
  return (
    <Section title="Panel" subtitle="Where the panel lives, how big it is and what the clock says.">
      <Card>
        <Row label="Position">
          <Select
            value={settings.panelPosition}
            onChange={(v) => setSettings({ panelPosition: v })}
            options={[
              ['bottom', 'Bottom of the screen'],
              ['top', 'Top of the screen'],
            ]}
          />
        </Row>
        <Row label="Panel height" hint={`${settings.panelSize} pixels`}>
          <Slider value={settings.panelSize} min={30} max={60} onChange={(v) => setSettings({ panelSize: v })} />
        </Row>
        <Row label="Auto-hide panel">
          <Toggle value={settings.panelAutohide} onChange={(v) => setSettings({ panelAutohide: v })} />
        </Row>
        <Row label="Use 24-hour clock">
          <Toggle value={settings.clock24} onChange={(v) => setSettings({ clock24: v })} />
        </Row>
        <Row label="Show seconds in the clock">
          <Toggle value={settings.clockSeconds} onChange={(v) => setSettings({ clockSeconds: v })} />
        </Row>
      </Card>
      <Card title="Applets" hint="Menu, quick launch, window list, workspace switcher, network, sound, battery, clock and the session menu are all present.">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['Menu', 'Quick launch', 'Window list', 'Workspaces', 'Network', 'Sound', 'Battery', 'Clock', 'Session'].map((a) => (
            <span key={a} style={{ border: '1px solid rgba(0,0,0,0.16)', borderRadius: 999, padding: '4px 10px', fontSize: 12.5 }}>
              {a}
            </span>
          ))}
        </div>
      </Card>
    </Section>
  )
}

function DesktopSection() {
  const settings = useOS((s) => s.settings)
  const setSettings = useOS((s) => s.setSettings)
  return (
    <Section title="Desktop" subtitle="Desktop icons and the hot corner.">
      <Card>
        <Row label="Hot corner" hint="Pushing the pointer into the top-left corner opens the menu">
          <Toggle value={settings.hotCorner} onChange={(v) => setSettings({ hotCorner: v })} />
        </Row>
        <Row label="Focus mode">
          <Select
            value={settings.focusMode}
            onChange={(v) => setSettings({ focusMode: v })}
            options={[
              ['click', 'Click to focus'],
              ['sloppy', 'Focus follows mouse (pretend)'],
            ]}
          />
        </Row>
      </Card>
      <Card title="Desktop icons">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {APPS.map((a) => (
            <span
              key={a.id}
              onClick={() =>
                setSettings({
                  desktopIcons: settings.desktopIcons.includes(a.id)
                    ? settings.desktopIcons.filter((d) => d !== a.id)
                    : [...settings.desktopIcons, a.id],
                })
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 10px',
                borderRadius: 999,
                cursor: 'pointer',
                border: '1px solid rgba(0,0,0,0.16)',
                background: settings.desktopIcons.includes(a.id) ? 'color-mix(in srgb, var(--wm-accent) 34%, transparent)' : undefined,
              }}
            >
              <AppIcon glyph={a.glyph} color={a.color} color2={a.color2} size={18} />
              {a.name}
            </span>
          ))}
        </div>
      </Card>
    </Section>
  )
}

function DisplaySection() {
  const settings = useOS((s) => s.settings)
  const setSettings = useOS((s) => s.setSettings)
  const [zoom, setZoom] = useState(1)
  const [refresh, setRefresh] = useState(60)
  return (
    <Section title="Display" subtitle="One monitor, comfortably arranged.">
      <Card>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
          <div style={{ width: 210, height: 130, border: '2px solid var(--wm-window-fg)', borderRadius: 10, display: 'grid', placeItems: 'center', background: 'rgba(128,136,132,0.15)' }}>
            <div style={{ textAlign: 'center' }}>
              <Glyph name="Monitor" size={34} />
              <div style={{ fontSize: 12.5, marginTop: 4 }}>Virtual Display</div>
              <div style={{ fontSize: 11.5, opacity: 0.7 }}>
                {window.innerWidth}×{window.innerHeight}
              </div>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <Row label="Resolution">
              <Select
                value={`${window.innerWidth}x${window.innerHeight}`}
                onChange={() => notify('Display', 'Resolution follows your browser window in the web edition.')}
                options={[[`${window.innerWidth}x${window.innerHeight}`, 'Current (browser window)']]}
              />
            </Row>
            <Row label="Refresh rate">
              <Select value={refresh} onChange={setRefresh} options={[[60, '60 Hz'], [75, '75 Hz'], [144, '144 Hz (optimistic)']]} />
            </Row>
            <Row label="Interface scale" hint="Applied to window contents">
              <Slider value={Math.round(zoom * 100)} min={80} max={140} onChange={(v) => setZoom(v / 100)} />
            </Row>
          </div>
        </div>
      </Card>
      <Card title="Night light" hint="Warms the colours after dark.">
        <Row label="Enable night light">
          <Toggle
            value={settings.scheme === 'dark'}
            onChange={(v) => setSettings({ scheme: v ? 'dark' : 'light', themeName: v ? 'Mint-Y-Dark' : 'Mint-Y' })}
          />
        </Row>
      </Card>
    </Section>
  )
}

function SoundSection() {
  const settings = useOS((s) => s.settings)
  const setSettings = useOS((s) => s.setSettings)
  const [output, setOutput] = useState('Built-in Audio (virtual)')
  return (
    <Section title="Sound" subtitle="Volume, alerts and the virtual sound card.">
      <Card>
        <Row label="Output volume" hint={settings.muted ? 'Muted' : `${settings.volume}%`}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Slider value={settings.volume} min={0} max={100} onChange={(v) => setSettings({ volume: v, muted: v === 0 })} />
            <Toggle value={!settings.muted} onChange={(v) => setSettings({ muted: !v })} />
          </div>
        </Row>
        <Row label="Output device">
          <Select value={output} onChange={setOutput} options={[['Built-in Audio (virtual)', 'Built-in Audio (virtual)'], ['HDMI / DisplayPort', 'HDMI / DisplayPort'], ['WebAudio Synth', 'WebAudio Synth']]} />
        </Row>
        <Row label="Alert sound">
          <button className="btn-ghost" onClick={() => window.dispatchEvent(new CustomEvent('webmpl:notify', { detail: { title: 'Alert', body: 'That is the alert sound. It is a notification. This is the web.' } }))}>
            <Glyph name="Volume2" size={14} /> Test sound
          </button>
        </Row>
      </Card>
    </Section>
  )
}

function NetworkSection() {
  const settings = useOS((s) => s.settings)
  const setSettings = useOS((s) => s.setSettings)
  const nets = [
    ['MintNet', 'WPA2', true],
    ['MintNet Guest', 'open', false],
    ['Cinnamon-5G', 'WPA2', false],
    ['Neighbour_2.4GHz', 'WPA2', false],
  ] as [string, string, boolean][]
  return (
    <Section title="Network" subtitle="Wireless networks in range.">
      <Card title="Wi-Fi">
        <Row label="Wireless">
          <Toggle value={settings.wifi} onChange={(v) => setSettings({ wifi: v })} />
        </Row>
        {nets.map(([name, security, connected]) => (
          <div key={name} className="menu-item" style={{ padding: '7px 9px' }}>
            <Glyph name={connected ? 'Wifi' : 'WifiOff'} size={15} />
            <span style={{ flex: 1 }}>{name}</span>
            <span style={{ opacity: 0.7, fontSize: 12 }}>{security}</span>
            {connected && <span style={{ color: 'var(--wm-accent-dim)', fontSize: 12 }}>connected</span>}
          </div>
        ))}
      </Card>
      <Card title="Wired">
        <Row label="Ethernet" hint="10.0.2.15 · 1 Gbit/s (virtual)">
          <span style={{ opacity: 0.75 }}>cable unplugged, metaphorically</span>
        </Row>
      </Card>
    </Section>
  )
}

function PowerSection() {
  const [mode, setMode] = useState('balanced')
  const [blank, setBlank] = useState(5)
  return (
    <Section title="Power Management" subtitle="Battery, brightness and what happens when you stop using the computer.">
      <Card>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <Glyph name="BatteryCharging" size={42} />
          <div>
            <div style={{ fontSize: 24, fontWeight: 600 }}>87%</div>
            <div style={{ opacity: 0.75 }}>Discharging · 3 h 41 m remaining · 5,200 mAh design capacity</div>
          </div>
        </div>
      </Card>
      <Card title="Power mode">
        <Row label="Mode">
          <Select
            value={mode}
            onChange={setMode}
            options={[
              ['performance', 'Performance'],
              ['balanced', 'Balanced'],
              ['saver', 'Power saver'],
            ]}
          />
        </Row>
        <Row label="Blank screen after">
          <Select value={blank} onChange={setBlank} options={[[1, '1 minute'], [5, '5 minutes'], [10, '10 minutes'], [0, 'Never']]} />
        </Row>
      </Card>
    </Section>
  )
}

function ClockSection() {
  const settings = useOS((s) => s.settings)
  const setSettings = useOS((s) => s.setSettings)
  const [tz, setTz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [ntp, setNtp] = useState(true)
  return (
    <Section title="Date & Time" subtitle="The clock reads your system clock, so it is suspiciously accurate.">
      <Card>
        <Row label="Current time">
          <span style={{ fontFamily: 'var(--font-mono)' }}>{new Date().toString().slice(0, 33)}</span>
        </Row>
        <Row label="Time zone">
          <Select
            value={tz}
            onChange={setTz}
            options={[
              [tz, tz],
              ['UTC', 'UTC'],
              ['Europe/London', 'Europe/London'],
              ['Europe/Berlin', 'Europe/Berlin'],
              ['America/New_York', 'America/New_York'],
              ['Asia/Tokyo', 'Asia/Tokyo'],
            ]}
          />
        </Row>
        <Row label="Clock format">
          <Select
            value={settings.clock24 ? '24' : '12'}
            onChange={(v) => setSettings({ clock24: v === '24' })}
            options={[
              ['12', '12-hour'],
              ['24', '24-hour'],
            ]}
          />
        </Row>
        <Row label="Show seconds">
          <Toggle value={settings.clockSeconds} onChange={(v) => setSettings({ clockSeconds: v })} />
        </Row>
        <Row label="Automatic date &amp; time" hint="Network time protocol, provided by the browser tab">
          <Toggle value={ntp} onChange={setNtp} />
        </Row>
      </Card>
    </Section>
  )
}

function StartupSection() {
  const settings = useOS((s) => s.settings)
  const setSettings = useOS((s) => s.setSettings)
  const apps: [string, string, string][] = [
    ['update-notifier', 'Update Notifier', 'Tells you that 3 packages are waiting, forever'],
    ['network', 'Network', 'Connects to MintNet and mentions it'],
    ['xed-daemon', 'Text Editor daemon', 'Keeps a text editor warm in case of inspiration'],
    ['mintwelcome', 'Welcome Screen', 'A friendly greeting on every boot'],
  ]
  return (
    <Section title="Startup Applications" subtitle="Programs that start when the session begins.">
      <Card>
        {apps.map(([id, name, desc]) => (
          <Row key={id} label={name} hint={desc}>
            <Toggle
              value={settings.startupApps.includes(id)}
              onChange={(v) =>
                setSettings({
                  startupApps: v ? [...settings.startupApps, id] : settings.startupApps.filter((x) => x !== id),
                })
              }
            />
          </Row>
        ))}
      </Card>
      <Card title="Other">
        <Row label="Automatic updates" hint="Show the update notification a few seconds after boot">
          <Toggle value={settings.autoUpdates} onChange={(v) => setSettings({ autoUpdates: v })} />
        </Row>
      </Card>
    </Section>
  )
}

function UsersSection() {
  const settings = useOS((s) => s.settings)
  const setSettings = useOS((s) => s.setSettings)
  const avatars = ['🪴', '🐧', '🍃', '💻', '🧑🚀', '🐢', '🌱', '🦉']
  return (
    <Section title="Users &amp; Groups" subtitle="There is one account here, and it is yours.">
      <Card>
        <Row label="Avatar">
          <div style={{ display: 'flex', gap: 8 }}>
            {avatars.map((a) => (
              <span
                key={a}
                onClick={() => setSettings({ avatar: a })}
                style={{
                  fontSize: 22,
                  cursor: 'pointer',
                  padding: 4,
                  borderRadius: 8,
                  border: settings.avatar === a ? '2px solid var(--wm-accent)' : '1px solid transparent',
                }}
              >
                {a}
              </span>
            ))}
          </div>
        </Row>
        <Row label="Full name">
          <input className="entry" value={settings.fullName} onChange={(e) => setSettings({ fullName: e.target.value })} style={{ width: 260 }} />
        </Row>
        <Row label="Username">
          <input className="entry" value={settings.username} onChange={(e) => setSettings({ username: e.target.value.replace(/\s/g, '') })} style={{ width: 180 }} />
        </Row>
        <Row label="Computer name" hint="Used in the terminal prompt and the network">
          <input className="entry" value={settings.hostname} onChange={(e) => setSettings({ hostname: e.target.value.replace(/\s/g, '-') })} style={{ width: 180 }} />
        </Row>
      </Card>
      <Card title="Account type" hint="This account can do anything, including run sudo commands in the terminal.">
        <div style={{ opacity: 0.8 }}>Administrator · groups: adm, cdrom, sudo, audio, video</div>
      </Card>
    </Section>
  )
}

function PrivacySection({ onReset }: { onReset: () => void }) {
  return (
    <Section title="Privacy" subtitle="Everything here lives in your browser's storage. Nothing leaves the tab.">
      <Card title="Data on this computer">
        <Row label="Filesystem" hint={`${humanSize(nodeSize(vfs.node('/')!))} used of a nominal 10 GB — stored in localStorage`}>
          <button className="btn-ghost" onClick={onReset}>
            <Glyph name="Trash2" size={14} /> Reset filesystem…
          </button>
        </Row>
        <Row label="Cookies" hint="MintNet sites do not track you, because they do not exist outside this page">
          <span style={{ opacity: 0.7 }}>none</span>
        </Row>
        <Row label="Browsing history">
          <span style={{ opacity: 0.7 }}>stored locally in ~/.config/mintnet/history.json</span>
        </Row>
      </Card>
      <Card title="Notifications">
        <Row label="Allow notifications from MintNet sites">
          <span style={{ opacity: 0.75 }}>always on (it is charming that way)</span>
        </Row>
      </Card>
    </Section>
  )
}

function InfoSection() {
  const settings = useOS((s) => s.settings)
  const bootTime = useOS((s) => s.bootTime)
  const up = Math.round((Date.now() - bootTime) / 1000)
  return (
    <Section title="System Info" subtitle="Version, hardware and the buttons you press when something deserves a restart.">
      <Card>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <AppIcon glyph="Compass" color="#61ad2b" color2="#2f6b12" size={54} />
          <div>
            <div style={{ fontSize: 17, fontWeight: 600 }}>Mint Web OS 1.0 “Minty”</div>
            <div style={{ opacity: 0.75 }}>Cinnamon web edition · Mint-Y theme · GNU/JavaScript</div>
          </div>
        </div>
        <div className="menu-sep" />
        <Row label="Kernel">
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>6.8.0-webmpl #1 SMP PREEMPT_DYNAMIC</span>
        </Row>
        <Row label="Processor">
          <span>JS Virtual Core × {navigator.hardwareConcurrency || 4} @ 3.20 GHz</span>
        </Row>
        <Row label="Memory">
          <span>{Math.round(380 + useOS.getState().windows.length * 34)} MiB of 3939 MiB used</span>
        </Row>
        <Row label="Uptime">
          <span>{Math.floor(up / 60)} min {up % 60} s</span>
        </Row>
        <Row label="Storage">
          <span>{humanSize(nodeSize(vfs.node('/')!))} of virtual disk in use</span>
        </Row>
      </Card>
      <Card title="Updates" hint="The Software Manager handles packages; this button pretends to check.">
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn-mint"
            onClick={() =>
              notify('Update Manager', 'Refreshing package lists… done.\nYour system is up to date (3 optional applications available).')
            }
          >
            <Glyph name="RefreshCw" size={14} /> Check for updates
          </button>
          <button className="btn-ghost" onClick={() => window.dispatchEvent(new CustomEvent('webmpl:session', { detail: 'reboot' }))}>
            <Glyph name="Power" size={14} /> Restart
          </button>
        </div>
      </Card>
      <Card title="Session settings" hint={`Signed in as ${settings.username}@${settings.hostname}`}>
        <button
          className="btn-ghost"
          onClick={() => {
            useOS.getState().setSettings({ ...DEFAULT_SETTINGS, username: settings.username, fullName: settings.fullName })
            notify('Settings', 'Appearance settings restored to the Mint defaults.')
          }}
        >
          <Glyph name="RotateCcw" size={14} /> Restore default settings
        </button>
      </Card>
    </Section>
  )
}

function ResetDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Reset the filesystem?" width={460} onClose={onClose}>
      <p>
        Every file you have created or changed — documents, downloads, wallpapers and configuration files — will be
        replaced with the original installation. This cannot be undone.
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-mint"
          onClick={() => {
            useVFS.getState().reset()
            notify('Filesystem', 'The virtual disk was recreated from the original image.')
            onClose()
          }}
        >
          Reset files
        </button>
      </div>
    </Dialog>
  )
}
