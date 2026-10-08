import React, { useState } from 'react'
import { useVFS, HOME, vfs } from '../os/vfs'
import { Glyph } from '../shell/AppIcon'
import { launch, notify } from '../os/bus'
import { captureScreen, saveWallpaperShot } from './screenshot-utils'
import type { AppProps } from '../os/types'

export default function ScreenshotApp({ api }: AppProps) {
  const revision = useVFS((s) => s.revision)
  const [source, setSource] = useState<'screen' | 'window' | 'background'>('screen')
  const [delay, setDelay] = useState(0)
  const [pointer, setPointer] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const shots = (vfs.list(`${HOME}/Pictures`) ?? []).filter((e) => e.name.startsWith('Screenshot_'))

  async function take() {
    setBusy(true)
    setMessage(source === 'screen' ? 'Capturing… the browser may ask which surface to share.' : 'Rendering…')
    let result
    if (source === 'background') {
      result = { ok: true, message: await saveWallpaperShot() }
    } else {
      result = await captureScreen({ delaySeconds: delay, includePointer: pointer })
    }
    setMessage(result.message)
    setBusy(false)
    if (result.path) setPreview(result.path)
    notify('Screenshot', result.message.split('\n')[0], 'screenshot')
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--wm-window-bg)' }}>
      <div className="mixt-toolbar">
        <button className="btn-ghost" onClick={() => launch('nemo', { path: `${HOME}/Pictures` })}>
          <Glyph name="FolderOpen" size={15} /> Open Pictures folder
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ opacity: 0.7, fontSize: 12 }}>{shots.length} screenshots</span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <h3 style={{ margin: '0 0 10px' }}>Take a screenshot</h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(
            [
              ['screen', 'Whole screen', 'Uses the browser screen-capture prompt and saves a real PNG'],
              ['window', 'Active window', 'Tries the window surface first, then falls back to the screen'],
              ['background', 'Desktop background only', 'Renders the wallpaper into a PNG — always works'],
            ] as const
          ).map(([id, label, hint]) => (
            <label key={id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type="radio" checked={source === id} onChange={() => setSource(id)} style={{ marginTop: 3, accentColor: 'var(--wm-accent)' }} />
              <span>
                <span style={{ fontWeight: 500 }}>{label}</span>
                <span style={{ display: 'block', opacity: 0.7, fontSize: 12 }}>{hint}</span>
              </span>
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 18, marginTop: 14 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>Delay</span>
            <select className="entry" value={delay} onChange={(e) => setDelay(Number(e.target.value))}>
              {[0, 3, 5, 10].map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? 'None' : `${d} seconds`}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={pointer} onChange={(e) => setPointer(e.target.checked)} style={{ accentColor: 'var(--wm-accent)' }} />
            <span>Draw a pointer marker in the middle</span>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn-mixt" disabled={busy} onClick={take}>
            <Glyph name="Camera" size={15} /> {busy ? 'Working…' : 'Take screenshot'}
          </button>
          <button className="btn-ghost" onClick={() => api.close()}>
            Cancel
          </button>
        </div>

        {message && (
          <div style={{ marginTop: 14, padding: 10, borderRadius: 7, background: 'color-mix(in srgb, var(--wm-accent) 16%, transparent)', whiteSpace: 'pre-wrap', fontSize: 12.5 }}>
            {message}
          </div>
        )}

        {preview && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Preview</div>
            <img src={preview.startsWith('/') ? preview : preview} alt="screenshot preview" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 6, border: '1px solid rgba(0,0,0,0.2)' }} />
            <div style={{ marginTop: 8 }}>
              <button className="btn-ghost" onClick={() => launch('imageviewer', { path: preview })}>
                <Glyph name="Image" size={14} /> Open in Image Viewer
              </button>
            </div>
          </div>
        )}

        {shots.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Recent screenshots</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))', gap: 8 }}>
              {shots.slice(-8).map((s) => (
                <div key={s.name} onClick={() => launch('imageviewer', { path: `${HOME}/Pictures/${s.name}` })} style={{ cursor: 'pointer' }}>
                  <div
                    style={{
                      height: 66,
                      borderRadius: 6,
                      background: (s.node as any).url ? `url(${(s.node as any).url}) center/cover` : 'linear-gradient(135deg,#3b6f18,#9ede6a)',
                      border: '1px solid rgba(0,0,0,0.2)',
                    }}
                  />
                  <div style={{ fontSize: 11, opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: 18, opacity: 0.65, fontSize: 12, lineHeight: 1.6 }}>
          A browser tab cannot grab the screen silently — the platform, correctly, requires your permission and a visible
          picker. When that is unavailable (for example inside a sandboxed preview frame), the background renderer is used
          instead so you always end up with a file in ~/Pictures. Filesystem revision: {revision}.
        </div>
      </div>
    </div>
  )
}
