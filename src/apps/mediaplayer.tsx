import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useOS } from '../os/store'
import { useVFS, HOME, vfs, join } from '../os/vfs'
import { Glyph } from '../shell/AppIcon'
import type { AppProps } from '../os/types'

/* ------------------------------------------------------------------ */
/* The VLC traffic cone, redrawn as inline SVG (the real 512px PNG in  */
/* the VLC source tree is ~210 KB, so we rebuild the artwork in JS).   */
/* ------------------------------------------------------------------ */
export function VlcCone({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-label="VLC cone">
      {/* base */}
      <rect x="12" y="82" width="76" height="12" rx="4" fill="#e8590c" />
      <rect x="12" y="80" width="76" height="6" rx="3" fill="#ff8800" />
      {/* cone body */}
      <path d="M50 4 L74 84 L26 84 Z" fill="#ff8800" />
      <path d="M50 4 L74 84 L60 84 Z" fill="#e8590c" opacity="0.7" />
      {/* white bands */}
      <path d="M41.5 34 L58.5 34 L62 46 L38 46 Z" fill="#f4f4f4" />
      <path d="M33 62 L67 62 L70.5 74 L29.5 74 Z" fill="#f4f4f4" />
    </svg>
  )
}

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

const BG = '#2b2b2b'
const BG2 = '#333333'
const FG = '#d9d9d9'
const ORANGE = '#ff8800'

type MenuName = 'Media' | 'Playback' | 'Audio' | 'Video' | 'Subtitle' | 'Tools' | 'View' | 'Help'
const MENUS: MenuName[] = ['Media', 'Playback', 'Audio', 'Video', 'Subtitle', 'Tools', 'View', 'Help']

export default function MediaPlayerApp({ win, api }: AppProps) {
  const revision = useVFS((s) => s.revision)
  const settings = useOS((s) => s.settings)
  const notify = useOS((s) => s.notify)

  const [trackIdx, setTrackIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState(true)
  const [volume, setVolume] = useState(settings.volume / 100)
  const [muted, setMuted] = useState(settings.muted)
  const [showPlaylist, setShowPlaylist] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null)
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
          duration: Math.round(pattern.length * (60 / bpm) * 16),
        }
      })
  }, [revision])

  const videos = useMemo(() => {
    const list = vfs.list(`${HOME}/Videos`) ?? []
    return list.map((e) => {
      let body: any = {}
      try {
        body = JSON.parse((e.node as any).content || '{}')
      } catch {
        body = {}
      }
      return { path: join(`${HOME}/Videos`, e.name), name: e.name.replace(/\.\w+$/, ''), body }
    })
  }, [revision])

  const isVideo = !!win.props?.path?.endsWith('.webm') || (!tracks.length && !!videos.length)
  const track = tracks[trackIdx]
  const video = videos[0]

  useEffect(() => {
    if (!win.props?.path) return
    const idx = tracks.findIndex((t) => t.path === win.props.path)
    if (idx >= 0) {
      setTrackIdx(idx)
      setPlaying(true)
    }
  }, [win.props?.path])

  useEffect(() => {
    api.setTitle(`${playing ? '▶ ' : ''}${track ? `${track.name} - ` : ''}VLC media player`)
  }, [track?.name, playing])

  /* ------------------------------ audio engine ---------------------------- */
  function ensureAudio() {
    if (!audioRef.current) {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
      if (!Ctx) return null
      audioRef.current = new Ctx()
      gainRef.current = audioRef.current!.createGain()
      gainRef.current.gain.value = muted ? 0 : volume
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
    if (gainRef.current) gainRef.current.gain.value = muted ? 0 : volume
  }, [volume, muted])

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

  /* ------------------------------ video canvas ---------------------------- */
  const [videoPlaying, setVideoPlaying] = useState(false)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !isVideo) return
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let t = 0
    const draw = () => {
      const W = (canvas.width = canvas.clientWidth)
      const H = (canvas.height = canvas.clientHeight)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, W, H)
      const cx = W / 2 + Math.sin(t * 0.7) * W * 0.16
      const cy = H / 2 + Math.cos(t * 0.5) * H * 0.1
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(Math.sin(t * 0.4) * 0.25)
      const r = Math.min(W, H) * 0.28
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.6)
      grad.addColorStop(0, 'rgba(255,136,0,0.95)')
      grad.addColorStop(1, 'rgba(122,60,0,0.05)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.moveTo(0, -r)
      ctx.quadraticCurveTo(r * 0.7, -r * 0.2, 0, r)
      ctx.quadraticCurveTo(-r * 0.7, -r * 0.2, 0, -r)
      ctx.fill()
      ctx.restore()
      const seconds = video?.body?.seconds ?? 12
      const pct = (t % seconds) / seconds
      ctx.fillStyle = 'rgba(255,255,255,0.2)'
      ctx.fillRect(18, H - 12, W - 36, 4)
      ctx.fillStyle = ORANGE
      ctx.fillRect(18, H - 12, (W - 36) * pct, 4)
      if (videoPlaying) t += 1 / 60
    }
    const loop = () => {
      draw()
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [isVideo, videoPlaying, video?.name])

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  const playingNow = isVideo ? videoPlaying : playing
  const stop = () => {
    setPlaying(false)
    setVideoPlaying(false)
    setPosition(0)
    stepRef.current = 0
  }
  const togglePlay = () => {
    if (isVideo) setVideoPlaying((p) => !p)
    else {
      ensureAudio()
      setPlaying((p) => !p)
    }
  }

  /* --------------------------------- menus -------------------------------- */
  const menuFor = (name: MenuName): { label: string; onClick?: () => void; disabled?: boolean; checked?: boolean }[] => {
    switch (name) {
      case 'Media':
        return [
          { label: 'Open File…', onClick: () => notify({ title: 'VLC', body: 'Pick a track from the playlist (View ▸ Playlist).' }) },
          { label: 'Open Folder…', disabled: true },
          { label: 'Open Disc…', disabled: true },
          { label: 'Open Network Stream…', disabled: true },
          { label: 'Quit', onClick: () => api.close() },
        ]
      case 'Playback':
        return [
          { label: playingNow ? 'Pause' : 'Play', onClick: togglePlay },
          { label: 'Stop', onClick: stop },
          { label: 'Previous', onClick: () => { setTrackIdx((i) => (i - 1 + tracks.length) % Math.max(1, tracks.length)); stepRef.current = 0 } },
          { label: 'Next', onClick: () => { setTrackIdx((i) => (i + 1) % Math.max(1, tracks.length)); stepRef.current = 0 } },
          { label: 'Repeat', checked: repeat, onClick: () => setRepeat(!repeat) },
          { label: 'Random', checked: shuffle, onClick: () => setShuffle(!shuffle) },
        ]
      case 'Audio':
        return [
          { label: muted ? 'Unmute' : 'Mute', onClick: () => setMuted(!muted) },
          { label: 'Volume Up', onClick: () => setVolume((v) => Math.min(1, v + 0.1)) },
          { label: 'Volume Down', onClick: () => setVolume((v) => Math.max(0, v - 0.1)) },
        ]
      case 'Video':
        return [{ label: 'Fullscreen', onClick: () => notify({ title: 'VLC', body: 'Fullscreen is handled by the window manager here.' }) }]
      case 'Subtitle':
        return [{ label: 'Add Subtitle File…', disabled: true }]
      case 'Tools':
        return [
          { label: 'Effects and Filters', onClick: () => notify({ title: 'VLC', body: 'No extra effects in the web edition.' }) },
          { label: 'Preferences', onClick: () => notify({ title: 'VLC', body: 'Preferences live in Settings ▸ Appearance.' }) },
        ]
      case 'View':
        return [
          { label: 'Playlist', checked: showPlaylist, onClick: () => setShowPlaylist(!showPlaylist) },
          { label: 'Advanced Controls', disabled: true },
        ]
      case 'Help':
        return [{ label: 'About', onClick: () => setShowAbout(true) }]
    }
  }

  const btn = (icon: React.ReactNode, title: string, onClick: () => void, active = false) => (
    <button
      title={title}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 34,
        height: 28,
        border: 'none',
        borderRadius: 4,
        background: active ? 'rgba(255,136,0,0.25)' : 'transparent',
        color: FG,
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.12)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = active ? 'rgba(255,136,0,0.25)' : 'transparent')}
    >
      {icon}
    </button>
  )

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: BG, color: FG, fontFamily: 'system-ui, sans-serif' }}>
      {/* menu bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '2px 6px', background: BG2, borderBottom: '1px solid #1f1f1f', position: 'relative', flex: 'none' }}>
        {MENUS.map((m) => (
          <div key={m} style={{ position: 'relative' }}>
            <button
              onClick={() => setOpenMenu(openMenu === m ? null : m)}
              onMouseEnter={() => openMenu && setOpenMenu(m)}
              style={{ border: 'none', background: openMenu === m ? 'rgba(255,136,0,0.3)' : 'transparent', color: FG, padding: '4px 10px', fontSize: 13, cursor: 'pointer', borderRadius: 3 }}
            >
              {m}
            </button>
            {openMenu === m && (
              <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 50, background: '#3a3a3a', border: '1px solid #222', borderRadius: 4, minWidth: 190, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', padding: '4px 0' }} onMouseLeave={() => setOpenMenu(null)}>
                {menuFor(m).map((it, i) => (
                  <div
                    key={i}
                    onClick={() => {
                      if (it.disabled) return
                      it.onClick?.()
                      setOpenMenu(null)
                    }}
                    style={{ padding: '5px 14px', fontSize: 13, cursor: it.disabled ? 'default' : 'pointer', opacity: it.disabled ? 0.45 : 1, display: 'flex', gap: 8, background: 'transparent' }}
                    onMouseEnter={(e) => !it.disabled && (e.currentTarget.style.background = ORANGE)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ width: 14 }}>{it.checked ? '✓' : ''}</span>
                    <span>{it.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <VlcCone size={18} />
      </div>

      {/* viewport + playlist */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#000' }}>
          {isVideo ? (
            <canvas ref={canvasRef} style={{ flex: 1, width: '100%' }} />
          ) : (
            <div style={{ flex: 1, display: 'grid', placeItems: 'center', background: '#1c1c1c' }}>
              <div style={{ textAlign: 'center', opacity: 0.9 }}>
                <VlcCone size={120} />
                {track && (
                  <div style={{ marginTop: 10, fontSize: 14, color: '#bbb' }}>
                    {track.name} — {track.artist}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {showPlaylist && (
          <div style={{ width: 260, flex: 'none', borderLeft: '1px solid #1f1f1f', display: 'flex', flexDirection: 'column', background: BG2 }}>
            <div style={{ padding: '6px 10px', fontSize: 12, color: '#9a9a9a', display: 'flex', borderBottom: '1px solid #262626' }}>
              <span style={{ flex: 1 }}>Title</span>
              <span>Duration</span>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {tracks.map((t, i) => (
                <div
                  key={t.path}
                  onClick={() => {
                    setTrackIdx(i)
                    stepRef.current = 0
                    setPlaying(true)
                  }}
                  style={{ display: 'flex', padding: '5px 10px', fontSize: 13, cursor: 'pointer', background: i === trackIdx ? 'rgba(255,136,0,0.25)' : 'transparent', color: i === trackIdx ? ORANGE : FG }}
                  onMouseEnter={(e) => i !== trackIdx && (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
                  onMouseLeave={(e) => i !== trackIdx && (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                  <span style={{ color: '#9a9a9a' }}>{mmss(t.duration)}</span>
                </div>
              ))}
              {tracks.length === 0 && <div style={{ padding: 12, color: '#8a8a8a', fontSize: 12 }}>Playlist is empty. Drop tracks into ~/Music.</div>}
            </div>
          </div>
        )}
      </div>

      {/* seek bar */}
      <div style={{ padding: '6px 10px 0', background: BG, flex: 'none' }}>
        <input
          type="range"
          min={0}
          max={isVideo ? video?.body?.seconds ?? 12 : track?.duration ?? 100}
          value={isVideo ? 0 : position}
          onChange={(e) => {
            setPosition(Number(e.target.value))
            stepRef.current = 0
          }}
          style={{ width: '100%', accentColor: ORANGE, height: 4, display: 'block' }}
        />
      </div>

      {/* control bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px 8px', background: BG, flex: 'none' }}>
        {btn(<Glyph name={playingNow ? 'Pause' : 'Play'} size={18} />, 'Play/Pause', togglePlay)}
        {btn(<Glyph name="Square" size={16} />, 'Stop', stop)}
        {btn(<Glyph name="SkipBack" size={16} />, 'Previous', () => { setTrackIdx((i) => (i - 1 + tracks.length) % Math.max(1, tracks.length)); stepRef.current = 0 })}
        {btn(<Glyph name="SkipForward" size={16} />, 'Next', () => { setTrackIdx((i) => (i + 1) % Math.max(1, tracks.length)); stepRef.current = 0 })}
        <span style={{ fontSize: 12, color: '#bdbdbd', marginLeft: 8, fontVariantNumeric: 'tabular-nums' }}>
          {mmss(isVideo ? 0 : position)} / {mmss(isVideo ? video?.body?.seconds ?? 0 : track?.duration ?? 0)}
        </span>
        <div style={{ flex: 1 }} />
        {btn(<Glyph name="List" size={16} />, 'Playlist (Ctrl+L)', () => setShowPlaylist(!showPlaylist), showPlaylist)}
        {btn(<Glyph name="RefreshCw" size={15} />, 'Random', () => setShuffle(!shuffle), shuffle)}
        {btn(<Glyph name="RotateCcw" size={15} />, 'Repeat', () => setRepeat(!repeat), repeat)}
        {btn(<Glyph name={muted ? 'VolumeX' : 'Volume2'} size={16} />, 'Mute', () => setMuted(!muted))}
        <input type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume} onChange={(e) => setVolume(Number(e.target.value))} style={{ width: 90, accentColor: ORANGE }} />
      </div>

      {/* about dialog */}
      {showAbout && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', zIndex: 60 }} onClick={() => setShowAbout(false)}>
          <div style={{ background: BG2, border: '1px solid #222', borderRadius: 8, padding: 24, width: 340, textAlign: 'center', color: FG }} onClick={(e) => e.stopPropagation()}>
            <VlcCone size={72} />
            <div style={{ fontWeight: 700, fontSize: 16, marginTop: 8 }}>VLC media player</div>
            <div style={{ fontSize: 12, color: '#9a9a9a', marginTop: 4 }}>3.0.24 Vetinari — rebuilt in JavaScript for the Mixt web desktop</div>
            <div style={{ fontSize: 12, color: '#9a9a9a', marginTop: 8 }}>
              The interface, cone artwork and menu structure follow the VLC 3.0.24 source (videolan/vlc). Playback here uses the Web Audio API.
            </div>
            <button onClick={() => setShowAbout(false)} style={{ marginTop: 14, background: ORANGE, color: '#fff', border: 'none', borderRadius: 4, padding: '6px 18px', cursor: 'pointer' }}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
