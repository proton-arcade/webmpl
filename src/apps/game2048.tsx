import React, { useCallback, useEffect, useState } from 'react'
import { useOS } from '../os/store'
import { Glyph } from '../shell/AppIcon'
import type { AppProps } from '../os/types'

type Grid = number[][]

const SIZE = 4
const TILE_COLORS: Record<number, [string, string]> = {
  2: ['#eeeae3', '#726b62'],
  4: ['#efe0c8', '#736449'],
  8: ['#f2b179', '#ffffff'],
  16: ['#f59563', '#ffffff'],
  32: ['#f67c5f', '#ffffff'],
  64: ['#f65e3b', '#ffffff'],
  128: ['#edcf72', '#ffffff'],
  256: ['#edcc61', '#ffffff'],
  512: ['#edc850', '#ffffff'],
  1024: ['#edc53f', '#ffffff'],
  2048: ['#9ede6a', '#1c2a10'],
  4096: ['#7cc93f', '#12300a'],
  8192: ['#4c8f1f', '#ffffff'],
}

function emptyGrid(): Grid {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0))
}

function addRandom(grid: Grid): Grid {
  const empty: [number, number][] = []
  grid.forEach((row, r) => row.forEach((v, c) => v === 0 && empty.push([r, c])))
  if (!empty.length) return grid
  const [r, c] = empty[Math.floor(Math.random() * empty.length)]
  const next = grid.map((row) => [...row])
  next[r][c] = Math.random() < 0.9 ? 2 : 4
  return next
}

function newGame(): Grid {
  return addRandom(addRandom(emptyGrid()))
}

function collapse(row: number[]): { row: number[]; gained: number } {
  const filtered = row.filter((v) => v !== 0)
  const out: number[] = []
  let gained = 0
  for (let i = 0; i < filtered.length; i++) {
    if (filtered[i] === filtered[i + 1]) {
      const merged = filtered[i] * 2
      out.push(merged)
      gained += merged
      i++
    } else out.push(filtered[i])
  }
  while (out.length < SIZE) out.push(0)
  return { row: out, gained }
}

function move(grid: Grid, dir: 'left' | 'right' | 'up' | 'down'): { grid: Grid; gained: number; moved: boolean } {
  let working = grid.map((r) => [...r])
  const rotate = (g: Grid): Grid => g[0].map((_, i) => g.map((row) => row[i]).reverse())
  const rotations = dir === 'left' ? 0 : dir === 'up' ? 1 : dir === 'right' ? 2 : 3
  for (let i = 0; i < rotations; i++) working = rotate(working)
  let gained = 0
  working = working.map((row) => {
    const res = collapse(row)
    gained += res.gained
    return res.row
  })
  for (let i = 0; i < (4 - rotations) % 4; i++) working = rotate(working)
  const moved = JSON.stringify(working) !== JSON.stringify(grid)
  return { grid: working, gained, moved }
}

function hasMoves(grid: Grid) {
  if (grid.some((row) => row.includes(0))) return true
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = grid[r][c]
      if (c + 1 < SIZE && grid[r][c + 1] === v) return true
      if (r + 1 < SIZE && grid[r + 1][c] === v) return true
    }
  }
  return false
}

export default function Game2048App({ api }: AppProps) {
  const [grid, setGrid] = useState<Grid>(newGame)
  const [score, setScore] = useState(0)
  const [best, setBest] = useState(() => Number(localStorage.getItem('webmpl.2048.best') ?? '0'))
  const [history, setHistory] = useState<{ grid: Grid; score: number }[]>([])
  const [state, setState] = useState<'playing' | 'won' | 'lost'>('playing')
  const [moves, setMoves] = useState(0)

  useEffect(() => {
    api.setTitle(`${score > best ? score : best} — 2048`)
    if (score > best) {
      setBest(score)
      localStorage.setItem('webmpl.2048.best', String(score))
    }
  }, [score, best])

  const doMove = useCallback(
    (dir: 'left' | 'right' | 'up' | 'down') => {
      if (state !== 'playing') return
      setGrid((current) => {
        const res = move(current, dir)
        if (!res.moved) return current
        setHistory((h) => [...h.slice(-20), { grid: current, score }])
        const withNew = addRandom(res.grid)
        setScore((s) => s + res.gained)
        setMoves((m) => m + 1)
        if (res.grid.flat().includes(2048) && state === 'playing' && !localStorage.getItem('webmpl.2048.won')) {
          localStorage.setItem('webmpl.2048.won', '1')
          setState('won')
        } else if (!hasMoves(withNew)) {
          setState('lost')
        }
        return withNew
      })
    },
    [state, score],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useOS.getState().activeId !== undefined) {
        const target = e.target as HTMLElement
        if (['INPUT', 'TEXTAREA'].includes(target?.tagName)) return
      }
      const map: Record<string, 'left' | 'right' | 'up' | 'down'> = {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'up',
        ArrowDown: 'down',
        a: 'left',
        d: 'right',
        w: 'up',
        s: 'down',
      }
      const dir = map[e.key]
      if (dir) {
        e.preventDefault()
        doMove(dir)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doMove])

  function undo() {
    setHistory((h) => {
      const last = h[h.length - 1]
      if (!last) return h
      setGrid(last.grid)
      setScore(last.score)
      setState('playing')
      return h.slice(0, -1)
    })
  }

  function restart() {
    setGrid(newGame())
    setScore(0)
    setHistory([])
    setState('playing')
    setMoves(0)
  }

  const running = state === 'playing'

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: '#faf8f3' }}>
      <div className="mint-toolbar" style={{ background: '#f0ece2', color: '#4a4238' }}>
        <button className="btn-ghost" onClick={restart}>
          <Glyph name="RefreshCw" size={15} /> New game
        </button>
        <button className="btn-ghost" disabled={!history.length} onClick={undo}>
          <Glyph name="RotateCcw" size={15} /> Undo
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, opacity: 0.75 }}>{moves} moves</span>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 16, overflow: 'auto' }}>
        <div style={{ display: 'flex', gap: 12, width: '100%', maxWidth: 420, marginBottom: 12 }}>
          <div style={{ flex: 1, background: '#bbada0', borderRadius: 8, padding: '8px 12px', color: '#fff' }}>
            <div style={{ fontSize: 11, opacity: 0.85 }}>SCORE</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{score}</div>
          </div>
          <div style={{ flex: 1, background: '#bbada0', borderRadius: 8, padding: '8px 12px', color: '#fff' }}>
            <div style={{ fontSize: 11, opacity: 0.85 }}>BEST</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{best}</div>
          </div>
          <button className="btn-mint" onClick={restart} style={{ alignSelf: 'stretch' }}>
            New game
          </button>
        </div>

        <div
          style={{
            position: 'relative',
            width: '100%',
            maxWidth: 420,
            aspectRatio: '1',
            background: '#bbada0',
            borderRadius: 10,
            padding: 10,
            display: 'grid',
            gridTemplateColumns: `repeat(${SIZE}, 1fr)`,
            gap: 10,
            touchAction: 'none',
          }}
          onTouchStart={(e) => {
            const t = e.touches[0]
            ;(e.currentTarget as any)._start = { x: t.clientX, y: t.clientY }
          }}
          onTouchEnd={(e) => {
            const start = (e.currentTarget as any)._start
            if (!start) return
            const t = e.changedTouches[0]
            const dx = t.clientX - start.x
            const dy = t.clientY - start.y
            if (Math.abs(dx) > Math.abs(dy)) doMove(dx > 0 ? 'right' : 'left')
            else doMove(dy > 0 ? 'down' : 'up')
          }}
        >
          {grid.flat().map((value, i) => {
            const [bg, fg] = TILE_COLORS[value] ?? ['#3c3a32', '#ffffff']
            return (
              <div
                key={i}
                style={{
                  background: value ? bg : 'rgba(238,228,218,0.35)',
                  borderRadius: 7,
                  display: 'grid',
                  placeItems: 'center',
                  color: fg,
                  fontWeight: 700,
                  fontSize: value >= 1024 ? 22 : value >= 128 ? 26 : 30,
                  transition: 'background .12s ease-out',
                }}
              >
                {value || ''}
              </div>
            )
          })}

          {state !== 'playing' && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 10,
                background: state === 'won' ? 'rgba(158,222,106,0.92)' : 'rgba(60,58,50,0.86)',
                color: state === 'won' ? '#1c2a10' : '#fff',
                display: 'grid',
                placeItems: 'center',
                textAlign: 'center',
                padding: 20,
              }}
            >
              <div>
                <div style={{ fontSize: 26, fontWeight: 800 }}>{state === 'won' ? 'You made 2048!' : 'No moves left'}</div>
                <div style={{ marginTop: 6, opacity: 0.85 }}>
                  Score {score} · best {best} · {moves} moves
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 14 }}>
                  {state === 'won' && (
                    <button className="btn-mint" onClick={() => setState('playing')}>
                      Keep playing
                    </button>
                  )}
                  <button className="btn-ghost" onClick={restart} style={{ color: state === 'won' ? '#1c2a10' : '#fff' }}>
                    New game
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ maxWidth: 420, marginTop: 14, fontSize: 12.5, opacity: 0.7, textAlign: 'center' }}>
          Use the arrow keys (or W A S D), or swipe on a touch screen. Merge equal tiles to reach 2048 — your best score
          is remembered between sessions.
        </div>
      </div>
    </div>
  )
}
