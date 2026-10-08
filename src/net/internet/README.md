# The Internet directory

This folder is the network. Every `*.server.tsx` file in `servers/` is a machine:
it claims hostnames, gets an address in the MixtNet block (`10.64.0.0/10`), and
serves whatever websites it declares.

Drop a file in, save, and the domain resolves — in the browser, in the terminal,
and in search. Nothing else needs registering anywhere.

```
src/net/internet/
  README.md                 ← you are here
  manifest.ts               ← auto-discovers the files below (Vite import.meta.glob)
  hosts.ts                  ← /etc/hosts and /etc/resolv.conf (real files in the VFS)
  types.ts                  ← ServerDef, the shape of a machine
  servers/
    nameservers.server.tsx  ← ns1 / ns2 (one file, two machines)
    portal.server.tsx       ← mixtnet.com + the whole zone
    pedia.server.tsx        ← mixtpedia.org + *.mixtpedia.org
    ...
    sandbox.server.tsx      ← a starter machine on a private zone
    pastemixt.server.tsx    ← a complete worked example (pastebin, in one file)
```

## Add a machine in 30 seconds

```bash
cp src/net/internet/servers/sandbox.server.tsx src/net/internet/servers/myapp.server.tsx
$EDITOR src/net/internet/servers/myapp.server.tsx     # change hosts + the page
```

Then open `https://myapp.mixtnet/` in the Web Browser, or run:

```console
mixt@mixt-web:~$ dig myapp.mixtnet
mixt@mixt-web:~$ nmap myapp.mixtnet
```

## The file format

A server file default-exports one machine — or an array of them, if you want a
cluster in one file (see `nameservers.server.tsx`).

```tsx
import { defineServer } from '../types'
import { SiteShell, H, Btn } from '../../sitekit'
import type { PageCtx, SiteDef } from '../../types'

const MY_SITE: SiteDef = {
  domain: 'myapp.mixtnet',           // the canonical hostname
  title: 'My App',
  glyph: 'Box',                      // any icon name from src/shell/AppIcon.tsx
  color: '#61ad2b',
  color2: '#2f6b12',
  description: 'What this site is, in one line.',
  tags: ['demo', 'internal'],        // extra search keywords
  defaultPath: '/',
  pages: [
    { path: '/', title: 'Home', render: (ctx: PageCtx) => (
      <SiteShell site={MY_SITE} ctx={ctx}>
        <H>Hello</H>
        <Btn onClick={() => ctx.navigate('https://mixtnet.com/')}>Go to the portal</Btn>
      </SiteShell>
    ) },
  ],
  // optional: the plain-text version `curl` and `wget` print
  text: () => 'Hello from myapp.mixtnet',
}

export default defineServer({
  id: 'myapp-01',                    // machine name (unique, shows in the registry)
  hosts: ['myapp.mixtnet'],          // A records — the names this machine answers for
  aliases: ['www.myapp.mixtnet'],    // CNAMEs → the canonical name
  wildcard: ['*.myapp.mixtnet'],     // answer for any subdomain
  ip: undefined,                     // optional: pin an address (otherwise hashed)
  operator: 'me',
  location: 'this computer',
  since: 'today',
  os: 'MixtNetOS 4.2 LTS',
  software: 'myappd 1.0',
  banner: 'myappd/1.0',              // shown by `nmap` / the registry
  ttl: 300,
  ports: [
    { port: 443, service: 'https', version: 'myappd 1.0' },
    { port: 22, service: 'ssh' },
  ],
  records: { MX: ['10 mx1.mixtmail.com.'], TXT: ['"v=spf1 -all"'] },
  sites: [MY_SITE],
  notes: 'Shown in the MixtNet Registry.',
})
```

### Every field

| field | meaning |
| --- | --- |
| `id` | machine name, unique across the directory. Required. |
| `hosts` | hostnames (A records). Required — at least one. |
| `aliases` | CNAMEs. An alias under a site's domain points at that site; otherwise at the machine's first host. |
| `wildcard` | zones this machine answers for, e.g. `*.mixtpedia.org`. Resolves as a CNAME to the first host. |
| `ip` / `ipv6` | pin an address (e.g. `10.0.0.53`). All hosts of a machine share it. |
| `ports` | what `nmap` and the registry report. |
| `records` | extra `MX`, `TXT`, `NS` records, printed by `dig -t MX` and friends. |
| `sites` | one or more `SiteDef`s — several hostnames on one machine is virtual hosting (`social.server.tsx`). Leave empty for infrastructure (mail relay, nameserver). |
| `ttl`, `operator`, `location`, `since`, `os`, `software`, `banner`, `notes` | flavour, and all of it shows up in the registry. |

## How resolution works

1. **`/etc/hosts`** wins over everything. It is a real file in the virtual
   filesystem — edit it in the Text Editor, with `sudo tee`, or from the
   browser's `about:dns` page. Great for pointing a name at a machine you are
   working on.
2. **The zone** — exact host match, then aliases (CNAME), then wildcards.
3. **Misses** become `NXDOMAIN`, which the browser renders as a proper
   "Server not found" page (with the `dig` output), and the shell reports as
   `Name or service not known`.
4. Names are also resolvable **backwards**: `dig -x 10.83.17.204`, or just open
   `https://10.83.17.204/` — the browser does a PTR lookup and loads the site.
5. Real-world domains that are not in the zone fall through to the honest
   "this sandbox cannot reach the real internet" page.

Nameservers for the zone are `10.0.0.53` / `10.0.0.54` (`/etc/resolv.conf`
points at them). The addresses of everything are listed in `about:dns`, and the
whole zone can be dumped in the Terminal with `dig anything -t ANY` or read from
`zoneRecords()` in code.

## Gotchas

* **Hostname conflicts**: if two machines claim the same host, the second file
  is skipped and listed under "Rejected server files" in `about:dns` (and warned
  about in the console). The app never crashes over a bad drop-in.
* The file must default-export a `ServerDef` (or an array of them) and live in
  `servers/` with a `.server.tsx` extension. Anything else is ignored.
* A site's `domain` is registered even if it is not in `hosts`, so you only have
  to type it once.
* Vite watches this folder: a new file reloads the page and the machine is live.
* There is no real network. Nothing here resolves outside this app.
