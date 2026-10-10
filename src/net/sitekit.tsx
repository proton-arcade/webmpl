import React from 'react'
import { AppIcon, Glyph } from '../shell/AppIcon'
import type { PageCtx, SiteDef } from './types'

/** Shared frame so every MixtNet site feels like a real website. */
export function SiteShell({
  site,
  ctx,
  nav,
  children,
  footer,
  maxWidth = 960,
  plain,
}: {
  site: SiteDef
  ctx: PageCtx
  nav?: { label: string; href: string }[]
  children: React.ReactNode
  footer?: React.ReactNode
  maxWidth?: number
  plain?: boolean
}) {
  const active = (href: string) => ctx.url.endsWith(href.split('?')[0])
  return (
    <div className="webdoc" style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      {!plain && (
        <header
          style={{
            background: `linear-gradient(135deg, ${site.color2 ?? site.color}, ${site.color})`,
            color: '#fff',
            padding: '10px 22px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.25)',
          }}
        >
          <a
            onClick={() => ctx.navigate(`https://${site.domain}/`)}
            style={{ display: 'flex', alignItems: 'center', gap: 9, color: '#fff', textDecoration: 'none', cursor: 'pointer' }}
          >
            <AppIcon glyph={site.glyph} color="#ffffff33" color2="#ffffff11" size={26} rounded={0.28} />
            <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: 0.2 }}>{site.title}</span>
          </a>
          <nav style={{ display: 'flex', gap: 4, marginLeft: 14, flexWrap: 'wrap' }}>
            {(nav ?? []).map((n) => (
              <a
                key={n.href}
                onClick={() => ctx.navigate(n.href)}
                style={{
                  color: active(n.href) ? '#fff' : '#fff',
                  opacity: active(n.href) ? 1 : 0.85,
                  background: active(n.href) ? 'rgba(0,0,0,0.22)' : 'transparent',
                  padding: '4px 10px',
                  borderRadius: 5,
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                {n.label}
              </a>
            ))}
          </nav>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11.5, opacity: 0.8 }}>https://{site.domain}</span>
        </header>
      )}
      <main style={{ flex: 1, padding: '20px 22px', maxWidth, margin: '0 auto', width: '100%' }}>{children}</main>
      <footer
        style={{
          borderTop: '1px solid #e2e5e0',
          padding: '16px 22px',
          color: '#6a736d',
          fontSize: 12,
          background: '#fafbf9',
        }}
      >
        {footer ?? (
          <span>
            © {new Date().getFullYear()} {site.title} — a fictional website served by MixtNet inside Mixt Web OS.
          </span>
        )}
      </footer>
    </div>
  )
}

export function A({ href, ctx, children, style }: { href: string; ctx: PageCtx; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <a onClick={() => ctx.navigate(href)} style={{ cursor: 'pointer', ...style }}>
      {children}
    </a>
  )
}

export function Card({ children, style, onClick }: { children: React.ReactNode; style?: React.CSSProperties; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: '#fff',
        border: '1px solid #e3e6e1',
        borderRadius: 10,
        padding: 14,
        boxShadow: '0 1px 2px rgba(20,30,20,0.06)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function Btn({
  children,
  onClick,
  tone = 'mixt',
  style,
}: {
  children: React.ReactNode
  onClick?: () => void
  tone?: 'mixt' | 'grey' | 'outline'
  style?: React.CSSProperties
}) {
  const tones: Record<string, React.CSSProperties> = {
    mixt: { background: '#61ad2b', color: '#fff', border: '1px solid #4c8f1f' },
    grey: { background: '#eef0ec', color: '#242c22', border: '1px solid #d7dbd4' },
    outline: { background: 'transparent', color: '#2c6b12', border: '1px solid #7cc93f' },
  }
  return (
    <button
      onClick={onClick}
      style={{
        padding: '7px 14px',
        borderRadius: 6,
        cursor: 'pointer',
        fontWeight: 500,
        fontSize: 13,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        ...tones[tone],
        ...style,
      }}
    >
      {children}
    </button>
  )
}

export function H({ children, level = 1, style }: { children: React.ReactNode; level?: 1 | 2 | 3; style?: React.CSSProperties }) {
  const sizes = { 1: 27, 2: 20, 3: 16 }
  return (
    <div style={{ fontSize: sizes[level], fontWeight: level === 1 ? 700 : 600, margin: level === 1 ? '0 0 12px' : '18px 0 8px', ...style }}>
      {children}
    </div>
  )
}

export function Img({ src = '', alt, height = 150, style }: { src?: string; alt?: string; height?: number; style?: React.CSSProperties }) {
  // MixtNet does not ship photographs, so "images" are procedural gradients.
  const seed = [...(alt ?? src)].reduce((a, c) => a + c.charCodeAt(0), 0)
  const h1 = seed % 360
  const h2 = (seed * 7) % 360
  return (
    <div
      style={{
        height,
        borderRadius: 8,
        background: `linear-gradient(135deg, hsl(${h1} 55% 62%), hsl(${h2} 60% 38%))`,
        display: 'grid',
        placeItems: 'center',
        color: 'rgba(255,255,255,0.92)',
        fontSize: 12.5,
        textAlign: 'center',
        padding: 8,
        ...style,
      }}
    >
      {alt}
    </div>
  )
}

export function Pill({ children, tone = '#eef4e8', color = '#2c6b12' }: { children: React.ReactNode; tone?: string; color?: string }) {
  return (
    <span style={{ background: tone, color, borderRadius: 999, padding: '2px 9px', fontSize: 11.5, fontWeight: 500 }}>
      {children}
    </span>
  )
}

export function Meta({ children }: { children: React.ReactNode }) {
  return <div style={{ color: '#77807a', fontSize: 12 }}>{children}</div>
}

export function Progress({ value }: { value: number }) {
  return (
    <div style={{ height: 6, background: '#e6e9e4', borderRadius: 999, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(100, Math.max(0, value))}%`, height: '100%', background: 'linear-gradient(90deg,#7cc93f,#4c8f1f)', transition: 'width .2s linear' }} />
    </div>
  )
}

/** MixtNet 404 page, shared by every site. */
export function NotFound({ ctx, site }: { ctx: PageCtx; site: SiteDef }) {
  return (
    <SiteShell site={site} ctx={ctx}>
      <div style={{ textAlign: 'center', padding: '40px 10px' }}>
        <div style={{ fontSize: 60, fontWeight: 800, color: site.color }}>404</div>
        <H level={2}>We could not find that page on {site.domain}</H>
        <p style={{ color: '#5c665f' }}>
          The link may be broken, or the page may have been moved inside the MixtNet.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
          <Btn onClick={() => ctx.navigate(`https://${site.domain}/`)}>
            <Glyph name="Home" size={14} /> Back to {site.title}
          </Btn>
          <Btn tone="outline" onClick={() => ctx.navigate('https://mixtnet.com/')}>
            Search MixtNet
          </Btn>
        </div>
      </div>
    </SiteShell>
  )
}
