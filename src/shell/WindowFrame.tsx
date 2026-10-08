import React, { useRef, useState } from 'react'
import { useOS } from '../os/store'
import type { WinState } from '../os/types'
import { getApp } from '../apps/registry'
import { AppIcon, Glyph } from './AppIcon'

type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const CURSORS: Record<Dir, string> = {
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
}

const HANDLE_SIZE = 6

function handleStyle(d: Dir): React.CSSProperties {
  const s: React.CSSProperties = { cursor: CURSORS[d] }
  const edge = HANDLE_SIZE
  const corner = HANDLE_SIZE + 4
  if (d === 'n') Object.assign(s, { top: -2, left: edge, right: edge, height: edge + 2 })
  if (d === 's') Object.assign(s, { bottom: -2, left: edge, right: edge, height: edge + 2 })
  if (d === 'w') Object.assign(s, { left: -2, top: edge, bottom: edge, width: edge + 2 })
  if (d === 'e') Object.assign(s, { right: -2, top: edge, bottom: edge, width: edge + 2 })
  if (d === 'nw') Object.assign(s, { top: -2, left: -2, width: corner, height: corner })
  if (d === 'ne') Object.assign(s, { top: -2, right: -2, width: corner, height: corner })
  if (d === 'sw') Object.assign(s, { bottom: -2, left: -2, width: corner, height: corner })
  if (d === 'se') Object.assign(s, { bottom: -2, right: -2, width: corner, height: corner })
  return s
}

export default function WindowFrame({ win, children }: { win: WinState; children: React.ReactNode }) {
  const settings = useOS((s) => s.settings)
  const activeId = useOS((s) => s.activeId)
  const { focusWindow, minimize, toggleMaximize, closeWindow, setGeometry, snap } = useOS.getState()
  const [snapHint, setSnapHint] = useState<'left' | 'right' | 'max' | null>(null)
  const dragRef = useRef<any>(null)
  const def = getApp(win.appId)
  const focused = activeId === win.id

  const panelOffset = settings.panelPosition === 'top' ? settings.panelSize : 0
  const maxGeom = {
    x: 0,
    y: panelOffset,
    w: window.innerWidth,
    h: window.innerHeight - settings.panelSize,
  }

  /* ------------------------------- dragging ------------------------------- */
  function onTitlePointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('.wm-btn')) return
    focusWindow(win.id)
    dragRef.current = {
      mx: e.clientX,
      my: e.clientY,
      x: win.x,
      y: win.y,
      w: win.w,
      h: win.h,
      wasMax: win.maximized,
      restore: win.restore,
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onTitlePointerMove(e: React.PointerEvent) {
    const d = dragRef.current
    if (!d) return
    if (d.wasMax) {
      const r = d.restore ?? { x: 60, y: 40, w: 900, h: 600 }
      const ratio = (e.clientX - d.x) / Math.max(1, d.w)
      const nx = Math.round(e.clientX - r.w * Math.min(Math.max(ratio, 0), 1))
      const ny = Math.max(panelOffset, e.clientY - 17)
      dragRef.current = { ...d, wasMax: false, mx: e.clientX, my: e.clientY, x: nx, y: ny, w: r.w, h: r.h }
      setGeometry(win.id, { x: nx, y: ny, w: r.w, h: r.h, maximized: false })
      return
    }
    const nx = Math.min(d.x + (e.clientX - d.mx), window.innerWidth - 90)
    const ny = Math.max(panelOffset, d.y + (e.clientY - d.my))
    setGeometry(win.id, { x: nx, y: ny })
    setSnapHint(
      e.clientY < 5 ? 'max' : e.clientX < 5 ? 'left' : e.clientX > window.innerWidth - 5 ? 'right' : null,
    )
  }

  function onTitlePointerUp() {
    if (!dragRef.current) return
    dragRef.current = null
    if (snapHint && !win.maximized) snap(win.id, snapHint)
    setSnapHint(null)
  }

  /* ------------------------------- resizing ------------------------------- */
  function startResize(e: React.PointerEvent, dir: Dir) {
    e.stopPropagation()
    focusWindow(win.id)
    const start = { mx: e.clientX, my: e.clientY, x: win.x, y: win.y, w: win.w, h: win.h }
    const minW = def?.minSize?.w ?? 320
    const minH = def?.minSize?.h ?? 200
    const move = (ev: PointerEvent) => {
      let { x, y, w, h } = start
      const dx = ev.clientX - start.mx
      const dy = ev.clientY - start.my
      if (dir.includes('e')) w = Math.max(minW, start.w + dx)
      if (dir.includes('s')) h = Math.max(minH, start.h + dy)
      if (dir.includes('w')) {
        w = Math.max(minW, start.w - dx)
        x = start.x + (start.w - w)
      }
      if (dir.includes('n')) {
        h = Math.max(minH, start.h - dy)
        y = Math.max(panelOffset, start.y + (start.h - h))
      }
      setGeometry(win.id, { x, y, w, h })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function openTitleMenu(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const S = useOS.getState()
    window.dispatchEvent(
      new CustomEvent('mixt:windowmenu', {
        detail: {
          x: e.clientX,
          y: e.clientY,
          items: [
            { label: 'Minimise', icon: <Glyph name="Minus" size={13} />, onClick: () => minimize(win.id) },
            {
              label: win.maximized ? 'Unmaximise' : 'Maximise',
              icon: <Glyph name="Maximize2" size={13} />,
              onClick: () => toggleMaximize(win.id),
            },
            { separator: true },
            { label: 'Snap to left half', onClick: () => snap(win.id, 'left') },
            { label: 'Snap to right half', onClick: () => snap(win.id, 'right') },
            {
              label: 'Move to workspace',
              submenu: [0, 1, 2, 3].map((i) => ({
                label: `Workspace ${i + 1}`,
                onClick: () => S.sendToWorkspace(win.id, i),
              })),
            },
            {
              label: 'Always on top',
              checked: !!win.props?.alwaysOnTop,
              onClick: () => S.patchProps(win.id, { alwaysOnTop: !win.props?.alwaysOnTop }),
            },
            { separator: true },
            { label: 'Close', icon: <Glyph name="X" size={13} />, onClick: () => closeWindow(win.id) },
          ],
        },
      }),
    )
  }

  const geometry = win.maximized ? maxGeom : { x: win.x, y: win.y, w: win.w, h: win.h }

  const buttons = (
    <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
      <button className="wm-btn" title="Minimise" onClick={() => minimize(win.id)}>
        <Glyph name="Minus" size={11} />
      </button>
      <button className="wm-btn" title="Maximise" onClick={() => toggleMaximize(win.id)}>
        <Glyph name="Square" size={9} />
      </button>
      <button className="wm-btn close" title="Close" onClick={() => closeWindow(win.id)}>
        <Glyph name="X" size={11} />
      </button>
    </div>
  )

  return (
    <>
      <div
        className={`wm-window ${focused ? 'focused' : ''} ${win.opening ? 'opening' : ''}`}
        style={{
          left: geometry.x,
          top: geometry.y,
          width: geometry.w,
          height: geometry.h,
          zIndex: win.props?.alwaysOnTop ? win.z + 900 : win.z,
          display: win.minimized ? 'none' : 'flex',
        }}
        onPointerDown={() => {
          if (!focused) focusWindow(win.id)
        }}
      >
        {!def?.noTitlebar && (
          <div
            className="wm-titlebar no-select"
            onPointerDown={onTitlePointerDown}
            onPointerMove={onTitlePointerMove}
            onPointerUp={onTitlePointerUp}
            onDoubleClick={() => toggleMaximize(win.id)}
            onContextMenu={openTitleMenu}
          >
            {settings.buttonSide === 'left' && buttons}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 'none', paddingLeft: settings.buttonSide === 'right' ? 0 : 4 }}>
              <AppIcon glyph={def?.glyph ?? 'AppWindow'} color={def?.color ?? '#5b8def'} size={19} rounded={0.3} />
            </div>
            <div className="wm-title" style={{ paddingLeft: 2 }}>{win.title}</div>
            {settings.buttonSide === 'right' ? (
              <>
                <div style={{ flex: 'none', width: 22 }} />
                {buttons}
              </>
            ) : (
              <div style={{ flex: 'none', width: 22 }} />
            )}
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
          {children}
        </div>

        {!win.maximized &&
          (Object.keys(CURSORS) as Dir[]).map((d) => (
            <div key={d} className="wm-resize" style={handleStyle(d)} onPointerDown={(e) => startResize(e, d)} />
          ))}
      </div>

      {snapHint && (
        <div
          style={{
            position: 'fixed',
            zIndex: 175000,
            pointerEvents: 'none',
            background: 'color-mix(in srgb, var(--wm-accent) 22%, transparent)',
            border: '2px solid var(--wm-accent)',
            borderRadius: 6,
            transition: 'all 90ms ease-out',
            ...(snapHint === 'left'
              ? { left: 4, top: panelOffset + 4, width: window.innerWidth / 2 - 8, height: window.innerHeight - settings.panelSize - 8 }
              : snapHint === 'right'
                ? { left: window.innerWidth / 2 + 4, top: panelOffset + 4, width: window.innerWidth / 2 - 8, height: window.innerHeight - settings.panelSize - 8 }
                : { left: 4, top: panelOffset + 4, width: window.innerWidth - 8, height: window.innerHeight - settings.panelSize - 8 }),
          }}
        />
      )}
    </>
  )
}
