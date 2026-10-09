import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useOS } from '../os/store'
import { useVFS, nodeSize, humanSize } from '../os/vfs'
import { Glyph } from '../shell/AppIcon'
import { getApp } from './registry'
import type { AppProps } from '../os/types'

interface Proc {
  pid: number
  user: string
  name: string
  cpu: number
  mem: number
  state: string
  winId?: string
}

const SYSTEM_PROCS = [
  { pid: 1, user: 'root', name: 'systemd(web)', base: 0.3, mem: 12.4 },
  { pid: 212, user: 'root', name: 'dbus-daemon', base: 0.1, mem: 3.2 },
  { pid: 388, user: 'mixt', name: 'mixt-shell', base: 1.4, mem: 46.8 },
  { pid: 402, user: 'mixt', name: 'mixtpanel', base: 0.4, mem: 18.9 },
  { pid: 517, user: 'mixt', name: 'mixtwindowmanager', base: 0.7, mem: 27.6 },
  { pid: 622, user: 'mixt', name: 'pulseaudio(virtual)', base: 0.1, mem: 6.1 },
  { pid: 704, user: 'mixt', name: 'mixtnetd', base: 0.2, mem: 9.4 },
  { pid: 811, user: 'mixt', name: 'localstoraged', base: 0.5, mem: 21.3 },
]

export default function SystemMonitorApp({ api }: AppProps) {
  const windows = useOS((s) => s.windows)
  const closeWindow = useOS((s) => s.closeWindow)
  const revision = useVFS((s) => s.revision)
  const [tab, setTab] = useState<'processes' | 'resources' | 'file-systems'>('processes')
  const [sortKey, setSortKey] = useState<'cpu' | 'mem' | 'name' | 'pid'>('cpu')
  const [selected, setSelected] = useState<number | null>(null)
  const [history, setHistory] = useState<number[]>(() => Array.from({ length: 60 }, () => 8 + Math.random() * 10))
  const [memHistory, setMemHistory] = useState<number[]>(() => Array.from({ length: 60 }, () => 24 + Math.random() * 6))
  const tickRef = useRef(0)

  useEffect(() => {
    const t = setInterval(() => {
      tickRef.current++
      const load = useOS.getState().windows.length
      const cpu = Math.max(2, Math.min(96, 6 + load * 7 + Math.sin(tickRef.current / 7) * 6 + Math.random() * 8))
      setHistory((h) => [...h.slice(1), cpu])
      setMemHistory((m) => [...m.slice(1), Math.max(18, Math.min(92, m[m.length - 1] + (Math.random() - 0.5) * 3))])
    }, 1000)
    return () => clearInterval(t)
  }, [])

  const procs = useMemo<Proc[]>(() => {
    const winProcs: Proc[] = windows.map((w, i) => ({
      pid: 1000 + i * 13,
      user: 'mixt',
      name: w.appId,
      cpu: 1 + ((w.z + i) % 9) * 0.8 + (w.minimized ? -0.5 : 0.6),
      mem: 18 + ((w.z * 7 + i * 11) % 90),
      state: w.minimized ? 'Sleeping' : useOS.getState().activeId === w.id ? 'Running' : 'Sleeping',
      winId: w.id,
    }))
    const sys: Proc[] = SYSTEM_PROCS.map((p, i) => ({
      pid: p.pid,
      user: p.user,
      name: p.name,
      cpu: p.base + Math.abs(Math.sin((tickRef.current + i * 3) / 5)) * 1.4,
      mem: p.mem,
      state: 'Sleeping',
    }))
    return [...sys, ...winProcs]
  }, [windows, history.length])

  const sorted = useMemo(() => {
    const list = [...procs]
    list.sort((a, b) => {
      switch (sortKey) {
        case 'mem':
          return b.mem - a.mem
        case 'name':
          return a.name.localeCompare(b.name)
        case 'pid':
          return a.pid - b.pid
        default:
          return b.cpu - a.cpu
      }
    })
    return list
  }, [procs, sortKey])

  const cpuNow = history[history.length - 1]
  const memNow = memHistory[memHistory.length - 1]
  const fsUsed = nodeSize(useVFS.getState().root)
  const selectedProc = procs.find((p) => p.pid === selected)

  useEffect(() => {
    api.setTitle(`System Monitor — ${cpuNow.toFixed(1)}% CPU, ${memNow.toFixed(0)}% memory`)
  }, [Math.round(cpuNow), Math.round(memNow)])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--wm-window-bg)' }}>
      <div className="mixt-toolbar">
        {(['processes', 'resources', 'file-systems'] as const).map((t) => (
          <button key={t} className="btn-ghost" data-active={tab === t} onClick={() => setTab(t)}>
            {t === 'processes' ? 'Processes' : t === 'resources' ? 'Resources' : 'File Systems'}
          </button>
        ))}
        {selectedProc?.winId && (
          <>
            <div style={{ width: 1, height: 20, background: 'rgba(0,0,0,0.15)', margin: '0 4px' }} />
            <button
              className="btn-ghost"
              onClick={() => {
                closeWindow(selectedProc.winId!)
                setSelected(null)
              }}
            >
              <Glyph name="X" size={14} /> End Process
            </button>
          </>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ opacity: 0.7, fontSize: 12 }}>{procs.length} processes</span>
      </div>

      {/* summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, padding: 10 }}>
        <Tile label="CPU" value={`${cpuNow.toFixed(1)}%`} history={history} color="#4a9be8" detail={`JS Virtual Core × ${navigator.hardwareConcurrency || 4} @ 3.2 GHz`} />
        <Tile label="Memory" value={`${(memNow / 100 * 3.9).toFixed(2)} GiB`} history={memHistory} color="#8b5cf6" detail={`${memNow.toFixed(0)}% of 3.9 GiB used`} />
        <Tile label="Disk" value={humanSize(fsUsed)} history={[]} color="#61ad2b" detail="localStorage filesystem" />
      </div>

      {tab === 'processes' && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, background: 'color-mix(in srgb, var(--wm-window-bg) 92%, #808890)' }}>
                  {([['pid', 'PID'], ['name', 'Process Name'], ['cpu', 'CPU %'], ['mem', 'Memory'], [null, 'Status']] as [any, string][]).map(([key, label]) => (
                    <th
                      key={label}
                      onClick={() => key && setSortKey(key)}
                      style={{ textAlign: 'left', padding: '5px 8px', borderBottom: '1px solid rgba(0,0,0,0.18)', cursor: key ? 'pointer' : 'default', fontWeight: 500 }}
                    >
                      {label}
                      {sortKey === key ? ' ▾' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => (
                  <tr
                    key={p.pid}
                    onClick={() => setSelected(p.pid)}
                    style={{ background: selected === p.pid ? 'color-mix(in srgb, var(--wm-accent) 45%, transparent)' : undefined, cursor: 'default' }}
                  >
                    <td style={{ padding: '3px 8px' }}>{p.pid}</td>
                    <td style={{ padding: '3px 8px' }}>
                      {getApp(p.name)?.name ?? p.name}
                      {p.winId ? '' : ''}
                    </td>
                    <td style={{ padding: '3px 8px' }}>{p.cpu.toFixed(1)}</td>
                    <td style={{ padding: '3px 8px' }}>{p.mem.toFixed(1)} MiB</td>
                    <td style={{ padding: '3px 8px', opacity: 0.8 }}>{p.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selectedProc && (
            <div style={{ width: 250, flex: 'none', borderLeft: '1px solid rgba(0,0,0,0.16)', padding: 12, fontSize: 12.5 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{selectedProc.name}</div>
              <div>PID: {selectedProc.pid}</div>
              <div>User: {selectedProc.user}</div>
              <div>CPU: {selectedProc.cpu.toFixed(1)}%</div>
              <div>Memory: {selectedProc.mem.toFixed(1)} MiB</div>
              <div>Status: {selectedProc.state}</div>
              <div>Nice: 0</div>
              <div style={{ marginTop: 8, opacity: 0.75 }}>
                Command: /usr/bin/{selectedProc.name} --session=mixt
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'resources' && (
        <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
          <BigGraph history={history} color="#4a9be8" label="CPU history (%)" />
          <BigGraph history={memHistory} color="#8b5cf6" label="Memory history (%)" />
          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 10 }}>
            {[
              ['Network', 'wlan0', `${(2.4 + Math.random()).toFixed(1)} kB/s in · ${(0.8 + Math.random()).toFixed(1)} kB/s out`],
              ['Load average', '1 min', `${(cpuNow / 100 * (navigator.hardwareConcurrency || 4)).toFixed(2)}`],
              ['GPU', 'WebGPU Virtual', `${(cpuNow * 0.7).toFixed(1)}% usage`],
              ['Uptime', 'session', `${Math.floor((Date.now() - useOS.getState().bootTime) / 60000)} min`],
            ].map(([title, sub, value]) => (
              <div key={title} style={{ border: '1px solid rgba(0,0,0,0.14)', borderRadius: 8, padding: 10 }}>
                <div style={{ fontWeight: 600 }}>{title}</div>
                <div style={{ opacity: 0.7, fontSize: 12 }}>{sub}</div>
                <div style={{ marginTop: 4 }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'file-systems' && (
        <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr>
                {['Device', 'Type', 'Size', 'Used', 'Available', 'Use %', 'Mounted on'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '5px 8px', borderBottom: '1px solid rgba(0,0,0,0.18)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ['localStorage', 'webstorage', '10 GB', humanSize(fsUsed), humanSize(Math.max(0, 10e9 - fsUsed)), `${Math.min(99, Math.round((fsUsed / 10e9) * 100))}%`, '/'],
                ['tmpfs', 'tmpfs', '2 GB', '12 MB', '2 GB', '1%', '/run'],
                ['mixtnetfs', 'fuse.mixtnet', '∞', '0 B', '∞', '—', '/media/mixtnet'],
                ['sessionStorage', 'webstorage', '5 MB', `${(JSON.stringify(useOS.getState().installed).length / 1024).toFixed(1)} kB`, '5 MB', '1%', '/run/user/1000'],
              ].map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, i) => (
                    <td key={i} style={{ padding: '4px 8px' }}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 14, opacity: 0.75, fontSize: 12.5 }}>
            The filesystem revision counter is {revision} — every write bumps it and schedules a save into localStorage.
          </div>
        </div>
      )}
    </div>
  )
}

function Tile({ label, value, history, color, detail }: { label: string; value: string; history: number[]; color: string; detail: string }) {
  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.14)', borderRadius: 8, padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span style={{ color }}>{value}</span>
      </div>
      {history.length > 0 && (
        <svg width="100%" height="34" style={{ marginTop: 6 }} preserveAspectRatio="none" viewBox="0 0 100 34">
          <polyline
            points={history.map((v, i) => `${(i / (history.length - 1)) * 100},${34 - (v / 100) * 32}`).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth="1.4"
          />
        </svg>
      )}
      <div style={{ opacity: 0.65, fontSize: 11.5, marginTop: 4 }}>{detail}</div>
    </div>
  )
}

function BigGraph({ history, color, label }: { history: number[]; color: string; label: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <svg width="100%" height="90" viewBox="0 0 100 40" preserveAspectRatio="none" style={{ border: '1px solid rgba(0,0,0,0.14)', borderRadius: 6, background: 'color-mix(in srgb, var(--wm-window-bg) 96%, #808890)' }}>
        <polyline
          points={history.map((v, i) => `${(i / (history.length - 1)) * 100},${40 - (v / 100) * 38}`).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth="0.9"
        />
      </svg>
    </div>
  )
}
