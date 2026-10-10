import React from 'react'
import { A, Btn, Card, H, Img, Meta, NotFound, Pill, SiteShell } from '../sitekit'
import type { PageCtx, SiteDef } from '../types'

/* ==========================================================================
   mixtbook.com — social network
   ========================================================================== */

interface Post {
  id: string
  author: string
  handle: string
  time: string
  text: string
  likes: number
  comments: { who: string; text: string }[]
  image?: string
}

const SEED_POSTS: Post[] = [
  {
    id: 'p1',
    author: 'Mixty Fresh',
    handle: '@mixtyfresh',
    time: '2 min',
    text: 'Just switched my whole desktop to the web edition. The terminal has neofetch. My life is complete. 🪴',
    likes: 42,
    comments: [{ who: '@tux_fan_92', text: 'Post the neofetch screenshot or it did not happen.' }],
  },
  {
    id: 'p2',
    author: 'Petra Lindgren',
    handle: '@petra',
    time: '18 min',
    text: 'Window snapping works on all four edges. I have not touched a mouse drag handle in an hour.',
    likes: 17,
    comments: [],
  },
  {
    id: 'p3',
    author: 'Owen Mbeki',
    handle: '@owen',
    time: '1 h',
    text: 'Unpopular opinion: localStorage is a perfectly good filesystem if you apologise to it regularly.',
    likes: 88,
    comments: [
      { who: '@mira_c', text: 'It is five megabytes. That is not a filesystem, that is a shopping list.' },
      { who: '@owen', text: 'A shopping list with folders.' },
    ],
  },
  {
    id: 'p4',
    author: 'Mira Castellan',
    handle: '@mira_c',
    time: '3 h',
    text: 'Wrote a tile puzzle inside a browser tab that is itself running inside a browser tab. Recursion has never been so relaxing.',
    likes: 64,
    comments: [{ who: '@dana', text: 'Put a browser in the browser in the browser. Do it.' }],
  },
]

function MixtbookHome({ ctx }: { ctx: PageCtx }) {
  const [posts, setPosts] = React.useState<Post[]>(SEED_POSTS)
  const [draft, setDraft] = React.useState('')
  const [liked, setLiked] = React.useState<string[]>([])

  const publish = () => {
    if (!draft.trim()) return
    setPosts((p) => [
      { id: `p${Date.now()}`, author: 'Mixt User', handle: '@mixt', time: 'now', text: draft.trim(), likes: 0, comments: [] },
      ...p,
    ])
    setDraft('')
  }

  return (
    <SiteShell
      site={MIXTBOOK}
      ctx={ctx}
      nav={[
        { label: 'Feed', href: 'https://mixtbook.com/' },
        { label: 'Profile', href: 'https://mixtbook.com/profile/mixt' },
        { label: 'Groups', href: 'https://mixtbook.com/groups' },
      ]}
      maxWidth={720}
    >
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ width: 42, height: 42, borderRadius: 999, background: 'linear-gradient(135deg,#9ede6a,#4c8f1f)', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700 }}>
            M
          </div>
          <div style={{ flex: 1 }}>
            <textarea
              className="entry"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="What are you doing with your computer?"
              style={{ width: '100%', height: 62, resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
              <Btn onClick={publish}>Post</Btn>
              <Meta>{draft.length}/280</Meta>
            </div>
          </div>
        </div>
      </Card>

      {posts.map((post) => (
        <Card key={post.id} style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <div
              style={{
                width: 40, height: 40, borderRadius: 999, flex: 'none',
                background: `linear-gradient(135deg, hsl(${(post.author.charCodeAt(0) * 7) % 360} 60% 62%), hsl(${(post.author.charCodeAt(1) * 11) % 360} 55% 38%))`,
              }}
            />
            <div style={{ flex: 1 }}>
              <div>
                <strong>{post.author}</strong>{' '}
                <span style={{ color: '#77807a', fontSize: 12 }}>
                  {post.handle} · {post.time}
                </span>
              </div>
              <div style={{ margin: '6px 0 8px', fontSize: 14.5, lineHeight: 1.5 }}>{post.text}</div>
              <div style={{ display: 'flex', gap: 14, fontSize: 12.5, color: '#5c665f' }}>
                <span
                  style={{ cursor: 'pointer', color: liked.includes(post.id) ? '#4c8f1f' : undefined }}
                  onClick={() => setLiked((l) => (l.includes(post.id) ? l.filter((x) => x !== post.id) : [...l, post.id]))}
                >
                  ♥ {post.likes + (liked.includes(post.id) ? 1 : 0)}
                </span>
                <span>💬 {post.comments.length}</span>
                <span>↗ Share</span>
              </div>
              {post.comments.map((c, i) => (
                <div key={i} style={{ marginTop: 8, paddingLeft: 10, borderLeft: '2px solid #e6e9e4', fontSize: 13 }}>
                  <strong style={{ color: '#3b6f18' }}>{c.who}</strong> <span style={{ color: '#39413b' }}>{c.text}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      ))}
    </SiteShell>
  )
}

function MixtbookProfile({ ctx, handle }: { ctx: PageCtx; handle: string }) {
  const posts = SEED_POSTS.filter((p) => p.handle === `@${handle}`)
  return (
    <SiteShell site={MIXTBOOK} ctx={ctx} nav={[{ label: 'Feed', href: 'https://mixtbook.com/' }]} maxWidth={720}>
      <Card>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <div style={{ width: 66, height: 66, borderRadius: 999, background: 'linear-gradient(135deg,#7cc93f,#2f6b12)', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 26, fontWeight: 700 }}>
            {handle[0]?.toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>@{handle}</div>
            <Meta>{posts.length} posts · 214 friends · likes green things</Meta>
          </div>
        </div>
      </Card>
      {posts.length === 0 ? (
        <p style={{ marginTop: 14 }}>Nothing here yet. This user mostly lurks.</p>
      ) : (
        posts.map((p) => (
          <Card key={p.id} style={{ marginTop: 12 }}>
            <div style={{ fontSize: 14.5 }}>{p.text}</div>
            <Meta>{p.time} ago</Meta>
          </Card>
        ))
      )}
    </SiteShell>
  )
}

/* ==========================================================================
   mixtube.com — video
   ========================================================================== */

interface Video {
  id: string
  title: string
  channel: string
  views: string
  age: string
  length: string
  description: string
  comments: { who: string; text: string }[]
}

const VIDEOS: Video[] = [
  {
    id: 'v1',
    title: 'Installing Mixt Web OS (and why nothing needed installing)',
    channel: 'Mixt Tips',
    views: '182K views',
    age: '3 days ago',
    length: '12:04',
    description: 'A walkthrough of the boot process, from the splash to the panel applets. No terminal knowledge required, though we use it anyway.',
    comments: [
      { who: 'gwen_tech', text: 'The part where the filesystem survives a reboot blew my mind.' },
      { who: 'old_school_linux', text: 'Finally a distro review that shows the package manager.' },
    ],
  },
  {
    id: 'v2',
    title: 'Snapping windows with a pointer capture in React',
    channel: 'Frontend Kitchen',
    views: '64K views',
    age: '1 week ago',
    length: '18:22',
    description: 'Pointer capture, transform-based dragging and the snap-preview rectangle explained with a live window manager.',
    comments: [{ who: 'react_fiend', text: 'I have been doing drag with mousemove listeners since 2014. This is so much cleaner.' }],
  },
  {
    id: 'v3',
    title: 'I wrote a shell in TypeScript and it has pipes',
    channel: 'Terminal Velocity',
    views: '301K views',
    age: '2 weeks ago',
    length: '24:51',
    description: 'Implementing tokenisation, pipelines and redirection in about 500 lines. Includes the famous cowsay command.',
    comments: [
      { who: 'bash_believer', text: 'The exit status of `false` being an exception is a choice.' },
      { who: 'ts_stan', text: 'Strict mode would have caught that.' },
    ],
  },
  {
    id: 'v4',
    title: 'Procedural wallpapers: drawing mixt leaves with canvas',
    channel: 'Pixel Garden',
    views: '27K views',
    age: '3 weeks ago',
    length: '09:37',
    description: 'Gradients, bezier curves and a bit of trigonometry, ending with three wallpapers.',
    comments: [],
  },
  {
    id: 'v5',
    title: 'Review: the tile puzzle inside the operating system inside the browser',
    channel: 'Arcade Corner',
    views: '96K views',
    age: '1 month ago',
    length: '06:12',
    description: 'It is 2048. It has arrow-key support. It remembers your best score. Ten out of ten.',
    comments: [{ who: 'tile_master', text: 'Reached 4096 on my third try. Please clap.' }],
  },
]

function TubeHome({ ctx }: { ctx: PageCtx }) {
  const [q, setQ] = React.useState('')
  const results = q.trim() ? VIDEOS.filter((v) => (v.title + v.channel + v.description).toLowerCase().includes(q.toLowerCase())) : VIDEOS
  return (
    <SiteShell
      site={MIXTUBE}
      ctx={ctx}
      nav={[{ label: 'Home', href: 'https://mixtube.com/' }, { label: 'Trending', href: 'https://mixtube.com/trending' }]}
      plain
      maxWidth={1100}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input className="entry" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search videos…" style={{ width: 360 }} />
        <Btn tone="grey">Search</Btn>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 16 }}>
        {results.map((v) => (
          <div key={v.id} style={{ cursor: 'pointer' }} onClick={() => ctx.navigate(`https://mixtube.com/watch/${v.id}`)}>
            <div style={{ position: 'relative' }}>
              <Img alt={v.channel} height={140} />
              <span style={{ position: 'absolute', right: 6, bottom: 6, background: 'rgba(0,0,0,0.78)', color: '#fff', fontSize: 11.5, padding: '1px 5px', borderRadius: 4 }}>
                {v.length}
              </span>
            </div>
            <div style={{ marginTop: 8, fontWeight: 500, fontSize: 14, lineHeight: 1.35 }}>{v.title}</div>
            <Meta>
              {v.channel} · {v.views} · {v.age}
            </Meta>
          </div>
        ))}
        {results.length === 0 && <p>No videos found. Mixtube is small, but it is honest.</p>}
      </div>
    </SiteShell>
  )
}

function TubeWatch({ ctx, id }: { ctx: PageCtx; id: string }) {
  const video = VIDEOS.find((v) => v.id === id)
  const [playing, setPlaying] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [likes, setLikes] = React.useState(1204)

  React.useEffect(() => {
    if (!playing) return
    const t = setInterval(() => setProgress((p) => Math.min(100, p + 1.4)), 120)
    return () => clearInterval(t)
  }, [playing])

  if (!video) return <NotFound ctx={ctx} site={MIXTUBE} />

  return (
    <SiteShell site={MIXTUBE} ctx={ctx} nav={[{ label: 'Home', href: 'https://mixtube.com/' }]} maxWidth={1000} plain>
      <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 18 }}>
        <div>
          <div style={{ position: 'relative', height: 340, borderRadius: 10, overflow: 'hidden', background: '#0e1113', display: 'grid', placeItems: 'center' }}>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: playing
                  ? `radial-gradient(circle at ${20 + progress}% 50%, rgba(158,222,106,0.35), transparent 55%)`
                  : 'radial-gradient(circle at 30% 40%, rgba(126,201,63,0.22), transparent 60%)',
              }}
            />
            <div style={{ zIndex: 1, textAlign: 'center', color: '#eef2ef' }}>
              {playing ? (
                <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 60 }}>
                  {Array.from({ length: 16 }).map((_, i) => (
                    <div
                      key={i}
                      style={{
                        width: 7,
                        height: `${18 + Math.abs(Math.sin((progress + i) / 3)) * 40}px`,
                        background: 'linear-gradient(to top,#4c8f1f,#9ede6a)',
                        borderRadius: 2,
                        transition: 'height .12s linear',
                      }}
                    />
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 15, opacity: 0.85 }}>{video.title}</div>
              )}
            </div>
            <button
              onClick={() => setPlaying((p) => !p)}
              style={{ position: 'absolute', zIndex: 2, width: 62, height: 62, borderRadius: 999, border: 'none', background: 'rgba(158,222,106,0.92)', cursor: 'pointer', fontSize: 22, color: '#1c2a10' }}
            >
              {playing ? '❚❚' : '▶'}
            </button>
          </div>
          <div style={{ height: 5, background: '#e6e9e4', borderRadius: 999, marginTop: 8, overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: '#61ad2b' }} />
          </div>
          <H level={2} style={{ marginTop: 14 }}>
            {video.title}
          </H>
          <Meta>
            {video.views} · {video.age}
          </Meta>
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <Btn tone="grey" onClick={() => setLikes((l) => l + 1)}>
              👍 {likes}
            </Btn>
            <Btn tone="grey">↗ Share</Btn>
          </div>
          <Card style={{ marginTop: 14, background: '#f8faf6' }}>
            <strong>{video.channel}</strong>
            <p style={{ margin: '6px 0 0', color: '#39413b', lineHeight: 1.6 }}>{video.description}</p>
          </Card>
        </div>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Up next</div>
          {VIDEOS.filter((v) => v.id !== id).map((v) => (
            <div key={v.id} style={{ display: 'flex', gap: 8, marginBottom: 12, cursor: 'pointer' }} onClick={() => ctx.navigate(`https://mixtube.com/watch/${v.id}`)}>
              <Img alt={v.channel} height={62} style={{ width: 110, flex: 'none' }} />
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.3 }}>{v.title}</div>
                <Meta>
                  {v.channel} · {v.views}
                </Meta>
              </div>
            </div>
          ))}
          <div style={{ fontWeight: 600, margin: '16px 0 8px' }}>{video.comments.length} comments</div>
          {video.comments.map((c, i) => (
            <div key={i} style={{ fontSize: 13, marginBottom: 8 }}>
              <strong style={{ color: '#3b6f18' }}>{c.who}</strong>
              <div style={{ color: '#39413b' }}>{c.text}</div>
            </div>
          ))}
        </div>
      </div>
    </SiteShell>
  )
}

/* ==========================================================================
   mixtgames.com — arcade
   ========================================================================== */

function ReactionGame() {
  const [state, setState] = React.useState<'idle' | 'waiting' | 'ready' | 'done'>('idle')
  const [started, setStarted] = React.useState(0)
  const [ms, setMs] = React.useState(0)
  const [best, setBest] = React.useState<number | null>(null)

  const begin = () => {
    setState('waiting')
    const delay = 900 + Math.random() * 2400
    setTimeout(() => {
      setStarted(Date.now())
      setState('ready')
    }, delay)
  }

  const click = () => {
    if (state === 'idle' || state === 'done') return begin()
    if (state === 'waiting') {
      setState('done')
      setMs(-1)
      return
    }
    const value = Date.now() - started
    setMs(value)
    setBest((b) => (b === null || value < b ? value : b))
    setState('done')
  }

  return (
    <Card>
      <H level={3}>Reflex tester</H>
      <div
        onClick={click}
        style={{
          height: 120,
          borderRadius: 8,
          display: 'grid',
          placeItems: 'center',
          cursor: 'pointer',
          userSelect: 'none',
          color: '#fff',
          fontWeight: 600,
          background:
            state === 'waiting' ? '#b8532f' : state === 'ready' ? '#4c8f1f' : state === 'done' ? '#3b4c5a' : '#66706a',
        }}
      >
        {state === 'idle' && 'Click to start'}
        {state === 'waiting' && 'Wait for green…'}
        {state === 'ready' && 'CLICK!'}
        {state === 'done' && (ms < 0 ? 'Too early! Click to retry.' : `${ms} ms — click to play again`)}
      </div>
      <Meta>{best !== null ? `Best: ${best} ms` : 'Average humans manage about 250 ms.'}</Meta>
    </Card>
  )
}

function GuessGame() {
  const [target, setTarget] = React.useState(() => 1 + Math.floor(Math.random() * 100))
  const [guess, setGuess] = React.useState('')
  const [log, setLog] = React.useState<string[]>(['I picked a number between 1 and 100.'])

  const submit = () => {
    const n = Number(guess)
    if (!n) return
    if (n === target) {
      setLog((l) => [...l, `${n} — correct! I have picked a new number.`])
      setTarget(1 + Math.floor(Math.random() * 100))
    } else if (n < target) setLog((l) => [...l, `${n} — higher.`])
    else setLog((l) => [...l, `${n} — lower.`])
    setGuess('')
  }

  return (
    <Card>
      <H level={3}>Guess the number</H>
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="entry" value={guess} onChange={(e) => setGuess(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="1–100" style={{ width: 100 }} />
        <Btn tone="grey" onClick={submit}>
          Guess
        </Btn>
      </div>
      <div style={{ marginTop: 10, maxHeight: 140, overflow: 'auto', fontSize: 13, color: '#39413b' }}>
        {log.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </Card>
  )
}

function GamesHome({ ctx }: { ctx: PageCtx }) {
  return (
    <SiteShell
      site={MIXTGAMES}
      ctx={ctx}
      nav={[{ label: 'Arcade', href: 'https://mixtgames.com/' }, { label: 'Source', href: 'https://mixtgames.com/source' }]}
      maxWidth={900}
    >
      <H level={1}>The MixtNet arcade</H>
      <p style={{ color: '#5c665f' }}>
        Three games, no installs. The big tile puzzle also ships as a desktop application — look for <strong>2048</strong> in the Menu.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 16 }}>
        <ReactionGame />
        <GuessGame />
        
        <Card>
          <H level={3}>Pong, eventually</H>
          <p style={{ color: '#39413b' }}>
            The arcade is powered by the same drawing primitives as the maps and the reaction test. A paddle is just a rectangle that feels responsible.
          </p>
        </Card>
      </div>
    </SiteShell>
  )
}

/* ==========================================================================
   site definitions
   ========================================================================== */

export const MIXTBOOK: SiteDef = {
  domain: 'mixtbook.com',
  aliases: ['facebook.com', 'mixtbook.net'],
  title: 'MixtBook',
  glyph: 'Users',
  color: '#3a5fd0',
  color2: '#22347e',
  description: 'A social network where everybody is unusually polite about window managers.',
  tags: ['social', 'friends', 'posts', 'feed'],
  defaultPath: '/',
  pages: [
    { path: '/', title: 'MixtBook — news feed', keywords: ['social', 'feed', 'friends', 'posts'], snippet: 'Post a status and read what everybody else is doing with their desktop.', render: (ctx) => <MixtbookHome ctx={ctx} /> },
    {
      path: '/profile',
      title: 'MixtBook — profile',
      keywords: ['profile', 'user', 'posts'],
      snippet: 'A user profile with their posts.',
      render: (ctx) => <MixtbookProfile ctx={ctx} handle={ctx.path.split('/')[2] ?? 'mixt'} />,
    },
    {
      path: '/groups',
      title: 'MixtBook — groups',
      keywords: ['groups', 'communities'],
      snippet: 'Groups you might like.',
      render: (ctx) => (
        <SiteShell site={MIXTBOOK} ctx={ctx} nav={[{ label: 'Feed', href: 'https://mixtbook.com/' }]} maxWidth={720}>
          <H level={1}>Groups</H>
          {[
            ['Window Snapping Enthusiasts', '12,402 members', 'We snap. They stick.'],
            ['Terminal Screenshots', '48,110 members', 'Show us your prompt.'],
            ['Wallpaper Appreciation Society', '9,308 members', 'Gradients preferred.'],
            ['Pixel Art & 2048', '4,921 members', 'Tiles, sprites, ambition.'],
          ].map(([name, members, about]) => (
            <Card key={name} style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 600 }}>{name}</div>
              <Meta>{members}</Meta>
              <div style={{ marginTop: 4, color: '#39413b' }}>{about}</div>
            </Card>
          ))}
        </SiteShell>
      ),
    },
  ],
  text: () =>
    ['MixtBook — news feed', '====================', '', ...SEED_POSTS.map((p) => `${p.author} ${p.handle} (${p.time})\n  ${p.text}\n  ♥ ${p.likes} · ${p.comments.length} comments`)].join('\n'),
}

export const MIXTUBE: SiteDef = {
  domain: 'mixtube.com',
  aliases: ['youtube.com'],
  title: 'Mixtube',
  glyph: 'Video',
  color: '#c0392b',
  color2: '#7c1d12',
  description: 'Video for the MixtNet: tutorials, reviews and a suspicious number of terminal demos.',
  tags: ['video', 'watch', 'tutorials', 'music'],
  defaultPath: '/',
  pages: [
    { path: '/', title: 'Mixtube — home', keywords: ['video', 'watch', 'stream', 'tutorials'], snippet: 'Browse and search videos on the MixtNet video site.', render: (ctx) => <TubeHome ctx={ctx} /> },
    { path: '/trending', title: 'Mixtube — trending', keywords: ['trending', 'popular'], snippet: 'What the MixtNet is watching right now.', render: (ctx) => <TubeHome ctx={ctx} /> },
    {
      path: '/watch',
      title: 'Mixtube — watch',
      keywords: ['player', 'comments', 'watch video'],
      snippet: 'Watch a video with a real (fake) player, likes and comments.',
      render: (ctx) => <TubeWatch ctx={ctx} id={ctx.path.split('/')[2] ?? 'v1'} />,
    },
  ],
  deepEntries: VIDEOS.map((v) => ({
    url: `https://mixtube.com/watch/${v.id}`,
    title: v.title,
    snippet: v.description,
    keywords: [v.channel, 'video', 'watch', v.length],
  })),
  text: (path) => {
    const id = path.split('/')[2]
    const v = VIDEOS.find((x) => x.id === id)
    if (v) return [`${v.title}`, `${v.channel} · ${v.views} · ${v.age}`, '', v.description, '', 'Comments:', ...v.comments.map((c) => `  ${c.who}: ${c.text}`)].join('\n')
    return ['Mixtube — home', '================', ...VIDEOS.map((x) => `${x.title}\n  ${x.channel} · ${x.views} · https://mixtube.com/watch/${x.id}`)].join('\n')
  },
}

export const MIXTGAMES: SiteDef = {
  domain: 'mixtgames.com',
  title: 'MixtGames',
  glyph: 'Gamepad2',
  color: '#7c3aed',
  color2: '#4c1d95',
  description: 'Browser games that run entirely on the client: reflex tester, number guessing and a tile puzzle.',
  tags: ['games', 'play', 'arcade'],
  defaultPath: '/',
  pages: [
    { path: '/', title: 'MixtGames — arcade', keywords: ['games', 'play', 'arcade', 'reaction', 'guess'], snippet: 'Play the reflex tester and guess-the-number, or launch the 2048 application.', render: (ctx) => <GamesHome ctx={ctx} /> },
    {
      path: '/source',
      title: 'MixtGames — source',
      keywords: ['source code', 'javascript', 'download'],
      snippet: 'Download the little JavaScript file that powers the arcade games.',
      render: (ctx) => (
        <SiteShell site={MIXTGAMES} ctx={ctx} nav={[{ label: 'Arcade', href: 'https://mixtgames.com/' }]}>
          <H level={1}>Arcade source</H>
          <p>The mini game engine is 12 kB of uninspiring JavaScript. You can have it.</p>
          <a href="#download-arcade-games.js" style={{ cursor: 'pointer' }} onClick={() => ctx.navigate('https://mixtgames.com/download/arcade-games.js')}>
            Download arcade-games.js
          </a>
        </SiteShell>
      ),
    },
  ],
  text: () => 'MixtGames arcade — open it in the Web Browser to play.',
}

export const SOCIAL_SITES = [MIXTBOOK, MIXTUBE, MIXTGAMES]
