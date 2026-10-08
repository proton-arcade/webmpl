import React, { useEffect, useMemo, useState } from 'react'
import { useOS } from '../os/store'
import { useVFS, HOME, vfs, baseName, join, humanSize, parentPath } from '../os/vfs'
import { Glyph } from '../shell/AppIcon'
import { notify } from '../os/bus'
import type { AppProps } from '../os/types'

interface Img {
  name: string
  path: string
  url?: string
  size: number
  modified: number
  mime: string
}

export default function ImageViewerApp({ win, api }: AppProps) {
  const revision = useVFS((s) => s.revision)
  const setSettings = useOS((s) => s.setSettings)
  const [folder, setFolder] = useState<string>(win.props?.path ? parentPath(win.props.path) : `${HOME}/Pictures`)
  const [index, setIndex] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [fit, setFit] = useState(true)
  const [strip, setStrip] = useState(true)

  const images = useMemo<Img[]>(() => {
    const out: Img[] = []
    const walk = (path: string) => {
      for (const entry of vfs.list(path) ?? []) {
        const node = entry.node
        const childPath = join(path, entry.name)
        if (node.type === 'dir') walk(childPath)
        else if ((node as any).mime?.startsWith('image/')) {
          out.push({
            name: entry.name,
            path: childPath,
            url: (node as any).url,
            size: (node as any).url ? 240_000 : (node as any).content?.length ?? 0,
            modified: node.modified,
            mime: (node as any).mime,
          })
        }
      }
    }
    walk(folder.startsWith('/') ? folder : `${HOME}/Pictures`)
    return out
  }, [folder, revision])

  useEffect(() => {
    if (!win.props?.path) return
    const idx = images.findIndex((i) => i.path === win.props.path)
    if (idx >= 0) setIndex(idx)
    setFolder(parentPath(win.props.path))
    setRotation(0)
    setZoom(1)
  }, [win.props?.path])

  const current = images[index]
  useEffect(() => {
    api.setTitle(current ? `${current.name} — Image Viewer` : 'Image Viewer')
  }, [current?.name])

  const next = () => setIndex((i) => (i + 1) % Math.max(1, images.length))
  const prev = () => setIndex((i) => (i - 1 + images.length) % Math.max(1, images.length))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useOS.getState().activeId !== win.id) return
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(6, z * 1.15))
      if (e.key === '-') setZoom((z) => Math.max(0.15, z / 1.15))
      if (e.key === '0') {
        setZoom(1)
        setRotation(0)
        setFit(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [win.id, images.length, index])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: '#23282b' }}>
      <div className="mixt-toolbar">
        <button className="btn-ghost" title="Previous image" onClick={prev} disabled={images.length < 2}>
          <Glyph name="ChevronLeft" size={16} />
        </button>
        <button className="btn-ghost" title="Next image" onClick={next} disabled={images.length < 2}>
          <Glyph name="ChevronRight" size={16} />
        </button>
        <button className="btn-ghost" title="Zoom out" onClick={() => { setFit(false); setZoom((z) => Math.max(0.15, z / 1.2)) }}>
          <Glyph name="Minus" size={15} />
        </button>
        <button className="btn-ghost" title="Zoom in" onClick={() => { setFit(false); setZoom((z) => Math.min(6, z * 1.2)) }}>
          <Glyph name="Plus" size={15} />
        </button>
        <button className="btn-ghost" data-active={fit} title="Fit to window" onClick={() => { setFit(true); setZoom(1) }}>
          <Glyph name="Maximize2" size={15} />
        </button>
        <button className="btn-ghost" title="Real size" onClick={() => { setFit(false); setZoom(1) }}>
          1:1
        </button>
        <button className="btn-ghost" title="Rotate left" onClick={() => setRotation((r) => r - 90)}>
          <Glyph name="RotateCcw" size={15} />
        </button>
        <button className="btn-ghost" title="Rotate right" onClick={() => setRotation((r) => r + 90)}>
          <Glyph name="RefreshCw" size={15} />
        </button>
        <div style={{ flex: 1 }} />
        <button
          className="btn-ghost"
          title="Set as background"
          disabled={!current?.url}
          onClick={() => {
            if (!current?.url) return
            setSettings({ wallpaper: current.url })
            notify('Image Viewer', `${current.name} is now your desktop background.`)
          }}
        >
          <Glyph name="Image" size={15} /> Set as background
        </button>
        <button className="btn-ghost" title="Show filmstrip" data-active={strip} onClick={() => setStrip(!strip)}>
          <Glyph name="LayoutGrid" size={15} />
        </button>
        <span style={{ opacity: 0.75, fontSize: 12, marginLeft: 6 }}>{current ? `${index + 1} / ${images.length}` : '0 / 0'}</span>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          placeItems: 'center',
          overflow: 'auto',
          background:
            'repeating-conic-gradient(#2c3235 0% 25%, #23282b 0% 50%) 50% / 24px 24px',
        }}
        onClick={next}
      >
        {current ? (
          current.url ? (
            <img
              src={current.url}
              alt={current.name}
              style={{
                transform: `scale(${zoom}) rotate(${rotation}deg)`,
                maxWidth: fit ? '96%' : undefined,
                maxHeight: fit ? '94%' : undefined,
                transition: 'transform .12s ease-out',
                boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
                cursor: 'zoom-in',
              }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                setFit(false)
                setZoom((z) => (z > 1 ? 1 : 2))
              }}
            />
          ) : (
            <GeneratedImage meta={current} />
          )
        ) : (
          <div style={{ color: '#cfd6d1', textAlign: 'center' }}>
            <Glyph name="Image" size={42} />
            <div style={{ marginTop: 8 }}>No images in {folder.replace(HOME, '~')}</div>
            <div style={{ opacity: 0.7, fontSize: 12.5, marginTop: 4 }}>
              Browse to another folder, or download wallpaper from mixtcart.com
            </div>
          </div>
        )}
      </div>

      {strip && images.length > 0 && (
        <div style={{ display: 'flex', gap: 6, padding: 8, overflow: 'auto', background: '#1b1f22', borderTop: '1px solid rgba(0,0,0,0.4)' }}>
          {images.map((img, i) => (
            <div
              key={img.path}
              onClick={() => setIndex(i)}
              style={{
                width: 74,
                height: 54,
                borderRadius: 5,
                flex: 'none',
                border: i === index ? '2px solid var(--wm-accent)' : '1px solid rgba(255,255,255,0.2)',
                background: img.url ? `url(${img.url}) center/cover` : 'linear-gradient(135deg,#3b6f18,#9ede6a)',
                cursor: 'pointer',
              }}
              title={img.name}
            />
          ))}
        </div>
      )}

      <div style={{ flex: 'none', display: 'flex', gap: 16, padding: '3px 10px', fontSize: 11.5, backgroundImage: 'linear-gradient(to bottom,#f2f3f1,#e6e8e4)', color: '#24292c' }}>
        <span>{current ? current.path.replace(HOME, '~') : 'no image'}</span>
        <span style={{ flex: 1 }} />
        {current && <span>{humanSize(current.size)}</span>}
        {current && <span>{(zoom * 100).toFixed(0)}%</span>}
        {current && <span>{rotation % 360}°</span>}
        {current && <span>{current.mime}</span>}
      </div>
    </div>
  )
}

/** For pictures that exist only as a name (no file url), draw something. */
function GeneratedImage({ meta }: { meta: Img }) {
  const seed = [...meta.name].reduce((a, c) => a + c.charCodeAt(0), 0)
  const h1 = seed % 360
  const h2 = (seed * 5) % 360
  return (
    <div
      style={{
        width: '70%',
        height: '70%',
        borderRadius: 10,
        background: `linear-gradient(135deg, hsl(${h1} 55% 58%), hsl(${h2} 60% 32%))`,
        display: 'grid',
        placeItems: 'center',
        color: '#fff',
        fontSize: 15,
        textAlign: 'center',
        padding: 20,
      }}
    >
      <div>
        <div style={{ fontSize: 22, fontWeight: 600 }}>{meta.name}</div>
        <div style={{ opacity: 0.85, marginTop: 6 }}>
          this image has no pixel data — it is a placeholder rendering, generated from the file name
        </div>
      </div>
    </div>
  )
}
