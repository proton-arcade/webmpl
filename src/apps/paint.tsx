import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useOS } from '../os/store'
import { useVFS, HOME, vfs, join, baseName } from '../os/vfs'
import { Glyph } from '../shell/AppIcon'
import { Dialog } from './files'
import { notify } from '../os/bus'
import type { AppProps } from '../os/types'

type Tool = 'pencil' | 'brush' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'fill' | 'text'

const PALETTE = [
  '#000000', '#5c665f', '#b8c0ba', '#ffffff', '#b8532f', '#e0793a', '#e8b64c', '#e8e04c',
  '#9ede6a', '#4c8f1f', '#1f6b4a', '#4aa8a0', '#4a9be8', '#26409c', '#8b5cf6', '#e05f8a',
]

const SIZES = [1, 2, 4, 8, 16, 28]

export default function PaintApp({ win, api }: AppProps) {
  const revision = useVFS((s) => s.revision)
  const settings = useOS((s) => s.settings)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tool, setTool] = useState<Tool>('brush')
  const [colour, setColour] = useState('#4c8f1f')
  const [size, setSize] = useState(4)
  const [undoStack, setUndoStack] = useState<string[]>([])
  const [redoStack, setRedoStack] = useState<string[]>([])
  const [showSave, setShowSave] = useState(false)
  const [textDraft, setTextDraft] = useState<string | null>(null)
  const drawing = useRef<any>(null)

  const W = 900
  const H = 560

  /* initial canvas: white, or the image we were asked to open */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)
    const path = win.props?.path
    if (path) {
      const node = vfs.node(path)
      const url = node && node.type === 'file' ? (node as any).url : undefined
      if (url) {
        const img = new Image()
        img.onload = () => {
          const scale = Math.min(W / img.width, H / img.height)
          ctx.drawImage(img, 0, 0, img.width * scale, img.height * scale)
          pushUndo()
        }
        img.src = url
      }
    } else {
      // a friendly starting doodle
      ctx.strokeStyle = '#9ede6a'
      ctx.lineWidth = 8
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(120, 380)
      ctx.bezierCurveTo(240, 200, 420, 460, 560, 260)
      ctx.bezierCurveTo(640, 140, 760, 300, 820, 220)
      ctx.stroke()
      ctx.fillStyle = 'rgba(76,143,31,0.14)'
      ctx.font = '500 22px Ubuntu, sans-serif'
      ctx.fillText('Drawing — pick a brush and scribble', 24, 40)
      pushUndo()
    }
  }, [])

  useEffect(() => {
    api.setTitle(`Drawing — ${tool}`)
  }, [tool])

  function pushUndo() {
    const canvas = canvasRef.current
    if (!canvas) return
    setUndoStack((s) => [...s.slice(-24), canvas.toDataURL()])
    setRedoStack([])
  }

  function restore(dataUrl: string) {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const img = new Image()
    img.onload = () => {
      ctx.clearRect(0, 0, W, H)
      ctx.drawImage(img, 0, 0)
    }
    img.src = dataUrl
  }

  function undo() {
    setUndoStack((s) => {
      if (s.length < 2) return s
      const last = s[s.length - 1]
      const previous = s[s.length - 2]
      setRedoStack((r) => [...r, last])
      restore(previous)
      return s.slice(0, -1)
    })
  }

  function redo() {
    setRedoStack((r) => {
      if (!r.length) return r
      const next = r[r.length - 1]
      restore(next)
      setUndoStack((s) => [...s, next])
      return r.slice(0, -1)
    })
  }

  function pos(e: React.PointerEvent) {
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
    return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H }
  }

  function floodFill(x: number, y: number, hex: string) {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const img = ctx.getImageData(0, 0, W, H)
    const data = img.data
    const target = getPixel(data, x, y)
    const rgb = hexToRgb(hex)
    if (!target || sameColour(target, rgb)) return
    const stack: [number, number][] = [[Math.round(x), Math.round(y)]]
    const seen = new Uint8Array(W * H)
    while (stack.length) {
      const [cx, cy] = stack.pop()!
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue
      const idx = cy * W + cx
      if (seen[idx]) continue
      seen[idx] = 1
      const p = getPixel(data, cx, cy)!
      if (!closeColour(p, target)) continue
      setPixel(data, cx, cy, rgb)
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
    }
    ctx.putImageData(img, 0, 0)
  }

  function getPixel(data: Uint8ClampedArray, x: number, y: number) {
    const i = (Math.round(y) * W + Math.round(x)) * 4
    if (i < 0 || i >= data.length) return null
    return [data[i], data[i + 1], data[i + 2], data[i + 3]] as number[]
  }
  function setPixel(data: Uint8ClampedArray, x: number, y: number, rgb: number[]) {
    const i = (y * W + x) * 4
    data[i] = rgb[0]
    data[i + 1] = rgb[1]
    data[i + 2] = rgb[2]
    data[i + 3] = 255
  }
  function sameColour(a: number[], b: number[]) {
    return Math.abs(a[0] - b[0]) < 6 && Math.abs(a[1] - b[1]) < 6 && Math.abs(a[2] - b[2]) < 6
  }
  function closeColour(a: number[], b: number[]) {
    return Math.abs(a[0] - b[0]) < 24 && Math.abs(a[1] - b[1]) < 24 && Math.abs(a[2] - b[2]) < 24 && Math.abs(a[3] - b[3]) < 24
  }
  function hexToRgb(hex: string) {
    const n = parseInt(hex.replace('#', ''), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const { x, y } = pos(e)
    const ctx = canvasRef.current!.getContext('2d')!
    if (tool === 'fill') {
      floodFill(x, y, colour)
      pushUndo()
      return
    }
    if (tool === 'text') {
      setTextDraft('')
      return
    }
    pushUndo()
    ;(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId)
    drawing.current = { x, y, snapshot: canvasRef.current!.toDataURL() }
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : colour
    ctx.fillStyle = colour
    ctx.lineWidth = tool === 'pencil' ? Math.max(1, size / 3) : tool === 'eraser' ? size * 2 : size
    if (tool === 'pencil' || tool === 'brush' || tool === 'eraser') {
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + 0.01, y + 0.01)
      ctx.stroke()
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drawing.current
    if (!d) return
    const { x, y } = pos(e)
    const ctx = canvasRef.current!.getContext('2d')!
    if (tool === 'pencil' || tool === 'brush' || tool === 'eraser') {
      ctx.beginPath()
      ctx.moveTo(d.x, d.y)
      ctx.lineTo(x, y)
      ctx.stroke()
      d.x = x
      d.y = y
      return
    }
    // shape tools: redraw from the snapshot
    const img = new Image()
    img.onload = () => {
      ctx.clearRect(0, 0, W, H)
      ctx.drawImage(img, 0, 0)
      ctx.strokeStyle = colour
      ctx.lineWidth = size
      ctx.beginPath()
      if (tool === 'line') {
        ctx.moveTo(d.x, d.y)
        ctx.lineTo(x, y)
      } else if (tool === 'rect') {
        ctx.rect(d.x, d.y, x - d.x, y - d.y)
      } else if (tool === 'ellipse') {
        ctx.ellipse((d.x + x) / 2, (d.y + y) / 2, Math.abs(x - d.x) / 2, Math.abs(y - d.y) / 2, 0, 0, Math.PI * 2)
      }
      ctx.stroke()
    }
    img.src = d.snapshot
  }

  function onPointerUp() {
    drawing.current = null
  }

  function commitText(value: string) {
    const ctx = canvasRef.current!.getContext('2d')!
    pushUndo()
    ctx.fillStyle = colour
    ctx.font = `500 ${Math.max(14, size * 5)}px Ubuntu, sans-serif`
    ctx.fillText(value, 40, H - 40)
    setTextDraft(null)
  }

  function save(name: string, folder: string) {
    const canvas = canvasRef.current!
    const path = join(folder, name)
    vfs.write(path, '', 'image/png', canvas.toDataURL('image/png'))
    setShowSave(false)
    notify('Drawing', `Saved ${path.replace(HOME, '~')} — open it from Files or the Image Viewer.`)
  }

  const files = useMemo(() => vfs.list(`${HOME}/Pictures`) ?? [], [revision])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--wm-window-bg)' }}>
      <div className="mint-toolbar" style={{ flexWrap: 'wrap' }}>
        <button className="btn-ghost" onClick={undo} disabled={undoStack.length < 2} title="Undo">
          <Glyph name="RotateCcw" size={15} />
        </button>
        <button className="btn-ghost" onClick={redo} disabled={!redoStack.length} title="Redo">
          <Glyph name="RefreshCw" size={15} />
        </button>
        <div style={{ width: 1, height: 20, background: 'rgba(0,0,0,0.15)', margin: '0 4px' }} />
        {(
          [
            ['pencil', 'Pencil', 'MousePointer'],
            ['brush', 'Brush', 'Paintbrush'],
            ['eraser', 'Eraser', 'Box'],
            ['line', 'Line', 'Minus'],
            ['rect', 'Rectangle', 'Square'],
            ['ellipse', 'Ellipse', 'Circle'],
            ['fill', 'Fill', 'Palette'],
            ['text', 'Text', 'Type'],
          ] as [Tool, string, string][]
        ).map(([id, label, glyph]) => (
          <button key={id} className="btn-ghost" data-active={tool === id} title={label} onClick={() => setTool(id)}>
            <Glyph name={glyph} size={15} />
          </button>
        ))}
        <div style={{ width: 1, height: 20, background: 'rgba(0,0,0,0.15)', margin: '0 4px' }} />
        <span style={{ opacity: 0.7, fontSize: 12 }}>Size</span>
        <input type="range" min={1} max={5} value={SIZES.indexOf(size)} onChange={(e) => setSize(SIZES[Number(e.target.value)])} style={{ width: 110, accentColor: 'var(--wm-accent)' }} />
        <span style={{ width: 22, textAlign: 'center', fontSize: 12 }}>{size}</span>
        <div style={{ flex: 1 }} />
        <button
          className="btn-ghost"
          onClick={() => {
            const canvas = canvasRef.current!
            const ctx = canvas.getContext('2d')!
            pushUndo()
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, W, H)
          }}
        >
          <Glyph name="Trash2" size={15} /> Clear
        </button>
        <button className="btn-mint" onClick={() => setShowSave(true)}>
          <Glyph name="Save" size={15} /> Save to Pictures
        </button>
      </div>

      <div style={{ display: 'flex', gap: 4, padding: '6px 10px', alignItems: 'center', borderBottom: '1px solid rgba(0,0,0,0.12)' }}>
        <span style={{ opacity: 0.7, fontSize: 12, marginRight: 6 }}>Colour</span>
        {PALETTE.map((c) => (
          <div
            key={c}
            onClick={() => setColour(c)}
            style={{
              width: 22,
              height: 22,
              borderRadius: 4,
              background: c,
              cursor: 'pointer',
              border: colour === c ? '2px solid var(--wm-window-fg)' : '1px solid rgba(0,0,0,0.3)',
            }}
          />
        ))}
        <input type="color" value={colour} onChange={(e) => setColour(e.target.value)} style={{ marginLeft: 8, width: 34, height: 24, border: 'none', background: 'transparent' }} />
        <div style={{ flex: 1 }} />
        <span style={{ opacity: 0.7, fontSize: 12 }}>
          {files.length} images in ~/Pictures{win.props?.path ? ` · opened ${baseName(win.props.path)}` : ''}
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'grid', placeItems: 'center', padding: 14, background: 'color-mix(in srgb, var(--wm-window-bg) 88%, #808890)' }}>
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{
            background: '#fff',
            boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
            cursor: tool === 'text' ? 'text' : tool === 'fill' ? 'cell' : 'crosshair',
            touchAction: 'none',
            maxWidth: '100%',
          }}
        />
      </div>

      <div style={{ flex: 'none', padding: '3px 10px', fontSize: 11.5, borderTop: '1px solid rgba(0,0,0,0.16)', backgroundImage: 'linear-gradient(to bottom,#f2f3f1,#e6e8e4)', color: '#24292c' }}>
        Canvas {W} × {H} · saved as PNG into ~/Pictures · undo depth {undoStack.length} · theme {settings.themeName}
      </div>

      {textDraft !== null && (
        <Dialog title="Add text" width={420} onClose={() => setTextDraft(null)}>
          <input className="entry" autoFocus value={textDraft} onChange={(e) => setTextDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && commitText(textDraft)} style={{ width: '100%' }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button className="btn-ghost" onClick={() => setTextDraft(null)}>
              Cancel
            </button>
            <button className="btn-mint" onClick={() => commitText(textDraft)}>
              Add to canvas
            </button>
          </div>
        </Dialog>
      )}

      {showSave && (
        <Dialog title="Save drawing" width={460} onClose={() => setShowSave(false)}>
          <p style={{ marginTop: 0 }}>Save as a PNG into your Pictures folder.</p>
          <input
            className="entry"
            autoFocus
            defaultValue={`drawing-${Date.now().toString().slice(-5)}.png`}
            id="paint-name"
            style={{ width: '100%' }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            {[`${HOME}/Pictures`, `${HOME}/Desktop`, `${HOME}/Documents`].map((p) => (
              <button key={p} className="btn-ghost" onClick={() => save((document.getElementById('paint-name') as HTMLInputElement).value, p)}>
                Save to {baseName(p) || 'Home'}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn-ghost" onClick={() => setShowSave(false)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </div>
  )
}
