/* Mixt Player — the media player that ships with the system.
 *
 * Every audio and video file opens here by default. VLC is a download from the
 * Software Manager, and it would be wrong for a file to open an application the
 * user has not installed, so this is what handles media until they install
 * something else and choose it in System Settings → Sound.
 *
 * The files in the virtual filesystem carry no real media data, so playback is
 * synthesised: audio gets a tone from WebAudio and video gets a stage with a
 * running clock. The transport behaves like a real one — play, pause, stop,
 * seek, volume, next and previous.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useOS } from '../os/store'
import { HOME, vfs, baseName } from '../os/vfs'
import { Glyph } from '../shell/AppIcon'
import type { AppProps } from '../os/types'

interface Track {
  path: string
  name: string
  kind: 'audio' | 'video'
}

/* A stable pitch per file, so the same track always sounds the same. */
function pitchOf(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 100000
  return 220 + (h % 220)
}

export default function MixtPlayerApp({ win, api }: AppProps) {
  const settings = useOS((s) => s.settings)
  const [tracks, setTracks] = useState<Track[]>([])
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [volume, setVolume] = useState(70)
  const audioRef = useRef<AudioContext | null>(null)
  const oscRef = useRef<{ osc: OscillatorNode; gain: GainNode } | null>(null)

  const duration = 214 // seconds; the files have no real length to read

  /* the library is whatever is in the two media folders */
  useEffect(() => {
    const collect = (folder: string, kind: 'audio' | 'video'): Track[] =>
      (vfs.list(`${HOME}/${folder}`) ?? [])
        .filter((e) => e.node.type === 'file')
        .map((e) => ({ path: `${HOME}/${folder}/${e.name}`, name: e.name, kind }))
    setTracks([...collect('Music', 'audio'), ...collect('Videos', 'video')])
  }, [])

  /* opening a file from the file manager selects it */
  useEffect(() => {
    const wanted = win.props?.path as string | undefined
    if (!wanted || !tracks.length) return
    const i = tracks.findIndex((t) => t.path === wanted)
    if (i >= 0) {
      setIndex(i)
      setPos(0)
    }
  }, [win.props?.path, tracks.length])

  const current = tracks[index] ?? null

  useEffect(() => {
    api.setTitle(current ? `${current.name} — Mixt Player` : 'Mixt Player')
  }, [current])

  function stopTone() {
    try {
      oscRef.current?.osc.stop()
      oscRef.current?.osc.disconnect()
      oscRef.current?.gain.disconnect()
    } catch {
      /* already stopped */
    }
    oscRef.current = null
  }

  function startTone(track: Track) {
    stopTone()
    if (track.kind !== 'audio' || volume === 0) return
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
      if (!Ctx) return
      const ctx: AudioContext = audioRef.current ?? new Ctx()
      audioRef.current = ctx
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = pitchOf(track.name)
      gain.gain.value = (volume / 100) * 0.12
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      oscRef.current = { osc, gain }
    } catch {
      /* no audio device: the transport still runs */
    }
  }

  /* the clock */
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => setPos((p) => (p + 1 >= duration ? 0 : p + 1)), 1000)
    return () => clearInterval(t)
  }, [playing])

  function toggle() {
    if (!current) return
    if (playing) {
      setPlaying(false)
      stopTone()
    } else {
      setPlaying(true)
      startTone(current)
    }
  }

  function select(i: number) {
    if (!tracks.length) return
    const next = (i + tracks.length) % tracks.length
    setIndex(next)
    setPos(0)
    if (playing) startTone(tracks[next])
  }

  useEffect(() => () => stopTone(), [])

  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, background: 'var(--wm-window-bg)', color: 'var(--wm-window-fg)' }}>
      {/* library */}
      <div style={{ width: 210, flex: 'none', borderRight: '1px solid rgba(0,0,0,0.14)', overflow: 'auto', padding: 8, background: 'color-mix(in srgb, var(--wm-window-bg) 92%, #808890)' }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.65, padding: '2px 6px 8px' }}>
          Music &amp; Videos
        </div>
        {tracks.length === 0 && (
          <div style={{ fontSize: 12.5, opacity: 0.7, padding: '6px' }}>
            Nothing in ~/Music or ~/Videos yet.
          </div>
        )}
        {tracks.map((t, i) => (
          <div
            key={t.path}
            className="menu-item"
            data-active={i === index}
            style={{ background: i === index ? 'color-mix(in srgb, var(--wm-accent) 34%, transparent)' : undefined }}
            onClick={() => select(i)}
          >
            <Glyph name={t.kind === 'audio' ? 'Music' : 'Film'} size={14} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
          </div>
        ))}
      </div>

      {/* stage and transport */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            flex: 1,
            display: 'grid',
            placeItems: 'center',
            background: current?.kind === 'video' ? '#101315' : 'color-mix(in srgb, var(--wm-window-bg) 88%, #000)',
            color: current?.kind === 'video' ? '#e8ecea' : undefined,
          }}
        >
          {current ? (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <Glyph name={current.kind === 'audio' ? 'Music' : 'Film'} size={54} />
              <div style={{ marginTop: 12, fontWeight: 600, fontSize: 15 }}>{baseName(current.path)}</div>
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                {current.kind === 'audio' ? 'Audio' : 'Video'} · {settings.fullName || settings.username}
              </div>
              {playing && <div style={{ fontSize: 22, fontVariantNumeric: 'tabular-nums', marginTop: 10 }}>{clock(pos)}</div>}
            </div>
          ) : (
            <div style={{ opacity: 0.7, fontSize: 13 }}>Put a file in ~/Music or ~/Videos and it will show up here.</div>
          )}
        </div>

        <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(0,0,0,0.14)' }}>
          <input
            type="range"
            min={0}
            max={duration}
            value={pos}
            onChange={(e) => setPos(Number(e.target.value))}
            style={{ width: '100%' }}
            aria-label="Seek"
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 11.5, opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>{clock(pos)}</span>
            <div style={{ flex: 1 }} />
            <button className="btn-ghost" disabled={!current} onClick={() => select(index - 1)} title="Previous">
              <Glyph name="SkipBack" size={15} />
            </button>
            <button className="btn-mixt" disabled={!current} onClick={toggle} title={playing ? 'Pause' : 'Play'}>
              <Glyph name={playing ? 'Pause' : 'Play'} size={15} />
            </button>
            <button
              className="btn-ghost"
              disabled={!current}
              onClick={() => {
                setPlaying(false)
                setPos(0)
                stopTone()
              }}
              title="Stop"
            >
              <Glyph name="Square" size={15} />
            </button>
            <button className="btn-ghost" disabled={!current} onClick={() => select(index + 1)} title="Next">
              <Glyph name="SkipForward" size={15} />
            </button>
            <div style={{ flex: 1 }} />
            <Glyph name="Volume2" size={15} />
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => {
                const v = Number(e.target.value)
                setVolume(v)
                if (oscRef.current) oscRef.current.gain.gain.value = (v / 100) * 0.12
              }}
              style={{ width: 96 }}
              aria-label="Volume"
            />
            <span style={{ fontSize: 11.5, opacity: 0.7, width: 30, textAlign: 'right' }}>{volume}</span>
          </div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>
            Install VLC media player from the Software Manager and choose it in System Settings → Sound to play with
            that instead.
          </div>
        </div>
      </div>
    </div>
  )
}
