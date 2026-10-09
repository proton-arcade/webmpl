# Adding things to MixtNet, step by step

Two recipes, both ending with a live address:

* **[Part 1 — add a server](#part-1--add-a-server-machine)** (a machine with an IP, ports and DNS records)
* **[Part 2 — add a website](#part-2--add-a-website)** (pages, search entries, `curl` output)

Everything in this file has been run against the real code — the templates below are
exactly the shape `servers/*.server.tsx` files are expected to have.

---

## The 60-second model

| Thing | Where it lives | Who picks it up |
| --- | --- | --- |
| A machine | `src/net/internet/servers/<name>.server.tsx` | `manifest.ts`, automatically, at build/HMR time |
| A website | the `sites: [ … ]` array of a machine (or `src/net/sites/*.tsx` for big ones) | same |
| Hostnames | the machine's `hosts` (A records), `aliases` (CNAMEs), `wildcard` (zones) | `dns.ts` |
| Search results | every `SiteDef` and every `SitePage` is indexed; `deepEntries` adds more | `buildIndex()` in `src/net/index.tsx` |
| `curl` output | the site's `text()` function | `fetchAsText()` |

There is no other registry. Drop the file, save, and the domain resolves in the
browser, the terminal, search, `nmap` and the MixtNet registry (`about:dns`).

---

## Part 1 — add a server (machine)

### Step 1 — copy the starter

```bash
cd src/net/internet/servers
cp sandbox.server.tsx myapp.server.tsx
```

`sandbox.server.tsx` is a deliberately small, working machine — the best starting
point. `pastemixt.server.tsx` is the same idea for a complete app (a working
pastebin). Only files **in this folder** named **`*.server.tsx`** are read, so
your own scratch files elsewhere will not be picked up.

### Step 2 — say who the machine is

Open the copy and change the top of the file. The minimum is `id` and `hosts`:

```tsx
export default defineServer({
  id: 'myapp-01',                 // machine name — must be unique in the directory
  hosts: ['myapp.mixtnet'],       // A records: the names this machine answers for
  aliases: ['www.myapp.mixtnet'], // optional CNAMEs
  wildcard: ['*.myapp.mixtnet'],  // optional: answer for any subdomain (any depth)
  ip: undefined,                  // optional: pin an address, e.g. '10.64.0.200'
  ttl: 300,
  operator: 'me',
  location: 'this computer',
  since: 'today',
  os: 'MixtNetOS 4.2 LTS',
  software: 'myappd 1.0',
  banner: 'myappd/1.0',           // what `nmap` and the registry print
  ports: [
    { port: 443, service: 'https', version: 'myappd 1.0' },
    { port: 22, service: 'ssh' },
  ],
  records: {
    MX: ['10 mx1.mixtmail.com.'], // printed by `dig -t MX myapp.mixtnet`
    TXT: ['"v=spf1 -all"'],
  },
  sites: [MY_SITE],               // ← Part 2 fills this in (leave it out for infrastructure)
  notes: 'Shown in the MixtNet registry.',
})
```

Pick a domain on the **fake web**. `.mixtnet` and friends (`mixtnet`, `mixt`,
`test`, `local`, `lan`, `internal`, `lab`, `home`) are "inside" names: an unknown
one is a proper `NXDOMAIN`. You can also claim a real-looking name
(`mixtnews.com`, `pastemixt.com`) — it resolves normally as long as a machine
claims it. An **unclaimed** `.com`/`.org`/`.io` name is treated as the real
internet and opens the browser's honest "this sandbox cannot reach the real
internet" page.

### Step 3 — save

That is the whole registration step. Vite watches the folder: the page reloads
and the machine is on the network. If it does not, reload the browser tab.

### Step 4 — check it

In the **Web Browser** (Mixtsfox):

```
https://myapp.mixtnet/
about:dns                    ← the registry: your machine, its address and ports
```

In the **Terminal**:

```console
mixt@mixt-web:~$ dig myapp.mixtnet
mixt@mixt-web:~$ dig -t MX myapp.mixtnet
mixt@mixt-web:~$ nmap myapp.mixtnet
mixt@mixt-web:~$ curl https://myapp.mixtnet/
```

You can also browse by address: the registry prints the IP, and
`https://10.64.0.xxx/` does a reverse lookup and loads the site.

**Infrastructure machines** (nameservers, mail relays) are the same file with no
`sites` at all — see `nameservers.server.tsx`, which returns an **array** of two
machines from one file.

**No file to spare? Runtime registration.** `registerServers([...SERVERS, machine])`
(from `src/net`) publishes a machine from code. It *rebuilds the whole zone from
the list you hand it*, so always pass everything, and know the trade-off: a
runtime machine resolves in DNS, the browser and `curl`, but the search index is
built from the files on disk at load time, so it will not be searchable until it
exists as a file. Dropping a file is the supported path; this is the escape hatch.

---

## Part 2 — add a website

### Route A — the whole thing in one file (recommended for a small site)

Paste this complete file as `src/net/internet/servers/myapp.server.tsx`, save,
and open `https://myapp.mixtnet/`:

```tsx
import { defineServer } from '../types'
import { Btn, Card, H, Meta, Pill, SiteShell } from '../../sitekit'
import type { PageCtx, SiteDef } from '../../types'

const MY_SITE: SiteDef = {
  domain: 'myapp.mixtnet',          // canonical hostname
  aliases: ['www.myapp.mixtnet'],   // optional extra spellings of this site
  title: 'My App',
  glyph: 'Box',                     // any icon name from src/shell/AppIcon.tsx
  color: '#61ad2b',
  color2: '#2f6b12',
  description: 'One line about this site — used by the portal and by search.',
  tags: ['demo', 'internal'],       // extra words the site answers to in search
  defaultPath: '/',
  pages: [
    {
      path: '/',
      title: 'My App — home',
      keywords: ['home', 'start'],  // what people should type to find this page
      snippet: 'The landing page of my app.',
      render: (ctx: PageCtx) => (
        <SiteShell site={MY_SITE} ctx={ctx} nav={[{ label: 'About', href: 'https://myapp.mixtnet/about' }]}>
          <H>Hello from MixtNet</H>
          <Card>
            <Pill>new site</Pill>
            <p>This page is a React component in a file under servers/.</p>
            <Btn onClick={() => ctx.navigate('https://mixtnet.com/')}>Go to the portal</Btn>
          </Card>
          <Meta>Served by myapp-01 at 10.64.x.x</Meta>
        </SiteShell>
      ),
    },
    {
      path: '/about',
      title: 'My App — about',
      keywords: ['about', 'contact'],
      snippet: 'Who runs this machine and why.',
      render: (ctx: PageCtx) => (
        <SiteShell site={MY_SITE} ctx={ctx}>
          <H level={2}>About</H>
          <p>path: {ctx.path} · query: {ctx.query || '(none)'}</p>
        </SiteShell>
      ),
    },
  ],
  // text() is what `curl` and `wget` print in the Terminal.
  text: (path) => ['MY APP', '======', '', `Hello from myapp.mixtnet${path}`].join('\n'),
  // deepEntries add search results that point at pages built from data.
  deepEntries: [
    {
      url: 'https://myapp.mixtnet/about',
      title: 'About My App',
      snippet: 'Who runs this machine.',
      keywords: ['about', 'credits'],
    },
  ],
}

export default defineServer({
  id: 'myapp-01',
  hosts: ['myapp.mixtnet'],
  aliases: ['www.myapp.mixtnet'],
  ports: [{ port: 443, service: 'https', version: 'myappd 1.0' }],
  sites: [MY_SITE],
})
```

**How routing works.** `matchPage()` tries, in order: an exact path match, then a
prefix match (`/article/x` matches a page declared as `/article`), then the `/`
page. Anything else gets the built-in **404 page** automatically. Data-driven
pages read the rest of the path from `ctx.path` and the query string from
`ctx.query` — `portal.tsx` renders every MixtPedia article and every MixtNews
story that way.

**Inside `render()`** you get `ctx`:

| on `ctx` | use it for |
| --- | --- |
| `ctx.navigate(url)` | normal links (also accepts `mixtnet://search?q=…`) |
| `ctx.openTab(url)` | open in a new browser tab |
| `ctx.path` / `ctx.query` / `ctx.url` | the address being rendered |
| `ctx.tabId` | per-tab state, if you need it |

and the toolkit from `src/net/sitekit.tsx`: `SiteShell`, `H`, `Btn`, `A`, `Card`,
`Img`, `Pill`, `Meta`, `Progress`, `NotFound`. `SiteShell` supplies the site's
header, colors, nav bar and footer — wrap every page in it and the site looks
native without any CSS work.

### Route B — put a second domain on an existing machine

One machine can host several sites (virtual hosting). `social.server.tsx` serves
`mixtbook.com` **and** `mixtube.com` from `social-web-01`:

```tsx
export default defineServer({
  id: 'social-web-01',
  hosts: ['mixtbook.com', 'mixtube.com'],
  sites: [MIXTBOOK, MIXTUBE],   // DNS picks the site whose `domain` matches the host
})
```

Rule: the hostname must be unique across all files (no two machines may claim the
same name), but a site's `domain` is registered even if it is not repeated in
`hosts` — so type each name once, in the right place. Aliases under a site's
domain point at that site; other aliases point at the machine's first host.

### Route C — add a page (or more search content) to a site that exists

1. Add a `SitePage` to the site's `pages` array in `src/net/sites/*.tsx` (or in
   the server file, for small sites). `keywords` and `snippet` are the fields
   search actually reads — a page without them is only findable by title.
2. Rendering from a list of things (articles, products, videos)? Add one
   `deepEntries` item per thing so each gets its own search result, and read the
   id from `ctx.path` inside the shared `render`.

### Route D — a big site in its own module

The five existing big sites keep their components in `src/net/sites/`:

```
src/net/sites/portal.tsx     → MIXTNET, MIXTPEDIA, MIXTNEWS
src/net/sites/social.tsx     → MIXTBOOK, MIXTUBE, MIXTGAMES
src/net/sites/services.tsx   → MIXTCART, MIXTMAIL, MIXTMAPS
src/net/sites/tech.tsx       → MIXTOS, MIXTDEV, MIXT
```

Do the same for a large site: export a `SiteDef` (or several) from a new file,
then import it into a server file and list it in `sites`. The server file stays
tiny and the pages get their own module.

---

## Part 3 — what you get for free

| Free thing | Where it shows up |
| --- | --- |
| DNS records, TTL, latency, PTR | `dig`, `host`, `nslookup`, `about:dns` |
| Reverse DNS and browsing by IP | `dig -x 10.64.0.x`, `https://10.64.0.x/` |
| Ports and banner | `nmap <host>`, the registry |
| Search indexing | Mixtsfox search, the portal search box, `openTab('mixtnet://search?q=…')` |
| Plain-text rendering | `curl`, `wget`, `http <url>` in the Terminal |
| Aliases, www, wildcards, virtual hosting | the resolver |
| Overriding a name locally | `/etc/hosts` beats the zone; add a line and DNS follows |
| 404 page, error pages, loading states | the browser, automatically |

---

## Part 4 — verify (30 seconds)

```console
$ npx tsc --noEmit          # the file type-checks
$ npm run smoke             # 97 checks, including "every server file loads"
```

Then, in the running desktop: the address loads in Mixtsfox, the name answers in
`dig`, `nmap` shows your ports, and `about:dns` lists the machine. The smoke suite
fails loudly if any dropped-in file is rejected, so it is a complete check of the
contract.

---

## Part 5 — troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Nothing happens after saving | file is not in `servers/`, or not named `*.server.tsx` | move/rename it — only that pattern is discovered |
| `about:dns` shows **Rejected server files** | `no default export`, `missing "id"`, `no hostnames in "hosts"`, or `hostname X is already served by Y` | fix the named problem; conflicts mean another machine already claims that name |
| `dig` says `NXDOMAIN` | the name is not claimed (typo, wrong zone, or missing `wildcard`) | check the spelling in `hosts`; wildcard zones answer for any subdomain depth |
| `dig` works, browser says *Server not found* | the machine has no `sites`, or you opened a host that is not the site's `domain`/alias | add `sites: [MY_SITE]`, or give the site an `aliases` entry |
| Browser opens a "real internet" page instead | the name is unclaimed **and** ends in a public TLD (`.com`, `.org`, `.io`…) | claim the name on a machine, or move it under `.mixtnet` |
| Search does not find my page | no `keywords`/`snippet`, or the item is in a list rather than a page | add both; for list items add a `deepEntries` entry |
| `curl` prints the "no plain-text version" note | no `text()` on the site | add `text: (path, query) => '…'` |
| A name resolves, a page loads, but the layout is bare | the page is not wrapped in `SiteShell` | wrap it — that is what applies the site frame |

---

## Files worth copying from

| File | Why look at it |
| --- | --- |
| `servers/sandbox.server.tsx` | smallest complete machine — the usual starting point |
| `servers/pastemixt.server.tsx` | a full app: routes, state, links between pages, `text()` |
| `servers/nameservers.server.tsx` | one file publishing several machines, no website |
| `servers/social.server.tsx` | virtual hosting: two domains, one machine |
| `sites/portal.tsx` | data-driven pages (articles, stories) and `deepEntries` |
| `../README.md` | the field-by-field reference for `ServerDef` and the resolver rules |
