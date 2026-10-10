import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useOS } from '../os/store'
import { useVFS, HOME, vfs, join } from '../os/vfs'
import { Glyph } from '../shell/AppIcon'
import { VlcCone } from './vlc-art'
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

/* VLC 3.0's Qt interface is light chrome with a black video area — the dark
 * theme this app used to have is a skin, not the default, and it made the
 * player read as a generic media app rather than as VLC. */
const CHROME = '#f2f1f0'      /* menus and toolbars */
const CHROME2 = '#e6e4e2'     /* pressed / recessed */
const EDGE = '#c4c1bd'        /* hairlines between bars */
const FG = '#1f1d1b'          /* text on chrome */
const FG_DIM = '#6d6a66'
const STAGE = '#000000'       /* the video area, always black */
const ORANGE = '#ff8800'      /* VLC orange, straight from the cone artwork */
const ORANGE_DARK = '#e35c00'

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
  /* VLC's toolbar buttons: flat, square-ish, and they only light up under the
   * pointer. The old version had them on a dark bar with a large hit area;
   * VLC's are small and tight against each other. */
  const btn = (icon: React.ReactNode, title: string, onClick: () => void, active = false, wide = 30) => (
    <button
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: wide,
        height: 26,
        border: '1px solid transparent',
        borderRadius: 3,
        background: active ? 'rgba(255,136,0,0.22)' : 'transparent',
        borderColor: active ? 'rgba(255,136,0,0.55)' : 'transparent',
        color: active ? ORANGE_DARK : FG,
        cursor: 'pointer',
        padding: 0,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'rgba(0,0,0,0.07)'
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent'
      }}
    >
      {icon}
    </button>
  )

  const total = isVideo ? (video?.body?.seconds ?? 12) : (track?.duration ?? 0)
  const at = isVideo ? 0 : position
  const pct = total ? Math.min(100, (at / total) * 100) : 0

  const goPrev = () => {
    setTrackIdx((i) => (i - 1 + tracks.length) % Math.max(1, tracks.length))
    stepRef.current = 0
  }
  const goNext = () => {
    setTrackIdx((i) => (i + 1) % Math.max(1, tracks.length))
    stepRef.current = 0
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        background: CHROME,
        color: FG,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* ------------------------------ menu bar ----------------------------- */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          padding: '2px 4px',
          background: CHROME,
          borderBottom: `1px solid ${EDGE}`,
          position: 'relative',
          flex: 'none',
        }}
      >
        {MENUS.map((m) => (
          <div key={m} style={{ position: 'relative' }}>
            <button
              onClick={() => setOpenMenu(openMenu === m ? null : m)}
              onMouseEnter={() => openMenu && setOpenMenu(m)}
              style={{
                border: '1px solid transparent',
                background: openMenu === m ? 'rgba(255,136,0,0.28)' : 'transparent',
                borderColor: openMenu === m ? 'rgba(255,136,0,0.5)' : 'transparent',
                color: FG,
                padding: '3px 9px',
                fontSize: 12.5,
                cursor: 'pointer',
                borderRadius: 3,
              }}
            >
              {m}
            </button>
            {openMenu === m && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  zIndex: 50,
                  background: '#fbfaf9',
                  border: `1px solid ${EDGE}`,
                  borderRadius: 3,
                  minWidth: 200,
                  boxShadow: '0 6px 20px rgba(0,0,0,0.28)',
                  padding: '3px 0',
                }}
                onMouseLeave={() => setOpenMenu(null)}
              >
                {menuFor(m).map((it, i) => (
                  <div
                    key={i}
                    onClick={() => {
                      if (it.disabled) return
                      it.onClick?.()
                      setOpenMenu(null)
                    }}
                    style={{
                      padding: '4px 12px',
                      fontSize: 12.5,
                      cursor: it.disabled ? 'default' : 'pointer',
                      opacity: it.disabled ? 0.42 : 1,
                      display: 'flex',
                      gap: 8,
                    }}
                    onMouseEnter={(e) => !it.disabled && (e.currentTarget.style.background = 'rgba(255,136,0,0.25)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ width: 12, color: ORANGE_DARK }}>{it.checked ? '✓' : ''}</span>
                    <span>{it.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <VlcCone size={16} />
      </div>

      {/* --------------------------- stage + playlist ------------------------ */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: STAGE }}>
          {isVideo ? (
            <canvas ref={canvasRef} style={{ flex: 1, width: '100%' }} />
          ) : (
            <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
              {/* VLC parks the cone in the middle of the black area until
                  something is playing — it is the app's signature. */}
              <div style={{ textAlign: 'center' }}>
                <VlcCone size={Math.max(64, 132)} />
                {track ? (
                  <div style={{ marginTop: 14, fontSize: 13, color: '#9a9a9a' }}>
                    {track.name}
                    <span style={{ opacity: 0.7 }}> — {track.artist}</span>
                  </div>
                ) : (
                  <div style={{ marginTop: 14, fontSize: 12.5, color: '#7d7d7d' }}>
                    Nothing to play. Put tracks in <code>~/Music</code>.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {showPlaylist && (
          <div
            style={{
              width: 268,
              flex: 'none',
              borderLeft: `1px solid ${EDGE}`,
              display: 'flex',
              flexDirection: 'column',
              background: CHROME,
            }}
          >
            <div
              style={{
                padding: '5px 10px',
                fontSize: 11.5,
                color: FG_DIM,
                display: 'flex',
                gap: 8,
                borderBottom: `1px solid ${EDGE}`,
                background: CHROME2,
              }}
            >
              <span style={{ flex: 1 }}>Title</span>
              <span style={{ width: 42, textAlign: 'right' }}>Duration</span>
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
                  style={{
                    display: 'flex',
                    gap: 8,
                    padding: '4px 10px',
                    fontSize: 12.5,
                    cursor: 'pointer',
                    background: i === trackIdx ? 'rgba(255,136,0,0.22)' : 'transparent',
                    color: i === trackIdx ? ORANGE_DARK : FG,
                    fontWeight: i === trackIdx ? 600 : 400,
                  }}
                  onMouseEnter={(e) => i !== trackIdx && (e.currentTarget.style.background = 'rgba(0,0,0,0.05)')}
                  onMouseLeave={(e) => i !== trackIdx && (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ width: 14, flex: 'none', opacity: 0.6 }}>{i === trackIdx ? '▶' : ''}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.name}
                  </span>
                  <span style={{ width: 42, textAlign: 'right', color: FG_DIM, fontVariantNumeric: 'tabular-nums' }}>
                    {mmss(t.duration)}
                  </span>
                </div>
              ))}
              {tracks.length === 0 && (
                <div style={{ padding: 12, color: FG_DIM, fontSize: 12, lineHeight: 1.6 }}>
                  The playlist is empty. Drop tracks into <code>~/Music</code> and they appear here.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------- seek bar --------------------------- */}
      <div style={{ padding: '0 8px', background: CHROME, flex: 'none' }}>
        <input
          type="range"
          min={0}
          max={total || 1}
          value={at}
          aria-label="Seek"
          onChange={(e) => {
            setPosition(Number(e.target.value))
            stepRef.current = 0
          }}
          style={{ width: '100%', accentColor: ORANGE, height: 5, display: 'block', margin: '5px 0 0' }}
        />
      </div>

      {/* ----------------------------- control bar -------------------------- */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: '2px 8px 6px',
          background: CHROME,
          borderTop: `1px solid ${EDGE}`,
          flex: 'none',
        }}
      >
        {btn(
          <Glyph name={playingNow ? 'Pause' : 'Play'} size={17} />,
          playingNow ? 'Pause' : 'Play',
          togglePlay,
        )}
        {btn(<Glyph name="SkipBack" size={15} />, 'Previous', goPrev)}
        {btn(<Glyph name="SkipForward" size={15} />, 'Next', goNext)}
        {btn(<Glyph name="Square" size={13} />, 'Stop', stop)}

        <span
          style={{
            fontSize: 11.5,
            color: FG_DIM,
            marginLeft: 8,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {mmss(at)} / {mmss(total)}
        </span>

        <div style={{ flex: 1 }} />

        {btn(<Glyph name="List" size={15} />, 'Playlist (Ctrl+L)', () => setShowPlaylist(!showPlaylist), showPlaylist)}
        {btn(<Glyph name="RefreshCw" size={14} />, 'Random', () => setShuffle(!shuffle), shuffle)}
        {btn(<Glyph name="RotateCcw" size={14} />, 'Repeat', () => setRepeat(!repeat), repeat)}
        {btn(<Glyph name="Type" size={15} />, 'Subtitles', () => notify({ title: 'VLC', body: 'No subtitle track in the web edition.' }))}
        {btn(
          <Glyph name={muted ? 'VolumeX' : volume > 0.5 ? 'Volume2' : 'Volume1'} size={15} />,
          muted ? 'Unmute' : 'Mute',
          () => setMuted(!muted),
          muted,
        )}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          aria-label="Volume"
          onChange={(e) => setVolume(Number(e.target.value))}
          style={{ width: 84, accentColor: ORANGE, marginLeft: 2 }}
        />
        {btn(
          <Glyph name="Maximize2" size={14} />,
          'Fullscreen',
          () => notify({ title: 'VLC', body: 'Fullscreen is handled by the window manager here.' }),
        )}
      </div>

      {/* ------------------------------- about ------------------------------ */}
      {showAbout && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 60,
          }}
          onClick={() => setShowAbout(false)}
        >
          <div
            style={{
              background: CHROME,
              border: `1px solid ${EDGE}`,
              borderRadius: 6,
              padding: 22,
              width: 350,
              textAlign: 'center',
              color: FG,
              boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <VlcCone size={76} />
            <div style={{ fontWeight: 700, fontSize: 15, marginTop: 10 }}>VLC media player</div>
            <div style={{ fontSize: 12, color: FG_DIM, marginTop: 4 }}>3.0.24 Vetinari</div>
            <div style={{ fontSize: 11.5, color: FG_DIM, marginTop: 10, lineHeight: 1.6 }}>
              Rebuilt in JavaScript for the Mixt web desktop. The cone artwork is taken from
              <code> extras/package/macosx/asset_sources/vlc_app_icon.svg</code> in the VLC source, and the menus follow
              the 3.0.24 Qt interface. Playback here uses the Web Audio API.
            </div>
            <button
              onClick={() => setShowAbout(false)}
              style={{
                marginTop: 14,
                background: ORANGE,
                color: '#fff',
                border: 'none',
                borderRadius: 3,
                padding: '5px 20px',
                cursor: 'pointer',
                fontSize: 12.5,
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
