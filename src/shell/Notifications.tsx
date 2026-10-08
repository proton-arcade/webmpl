import { useEffect } from 'react'
import { useOS } from '../os/store'
import { AppIcon, Glyph } from './AppIcon'

function ago(t: number) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 60) return 'now'
  return `${Math.round(s / 60)} min ago`
}

export default function Notifications() {
  const { notifications, dismissNotification, settings } = useOS()
  const top = settings.panelPosition === 'top' ? 46 : 10

  // auto-dismiss after 9s
  useEffect(() => {
    if (!notifications.length) return
    const timers = notifications.map((n) =>
      setTimeout(() => dismissNotification(n.id), 9000),
    )
    return () => timers.forEach(clearTimeout)
  }, [notifications, dismissNotification])

  return (
    <div
      style={{
        position: 'fixed',
        right: 10,
        top,
        zIndex: 190000,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        width: 330,
        pointerEvents: 'none',
      }}
    >
      {notifications.map((n) => (
        <div
          key={n.id}
          className="notif"
          style={{
            pointerEvents: 'auto',
            background: settings.scheme === 'dark' ? 'rgba(40,44,47,0.97)' : 'rgba(250,251,249,0.97)',
            color: 'var(--wm-window-fg)',
            border: '1px solid rgba(0,0,0,0.35)',
            borderRadius: 8,
            boxShadow: '0 12px 34px rgba(0,0,0,0.45)',
            overflow: 'hidden',
            backdropFilter: 'blur(10px)',
          }}
          onClick={() => dismissNotification(n.id)}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              background: 'linear-gradient(to bottom, #4b5054, #35393c)',
              color: '#f2f4f1',
              fontSize: 11,
              letterSpacing: 0.2,
            }}
          >
            <Glyph name="Bell" size={12} />
            <span style={{ flex: 1, textTransform: 'uppercase', opacity: 0.9 }}>
              Notification
            </span>
            <span style={{ opacity: 0.7 }}>{ago(n.time)}</span>
            <Glyph name="X" size={12} />
          </div>
          <div style={{ display: 'flex', gap: 10, padding: '9px 10px' }}>
            <AppIcon glyph="Info" color="#5b8def" size={30} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 500 }}>{n.title}</div>
              {n.body && (
                <div style={{ opacity: 0.85, marginTop: 2, whiteSpace: 'pre-wrap' }}>{n.body}</div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
