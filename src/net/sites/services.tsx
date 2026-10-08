import React from 'react'
import { A, Btn, Card, H, Img, Meta, NotFound, Pill, Progress, SiteShell } from '../sitekit'
import { FILES } from '../downloads'
import type { PageCtx, SiteDef } from '../types'

/* ==========================================================================
   mixtcart.com — the shop
   ========================================================================== */

interface Product {
  id: string
  name: string
  price: number
  category: string
  blurb: string
  stars: number
  fileId?: string
}

const PRODUCTS: Product[] = [
  { id: 'tux-plush', name: 'Tux plush toy', price: 19.5, category: 'Toys', blurb: 'Seventeen centimetres of unstoppable penguin. Embroidered beak, weighted base.', stars: 5, fileId: 'tux-plush' },
  { id: 'mixt-mug', name: 'Mixt leaf mug', price: 11.0, category: 'Kitchen', blurb: '350 ml of tea capacity, dishwasher safe, faintly smug about its own colour.', stars: 4 },
  { id: 'keyboard', name: 'Mechanical keyboard, 87 keys', price: 84.9, category: 'Hardware', blurb: 'Tactile brown switches, PBT caps, a volume knob that actually turns.', stars: 5 },
  { id: 'wallpaper-pack', name: 'Wallpaper pack (3 images)', price: 0, category: 'Digital', blurb: 'The wave, the facets and the leaf. Yours to download and immediately re-download.', stars: 5, fileId: 'photo-mixt-wave' },
  { id: 'stickers', name: 'Sticker sheet', price: 4.25, category: 'Stationery', blurb: 'Twelve vinyl stickers: terminals, leaves, a cheerful monitor.', stars: 4 },
  { id: 'ssd', name: '1 TB NVMe SSD', price: 79.0, category: 'Hardware', blurb: 'Nobody has ever regretted more storage. Boots in nine seconds, sleeps in none.', stars: 5 },
  { id: 'cable', name: 'USB-C cable, 2 m braided', price: 9.99, category: 'Hardware', blurb: 'Charges at 100 W and does not tangle in a bag, allegedly.', stars: 3 },
  { id: 'notebook', name: 'Dot grid notebook', price: 7.5, category: 'Stationery', blurb: 'For drawing window layouts before you implement them badly.', stars: 4 },
  { id: 'cheatsheet', name: 'Shell cheat sheet (PDF)', price: 0, category: 'Digital', blurb: 'Pipes, redirects and the commands you always look up.', stars: 5, fileId: 'mixt-cheatsheet' },
]

interface CartLine {
  product: Product
  qty: number
}

function money(n: number) {
  return n === 0 ? 'Free' : `£${n.toFixed(2)}`
}

function CartContext(ctx: PageCtx) {
  // the cart lives one level up in a module-level object keyed by tab, so it
  // survives navigation between pages of the shop
  const key = `mixtcart.${ctx.tabId}`
  const store = ((window as any).__mixtcart ??= {} as Record<string, CartLine[]>)
  const lines: CartLine[] = (store[key] ??= [])
  return { lines, key }
}

function ShopHome({ ctx }: { ctx: PageCtx }) {
  const [q, setQ] = React.useState('')
  const [, force] = React.useState(0)
  const { lines } = CartContext(ctx)
  const add = (p: Product) => {
    const line = lines.find((l) => l.product.id === p.id)
    if (line) line.qty++
    else lines.push({ product: p, qty: 1 })
    force((n) => n + 1)
    window.dispatchEvent(
      new CustomEvent('mixt:cart', { detail: { count: lines.reduce((a, l) => a + l.qty, 0) } }),
    )
  }
  const list = q ? PRODUCTS.filter((p) => (p.name + p.category + p.blurb).toLowerCase().includes(q.toLowerCase())) : PRODUCTS
  const count = lines.reduce((a, l) => a + l.qty, 0)

  return (
    <SiteShell
      site={MIXTCART}
      ctx={ctx}
      nav={[{ label: 'Shop', href: 'https://mixtcart.com/' }, { label: 'Digital', href: 'https://mixtcart.com/category/digital' }, { label: 'Hardware', href: 'https://mixtcart.com/category/hardware' }]}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <input className="entry" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…" style={{ width: 320 }} />
        <span style={{ flex: 1 }} />
        <Btn tone="grey" onClick={() => ctx.navigate('https://mixtcart.com/cart')}>
          🛒 Cart ({count})
        </Btn>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: 14 }}>
        {list.map((p) => (
          <Card key={p.id}>
            <div style={{ cursor: 'pointer' }} onClick={() => ctx.navigate(`https://mixtcart.com/product/${p.id}`)}>
              <Img alt={p.category} height={110} />
              <div style={{ marginTop: 8, fontWeight: 600, fontSize: 14 }}>{p.name}</div>
              <Meta>
                {'★'.repeat(p.stars)}
                {'☆'.repeat(5 - p.stars)} · {p.category}
              </Meta>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 8 }}>
              <strong style={{ flex: 1, color: '#2f6b12' }}>{money(p.price)}</strong>
              <Btn onClick={() => add(p)} style={{ padding: '5px 10px' }}>
                Add
              </Btn>
            </div>
          </Card>
        ))}
      </div>
    </SiteShell>
  )
}

function ProductPage({ ctx, id }: { ctx: PageCtx; id: string }) {
  const product = PRODUCTS.find((p) => p.id === id)
  const [, force] = React.useState(0)
  const { lines } = CartContext(ctx)
  const [qty, setQty] = React.useState(1)
  if (!product) return <NotFound ctx={ctx} site={MIXTCART} />

  const add = () => {
    const line = lines.find((l) => l.product.id === product.id)
    if (line) line.qty += qty
    else lines.push({ product, qty })
    force((n) => n + 1)
    ctx.navigate('https://mixtcart.com/cart')
  }

  return (
    <SiteShell site={MIXTCART} ctx={ctx} nav={[{ label: 'Shop', href: 'https://mixtcart.com/' }]}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
        <Img alt={product.category} height={260} />
        <div>
          <H level={1}>{product.name}</H>
          <Meta>
            {'★'.repeat(product.stars)}
            {'☆'.repeat(5 - product.stars)} · {product.category} · in stock
          </Meta>
          <div style={{ fontSize: 26, fontWeight: 700, color: '#2f6b12', margin: '12px 0' }}>{money(product.price)}</div>
          <p style={{ lineHeight: 1.65, color: '#39413b' }}>{product.blurb}</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <input
              className="entry"
              type="number"
              min={1}
              max={9}
              value={qty}
              onChange={(e) => setQty(Math.max(1, Math.min(9, Number(e.target.value))))}
              style={{ width: 70 }}
            />
            <Btn onClick={add}>Add to cart</Btn>
            {product.fileId && (
              <Btn tone="outline" onClick={() => ctx.navigate(`https://mixtcart.com/download/${FILES.find((f) => f.id === product.fileId)!.filename}`)}>
                Download now
              </Btn>
            )}
          </div>
          <Card style={{ marginTop: 16, background: '#f8faf6' }}>
            <strong>Delivery</strong>
            <p style={{ margin: '4px 0 0', color: '#39413b' }}>
              Digital items download instantly into ~/Downloads. Physical items are delivered by a small van that exists only in the fiction of this shop.
            </p>
          </Card>
        </div>
      </div>
    </SiteShell>
  )
}

function CartPage({ ctx }: { ctx: PageCtx }) {
  const [, force] = React.useState(0)
  const { lines } = CartContext(ctx)
  const [placed, setPlaced] = React.useState<string | null>(null)
  const total = lines.reduce((a, l) => a + l.product.price * l.qty, 0)

  const checkout = () => {
    const orderId = `MIXT-${Math.floor(100000 + Math.random() * 899999)}`
    setPlaced(orderId)
    // write a receipt straight into the user's Documents folder
    const receipt = [
      `MixtCart order ${orderId}`,
      `Date: ${new Date().toLocaleString()}`,
      '',
      ...lines.map((l) => `${l.qty} × ${l.product.name.padEnd(34)} ${money(l.product.price * l.qty)}`),
      '',
      `Total: ${money(total)}`,
      '',
      'Thank you for shopping on the MixtNet.',
      'Digital items can be downloaded again from your order confirmation page.',
    ].join('\n')
    window.dispatchEvent(new CustomEvent('mixt:file', { detail: { path: `/home/mixt/Documents/mixtcart-order-${orderId}.txt`, content: receipt, mime: 'text/plain' } }))
    window.dispatchEvent(
      new CustomEvent('mixt:notify', { detail: { title: 'MixtCart', body: `Order ${orderId} confirmed. Receipt saved to Documents.`, appId: 'mixtcart' } }),
    )
    lines.length = 0
    force((n) => n + 1)
  }

  return (
    <SiteShell site={MIXTCART} ctx={ctx} nav={[{ label: 'Shop', href: 'https://mixtcart.com/' }]}>
      <H level={1}>Your cart</H>
      {placed ? (
        <Card style={{ background: '#f2fbe9', border: '1px solid #b6e88a' }}>
          <H level={2}>Thank you!</H>
          <p>
            Order <strong>{placed}</strong> has been placed. A receipt was written to <code>~/Documents</code> — open the Files application to see it.
          </p>
          <Btn onClick={() => ctx.navigate('https://mixtcart.com/')}>Keep shopping</Btn>
        </Card>
      ) : lines.length === 0 ? (
        <Card>
          <p>Your cart is empty. It is a very tidy cart.</p>
          <Btn onClick={() => ctx.navigate('https://mixtcart.com/')}>Browse products</Btn>
        </Card>
      ) : (
        <>
          {lines.map((l) => (
            <Card key={l.product.id} style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
              <Img alt={l.product.category} height={54} style={{ width: 78, flex: 'none' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>{l.product.name}</div>
                <Meta>{money(l.product.price)} each</Meta>
              </div>
              <input
                className="entry"
                type="number"
                min={0}
                value={l.qty}
                onChange={(e) => {
                  l.qty = Math.max(0, Number(e.target.value))
                  if (l.qty === 0) lines.splice(lines.indexOf(l), 1)
                  force((n) => n + 1)
                }}
                style={{ width: 64 }}
              />
              <strong style={{ width: 76, textAlign: 'right' }}>{money(l.product.price * l.qty)}</strong>
            </Card>
          ))}
          <Card style={{ marginTop: 12, display: 'flex', alignItems: 'center' }}>
            <strong style={{ flex: 1, fontSize: 17 }}>Total {money(total)}</strong>
            <Btn onClick={checkout}>Place order</Btn>
          </Card>
          <Meta>Free delivery on orders over £50. Nothing is actually shipped, which keeps costs low.</Meta>
        </>
      )}
    </SiteShell>
  )
}

/* ==========================================================================
   mixtmail.com — webmail
   ========================================================================== */

interface Mail {
  id: string
  from: string
  subject: string
  time: string
  body: string[]
  read?: boolean
  folder: 'inbox' | 'sent' | 'trash'
}

const SEED_MAIL: Mail[] = [
  {
    id: 'm1',
    from: 'Mixt Update Manager <updates@mixtnet.com>',
    subject: '3 optional applications are available',
    time: '09:12',
    folder: 'inbox',
    body: [
      'Hello Mixt User,',
      '',
      'Three applications can be installed from the Software Manager: Drawing, Mail and News Reader.',
      'They are small, they are green-adjacent, and they will not break anything.',
      '',
      'Kind regards,\nThe Update Manager',
    ],
  },
  {
    id: 'm2',
    from: 'Cinnamon Team <hello@cinnamon.dev>',
    subject: 'Your window snapped correctly',
    time: 'Yesterday, 18:40',
    folder: 'inbox',
    body: [
      'We noticed you dragged a window to the left edge of the screen and it filled exactly half.',
      '',
      'That is the intended behaviour. Thank you for participating.',
    ],
  },
  {
    id: 'm3',
    from: 'MixtCart <orders@mixtcart.com>',
    subject: 'Your digital downloads are ready',
    time: 'Yesterday, 11:02',
    folder: 'inbox',
    body: [
      'Thanks for your order!',
      '',
      'Your wallpapers can be downloaded directly from the product pages. They will be saved to ~/Downloads, where they will sit quietly until you open the Files application.',
    ],
  },
  {
    id: 'm4',
    from: 'Petra Lindgren <petra@mixtnews.com>',
    subject: 'Re: desktop feature ideas',
    time: 'Monday',
    folder: 'inbox',
    body: [
      'Hi!',
      '',
      'Love the four workspaces. One request: can the panel clock show seconds? I time my tea with it.',
      '',
      '— Petra',
    ],
  },
  {
    id: 'm5',
    from: 'you@mixtmail.com',
    subject: 'Re: desktop feature ideas',
    time: 'Monday',
    folder: 'sent',
    body: ['Petra,', '', 'Right-click the clock, choose preferences, tick "Show seconds". Enjoy the tea.', '', '— Mixt'],
  },
]

function MailApp({ ctx }: { ctx: PageCtx }) {
  const [folder, setFolder] = React.useState<'inbox' | 'sent' | 'trash'>('inbox')
  const [mails, setMails] = React.useState<Mail[]>(SEED_MAIL)
  const [selected, setSelected] = React.useState<string | null>('m1')
  const [writing, setWriting] = React.useState(false)
  const [to, setTo] = React.useState('')
  const [subject, setSubject] = React.useState('')
  const [body, setBody] = React.useState('')

  const visible = mails.filter((m) => m.folder === folder)
  const current = mails.find((m) => m.id === selected)
  const unread = mails.filter((m) => m.folder === 'inbox' && !m.read).length

  const send = () => {
    if (!to.trim()) return
    const mail: Mail = {
      id: `m${Date.now()}`,
      from: 'you@mixtmail.com',
      subject: subject || '(no subject)',
      time: 'now',
      body: body.split('\n'),
      folder: 'sent',
      read: true,
    }
    setMails((m) => [...m, mail])
    setWriting(false)
    setTo('')
    setSubject('')
    setBody('')
    setFolder('sent')
    setSelected(mail.id)
    window.dispatchEvent(new CustomEvent('mixt:notify', { detail: { title: 'Mail', body: `Your message to ${to} was sent.` } }))
  }

  return (
    <SiteShell site={MIXTMAIL} ctx={ctx} plain maxWidth={1000}>
      <div style={{ display: 'flex', height: 470, border: '1px solid #e3e6e1', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
        <div style={{ width: 160, background: '#f6f8f4', borderRight: '1px solid #e3e6e1', padding: 10 }}>
          <Btn onClick={() => setWriting(true)} style={{ width: '100%', justifyContent: 'center' }}>
            ✏️ Compose
          </Btn>
          <div style={{ marginTop: 12 }}>
            {([['inbox', `Inbox${unread ? ` (${unread})` : ''}`], ['sent', 'Sent'], ['trash', 'Trash']] as const).map(([key, label]) => (
              <div
                key={key}
                onClick={() => setFolder(key as any)}
                style={{ padding: '6px 9px', borderRadius: 5, cursor: 'pointer', background: folder === key ? '#e6f2d8' : undefined, fontWeight: folder === key ? 600 : 400 }}
              >
                {label}
              </div>
            ))}
          </div>
          <Meta>
            you@mixtmail.com
            <br />
            1.0 GB of 1.0 GB free
          </Meta>
        </div>

        <div style={{ width: 300, borderRight: '1px solid #e3e6e1', overflow: 'auto' }}>
          {visible.length === 0 && <div style={{ padding: 14, color: '#77807a' }}>Nothing in {folder}.</div>}
          {visible.map((m) => (
            <div
              key={m.id}
              onClick={() => {
                setSelected(m.id)
                setWriting(false)
                setMails((all) => all.map((x) => (x.id === m.id ? { ...x, read: true } : x)))
              }}
              style={{ padding: '10px 12px', borderBottom: '1px solid #eef0ec', cursor: 'pointer', background: selected === m.id ? '#f2fbe9' : undefined }}
            >
              <div style={{ fontWeight: m.read ? 400 : 700, fontSize: 13 }}>{m.subject}</div>
              <Meta>{m.from.replace(/<.*>/, '').trim()}</Meta>
              <Meta>{m.time}</Meta>
            </div>
          ))}
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {writing ? (
            <>
              <H level={2}>New message</H>
              <input className="entry" placeholder="To" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
              <input className="entry" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
              <textarea className="entry" value={body} onChange={(e) => setBody(e.target.value)} style={{ width: '100%', height: 190 }} />
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <Btn onClick={send}>Send</Btn>
                <Btn tone="grey" onClick={() => setWriting(false)}>
                  Discard
                </Btn>
              </div>
            </>
          ) : current ? (
            <>
              <H level={2}>{current.subject}</H>
              <Meta>
                From {current.from} · {current.time}
              </Meta>
              <div style={{ marginTop: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{current.body.join('\n')}</div>
              <div style={{ marginTop: 18, display: 'flex', gap: 8 }}>
                <Btn tone="grey" onClick={() => setWriting(true)}>
                  Reply
                </Btn>
                <Btn
                  tone="grey"
                  onClick={() => {
                    setMails((all) => all.map((x) => (x.id === current.id ? { ...x, folder: 'trash' } : x)))
                    setSelected(null)
                  }}
                >
                  Move to trash
                </Btn>
              </div>
            </>
          ) : (
            <div style={{ color: '#77807a' }}>Select a message to read it.</div>
          )}
        </div>
      </div>
    </SiteShell>
  )
}

/* ==========================================================================
   mixtmaps.com — maps
   ========================================================================== */

const PLACES: { name: string; kind: string; x: number; y: number; info: string }[] = [
  { name: 'Mixtville Centre', kind: 'Town', x: 0.5, y: 0.5, info: 'The greenest roundabout on the MixtNet.' },
  { name: 'Cinnamon Park', kind: 'Park', x: 0.22, y: 0.3, info: 'Trees, benches and one extremely relaxed duck.' },
  { name: 'Kernel Street', kind: 'Road', x: 0.62, y: 0.36, info: 'Runs north to south, never blocks.' },
  { name: 'Daemon Docks', kind: 'Harbour', x: 0.76, y: 0.72, info: 'Ships in the night, cleaned up by systemd.' },
  { name: 'Terminal Station', kind: 'Station', x: 0.4, y: 0.66, info: 'Platforms named after shells. No services run here.' },
  { name: 'Localhost Lane', kind: 'Road', x: 0.86, y: 0.24, info: 'Always close by, never accessible from outside.' },
  { name: 'Pipe Avenue', kind: 'Road', x: 0.3, y: 0.78, info: 'Every intersection feeds into the next.' },
  { name: 'Wallpaper Gardens', kind: 'Park', x: 0.14, y: 0.6, info: 'Gradients all the way to the horizon.' },
]

function MapCanvas({ focus, onPick }: { focus: { x: number; y: number } | null; onPick?: (x: number, y: number) => void }) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = React.useState(1)
  const [center, setCenter] = React.useState({ x: 0.5, y: 0.5 })
  const drag = React.useRef<any>(null)

  React.useEffect(() => {
    if (focus) setCenter(focus)
  }, [focus])

  React.useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const W = (canvas.width = canvas.clientWidth)
    const H = (canvas.height = canvas.clientHeight)
    const scale = zoom * Math.min(W, H)

    const project = (x: number, y: number) => ({
      px: W / 2 + (x - center.x) * scale,
      py: H / 2 + (y - center.y) * scale,
    })

    // background
    ctx.fillStyle = '#eef3e8'
    ctx.fillRect(0, 0, W, H)

    // water
    ctx.fillStyle = '#cfe6f2'
    ctx.fillRect(0, H * 0.86, W, H * 0.14)
    ctx.beginPath()
    ctx.moveTo(W * 0.62, H)
    ctx.bezierCurveTo(W * 0.72, H * 0.78, W * 0.86, H * 0.82, W, H * 0.74)
    ctx.lineTo(W, H)
    ctx.closePath()
    ctx.fill()

    // parks
    ctx.fillStyle = '#cdeab8'
    for (const p of PLACES.filter((p) => p.kind === 'Park')) {
      const { px, py } = project(p.x, p.y)
      ctx.beginPath()
      ctx.ellipse(px, py, scale * 0.09, scale * 0.07, 0.4, 0, Math.PI * 2)
      ctx.fill()
    }

    // roads: a deterministic grid
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = Math.max(2, scale * 0.012)
    for (let i = -4; i <= 8; i++) {
      const t = 0.5 + i * 0.11
      const a = project(t, -1)
      const b = project(t, 2)
      ctx.beginPath()
      ctx.moveTo(a.px, a.py)
      ctx.lineTo(b.px, b.py)
      ctx.moveTo(project(-1, t).px, project(-1, t).py)
      ctx.lineTo(project(2, t).px, project(2, t).py)
      ctx.stroke()
    }
    ctx.strokeStyle = '#f7c96b'
    ctx.lineWidth = Math.max(3, scale * 0.022)
    const mainA = project(-1, 0.5)
    const mainB = project(2, 0.5)
    ctx.beginPath()
    ctx.moveTo(mainA.px, mainA.py)
    ctx.lineTo(mainB.px, mainB.py)
    ctx.stroke()

    // places
    for (const p of PLACES) {
      const { px, py } = project(p.x, p.y)
      ctx.fillStyle = p.kind === 'Park' ? '#3f7d1f' : '#b8532f'
      ctx.beginPath()
      ctx.arc(px, py, Math.max(3, scale * 0.011), 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#25302a'
      ctx.font = `${Math.max(10, Math.min(13, scale * 0.03))}px Ubuntu, sans-serif`
      ctx.fillText(p.name, px + 8, py + 4)
    }

    // centre crosshair
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(W / 2 - 8, H / 2)
    ctx.lineTo(W / 2 + 8, H / 2)
    ctx.moveTo(W / 2, H / 2 - 8)
    ctx.lineTo(W / 2, H / 2 + 8)
    ctx.stroke()
  }, [zoom, center, focus])

  return (
    <div style={{ position: 'relative', height: 420, borderRadius: 10, overflow: 'hidden', border: '1px solid #dfe3dd' }}>
      <canvas
        ref={ref}
        style={{ width: '100%', height: '100%', cursor: drag.current ? 'grabbing' : 'grab', display: 'block' }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, cx: center.x, cy: center.y }
          ;(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const canvas = ref.current!
          const scale = zoom * Math.min(canvas.clientWidth, canvas.clientHeight)
          setCenter({
            x: drag.current.cx - (e.clientX - drag.current.x) / scale,
            y: drag.current.cy - (e.clientY - drag.current.y) / scale,
          })
        }}
        onPointerUp={() => {
          drag.current = null
        }}
        onClick={(e) => {
          const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
          const canvas = ref.current!
          const scale = zoom * Math.min(canvas.clientWidth, canvas.clientHeight)
          onPick?.(
            center.x + (e.clientX - rect.left - rect.width / 2) / scale,
            center.y + (e.clientY - rect.top - rect.height / 2) / scale,
          )
        }}
      />
      <div style={{ position: 'absolute', right: 10, top: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button className="btn-ghost" style={{ background: '#fff' }} onClick={() => setZoom((z) => Math.min(6, z * 1.35))}>
          +
        </button>
        <button className="btn-ghost" style={{ background: '#fff' }} onClick={() => setZoom((z) => Math.max(0.6, z / 1.35))}>
          −
        </button>
        <button className="btn-ghost" style={{ background: '#fff' }} onClick={() => { setZoom(1); setCenter({ x: 0.5, y: 0.5 }) }}>
          ⌂
        </button>
      </div>
      <div style={{ position: 'absolute', left: 10, bottom: 10, background: 'rgba(255,255,255,0.9)', borderRadius: 6, padding: '4px 8px', fontSize: 11.5 }}>
        zoom {zoom.toFixed(1)}× · drag to pan
      </div>
    </div>
  )
}

function MapsHome({ ctx }: { ctx: PageCtx }) {
  const [q, setQ] = React.useState('')
  const [focus, setFocus] = React.useState<{ x: number; y: number } | null>(null)
  const [selected, setSelected] = React.useState<(typeof PLACES)[number] | null>(null)
  const [route, setRoute] = React.useState<{ from: string; to: string } | null>(null)

  const found = q ? PLACES.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())) : []
  const steps = route
    ? [
        `Leave ${route.from} heading towards the main road (north-east).`,
        'At the Mixtville roundabout take the second exit onto Kernel Street.',
        'Continue straight for about 900 m — you will pass Cinnamon Park on your left.',
        route.to.includes('Docks') ? 'Turn right at the harbour sign and follow the quay.' : `Arrive at ${route.to} on your right.`,
      ]
    : []

  return (
    <SiteShell
      site={MIXTMAPS}
      ctx={ctx}
      nav={[{ label: 'Maps', href: 'https://mixtmaps.com/' }, { label: 'Directions', href: 'https://mixtmaps.com/directions' }]}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          className="entry"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search places, e.g. Cinnamon Park"
          style={{ width: 340 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && found[0]) {
              setFocus({ x: found[0].x, y: found[0].y })
              setSelected(found[0])
            }
          }}
        />
        <Btn
          onClick={() => {
            if (found[0]) {
              setFocus({ x: found[0].x, y: found[0].y })
              setSelected(found[0])
            }
          }}
        >
          Search
        </Btn>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14 }}>
        <MapCanvas focus={focus} />
        <div>
          {selected && (
            <Card style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 600 }}>{selected.name}</div>
              <Meta>{selected.kind}</Meta>
              <p style={{ margin: '6px 0 0', color: '#39413b' }}>{selected.info}</p>
            </Card>
          )}
          {found.length > 1 && (
            <Card style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Results</div>
              {found.slice(0, 6).map((p) => (
                <div key={p.name} style={{ padding: '4px 0', cursor: 'pointer' }} onClick={() => { setFocus({ x: p.x, y: p.y }); setSelected(p) }}>
                  <A ctx={ctx} href={`https://mixtmaps.com/place/${encodeURIComponent(p.name)}`} style={{ textDecoration: 'none' }}>
                    {p.name}
                  </A>{' '}
                  <span style={{ color: '#8a938d', fontSize: 11.5 }}>{p.kind}</span>
                </div>
              ))}
            </Card>
          )}
          <Card>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Directions</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <select className="entry" style={{ flex: 1 }} id="from">
                {PLACES.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select className="entry" style={{ flex: 1 }} id="to">
                {PLACES.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <Btn
              tone="grey"
              onClick={() => {
                const from = (document.getElementById('from') as HTMLSelectElement)?.value
                const to = (document.getElementById('to') as HTMLSelectElement)?.value
                setRoute({ from, to })
              }}
            >
              Get directions
            </Btn>
            {route && (
              <ol style={{ marginTop: 10, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: '#39413b' }}>
                {steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </SiteShell>
  )
}

/* ==========================================================================
   site definitions
   ========================================================================== */

export const MIXTCART: SiteDef = {
  domain: 'mixtcart.com',
  aliases: ['amazon.com', 'shop.mixt.com'],
  title: 'MixtCart',
  glyph: 'ShoppingBag',
  color: '#2f9e8f',
  color2: '#14705f',
  description: 'An online shop for mixty merchandise, keyboards and digital downloads that really download.',
  tags: ['shop', 'store', 'products', 'cart', 'buy'],
  defaultPath: '/',
  pages: [
    { path: '/', title: 'MixtCart — shop', keywords: ['shop', 'store', 'products', 'buy', 'price'], snippet: 'Browse keyboards, mugs, plush penguins and free digital downloads.', render: (ctx) => <ShopHome ctx={ctx} /> },
    {
      path: '/product',
      title: 'MixtCart — product',
      keywords: ['product', 'item', 'price', 'keyboard', 'mug', 'wallpaper'],
      snippet: 'Product details with quantity and add to cart.',
      render: (ctx) => <ProductPage ctx={ctx} id={ctx.path.split('/')[2] ?? ''} />,
    },
    {
      path: '/cart',
      title: 'MixtCart — cart & checkout',
      keywords: ['cart', 'checkout', 'order', 'bag'],
      snippet: 'Review your cart and place an order — the receipt lands in your Documents folder.',
      render: (ctx) => <CartPage ctx={ctx} />,
    },
    {
      path: '/category',
      title: 'MixtCart — category',
      keywords: ['category', 'digital', 'hardware'],
      snippet: 'Products in one category.',
      render: (ctx) => <ShopHome ctx={ctx} />,
    },
    {
      path: '/download',
      title: 'MixtCart — download',
      keywords: ['download', 'file'],
      snippet: 'Download a digital purchase to ~/Downloads.',
      render: (ctx) => (
        <SiteShell site={MIXTCART} ctx={ctx} nav={[{ label: 'Shop', href: 'https://mixtcart.com/' }]}>
          <H level={1}>Download ready</H>
          <p>The file browser should have started the download. If not, open the Files application and look in ~/Downloads.</p>
        </SiteShell>
      ),
    },
  ],
  deepEntries: PRODUCTS.map((p) => ({
    url: `https://mixtcart.com/product/${p.id}`,
    title: p.name,
    snippet: p.blurb,
    keywords: [p.category, 'shop', 'buy', money(p.price)],
  })),
  text: () => ['MixtCart — products', '===================', ...PRODUCTS.map((p) => `${p.name.padEnd(36)} ${money(p.price)}  https://mixtcart.com/product/${p.id}`)].join('\n'),
}

export const MIXTMAIL: SiteDef = {
  domain: 'mixtmail.com',
  aliases: ['mail.mixt.com', 'gmail.com'],
  title: 'MixtMail',
  glyph: 'Mail',
  color: '#3f6fd8',
  color2: '#25428f',
  description: 'Webmail with a working folder pane, message reader and a compose window that really sends.',
  tags: ['mail', 'email', 'inbox', 'compose'],
  defaultPath: '/',
  pages: [
    { path: '/', title: 'MixtMail — inbox', keywords: ['email', 'inbox', 'messages', 'compose', 'send'], snippet: 'Read your inbox, compose and send messages.', render: (ctx) => <MailApp ctx={ctx} /> },
    { path: '/compose', title: 'MixtMail — compose', keywords: ['compose', 'new message', 'write'], snippet: 'Write a new message.', render: (ctx) => <MailApp ctx={ctx} /> },
  ],
  text: () => ['MixtMail — inbox', '================', '1. 3 optional applications are available        — updates@mixtnet.com', '2. Your window snapped correctly                 — hello@cinnamon.dev', '3. Your digital downloads are ready              — orders@mixtcart.com', '', 'Open https://mixtmail.com/ in the browser to read them.'].join('\n'),
}

export const MIXTMAPS: SiteDef = {
  domain: 'mixtmaps.com',
  aliases: ['maps.google.com', 'openstreetmap.org'],
  title: 'MixtMaps',
  glyph: 'Map',
  color: '#4a8f3f',
  color2: '#2c5f24',
  description: 'A procedurally drawn map of Mixtville with panning, zooming, place search and directions.',
  tags: ['maps', 'directions', 'places', 'navigation'],
  defaultPath: '/',
  pages: [
    { path: '/', title: 'MixtMaps — map of Mixtville', keywords: ['map', 'directions', 'places', 'search places', 'route'], snippet: 'Pan and zoom a procedurally drawn map, search places and get directions.', render: (ctx) => <MapsHome ctx={ctx} /> },
    { path: '/directions', title: 'MixtMaps — directions', keywords: ['directions', 'route', 'navigate'], snippet: 'Turn-by-turn directions that are accurate to within a metre of fiction.', render: (ctx) => <MapsHome ctx={ctx} /> },
    {
      path: '/place',
      title: 'MixtMaps — place',
      keywords: ['place', 'cinnamon park', 'kernel street'],
      snippet: 'Information about a place in Mixtville.',
      render: (ctx) => {
        const name = decodeURIComponent(ctx.path.split('/')[2] ?? '')
        const place = PLACES.find((p) => p.name === name)
        if (!place) return <NotFound ctx={ctx} site={MIXTMAPS} />
        return (
          <SiteShell site={MIXTMAPS} ctx={ctx} nav={[{ label: 'Map', href: 'https://mixtmaps.com/' }]}>
            <H level={1}>{place.name}</H>
            <Meta>{place.kind}</Meta>
            <p style={{ lineHeight: 1.7 }}>{place.info}</p>
            <MapCanvas focus={{ x: place.x, y: place.y }} />
          </SiteShell>
        )
      },
    },
  ],
  deepEntries: PLACES.map((p) => ({
    url: `https://mixtmaps.com/place/${encodeURIComponent(p.name)}`,
    title: p.name,
    snippet: p.info,
    keywords: [p.kind, 'map', 'directions', 'place'],
  })),
  text: () => ['MixtMaps', '========', 'Places:', ...PLACES.map((p) => `  ${p.name} (${p.kind}) — ${p.info}`), '', 'Open in the browser to pan the map.'].join('\n'),
}

export const SERVICE_SITES = [MIXTCART, MIXTMAIL, MIXTMAPS]
