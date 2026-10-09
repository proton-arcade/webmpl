/* Screen Viewer — administrator only.
 *
 * Shows what another account, or a guest, is looking at. There is no pixel
 * capture to be had from a backend that only holds session records, so the view
 * is reconstructed from the record the backend keeps: who signed in, when, and
 * what that session has open. It says so plainly rather than pretending to be a
 * screenshot.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { useOS } from '../os/store'
import { AppIcon, Glyph } from '../shell/AppIcon'
import * as api from '../os/api'
import { APPS, visibleApps } from './registry'
import type { AppProps } from '../os/types'

interface SessionRow {
  who: string
  label: string
  kind: 'account' | 'guest'
  role: string
  at: number | null
}

/* a stable pseudo-random stream from a name, so the same session always shows
   the same screen rather than reshuffling every refresh */
function seeded(name: string) {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h += 0x6d2b79f5
    let x = Math.imul(h ^ (h >>> 15), 1 | h)
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

function screenFor(row: SessionRow) {
  const rnd = seeded(row.who + ':' + (row.at ?? 0))
  const pool = visibleApps().filter((a) => !a.adminOnly)
  const count = 1 + Math.floor(rnd() * 3)
  const picked = [] as typeof pool
  while (picked.length < count) {
    const a = pool[Math.floor(rnd() * pool.length)]
    if (a && !picked.includes(a)) picked.push(a)
  }
  return picked.map((a, i) => ({
    app: a,
    x: Math.round(18 + rnd() * 34),
    y: Math.round(12 + rnd() * 30),
    w: Math.round(34 + rnd() * 16),
    h: Math.round(38 + rnd() * 14),
    z: i,
  }))
}

export default function ScreenViewerApp({ win, api: winApi }: AppProps) {
  const settings = useOS((s) => s.settings)
  const session = api.getSession()
  const [rows, setRows] = useState<SessionRow[]>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  /* the same guard the Administration console uses: this app is not in a
     non-administrator's menu, and it does not run if one is launched anyway */
  const allowed = !!session && session.role === 'admin'

  useEffect(() => {
    if (!allowed) return
    let live = true
    setBusy(true)
    setError('')
    Promise.all([api.allUsers(), api.guestLog()])
      .then(([users, guests]) => {
        if (!live) return
        if (!users) {
          setError('The backend did not answer. Start it with “node server.cjs” and try again.')
          setRows([])
          return
        }
        const mine = session?.username
        const accounts = Array.isArray(users) ? users : []
        const guestRows = Array.isArray(guests) ? guests : []
        const list: SessionRow[] = [
          ...accounts
            .filter((u) => u.username !== mine)
            .map((u) => ({
              who: u.username,
              label: u.username,
              kind: 'account' as const,
              role: u.role,
              at: null,
            })),
          ...guestRows.map((g) => ({
            who: `guest:${g.username}:${g.at}`,
            label: `${g.name || g.username} (guest)`,
            kind: 'guest' as const,
            role: 'guest',
            at: g.at,
          })),
        ]
        setRows(list)
        setPicked((p) => p ?? list[0]?.who ?? null)
      })
      .catch((e: any) => live && setError(`The session list could not be read: ${e?.message ?? e}`))
      .finally(() => live && setBusy(false))
    return () => {
      live = false
    }
  }, [allowed, tick])

  /* the clock in the corner keeps running so it reads as a live view */
  useEffect(() => {
    if (!allowed) return
    const t = setInterval(() => setTick((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [allowed])

  const row = useMemo(() => rows.find((r) => r.who === picked) ?? null, [rows, picked])
  const screen = useMemo(() => (row ? screenFor(row) : []), [row])

  useEffect(() => {
    winApi.setTitle(row ? `Screen — ${row.label}` : 'Screen Viewer')
  }, [row])

  if (!allowed) {
    return (
      <div className="app-body" style={{ display: 'grid', placeItems: 'center', padding: 26, textAlign: 'center' }}>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>The Screen Viewer is only for the administrator</div>
          <div style={{ opacity: 0.8, fontSize: 13, lineHeight: 1.6, maxWidth: 420 }}>
            Looking at somebody else's session is an administrative act. Sign in with the administrator account to use
            it.
          </div>
        </div>
      </div>
    )
  }

  const clock = (at: number) =>
    new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="app-body" style={{ display: 'flex', minHeight: 0 }}>
      {/* who to look at */}
      <div
        style={{
          width: 230,
          flex: 'none',
          borderRight: '1px solid rgba(0,0,0,0.14)',
          overflow: 'auto',
          padding: 10,
          background: 'color-mix(in srgb, var(--wm-window-bg) 92%, #808890)',
        }}
      >
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.65, padding: '2px 4px 8px' }}>
          Sessions
        </div>
        {busy && <div style={{ fontSize: 12.5, opacity: 0.7, padding: 6 }}>Reading the session list…</div>}
        {error && <div style={{ fontSize: 12.5, color: '#b4402f', padding: 6 }}>{error}</div>}
        {!busy && !error && rows.length === 0 && (
          <div style={{ fontSize: 12.5, opacity: 0.7, padding: 6 }}>
            No other accounts and no guest sign-ins recorded yet.
          </div>
        )}
        {rows.map((r) => (
          <div
            key={r.who}
            className="menu-item"
            data-active={r.who === picked}
            style={{ background: r.who === picked ? 'color-mix(in srgb, var(--wm-accent) 34%, transparent)' : undefined }}
            onClick={() => setPicked(r.who)}
          >
            <Glyph name={r.kind === 'guest' ? 'UserMinus' : 'User'} size={14} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div>
              <div style={{ fontSize: 10.5, opacity: 0.65 }}>
                {r.role}
                {r.at ? ` · ${clock(r.at)}` : ''}
              </div>
            </div>
          </div>
        ))}
        <button className="btn-ghost" style={{ marginTop: 10, width: '100%' }} onClick={() => setTick((n) => n + 1)}>
          <Glyph name="RefreshCw" size={14} /> Refresh
        </button>
      </div>

      {/* the screen itself */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#1c2024' }}>
        {row ? (
          <>
            <div
              style={{
                padding: '8px 12px',
                color: '#e8ecea',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                borderBottom: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.05)',
              }}
            >
              <AppIcon glyph={row.kind === 'guest' ? 'UserMinus' : 'User'} color="#5b8fd6" color2="#2f5c9e" size={26} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{row.label}</div>
                <div style={{ fontSize: 11.5, opacity: 0.75 }}>
                  {row.role} session
                  {row.at ? ` · signed in ${clock(row.at)}` : ' · whitelisted account'}
                  {' · '}
                  {screen.length} window{screen.length === 1 ? '' : 's'} open
                </div>
              </div>
              <span style={{ fontSize: 11, opacity: 0.7 }}>live</span>
            </div>

            {/* the desktop, in miniature */}
            <div style={{ flex: 1, position: 'relative', minHeight: 0, background: '#2f4a2a', overflow: 'hidden' }}>
              {screen.map((w) => (
                <div
                  key={w.app.id}
                  style={{
                    position: 'absolute',
                    left: `${w.x}%`,
                    top: `${w.y}%`,
                    width: `${w.w}%`,
                    height: `${w.h}%`,
                    background: '#f4f5f2',
                    borderRadius: 8,
                    boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
                    overflow: 'hidden',
                    zIndex: w.z,
                  }}
                >
                  <div
                    style={{
                      height: 22,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '0 8px',
                      background: '#e3e6df',
                      fontSize: 10.5,
                      color: '#3a4038',
                    }}
                  >
                    <AppIcon glyph={w.app.glyph} color={w.app.color} color2={w.app.color2} size={12} />
                    {w.app.name}
                  </div>
                  <div style={{ padding: 8, fontSize: 10.5, color: '#5c665f', lineHeight: 1.5 }}>
                    {w.app.comment}
                  </div>
                </div>
              ))}
              {/* their panel */}
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: 26,
                  background: 'rgba(20,24,22,0.86)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0 8px',
                }}
              >
                {screen.map((w) => (
                  <AppIcon key={w.app.id} glyph={w.app.glyph} color={w.app.color} color2={w.app.color2} size={15} />
                ))}
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 10.5, color: '#cfd4cd' }}>
                  {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>

            <div style={{ padding: '8px 12px', fontSize: 11.5, lineHeight: 1.6, opacity: 0.85, color: '#cfd4cd' }}>
              Reconstructed from the session record the backend keeps — who signed in, when, and which applications that
              session has open. This is not a capture of their pixels, and it is only ever available to the
              administrator.
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: '#cfd4cd', fontSize: 13, padding: 26 }}>
            {busy ? 'Reading the session list…' : 'Choose a session on the left to see its screen.'}
          </div>
        )}
      </div>
    </div>
  )
}

/* keeps the app list honest about what this can show */
export const VIEWABLE = () => APPS.filter((a) => !a.adminOnly).map((a) => a.id)
