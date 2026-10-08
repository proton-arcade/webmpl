import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useOS } from '../os/store'
import { useVFS, HOME, vfs, baseName, join } from '../os/vfs'
import { AppIcon, Glyph } from '../shell/AppIcon'
import type { AppProps } from '../os/types'

interface Track {
  path: string
  name: string
  bpm: number
  key: string
  pattern: string[]
  wave: OscillatorType
  artist: string
  duration: number
}

const NOTE_RE = /^([A-G])(#|b)?(\d)$/
const SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

function noteToFreq(note: string) {
  const m = NOTE_RE.exec(note)
  if (!m) return 440
  const [, letter, accidental, octave] = m
  let semi = SEMITONES[letter]
  if (accidental === '#') semi += 1
  if (accidental === 'b') semi -= 1
  const midi = semi + (Number(octave) + 1) * 12
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export default function MediaPlayerApp({ win, api }: AppProps) {
  const revision = useVFS((s) => s.revision)
  const settings = useOS((s) => s.settings)
  const [tab, setTab] = useState<'music' | 'video'>(win.props?.path?.endsWith('.webm') ? 'video' : 'music')
  const [trackIdx, setTrackIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState(true)
  const [volume, setVolume] = useState(settings.volume / 100)
  const audioRef = useRef<AudioContext | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const timerRef = useRef<any>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stepRef = useRef(0)

  const tracks = useMemo<Track[]>(() => {
    const list = vfs.list(`${HOME}/Music`) ?? []
    return list
      .filter((e) => e.node.type === 'file')
      .map((e) => {
        let body: any = {}
        try {
          body = JSON.parse((e.node as any).content || '{}')
        } catch {
          body = {}
        }
        const pattern: string[] = body.pattern ?? ['A3', 'C4', 'E4']
        const bpm = body.bpm ?? 100
        return {
          path: join(`${HOME}/Music`, e.name),
          name: e.name.replace(/\.\w+$/, ''),
          bpm,
          key: body.key ?? 'A',
          pattern,
          wave: (body.wave ?? 'sine') as OscillatorType,
          artist: body.artist ?? 'Unknown artist',
          duration: Math.round((pattern.length * (60 / bpm)) * 16),
        }
      })
  }, [revision])

  const videos = useMemo(() => {
    const list = vfs.list(`${HOME}/Videos`) ?? []
    return list.map((e) => ({
      path: join(`${HOME}/Videos`, e.name),
      name: e.name.replace(/\.\w+$/, ''),
      body: (() => {
        try {
          return JSON.parse((e.node as any).content || '{}')
        } catch {
          return {}
        }
      })(),
    }))
  }, [revision])

  const track = tracks[trackIdx]
  const video = videos[0]

  /* focus the requested file */
  useEffect(() => {
    if (!win.props?.path) return
    const idx = tracks.findIndex((t) => t.path === win.props.path)
    if (idx >= 0) {
      setTab('music')
      setTrackIdx(idx)
    } else if (win.props.path.endsWith('.webm')) {
      setTab('video')
    }
  }, [win.props?.path])

  useEffect(() => {
    if (track) api.setTitle(`${playing ? '▶ ' : ''}${track.name} — Media Player`)
    else api.setTitle('Media Player')
  }, [track?.name, playing])

  /* ------------------------------- playback -------------------------------- */
  function ensureAudio() {
    if (!audioRef.current) {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
      if (!Ctx) return null
      audioRef.current = new Ctx()
      gainRef.current = audioRef.current!.createGain()
      gainRef.current.gain.value = settings.muted ? 0 : volume
      gainRef.current.connect(audioRef.current!.destination)
    }
    if (audioRef.current!.state === 'suspended') void audioRef.current!.resume()
    return audioRef.current
  }

  function beep(freq: number, when: number, length: number, wave: OscillatorType, level = 0.22) {
    const ctx = audioRef.current!
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = wave
    osc.frequency.value = freq
    g.gain.setValueAtTime(0, when)
    g.gain.linearRampToValueAtTime(level, when + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0008, when + length)
    osc.connect(g).connect(gainRef.current!)
    osc.start(when)
    osc.stop(when + length + 0.02)
  }

  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = settings.muted ? 0 : volume
  }, [volume, settings.muted])

  useEffect(() => {
    if (!playing || !track) {
      if (timerRef.current) clearInterval(timerRef.current)
      return
    }
    const ctx = ensureAudio()
    if (!ctx) return
    const beat = 60 / track.bpm / 2
    let step = stepRef.current
    const schedule = () => {
      const t0 = ctx.currentTime + 0.05
      for (let i = 0; i < 4; i++) {
        const note = track.pattern[(step + i) % track.pattern.length]
        beep(noteToFreq(note), t0 + i * beat, beat * 0.9, track.wave)
        if (i % 2 === 0) beep(noteToFreq(note) / 2, t0 + i * beat, beat * 0.8, 'triangle', 0.12)
      }
      step += 4
      stepRef.current = step
    }
    schedule()
    timerRef.current = setInterval(() => {
      schedule()
      setPosition((p) => {
        const next = p + beat * 4
        if (next > track.duration && !repeat) {
          setPlaying(false)
          return track.duration
        }
        return next % Math.max(1, track.duration)
      })
    }, beat * 4 * 1000)
    return () => clearInterval(timerRef.current)
  }, [playing, track?.path, track?.bpm, repeat, shuffle])

  /* canvas visualiser */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || tab !== 'music') return
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let t = 0
    const bars = 42
    const draw = () => {
      t += playing ? 0.08 : 0.02
      const W = (canvas.width = canvas.clientWidth)
      const H = (canvas.height = canvas.clientHeight)
      ctx.fillStyle = '#14181b'
      ctx.fillRect(0, 0, W, H)
      const grad = ctx.createLinearGradient(0, H, 0, 0)
      grad.addColorStop(0, '#2f6b12')
      grad.addColorStop(0.5, '#7cc93f')
      grad.addColorStop(1, '#c9f3a0')
      ctx.fillStyle = grad
      for (let i = 0; i < bars; i++) {
        const note = track ? track.pattern[i % track.pattern.length] : 'A3'
        const f = noteToFreq(note) / 900
        const h = (0.14 + Math.abs(Math.sin(t + i * 0.42)) * (0.4 + f)) * H * (playing ? 1 : 0.42)
        const w = W / bars - 3
        ctx.fillRect(i * (W / bars) + 1.5, H - h, w, h)
      }
    }
    const loop = () => {
      draw()
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [tab, playing, track?.path])

  /* video canvas */
  const [videoTime, setVideoTime] = useState(0)
  const [videoPlaying, setVideoPlaying] = useState(false)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || tab !== 'video') return
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let t = videoTime
    const draw = () => {
      const W = (canvas.width = canvas.clientWidth)
      const H = (canvas.height = canvas.clientHeight)
      ctx.fillStyle = '#0d1013'
      ctx.fillRect(0, 0, W, H)
      // mixt leaf animation
      const cx = W / 2 + Math.sin(t * 0.7) * W * 0.16
      const cy = H / 2 + Math.cos(t * 0.5) * H * 0.1
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(Math.sin(t * 0.4) * 0.25)
      const r = Math.min(W, H) * 0.28
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.6)
      grad.addColorStop(0, 'rgba(158,222,106,0.95)')
      grad.addColorStop(1, 'rgba(47,107,18,0.05)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.moveTo(0, -r)
      ctx.quadraticCurveTo(r * 0.7, -r * 0.2, 0, r)
      ctx.quadraticCurveTo(-r * 0.7, -r * 0.2, 0, -r)
      ctx.fill()
      ctx.strokeStyle = 'rgba(20,40,10,0.6)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(0, -r * 0.9)
      ctx.lineTo(0, r * 0.9)
      ctx.stroke()
      for (let i = 1; i <= 5; i++) {
        const y = -r * 0.6 + (i / 5) * r * 1.2
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(r * 0.32 * (1 - i / 8), y + r * 0.18)
        ctx.moveTo(0, y)
        ctx.lineTo(-r * 0.32 * (1 - i / 8), y + r * 0.18)
        ctx.stroke()
      }
      ctx.restore()
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.font = '600 16px Ubuntu, sans-serif'
      ctx.fillText(video?.name ?? 'Untitled video', 18, H - 46)
      ctx.font = '13px Ubuntu, sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.6)'
      ctx.fillText(`${t.toFixed(1)}s / ${video?.body?.seconds ?? 12}s  ·  procedural animation, no video codec required`, 18, H - 24)
      // timeline
      const seconds = video?.body?.seconds ?? 12
      const pct = (t % seconds) / seconds
      ctx.fillStyle = 'rgba(255,255,255,0.2)'
      ctx.fillRect(18, H - 12, W - 36, 4)
      ctx.fillStyle = '#9ede6a'
      ctx.fillRect(18, H - 12, (W - 36) * pct, 4)
      if (videoPlaying) t += 1 / 60
    }
    const loop = () => {
      draw()
      setVideoTime(t)
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [tab, videoPlaying, video?.name])

  /* ------------------------------- rendering ------------------------------- */
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--wm-window-bg)' }}>
      <div className="mixt-toolbar">
        <button className="btn-ghost" data-active={tab === 'music'} onClick={() => setTab('music')}>
          <Glyph name="Music" size={15} /> Music
        </button>
        <button className="btn-ghost" data-active={tab === 'video'} onClick={() => setTab('video')}>
          <Glyph name="Video" size={15} /> Video
        </button>
        <div style={{ flex: 1 }} />
        {tab === 'music' && track && (
          <span style={{ opacity: 0.75, fontSize: 12 }}>
            {track.pattern.length} notes · {track.bpm} BPM · key {track.key} · {track.wave}
          </span>
        )}
      </div>

      {tab === 'music' ? (
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <div style={{ width: 250, flex: 'none', borderRight: '1px solid rgba(0,0,0,0.14)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '8px 10px', fontWeight: 600 }}>Library</div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {tracks.map((t, i) => (
                <div
                  key={t.path}
                  className="menu-item"
                  style={{ background: i === trackIdx ? 'color-mix(in srgb, var(--wm-accent) 40%, transparent)' : undefined }}
                  onClick={() => {
                    setTrackIdx(i)
                    setPosition(0)
                    stepRef.current = 0
                    setPlaying(true)
                  }}
                >
                  <Glyph name={i === trackIdx && playing ? 'Pause' : 'Play'} size={14} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                  <span style={{ opacity: 0.6, fontSize: 11 }}>{mmss(t.duration)}</span>
                </div>
              ))}
              {tracks.length === 0 && <div style={{ padding: 12, opacity: 0.7 }}>No music in ~/Music.</div>}
            </div>
            <div style={{ padding: 10, borderTop: '1px solid rgba(0,0,0,0.12)', fontSize: 12, opacity: 0.75 }}>
              Tracks are little JSON scores played with the Web Audio API — no files, no codecs, no DRM.
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <canvas ref={canvasRef} style={{ flex: 1, minHeight: 120, width: '100%' }} />
            <div style={{ padding: 14 }}>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{track?.name ?? 'Nothing playing'}</div>
              <div style={{ opacity: 0.75 }}>{track?.artist ?? '—'}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                <span style={{ width: 34, fontSize: 12 }}>{mmss(position)}</span>
                <input
                  type="range"
                  min={0}
                  max={track?.duration ?? 100}
                  value={position}
                  onChange={(e) => {
                    setPosition(Number(e.target.value))
                    stepRef.current = 0
                  }}
                  style={{ flex: 1, accentColor: 'var(--wm-accent)' }}
                />
                <span style={{ width: 34, fontSize: 12, textAlign: 'right' }}>{mmss(track?.duration ?? 0)}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                <button className="btn-ghost" onClick={() => { setTrackIdx((i) => (i - 1 + tracks.length) % Math.max(1, tracks.length)); stepRef.current = 0 }}>
                  <Glyph name="SkipBack" size={16} />
                </button>
                <button
                  className="btn-mixt"
                  onClick={() => {
                    ensureAudio()
                    setPlaying((p) => !p)
                  }}
                >
                  <Glyph name={playing ? 'Pause' : 'Play'} size={16} /> {playing ? 'Pause' : 'Play'}
                </button>
                <button className="btn-ghost" onClick={() => { setTrackIdx((i) => (i + 1) % Math.max(1, tracks.length)); stepRef.current = 0 }}>
                  <Glyph name="SkipForward" size={16} />
                </button>
                <button className="btn-ghost" data-active={shuffle} title="Shuffle" onClick={() => setShuffle(!shuffle)}>
                  <Glyph name="RefreshCw" size={15} />
                </button>
                <button className="btn-ghost" data-active={repeat} title="Repeat" onClick={() => setRepeat(!repeat)}>
                  <Glyph name="RotateCcw" size={15} />
                </button>
                <div style={{ flex: 1 }} />
                <Glyph name="Volume2" size={15} />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  style={{ width: 110, accentColor: 'var(--wm-accent)' }}
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <canvas ref={canvasRef} style={{ flex: 1, minHeight: 200, width: '100%' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12 }}>
            <button className="btn-mixt" onClick={() => setVideoPlaying((p) => !p)}>
              <Glyph name={videoPlaying ? 'Pause' : 'Play'} size={16} /> {videoPlaying ? 'Pause' : 'Play'}
            </button>
            <button className="btn-ghost" onClick={() => { setVideoTime(0) }}>
              <Glyph name="RotateCcw" size={15} /> Restart
            </button>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{video?.name ?? 'No video found'}</div>
              <div style={{ opacity: 0.7, fontSize: 12 }}>
                {video ? 'Procedurally animated: no codec, no buffering, no adverts.' : 'Drop a file into ~/Videos to see it appear here.'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
