import type { Settings } from './types'

/** Pushes the session settings into CSS custom properties (Mint-Y theming). */
export function applyThemeVars(s: Settings) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.scheme = s.scheme
  root.style.setProperty('--wm-accent', s.accent)
  root.style.setProperty('--wm-accent-dim', shade(s.accent, -0.18))
  root.style.setProperty('--wm-panel-text', s.scheme === 'dark' ? '#f0f2ef' : '#1c1f21')
}

export function shade(hex: string, amount: number) {
  const c = hex.replace('#', '')
  const full = c.length === 3 ? c.split('').map((x) => x + x).join('') : c
  const num = parseInt(full, 16)
  let r = (num >> 16) & 255
  let g = (num >> 8) & 255
  let b = num & 255
  const f = (v: number) =>
    Math.max(0, Math.min(255, Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount)))
  r = f(r); g = f(g); b = f(b)
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

export function rgba(hex: string, alpha: number) {
  const c = hex.replace('#', '')
  const full = c.length === 3 ? c.split('').map((x) => x + x).join('') : c
  const num = parseInt(full, 16)
  return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`
}
