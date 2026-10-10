/* Mixt Web OS — boot error screen.
 *
 * A desktop that fails to mount used to leave a plain white page: no message,
 * nothing to click, nothing in the UI that says what went wrong. This is the
 * last line of defence. Anything thrown while the desktop renders is caught
 * here and shown as a readable report — the error, the stack, whether the
 * browser is even allowing storage — plus two ways out (reload, or forget the
 * saved state that caused it).
 *
 * Boot problems that happen *before* React mounts (bootstrap()) cannot be
 * caught by a boundary; main.tsx reports those through `renderBootFailure()`.
 */
import React from 'react'
import { clearSavedData, storageAvailable } from './storage'

interface Props {
  children: React.ReactNode
}

interface State {
  error: Error | null
}

export class BootBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep the full report in the console for anyone who opens devtools.
    console.error('[mixt] the desktop failed to render:', error, info?.componentStack)
  }

  render() {
    if (this.state.error) return <BootFailure error={this.state.error} />
    return this.props.children
  }
}

/** Nothing in the failure screen is allowed to throw — not even reading
 *  `location`, which some embedders do not expose. A broken error screen would
 *  put the user back in front of the white page it exists to replace. */
function originOf(): string {
  try {
    return typeof location !== 'undefined' && location.origin ? location.origin : 'this page'
  } catch {
    return 'this page'
  }
}

export function reloadPage() {
  try {
    location.reload()
  } catch {
    try {
      location.href = location.href
    } catch {
      /* a browser with no location at all — nothing sensible left to do */
    }
  }
}

/** Plain-DOM report, for the cases React cannot show anything: an error thrown
 *  outside the render tree, or a failure before the root ever mounted. */
export function renderPlainFailure(error?: unknown, into?: HTMLElement) {
  try {
    const host = into ?? (typeof document !== 'undefined' ? document.body : null)
    if (!host) return null
    const box = document.createElement('div')
    box.setAttribute('data-mixt-boot-failure', 'true')
    box.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;padding:32px;background:#16181a;color:#eceeed;' +
      "font:13px/1.55 system-ui,sans-serif;overflow:auto"
    const title = document.createElement('div')
    title.style.cssText = 'font-size:17px;font-weight:500;margin-bottom:6px'
    title.textContent = 'Mixt Web OS could not start'
    const sub = document.createElement('div')
    sub.style.cssText = 'opacity:.75;margin-bottom:14px'
    sub.textContent = 'The desktop stopped while loading. Reload the page to try again.'
    const pre = document.createElement('pre')
    pre.style.cssText =
      'margin:0 0 16px;padding:12px;background:#15181a;border:1px solid rgba(255,255,255,.07);' +
      'border-radius:6px;color:#f0b46b;font-size:11.5px;white-space:pre-wrap;max-height:45vh;overflow:auto'
    pre.textContent = errorMessage(error) || 'No error details were reported.'
    const button = document.createElement('button')
    button.textContent = 'Reload'
    button.style.cssText = 'padding:7px 16px;border-radius:6px;border:1px solid #7cc93f;background:#9ede6a;color:#1c2410;cursor:pointer'
    button.onclick = () => reloadPage()
    box.append(title, sub, pre, button)
    host.appendChild(box)
    return box
  } catch {
    return null
  }
}

function errorMessage(error?: unknown): string {
  if (!error) return ''
  if (error instanceof Error) return [error.message, error.stack].filter(Boolean).join('\n\n')
  return String(error)
}

export function BootFailure({ error }: { error?: Error | null }) {
  const storageOk = storageAvailable()
  const detail = errorMessage(error) || 'Unknown error'

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.header}>
          <span style={styles.logo}>🪴</span>
          <div>
            <div style={styles.title}>Mixt Web OS could not start</div>
            <div style={styles.subtitle}>
              The desktop stopped while it was loading. Your files and settings are still saved.
            </div>
          </div>
        </div>

        <pre style={styles.report}>{detail || 'No error details were reported.'}</pre>

        <div style={styles.checks}>
          <Check ok={storageOk} label={storageOk ? 'Browser storage works' : 'Browser storage is blocked or full'} />
          <Check ok label={`Booting from ${originOf()}`} />
        </div>

        <div style={styles.actions}>
          <button style={styles.primary} onClick={reloadPage}>
            Reload
          </button>
          <button
            style={styles.secondary}
            onClick={() => {
              clearSavedData()
              reloadPage()
            }}
          >
            Reset saved data &amp; reload
          </button>
        </div>

        <div style={styles.hint}>
          {storageOk
            ? 'If this keeps happening, reset the saved data — it rebuilds a fresh Mixt home directory.'
            : 'This browser is not allowing web storage (private mode, a sandboxed frame, or a full disk). Mixt can run without it, so try reloading; anything you create will be forgotten when the tab closes.'}
        </div>
      </div>
    </div>
  )
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{ ...styles.check, color: ok ? '#c4eea4' : '#f0b46b' }}>
      <span>{ok ? '✓' : '!'}</span>
      <span>{label}</span>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    position: 'fixed',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    padding: 24,
    background: '#16181a',
    color: '#eceeed',
    fontFamily: "system-ui, sans-serif",
    fontSize: 13,
    overflow: 'auto',
  },
  card: {
    width: 'min(720px, 100%)',
    background: '#202325',
    border: '1px solid rgba(255,255,255,0.09)',
    borderTop: '3px solid #9ede6a',
    borderRadius: 10,
    boxShadow: '0 18px 48px rgba(0,0,0,0.55)',
    padding: 22,
  },
  header: { display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 16 },
  logo: { fontSize: 30, lineHeight: '34px' },
  title: { fontSize: 17, fontWeight: 500 },
  subtitle: { marginTop: 4, opacity: 0.75, lineHeight: 1.5 },
  report: {
    margin: 0,
    padding: 12,
    maxHeight: 220,
    overflow: 'auto',
    background: '#15181a',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 6,
    color: '#f0b46b',
    fontFamily: "ui-monospace, monospace",
    fontSize: 11.5,
    whiteSpace: 'pre-wrap',
  },
  checks: { display: 'flex', flexWrap: 'wrap', gap: '6px 18px', margin: '14px 2px 0' },
  check: { display: 'flex', gap: 7, alignItems: 'center', fontSize: 12 },
  actions: { display: 'flex', gap: 10, marginTop: 18 },
  primary: {
    padding: '7px 16px',
    borderRadius: 6,
    border: '1px solid #7cc93f',
    background: '#9ede6a',
    color: '#1c2410',
    fontWeight: 500,
    cursor: 'pointer',
  },
  secondary: {
    padding: '7px 16px',
    borderRadius: 6,
    border: '1px solid rgba(255,255,255,0.16)',
    background: 'rgba(255,255,255,0.05)',
    color: '#eceeed',
    cursor: 'pointer',
  },
  hint: { marginTop: 14, opacity: 0.66, lineHeight: 1.55, fontSize: 12 },
}
