import React, { useEffect, useRef, useState } from 'react'

export interface MenuItem {
  label?: string
  icon?: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  separator?: boolean
  accel?: string
  checked?: boolean
  submenu?: MenuItem[]
}

export function Popup({
  x,
  y,
  items,
  onClose,
  minWidth = 200,
  align = 'left',
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
  minWidth?: number
  align?: 'left' | 'right'
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [openSub, setOpenSub] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let nx = align === 'right' ? x - r.width : x
    let ny = y
    if (nx + r.width > window.innerWidth - 4) nx = window.innerWidth - r.width - 4
    if (nx < 4) nx = 4
    if (ny + r.height > window.innerHeight - 4) ny = Math.max(4, window.innerHeight - r.height - 4)
    setPos({ x: nx, y: ny })
  }, [x, y, align, items.length])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const t = setTimeout(() => window.addEventListener('mousedown', onDown, true), 0)
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="menu-popup anim-pop"
      style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 180000, minWidth }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="menu-sep" />
        ) : (
          <div
            key={i}
            className="menu-item"
            data-disabled={it.disabled}
            style={{ opacity: it.disabled ? 0.45 : 1, position: 'relative' }}
            onMouseEnter={() => setOpenSub(it.submenu ? i : null)}
            onClick={(e) => {
              if (it.submenu) {
                e.stopPropagation()
                setOpenSub(openSub === i ? null : i)
                return
              }
              if (it.disabled) return
              it.onClick?.()
              onClose()
            }}
          >
            <span style={{ width: 16, display: 'grid', placeItems: 'center', flex: 'none' }}>{it.icon}</span>
            <span style={{ flex: 1 }}>{it.label}</span>
            {it.accel && <span style={{ opacity: 0.6, fontSize: 11 }}>{it.accel}</span>}
            {it.checked && <span style={{ color: 'var(--wm-accent-dim)' }}>✓</span>}
            {it.submenu && <span style={{ opacity: 0.6 }}>▸</span>}
            {it.submenu && openSub === i && (
              <div style={{ position: 'absolute', left: '100%', top: -5, zIndex: 10 }}>
                <Popup x={0} y={0} items={it.submenu} onClose={onClose} minWidth={170} />
              </div>
            )}
          </div>
        ),
      )}
    </div>
  )
}

/** Simple right-click/context-menu controller. */
export function usePopup<T = any>() {
  const [state, setState] = useState<{ x: number; y: number; data?: T } | null>(null)
  return {
    state,
    open: (e: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void }, data?: T) => {
      e.preventDefault?.()
      e.stopPropagation?.()
      setState({ x: e.clientX, y: e.clientY, data })
    },
    close: () => setState(null),
  }
}
