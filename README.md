# Mixt Web OS

A complete desktop computer that runs in your browser — window manager, panel, main menu,
workspaces, a real filesystem, a real terminal, an installable software store, and a
**Mixtsfox** browser that renders a whole fictional internet ("MixtNet"), all
styled after a classic panel-and-menu desktop.

It is also a real machine on your network. The desktop you see is a browser talking to one
small Node server — `server/` — which owns the accounts, the files, the mail, the terminal
and the hosted sites. Your files are files on that machine's disk, shared with everyone who
signs in to it, and they are still there when you come back on another computer.

What it never does is reach the Internet. There is no outbound socket anywhere in the server,
the mail is delivered between accounts on the machine itself, and the network the browser
browses is the fictional one built into the app. The air gap is a setting the administrator
can look at (`/api/system/airgap`) and the machine reports it on boot.

### Things to try

* **Accounts.** Sign in as `Mixt_MPL` and add people in Settings → Accounts; each one gets a
  home of their own on the machine and a mailbox at `<name>@proper.com`. The session menu in
  the panel locks the screen or signs out, and a guest can sit down without an account at all.
* **The terminal.** It is a real shell over real files, but it is jailed to the account using
  it: `ls`, `grep`, pipes and redirection all work against your own tree, `sudo` is refused
  unless you are allowed it, and only the administrator can look outside their home.
* **The Software Manager.** A real storefront: featured banner, editor's picks with
  screenshots, a detail page per app, ratings you can leave, and install/uninstall.
* **A shelf look.** Settings → Appearance → Desktop style turns the panel into a shelf and
  the menu into a launcher, modelled on the real thing.
* **Tiling.** Drag a window to an edge or corner to snap it — top maximises, the sides and the
  bottom give halves, and the four corners give quarters. Super+arrows does the same.


### Run the machine

```bash
npm install
npm start                          # http://<this computer>:8080
```

That is the whole setup: one process, no database, nothing else to install — it keeps its
state in `data/` beside the sources. It prints every address it is listening on when it
boots, so the other computers on the network can open it too.

Sign in as the administrator, **`Mixt_MPL`**, with the password in `ROOTPASS.md`
(`mixt-root` until you change it). Guests are let in without an account; nothing they do is
kept. Only an administrator may add a standard account, in Settings → Accounts, and that is
also where a mailbox is switched on for one.

| to reach it from | |
| --- | --- |
| this computer | <http://localhost:8080> |
| another computer on the network | `http://<this computer's address>:8080` — printed on boot |
| a different port | `MIXT_PORT=9000 npm start` |
| a different place for its state | `MIXT_DATA=/srv/mixt npm start` |

### The site is still a plain static site

The server serves the repository root as it found it — no build step at request time, no
rewrites. The same folder works as a bare static site:

```
index.html        the page
mixt.bundle.js    the app (a classic script — no modules, no build step to visit)
mixt.bundle.css   the theme
wallpapers/  logo.svg
```

Everything is relative, so it still loads from a subdirectory (`http://host/mixt/`). What no
longer works is opening `index.html` straight from disk with `file://`: with no machine to
talk to there is no account, no filesystem and no terminal, and the desktop says exactly
that instead of pretending to be a computer that will forget everything.

### Work on the sources

```bash
npm install
npm run dev        # http://localhost:3000/dev.html — TypeScript + hot reload
npm run build      # regenerate mixt.bundle.js / mixt.bundle.css (and dist/)
```

`npm run dev` serves the sources with hot reload through `dev.html`; `index.html` always
loads the published bundle, exactly as a visitor would get it.

| script | what it does |
| --- | --- |
| `npm start` | run the machine: the server on port 8080, serving this folder (`npm run server` is the same thing) |
| `npm run dev:all` | the machine and the dev server together, which is what you want while working on the desktop |
| `npm run dev` | dev server on port 3000, hot reload through `dev.html`; `/api`, `/webdav` and `/site` are proxied to the machine on 8080, so run `npm start` alongside it |
| `npm run server:check` | boot a real server into a throwaway directory and drive it over HTTP: 90 checks on accounts, sessions, the filesystem, revisions and conflicts, the jailed terminal, mail, applications, hosting, WebDAV, guest isolation, the air gap, the audit log, and whether any of it survives a restart. Takes a name to run one section: `npm run server:check terminal` |
| `npm run build` | build `mixt.bundle.js` + `mixt.bundle.css` into the root, and assemble `dist/` |
| `npm run preview` | serve the assembled `dist/` copy |
| `npm run smoke` | build `src/smoke/bundle.tsx` for node, run it inside jsdom **against a real server**, and assert 115 behaviours (desktop mounting, every app rendering, every MixtNet page rendering, DNS resolution and NXDOMAIN, real terminal commands, window management, persistence, and the boot-safety checks below) |
| `npm run diagnose` | boot the real entry point (`src/os/start.tsx`) inside jsdom under eleven hostile browser conditions — blocked storage, a full disk, a damaged or truncated saved filesystem, stale settings, a tiny window, no canvas — and report which ones leave a white page |
| `npm run static` | host the folder the way a normal static server does — as the web root, from a subdirectory, and from `file://` — fetch the page over HTTP, execute the script the server returns, and fail if the desktop does not mount |
| `npm run session` | boot the shipped bundle against a small fake API and walk the server-only flows: the administrator signs in and owns the desktop, System Settings reports Administrator, the Administration console lists what is waiting for approval, a standard user never sees it, logging out returns a sign-in screen you can actually type into, and empty boxes go in as a guest |
| `npm run served [url …]` | ask a running server what a browser would actually get: every asset in `index.html` must return 200 **and** a content-type the browser accepts (a stylesheet served as `text/javascript` is dropped outright, which leaves a running OS with no CSS — a white page), and the served `mixt.bundle.js` itself must mount the desktop. Defaults to `http://127.0.0.1:3000` |

---

## The desktop

* **Window manager** — drag, resize from all eight edges/corners, minimise, maximise,
  restore, snap to left/right/top/bottom halves, per-workspace window lists, z-order focus,
  shadows and the Mixt-Y title bar (`WindowFrame.tsx`).
* **Panel** — bottom bar (movable to top/left/right and resizable, with optional autohide)
  holding the menu button, quick-launch icons, a **window list** with per-window actions,
  the workspace switcher, a system tray (network/volume/battery), a clock and a
  calendar/notification drawer.
* **Main menu** — searchable application browser with categories, favourites, and
  "All Applications" grid (`MainMenu.tsx`).
* **Alt+Tab** window switcher overlay, **Super** for the menu, **Ctrl+Alt+←/→** workspace
  switching, **Super+arrows** to snap, **Alt+F2** run dialog, hot corner, right-click
  desktop/taskbar menus, and a boot → lock → login → desktop session flow
  (`Desktop.tsx`, `os/bootstrap.tsx`).
* **Notifications** stack with timeout and a persisted history drawer.
* **Theming** — six Mixt-Y accents, three bundled wallpapers, light/dark/auto, font scale —
  all driven through CSS custom properties (`os/theme.ts`, `index.css`).

## Applications (20)

Preinstalled: Files, Terminal, Mixtsfox (web browser), Software Manager, System Settings,
Text Editor (Xed), Calculator, System Monitor, Media Player, Image Viewer, Weather,
Archive Manager, Screenshot, 2048, Help, About This Computer.
Installable from the **Software Manager** with a simulated download: Drawing (a paint
program), Mail (a working email client), News Reader.

**Administration** is the twentieth, and the only one not everybody gets: it is listed
only for the signed-in administrator account. Everything privileged lives there —
approving or rejecting apps waiting in the publish queue, adding and removing the
whitelisted accounts, and what the server is holding (`data.json`, `ROOTPASS.md`, live
sessions). Standard users and guests never see it, and launching it by hand gets a
refusal rather than the console. The **Administration** category in the menu gathers the
administrative tools together: the console, Software Manager, System Settings and System
Monitor.

Highlights:

* **Terminal** — `ls cd pwd cat echo mkdir touch rm cp mv tree find grep head tail wc sort uniq date whoami hostname uname df free ps top neofetch clear history man help exit sudo apt`, plus `curl`/`wget` (which render MixtNet pages as text), `wallpaper`, `theme`, `notify`, `open`, pipes (`|` — `wc`, `grep`, `sort`, `head`, `tail`, `uniq`), redirection (`>` and `>>`), and command chaining (`&&`, `||`, `;`) with up/down history and tab completion.
* **Files** — sidebar bookmarks, breadcrumbs, list/grid views, sort, search, create folder/file,
  rename, cut/copy/paste, delete → Trash, restore, empty trash, mount a generated "archive"
  and browse inside it, open files with the right application.
* **Mixtsfox** — tabs, bookmarks, history, downloads shelf, `about:` pages, back/forward with a
  per-tab stack, and a URL bar that resolves `mixtnet://`, MixtNet domains and search queries.
  Unknown external domains get an honest "this sandbox cannot reach the real internet"
  page rather than a blank frame.
* **System Settings** — 14 panels: appearance, backgrounds, themes, panel, desktop, display,
  sound, network, power, date & time, startup, users, privacy, and system info. Changing
  settings takes effect immediately and persists.
* Everything else is functional rather than decorative: the calculator evaluates real
  arithmetic, the archive manager creates and opens real archives, the image viewer zooms
  and rotates real files from the virtual filesystem, the text editor saves real files
  with a Markdown preview, Mail sends/replies/forwards and stores messages as JSON in the
  virtual filesystem, Drawing saves PNGs, Screenshot captures a wallpaper composition (the
  sandbox blocks `getDisplayMedia`), and 2048 is 2048.

## MixtNet — an internet built in

The browser is backed by a small site framework (`src/net/`). Each site is a real page tree
with its own CSS-free styling, and the browser resolves URLs to it:

| domain | what it is |
| --- | --- |
| `mixtnet.com` | the portal: search, news headlines, directory of sites |
| `mixtpedia.org` | encyclopaedia with ~20 full articles on Mixt OS, the Mixt Shell, filesystems, the web… |
| `mixtnews.com` | a newspaper with front page, sections and articles |
| `mixtbook.com` / `mixtube.com` / `mixtgames.com` | social feed, video site, and a games arcade that can launch 2048 from the desktop |
| `mixtcart.com` | shop with products, a cart, and checkout that writes a receipt into `~/Documents` |
| `mixtmail.com` | webmail that composes real messages |
| `mixtmaps.com` | a canvas-drawn map with places and directions |
| `mixtos.com`, `mixtdev.io`, `mixt.dev` | documentation sites, including this project's own |
| `mixtnet://search?q=…` | **Mixtsfox Search** — the built-in search engine (also reachable from the terminal with `curl`) |
| `pastemixt.com` | a pastebin that lives entirely in one server file — create pastes, and `curl https://pastemixt.com/raw/hello1` |

## The Internet directory and its DNS

MixtNet is not a hard-coded list of sites: it is a folder of machines plus a
resolver.

```
src/net/internet/servers/*.server.tsx   ← drop a file in, the domain resolves
src/net/dns.ts                          ← the zone: A/AAAA/CNAME/MX/TXT/NS/PTR
src/net/internet/hosts.ts               ← /etc/hosts + /etc/resolv.conf (real VFS files)
```

Each `*.server.tsx` file default-exports a machine — hostnames, aliases,
wildcards, open ports, DNS records, operator flavour, and the `SiteDef`s it
serves. `import.meta.glob` picks the files up automatically, so **adding a site
means adding a file**, and nothing else: `src/net/internet/HOWTO.md` is the
step-by-step walkthrough, `src/net/internet/README.md` is the field-by-field
reference, and `servers/pastemixt.server.tsx` is a complete worked example (a
working pastebin in a single file).

Every machine gets a stable fake address in the MixtNet block (`10.64.0.0/10`),
a PTR record back to its name, `www.` CNAMEs for its sites, and — where declared
— MX/TXT/NS records and a port list. The address bar shows what the resolver
said (`10.83.17.204 · 6 ms`), and:

* `dig`, `host`, `nslookup`, `getent`, `nmap`, `ping` all query the real
  resolver, including `NXDOMAIN` and reverse lookups (`dig -x <ip>`)
* **`about:dns`** is the MixtNet Registry — every machine, the whole zone file,
  and your `/etc/hosts`, live
* unknown names get a proper **"Server not found"** page that prints the DNS
  answer and offers the closest match
* any name can be overridden from `/etc/hosts` (`10.9.9.9 smoke.local`) — no
  code change, and the override wins, exactly like a real resolver
* navigating by address works too: `https://10.83.17.204/` reverse-resolves and
  loads the right site

Cross-app plumbing is done with `window` events (`mixt:launch`, `mixt:cart`,
`mixt:file`, `mixt:notify`, `mixt:session`) and the small helper API in `src/os/bus.ts`,
so a web page can open the drawing program, add to a shop cart, or leave a file behind.

## The virtual computer

`src/os/vfs.ts` implements a real filesystem in React state: inode-ish nodes (`dir`/`file`
with size, mime, url, modified time), `normalizePath`, `join`, `mkdir(-p)`, `list`, `read`,
`write`, `rm`, `trash`, and helpers such as `humanSize`. The same store backs the file
manager, terminal, text editor, image viewer, paint, mail, archive manager and the browser's
downloads — which is what keeps twenty applications instant: a read is a property lookup.

It is a **mirror**. The machine in `server/` holds the files as real bytes on disk, and
`src/os/sync.ts` keeps the two in step: the desktop downloads its account's tree when it
signs in, applies every change locally at once, and streams it back as operations. Each
account's tree carries a revision, so a second window that changed something makes the first
one re-read rather than write over it. A copy is cached in this browser too, under
`mixt.vfs.v2:<username>`, so the desktop appears immediately and a brief outage costs
nothing.

### The default filesystem is a folder, not code

What a new account and a guest both find when they first boot lives in **`defaultfs/`**, at the
root of the repository beside `index.html` and this README — as ordinary files. `etc/hosts`,
`home/mixt/Documents/todo.txt`, `var/log/boot.log` and the rest are real files you can open,
edit and diff.

`npm run gen:defaultfs` (which `npm run build` runs for you) reads that folder and writes
`src/os/defaultfs.ts`; the server reads the same folder itself when it seeds a new account,
so what the machine gives you and what the desktop would have built on its own are the same
files. Adding a file to the default desktop means adding a file to `defaultfs/`.

Only the parts that are computed rather than stored are added in code: the wallpapers, listed
once and shown in both places they appear; `/usr/share/applications`, which the application
index fills in; the hosted share under `/srv/www`; and `/bin`, which holds placeholders.

### Each account has its own files, and a guest has none

Every account's filesystem is its own on the machine, and the copy cached in this browser is
kept under its own key, `mixt.vfs.v2:<username>`, so two people sharing a browser do not
inherit each other's files either. An administrator gets a read-only `/users` folder at the
root holding everybody else's current filesystem.

A guest has no saved progress. `persistsFor()` in `src/os/vfs.ts` is the one place that decides
whether a mounted tree is written out, and a guest never is — nor are their installed apps or
their settings. Everything a guest does lasts as long as the session and is gone when they sign
out, so a shared machine does not accumulate one filesystem per person who sat down at it.

### Mail stays on this machine

Two domains, both invented and both local — neither resolves in real DNS, and the server never
opens a socket to deliver anything:

| | address |
| --- | --- |
| a whitelisted account | `name@proper.com` |
| a guest | `NAME@Guest.MPL` |

With guest mail switched on in the Administration console, **each guest gets a mailbox of their
own** rather than one shared box, so two people on the same machine cannot read each other's
mail. `src/os/mailaddr.ts` is the single place those rules live, so the mail client, the
webmail site and the Administration console cannot disagree about an address.

`src/os/store.ts` (zustand) holds windows, workspaces, settings, the installed-app list,
notifications and the session/lock state; `src/os/bootstrap.tsx` runs the boot sequence.

## Project layout

```
index.html            the published site (classic script + stylesheet, relative paths)
dev.html              the dev-server entry (loads src/main.tsx, hot reload)
mixt.bundle.js/.css   built by `npm run build`, committed — index.html loads these
defaultfs/            the filesystem every new account is seeded from, as ordinary files
wallpapers/           the backgrounds, and index.json — the order they are offered in
converter/            a second website: turns a page from out there into one for this project
data/                 the machine's own state, written by the server (not committed)
scripts/              the checks: smoke, server:check, static, diagnose, session, …
src/
  main.tsx            entry — imports the boot module, calls startDesktop()
  index.css           Mixt-Y theme, window/panel/menu styling
  os/                 types, zustand store, vfs, theme, bus, boot bootstrap
    start.tsx         the real boot sequence: housekeeping → error boundary → Desktop
    storage.ts        safe web-storage access (never throws, falls back to memory)
    defaultfs.ts      generated from defaultfs/ — do not edit by hand
    wallpapers.ts     generated from wallpapers/index.json — do not edit by hand
    api.ts            the client for the machine: every route it speaks
    sync.ts           the mirror: streams local changes up, adopts the server's tree
    mailaddr.ts       the two local mail domains, in one place
    sdk.ts            mixt.js — the runtime an application calls into
    errorboundary.tsx boot failure screen + plain-DOM last resort report
  shell/              Desktop, Panel, MainMenu, WindowFrame, AppIcon, ContextMenu, Notifications
  apps/               registry.tsx + one module per application (19)
  net/                types, index (URL resolution + search), dns, sitekit, storage, downloads
    internet/         the directory: manifest + servers/*.server.tsx + /etc/hosts helpers
    sites/            portal, tech, services, social page trees
  smoke/              bundle.tsx — the jsdom smoke harness driven by scripts/smoke.mjs
server/               the machine
  index.js            boot, HTTP, and the wiring of everything under it
  routes.js           every route, in one table
  lib/                container, config, http helpers, errors, paths, mime
  services/           auth, users, fs, shell, mail, apps, hosting, shares, webdav, events…
  controllers/        one per group of routes
  stores/             the tables: users, sessions, fs entries, shares, kv
  clients/            the database (JSON on disk) and the blob store
scripts/smoke.mjs     runner (esbuild via Vite SSR build → jsdom → a real server → assertions)
scripts/server.mjs    the machine's own end-to-end check: 90 assertions over HTTP
scripts/diagnose.mjs  boot matrix runner (one process per hostile condition)
scripts/static.mjs    hosting check: plain static server, subdirectory and file://
scripts/converter.mjs checks the converter website
scripts/sdk.mjs       checks the mixt.js runtime against the shipped bundle
scripts/gen-defaultfs.mjs  defaultfs/ → src/os/defaultfs.ts, wallpapers/ → src/os/wallpapers.ts
scripts/gen-appindex.mjs   src/apps → src/os/appindex.ts
scripts/build-static.mjs  publishes mixt.bundle.js/.css and dist/
vite.static.config.ts build config for the published bundle (IIFE, everything relative)
vite.config.ts        dev config: /api, /webdav and /site are proxied to the machine on 8080
```

## mixt.js — what an application talks to

Every application in `/usr/share/applications` ships a `main.js` that says what it is and how it
starts. `window.mixt` is the other side of that: the runtime an application calls into, installed
before anything else runs and written into the filesystem at `/usr/share/mixt/mixt.js` so it can be
listed as a dependency and read like any other file.

```js
mixt.version                       // 1 — check it before using something new
mixt.whoami()                      // {username, role, guest, address} — never a password
mixt.apps.list()                   // every app this session may see
mixt.apps.launch('nemo', {})       // open one; the window id, or null
mixt.apps.open('/home/mixt/a.txt') // open a file with whatever handles it

mixt.fs.read('/etc/hostname')      // text, or null
mixt.fs.write(path, 'hi')          // true if it was written
mixt.fs.list('/home/mixt')         // entries, or null
mixt.fs.mkdir('/a/b/c')            // makes the parents too
mixt.fs.move / copy / trash / remove
mixt.fs.basename / dirname

mixt.notify('Saved', 'Written.')
mixt.terminal('/srv/www')          // open a terminal, optionally there
mixt.mail.address()                // this session's local address
```

Three things about it are deliberate:

* **Nothing throws.** A missing path gives `null`; a refused write gives `false`. An application
  calling into the OS should not have to wrap every line in a `try`, and a failure it can see is
  one it can report.
* **The filesystem calls are synchronous**, because they read and write the same tree the desktop
  is already showing — a change is on screen immediately, with nothing to await.
* **There is no way out.** No `fetch`, no upload, no remote storage in this API. An application
  written against `mixt.js` cannot leave this machine, which is the whole point of a desktop that
  claims to be self-contained. The runtime is frozen, so one application cannot redefine the OS out
  from under the next.

```bash
npm run sdk                # 26 checks, run against the shipped bundle
```

## The converter — a second website in the repository

`converter/` is its own small website, beside the desktop rather than inside it. It takes a page
written for the open internet and produces a page that stands on its own, so it can be dropped
into `/srv/www` and browsed on this machine like any other site.

Open `converter/index.html`, paste the page's HTML, and it rewrites it:

* **absolute addresses become local ones** — `https://cdn.example/style.css` becomes
  `vendor/cdn.example-style.css`, so nothing on the page points at another machine;
* **protocol-relative addresses** (`//cdn.example/x`) are absolute in disguise and get the same
  treatment;
* **integrity hashes are dropped**, because the hash described the remote file and keeping it
  would make the browser refuse every local copy;
* **things that need a foreign machine are commented out, not deleted** — iframes, forms that
  post away, prefetch and preconnect hints, beacons, service worker registration — each with a
  note saying what it was and why it went;
* **a manifest** lists every change, so the result can be checked instead of taken on trust;
* **a `website.ini`** in the `[Website]` key-per-line form the rest of the project uses.

Nothing is fetched. The converter has no network access and makes no requests — a converter that
had to download the very assets it is neutralising would defeat the point — so each `vendor/`
path is a file you place there yourself, or the page does without it. It has no dependencies and
no build step: it runs over http or straight off the disk.

```bash
npm run converter      # 25 checks on the conversion rules
```

## Booting is defensive on purpose

A desktop that fails to mount is a white page: no message, no way out, and nothing in the
browser's network panel to look at. Every layer of the boot path therefore assumes the
worst about the environment it wakes up in:

* **Web storage can be missing.** A sandboxed iframe, a private-mode browser or a full disk
  makes `localStorage`/`sessionStorage` throw — even reading the property. All access goes
  through `os/storage.ts`, which never throws and keeps values in memory for the session.
* **Saved state can be from another build.** The stored filesystem is validated node by
  node on the way in (`parseTree`), every directory ends up with a `children` map, and
  unreadable blobs fall back to the seed filesystem. Settings are checked against the type
  of their default, so a `null` wallpaper or a `"sideways"` panel position cannot crash the
  first render.
* **Nothing external is loaded at all.** The page requests exactly three local files
  (the bundle, the stylesheet, the logo), and the typeface is the system font stack, so a
  machine with no internet costs nothing at all. `npm run static` fails the build if an
  external request ever creeps back in.
* **And if the machine is not there, it says so.** The desktop opens a stream to the server
  when it boots; with nothing answering, it shows a page naming the address it tried rather
  than a desktop that would quietly forget everything typed into it.
* **If something still throws, you get told.** React rendering is wrapped in
  `BootBoundary`, and errors that escape React entirely are caught in `start.tsx` — both
  put a readable report on screen with the error, the storage status, and buttons to
  reload or forget the saved state that caused it. If the script never runs at all (a 404,
  a host that refuses `.js`, an extension blocking scripts), `index.html` has its own
  watchdog that says so instead of showing a white page.

`npm run diagnose` exercises those boot paths, `npm run static` proves the hosting story
(web root, subdirectory, `file://`), and `npm run smoke` keeps regression checks for the
failures that used to be silent white screens.

### How it is hosted, in one line

Plain HTML + a classic `<script>` + a stylesheet, all relative to the page, served by the
machine itself. That is why it also works on a bare static host: no ES modules to MIME-type
correctly, no `type="module"` CORS rules, no server rewrites, no proxy, no build step at
request time.

### What the server actually is

`server/` is a small Node program with no dependencies beyond Node itself — a service
container, controllers and services, and a JSON database in `data/` with the files kept as
real bytes on disk. It speaks Puter-shaped routes (`/api/...`), plus WebDAV at `/webdav` and
hosted sites at `/site/<name>`. Accounts, sessions and tokens; per-account filesystems with
revisions so two windows cannot overwrite each other; ACLs and share links; an app registry
with publishing and approval; mail between accounts; an event stream; and a terminal that
runs over the real filesystem but is jailed to the account using it — only the administrator
can look outside their own tree, and nobody gets a shell on the host.

## Honest limitations

* The **real** internet is not reachable from the sandbox: domains that are not part of
  MixtNet fall back to an explanatory page. The browser is fully functional; the network
  it browses is the one built into the app.
* Screen capture uses `getDisplayMedia` when the host allows it and otherwise composes a
  wallpaper shot — the preview iframe blocks the former. Audio, the clipboard and storage
  are all optional too: each is detected first and has a plain-path fallback.
* No real executable installs: the Software Manager simulates installation (progress,
  notifications, menu entries).
* In a browser that refuses web storage altogether (a sandboxed frame or private mode), the
  desktop still runs — it just keeps its working copy in memory, so the cache that makes it
  open instantly is missing and everything is read from the machine instead. Opening
  `index.html` straight from disk with `file://` is different: with no machine to talk to,
  the desktop reports that rather than booting.
