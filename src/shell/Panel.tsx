import React, { useEffect, useState } from 'react'
import { useOS } from '../os/store'
import { AppIcon, Glyph } from './AppIcon'
import { getApp, searchApps } from '../apps/registry'
import { Popup, type MenuItem } from './ContextMenu'
import { launch } from '../os/bus'

export default function Panel() {
  const settings = useOS((s) => s.settings)
  const windows = useOS((s) => s.windows)
  const activeId = useOS((s) => s.activeId)
  const workspace = useOS((s) => s.workspace)
  const workspaceCount = useOS((s) => s.workspaceCount)
  const menuOpen = useOS((s) => s.menuOpen)
  const [popup, setPopup] = useState<{ kind: string; x: number; y: number } | null>(null)
  const [now, setNow] = useState(new Date())
  const [hidden, setHidden] = useState(false)
  const [peek, setPeek] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), settings.clockSeconds ? 500 : 1000)
    return () => clearInterval(t)
  }, [settings.clockSeconds])

  const S = useOS.getState()
  const visible = windows.filter((w) => w.workspace === workspace)
  const top = settings.panelPosition === 'top'
  const size = settings.panelSize

  const clock = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: settings.clockSeconds ? '2-digit' : undefined,
    hour12: !settings.clock24,
  })

  const isHidden = settings.panelAutohide && hidden && !peek

  const quickApps = ['nemo', 'browser', 'terminal', 'xed', 'settings']

  return (
    <>
      {settings.panelAutohide && (
        <div
          style={{ position: 'fixed', left: 0, right: 0, height: 4, [top ? 'top' : 'bottom']: 0, zIndex: 150000 } as any}
          onMouseEnter={() => setPeek(true)}
        />
      )}
      <div
        className="panel no-select"
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          [top ? 'top' : 'bottom']: 0,
          height: size,
          zIndex: 150000,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '0 6px',
          transform: isHidden ? `translateY(${top ? '-100%' : '100%'})` : 'none',
          transition: 'transform .18s ease-out',
        } as any}
        onMouseLeave={() => setPeek(false)}
        onContextMenu={(e) => {
          e.preventDefault()
          setPopup({ kind: 'panelMenu', x: e.clientX, y: e.clientY })
        }}
      >
        {/* menu button */}
        <div
          className="menu-button"
          data-open={menuOpen}
          onClick={() => S.setMenuOpen(!menuOpen)}
          title="Main Menu (Super)"
        >
          <MixtLogo />
        </div>

        {/* quick launch */}
        <div style={{ display: 'flex', gap: 2 }}>
          {quickApps.map((id) => {
            const app = getApp(id)
            if (!app) return null
            return (
              <div key={id} className="panel-item" style={{ padding: '0 5px' }} title={app.name} onClick={() => launch(id, {})}>
                <AppIcon glyph={app.glyph} color={app.color} color2={app.color2} size={22} rounded={0.28} />
              </div>
            )
          })}
        </div>

        <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.18)', margin: '0 4px' }} />

        {/* window list */}
        <div style={{ display: 'flex', gap: 3, flex: '1 1 auto', overflow: 'hidden', minWidth: 0 }}>
          {visible.map((w) => {
            const app = getApp(w.appId)
            const active = activeId === w.id && !w.minimized
            return (
              <div
                key={w.id}
                className="panel-item"
                data-active={active}
                style={{ maxWidth: 190, minWidth: 0, opacity: w.minimized ? 0.65 : 1 }}
                title={w.title}
                onClick={() => (active || w.minimized ? S.toggleMinimize(w.id) : S.focusWindow(w.id))}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setPopup({ kind: `win:${w.id}`, x: e.clientX, y: e.clientY })
                }}
              >
                <AppIcon glyph={app?.glyph ?? 'AppWindow'} color={app?.color ?? '#5b8def'} size={16} rounded={0.3} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                  {w.title.replace(/ — .*/, '')}
                </span>
              </div>
            )
          })}
        </div>

        {/* right hand applets */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 'auto' }}>
          {/* workspace switcher */}
          <div className="panel-item" style={{ gap: 4 }} title="Workspaces (click for all windows)" onClick={() => S.setExposeOpen(true)}>
            {Array.from({ length: workspaceCount }).map((_, i) => (
              <span
                key={i}
                onClick={(e) => {
                  e.stopPropagation()
                  S.switchWorkspace(i)
                }}
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.55)',
                  background: i === workspace ? 'var(--wm-accent)' : 'transparent',
                  display: 'inline-block',
                }}
              />
            ))}
          </div>

          {/* network */}
          <div className="panel-item" title={settings.wifi ? 'Connected to MixtNet' : 'Wireless off'} onClick={() => setPopup({ kind: 'network', x: window.innerWidth - 240, y: top ? size : window.innerHeight - size - 150 })}>
            <Glyph name={settings.wifi ? 'Wifi' : 'WifiOff'} size={15} />
          </div>

          {/* volume */}
          <div className="panel-item" title="Sound" onClick={() => setPopup({ kind: 'volume', x: window.innerWidth - 250, y: top ? size : window.innerHeight - size - 60 })}>
            <Glyph name={settings.muted || settings.volume === 0 ? 'VolumeX' : settings.volume < 45 ? 'Volume1' : 'Volume2'} size={15} />
          </div>

          {/* battery */}
          <div className="panel-item" title="Battery 87%" onClick={() => setPopup({ kind: 'battery', x: window.innerWidth - 230, y: top ? size : window.innerHeight - size - 90 })}>
            <Glyph name="Battery" size={16} />
            <span style={{ fontSize: 11.5 }}>87%</span>
          </div>

          {/* clock */}
          <div
            className="panel-item"
            title={now.toString()}
            onClick={() => setPopup({ kind: 'calendar', x: window.innerWidth - 300, y: top ? size : window.innerHeight - size - 330 })}
          >
            <span style={{ fontSize: 12.5 }}>
              {now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} {clock}
            </span>
          </div>

          {/* session */}
          <div
            className="panel-item"
            title={`${settings.username}@${settings.hostname}`}
            onClick={() => setPopup({ kind: 'session', x: window.innerWidth - 210, y: top ? size : window.innerHeight - size - 250 })}
          >
            <span style={{ fontSize: 15 }}>{settings.avatar}</span>
          </div>
        </div>
      </div>

      {/* ------------------------------ popups ------------------------------ */}
      {popup?.kind === 'calendar' && (
        <CalendarPopup x={popup.x} y={popup.y} onClose={() => setPopup(null)} />
      )}
      {popup?.kind === 'volume' && <VolumePopup x={popup.x} y={popup.y} onClose={() => setPopup(null)} />}
      {popup?.kind === 'network' && (
        <Popup
          x={popup.x}
          y={popup.y}
          onClose={() => setPopup(null)}
          items={[
            {
              label: settings.wifi ? 'Wireless: connected to “MixtNet”' : 'Wireless is off',
              disabled: true,
            },
            { separator: true },
            {
              label: settings.wifi ? 'Turn wireless off' : 'Turn wireless on',
              icon: <Glyph name="Wifi" size={14} />,
              onClick: () => S.setSettings({ wifi: !settings.wifi }),
            },
            { label: 'Network settings…', icon: <Glyph name="Settings" size={14} />, onClick: () => launch('settings', { page: 'network' }) },
            { separator: true },
            { label: 'IP address: 10.0.2.15', disabled: true },
            { label: 'Signal: excellent', disabled: true },
          ]}
        />
      )}
      {popup?.kind === 'battery' && (
        <Popup
          x={popup.x}
          y={popup.y}
          onClose={() => setPopup(null)}
          items={[
            { label: 'Battery: 87% — 3 h 41 m left', disabled: true },
            { label: 'Power source: battery', disabled: true },
            { separator: true },
            { label: 'Power settings…', icon: <Glyph name="Settings" size={14} />, onClick: () => launch('settings', { page: 'power' }) },
          ]}
        />
      )}
      {popup?.kind === 'session' && (
        <Popup
          x={popup.x}
          y={popup.y}
          onClose={() => setPopup(null)}
          items={[
            { label: `${settings.fullName} (${settings.username})`, disabled: true },
            { separator: true },
            { label: 'Lock screen', icon: <Glyph name="Lock" size={14} />, onClick: () => S.setLocked(true) },
            { label: 'Log out…', icon: <Glyph name="LogOut" size={14} />, onClick: () => window.dispatchEvent(new CustomEvent('mixt:session', { detail: 'logout' })) },
            { label: 'Restart…', icon: <Glyph name="RefreshCw" size={14} />, onClick: () => window.dispatchEvent(new CustomEvent('mixt:session', { detail: 'reboot' })) },
            { label: 'Shut down…', icon: <Glyph name="Power" size={14} />, onClick: () => window.dispatchEvent(new CustomEvent('mixt:session', { detail: 'shutdown' })) },
            { separator: true },
            { label: 'System Settings', icon: <Glyph name="Settings" size={14} />, onClick: () => launch('settings', {}) },
            { label: 'About This Computer', icon: <Glyph name="Info" size={14} />, onClick: () => launch('about', {}) },
          ]}
        />
      )}
      {popup?.kind?.startsWith('win:') && (
        <Popup
          x={popup.x}
          y={popup.y}
          onClose={() => setPopup(null)}
          items={(() => {
            const id = popup.kind.slice(4)
            const win = windows.find((w) => w.id === id)
            if (!win) return [{ label: 'Window closed', disabled: true }]
            return [
              { label: 'Restore', icon: <Glyph name="AppWindow" size={14} />, onClick: () => S.unminimize(id) },
              { label: 'Minimise', icon: <Glyph name="Minus" size={14} />, onClick: () => S.minimize(id) },
              win.maximized
                ? { label: 'Unmaximise', icon: <Glyph name="Maximize2" size={14} />, onClick: () => S.toggleMaximize(id) }
                : { label: 'Maximise', icon: <Glyph name="Maximize2" size={14} />, onClick: () => S.toggleMaximize(id) },
              { separator: true },
              { label: 'Move to workspace 2', onClick: () => S.sendToWorkspace(id, 1) },
              { label: 'Move to workspace 3', onClick: () => S.sendToWorkspace(id, 2) },
              { separator: true },
              { label: 'Close', icon: <Glyph name="X" size={14} />, onClick: () => S.closeWindow(id) },
            ] as MenuItem[]
          })()}
        />
      )}
      {popup?.kind === 'panelMenu' && (
        <Popup
          x={popup.x}
          y={top ? 6 : popup.y - 300}
          onClose={() => setPopup(null)}
          items={[
            { label: 'Panel Settings', icon: <Glyph name="Settings" size={14} />, onClick: () => launch('settings', { page: 'panel' }) },
            {
              label: 'Move panel to the top',
              checked: top,
              onClick: () => S.setSettings({ panelPosition: top ? 'bottom' : 'top' }),
            },
            {
              label: 'Auto-hide the panel',
              checked: settings.panelAutohide,
              onClick: () => S.setSettings({ panelAutohide: !settings.panelAutohide }),
            },
            { separator: true },
            { label: 'Add applet', submenu: searchApps('').slice(0, 8).map((a) => ({ label: a.name, onClick: () => {} })) },
            { label: 'Themes', icon: <Glyph name="Palette" size={14} />, onClick: () => launch('settings', { page: 'themes' }) },
            { label: 'Troubleshoot', icon: <Glyph name="Wrench" size={14} />, onClick: () => S.notify({ title: 'Panel', body: 'Applets reloaded. Nothing was harmed.' }) },
          ]}
        />
      )}
    </>
  )
}

function MixtLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 128 128" aria-label="Menu">
      <path
        d="M64 14c2.8 15 11.6 23.6 25.8 25.8C78 42.6 70 51.2 65.4 64.4 60.8 51.2 52.8 42.6 40.2 39.8 54.4 37.6 61.2 29 64 14z"
        fill="#eafbe0"
      />
      <path
        d="M64 118c-20.4-8.2-32.2-21.9-32.2-40.8 0-4.3.6-8.6 1.9-12.5 8.2 10.3 18.7 16.8 30.3 20 11.6-3.2 22.1-9.7 30.3-20 1.3 3.9 1.9 8.2 1.9 12.5 0 18.9-11.8 32.6-32.2 40.8z"
        fill="#eafbe0"
        opacity="0.92"
      />
      <path d="M64 118V82" stroke="#9ede6a" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

function CalendarPopup({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [selected, setSelected] = useState(new Date())
  const today = new Date()
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < first.getDay(); i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push(d)

  const EVENTS: Record<number, string[]> = {
    [today.getDate()]: ['MixtNet release day', 'Back up ~/Documents'],
  }

  return (
    <div
      className="menu-popup anim-pop"
      style={{ position: 'fixed', left: Math.max(6, x - 40), top: Math.max(6, y - 40), zIndex: 160000, width: 300 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'center', padding: '2px 4px 8px' }}>
        <button className="btn-ghost" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
          <Glyph name="ChevronLeft" size={14} />
        </button>
        <div style={{ flex: 1, textAlign: 'center', fontWeight: 600 }}>
          {cursor.toLocaleString([], { month: 'long', year: 'numeric' })}
        </div>
        <button className="btn-ghost" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
          <Glyph name="ChevronRight" size={14} />
        </button>
        <button className="btn-ghost" onClick={onClose}>
          <Glyph name="X" size={13} />
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, fontSize: 11, textAlign: 'center', opacity: 0.7 }}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginTop: 2 }}>
        {cells.map((d, i) => {
          const isToday = d === today.getDate() && cursor.getMonth() === today.getMonth() && cursor.getFullYear() === today.getFullYear()
          const isSelected = d === selected.getDate() && cursor.getMonth() === selected.getMonth()
          return (
            <div
              key={i}
              onClick={() => d && setSelected(new Date(cursor.getFullYear(), cursor.getMonth(), d))}
              style={{
                textAlign: 'center',
                padding: '4px 0',
                borderRadius: 5,
                cursor: d ? 'pointer' : 'default',
                background: isSelected ? 'var(--wm-accent)' : isToday ? 'color-mix(in srgb, var(--wm-accent) 30%, transparent)' : undefined,
                color: isSelected ? '#14260a' : undefined,
                fontWeight: isToday ? 700 : 400,
              }}
            >
              {d ?? ''}
            </div>
          )
        })}
      </div>
      <div className="menu-sep" />
      <div style={{ fontSize: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          {selected.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
        </div>
        {(EVENTS[selected.getDate()] ?? ['Nothing scheduled — a rare and precious thing.']).map((e) => (
          <div key={e} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '2px 0' }}>
            <Glyph name="Clock" size={12} />
            <span>{e}</span>
          </div>
        ))}
        <div style={{ marginTop: 8 }}>
          <button className="btn-ghost" onClick={() => launch('settings', { page: 'clock' })}>
            <Glyph name="Settings" size={13} /> Date &amp; time settings
          </button>
        </div>
      </div>
    </div>
  )
}

function VolumePopup({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const settings = useOS((s) => s.settings)
  const setSettings = useOS((s) => s.setSettings)
  return (
    <div className="menu-popup anim-pop" style={{ position: 'fixed', left: x, top: y, zIndex: 160000, width: 240 }} onMouseDown={(e) => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px' }}>
        <Glyph name={settings.muted ? 'VolumeX' : 'Volume2'} size={16} />
        <input
          type="range"
          min={0}
          max={100}
          value={settings.muted ? 0 : settings.volume}
          style={{ flex: 1, accentColor: 'var(--wm-accent)' }}
          onChange={(e) => setSettings({ volume: Number(e.target.value), muted: Number(e.target.value) === 0 })}
        />
        <span style={{ width: 34, textAlign: 'right', fontSize: 12 }}>{settings.muted ? 'Mute' : `${settings.volume}%`}</span>
      </div>
      <div className="menu-sep" />
      <div className="menu-item" onClick={() => setSettings({ muted: !settings.muted })}>
        <Glyph name="Volume1" size={14} /> {settings.muted ? 'Unmute' : 'Mute'}
      </div>
      <div className="menu-item" onClick={() => launch('mediaplayer', {})}>
        <Glyph name="Music" size={14} /> Open Media Player
      </div>
      <div className="menu-item" onClick={() => launch('settings', { page: 'sound' })}>
        <Glyph name="Settings" size={14} /> Sound settings
      </div>
    </div>
  )
}
