import React from 'react'
import { useOS } from '../os/store'
import { useVFS, nodeSize, humanSize, countNodes } from '../os/vfs'
import { AppIcon, Glyph } from '../shell/AppIcon'
import { APPS } from './registry'
import { openUrl } from '../os/bus'
import type { AppProps } from '../os/types'

export default function AboutApp({ api }: AppProps) {
  const settings = useOS((s) => s.settings)
  const windows = useOS((s) => s.windows)
  const installed = useOS((s) => s.installed)
  const bootTime = useOS((s) => s.bootTime)
  const revision = useVFS((s) => s.revision)
  const root = useVFS.getState().root
  const up = Math.round((Date.now() - bootTime) / 1000)

  React.useEffect(() => {
    api.setTitle('About This Computer')
  }, [])

  const installCount = APPS.filter((a) => a.preinstalled !== false || installed[a.id]).length

  return (
    <div style={{ flex: 1, overflow: 'auto', background: 'var(--wm-window-bg)' }}>
      <div
        style={{
          background: 'linear-gradient(135deg,#2f6b12,#61ad2b)',
          color: '#fff',
          padding: '22px 24px',
          display: 'flex',
          gap: 16,
          alignItems: 'center',
        }}
      >
        <AppIcon glyph="Compass" color="rgba(255,255,255,0.28)" color2="rgba(255,255,255,0.08)" size={70} />
        <div>
          <div style={{ fontSize: 25, fontWeight: 700 }}>Mixt Web OS 1.0 “Mixty”</div>
          <div style={{ opacity: 0.9 }}>
            Mixt Shell web edition · Mixt-Y theme · pure JavaScript · running in {settings.username}@{settings.hostname}
          </div>
          <div style={{ opacity: 0.75, fontSize: 12.5, marginTop: 4 }}>
            64-bit · 1 virtual CPU socket · no telemetry · no servers involved
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 18, padding: 20 }}>
        <div>
          <h3 style={{ marginTop: 0 }}>System</h3>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <tbody>
              {[
                ['Operating system', 'Mixt Web OS 1.0 (mixtwebos) · built on Mixt OS design language'],
                ['Kernel', '6.8.0-mixt #1 SMP PREEMPT_DYNAMIC (simulated)'],
                ['Desktop environment', 'Mixt Shell (web edition) — panel, menu, window manager, applets'],
                ['Window manager', 'mixtwm (React + pointer events)'],
                ['Processor', `JS Virtual Core × ${navigator.hardwareConcurrency || 4} @ 3.20 GHz`],
                ['Memory', `${Math.round(380 + windows.length * 34)} MiB of 3939 MiB in use`],
                ['Graphics', 'WebGPU Virtual Display Adapter · CSS compositor'],
                ['Storage', `${humanSize(nodeSize(root))} used across ${countNodes(root)} files (localStorage filesystem)`],
                ['Packages', `${installCount} installed of ${APPS.length} available · filesystem revision ${revision}`],
                ['Uptime', `${Math.floor(up / 60)} min ${up % 60} s since boot`],
                ['Resolution', `${window.innerWidth} × ${window.innerHeight} at ${window.devicePixelRatio}×`],
                ['Locale', navigator.language],
                ['Theme', `${settings.themeName} · ${settings.iconTheme} icons · accent ${settings.accent}`],
                ['Browser engine', 'MixtNet renderer'],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td style={{ padding: '5px 10px 5px 0', opacity: 0.65, width: 150, verticalAlign: 'top' }}>{k}</td>
                  <td style={{ padding: '5px 0' }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Credits</h3>
          <p style={{ lineHeight: 1.7, fontSize: 13.5 }}>
            Interface inspired by <strong>Mixt OS</strong> and its <strong>Mixt Shell</strong> desktop, both of which are
            excellent and free software. Application icons drawn with <strong>lucide</strong>. Built with{' '}
            <strong>React</strong>, <strong>Vite</strong>, <strong>Tailwind</strong> and <strong>zustand</strong>. The
            MixtNet, the MixtNet sites and every word of their contents were written for this project.
          </p>
          <p style={{ lineHeight: 1.7, fontSize: 13.5 }}>
            Mixt Web OS is free software; you can redistribute it and modify it under the terms of the MIT licence. It
            comes with absolutely no warranty, although the panel clock is reliably accurate.
          </p>

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn-mixt" onClick={() => window.dispatchEvent(new CustomEvent('mixt:session', { detail: 'reboot' }))}>
              <Glyph name="RefreshCw" size={14} /> Restart
            </button>
            <button className="btn-ghost" onClick={() => window.dispatchEvent(new CustomEvent('mixt:session', { detail: 'shutdown' }))}>
              <Glyph name="Power" size={14} /> Shut down
            </button>
            <button className="btn-ghost" onClick={() => openUrl('https://mixt.dev/')}>
              <Glyph name="Globe" size={14} /> Project page on the MixtNet
            </button>
            <button
              className="btn-ghost"
              onClick={() => {
                const text = [
                  `         ,gggg,    ${settings.username}@${settings.hostname}`,
                  '      ,d8"  "Y8b,   -----------------------------',
                  '    ,8"       `Y8,  OS: Mixt Web OS 1.0 x86_64',
                  '    d8           8b Host: Mixt Virtual Machine',
                  '    Y8,          ,8 Kernel: 6.8.0-mixt',
                  '     `8b,,____,,d8" Uptime: ' + `${Math.floor(up / 60)} mins`,
                  '       "Y8b,,d8P"   Shell: bash 5.2.21',
                  '                    DE: Mixt Shell (web edition)',
                  `                    Packages: ${installCount} (mixtinstall)`,
                ].join('\n')
                navigator.clipboard?.writeText(text).catch(() => {})
                useOS.getState().notify({ title: 'About This Computer', body: 'The neofetch output was copied (or would have been, with clipboard permission).' })
              }}
            >
              <Glyph name="Copy" size={14} /> Copy neofetch
            </button>
          </div>
        </div>

        <div>
          <div
            style={{
              border: '1px solid rgba(0,0,0,0.16)',
              borderRadius: 10,
              padding: 16,
              background: 'color-mix(in srgb, var(--wm-window-bg) 94%, #ffffff)',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Session</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ width: 52, height: 52, borderRadius: 999, background: 'linear-gradient(135deg,#9ede6a,#3b6f18)', display: 'grid', placeItems: 'center', fontSize: 24 }}>
                {settings.avatar}
              </div>
              <div>
                <div style={{ fontWeight: 600 }}>{settings.fullName}</div>
                <div style={{ opacity: 0.7, fontSize: 12.5 }}>
                  {settings.username}@{settings.hostname}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 12, fontSize: 12.5, opacity: 0.8 }}>
              {windows.length} window{windows.length === 1 ? '' : 's'} open · workspace {useOS.getState().workspace + 1} of 4 ·{' '}
              {settings.panelPosition} panel · {settings.scheme} theme
            </div>
          </div>

          <div style={{ marginTop: 14, border: '1px solid rgba(0,0,0,0.16)', borderRadius: 10, padding: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Papers</div>
            {[
              ['MixtNet protocol specification', 'https://mixtdev.io/protocol'],
              ['Keyboard shortcuts', 'https://mixt.dev/shortcuts'],
              ['Mixt OS on MixtPedia', 'https://mixtpedia.org/article/mixt-os'],
            ].map(([label, url]) => (
              <div key={url} style={{ padding: '4px 0' }}>
                <a style={{ cursor: 'pointer' }} onClick={() => openUrl(url)}>
                  {label}
                </a>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 14, border: '1px solid rgba(0,0,0,0.16)', borderRadius: 10, padding: 16, fontSize: 12.5, lineHeight: 1.65, opacity: 0.85 }}>
            “Mixt” refers to the Mixt OS project, whose designers thought of the panel layout, the three-dot window
            buttons, the Mixt-Y palette and the general air of calm competence long before this web page did.
          </div>
        </div>
      </div>
    </div>
  )
}
