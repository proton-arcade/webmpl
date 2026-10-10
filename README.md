# Mixt Web OS

A complete desktop computer that runs in your browser — window manager, panel, main menu,
workspaces, a virtual filesystem, a real terminal, an installable software store, and a
**Mixtsfox** browser that renders a whole fictional internet ("MixtNet"), all
styled after a classic panel-and-menu desktop.

Everything is client-side: no backend, no server, no network calls. The "operating system" is
React state; the one thing that *is* saved locally is what you would expect an OS to remember —
your accounts, files and settings — in the browser.

### Things to try

* **Accounts.** Open the Terminal and type `/startup` to create a user account (username,
  display name, optional password, avatar, accent). It is saved in the browser; the lock screen
  and the session menu let you switch between accounts. `users`, `login <name>` and `logout`
  manage them.
* **The Software Manager.** A real storefront: featured banner, editor's picks with
  screenshots, a detail page per app, ratings you can leave, and install/uninstall.
* **A shelf look.** Settings → Appearance → Desktop style turns the panel into a shelf and
  the menu into a launcher, modelled on the real thing.
* **Tiling.** Drag a window to an edge or corner to snap it — top maximises, the sides and the
  bottom give halves, and the four corners give quarters. Super+arrows does the same.


### Run it like any other website

```bash
python3 -m http.server 8000        # or any static file server, pointed at this folder
open http://localhost:8000/
```

That is the whole setup. The repository root **is** the site:

```
index.html        the page
mixt.bundle.js    the app (a classic script — no modules, no build step to visit)
mixt.bundle.css   the theme
wallpapers/  logo.svg
```

Everything is relative, so it also works from a subdirectory (`http://localhost:8000/mixt/`)
and by opening `index.html` straight from disk. No backend, no environment variables, no
CDN, no service worker, no CORS, no MIME-type rules, no `npm install` — nothing for a host
to configure.

### Run it with the backend

```bash
npm install          # once
npm start            # → http://localhost:8080
```

That is the full desktop: accounts, mail between them, the administrator console and the
publishing queue. `npm start` runs `node server.cjs` — a single dependency-free Node file
that serves this folder **and** the JSON API under `/api/`. Change the port with
`PORT=9000 npm start`. State lives in `data.json` beside it.

The backend is optional. Without it the site still runs, in offline mode: one local
account, no mail between accounts, no administrator. That is the "any static server"
mode above.

### Work on the sources

```bash
npm install
npm run dev        # http://localhost:3000/dev.html — TypeScript + hot reload
npm run build      # regenerate mixt.bundle.js / mixt.bundle.css (and dist/)
```

`npm run dev` serves the sources with hot reload through `dev.html`; `index.html` always
loads the published bundle, exactly as a visitor would get it.

To edit the sources *and* have accounts and mail, run both — the dev server forwards
`/api` to the backend, and the backend forwards the dev module graph back to Vite, so
`http://localhost:8080/dev.html` works as well as port 3000:

```bash
npm start            # terminal 1 — backend on 8080
npm run dev          # terminal 2 — Vite on 3000
```

| script | what it does |
| --- | --- |
| `npm start` | the backend on port 8080 — this folder as a static site plus the `/api` JSON API (`node server.cjs`, no dependencies); `PORT=…` changes the port |
| `npm run dev` | dev server on port 3000, hot reload through `dev.html`; the published `index.html`, bundle, logo and wallpapers are served as raw bytes with correct MIME types, so `http://localhost:3000/` is the real site |
| `npm run build` | build `mixt.bundle.js` + `mixt.bundle.css` into the root, and assemble `dist/` |
| `npm run preview` | serve the assembled `dist/` copy |
| `npm run smoke` | build `src/smoke/bundle.tsx` for node, run it inside jsdom, assert 117 behaviours (desktop mounting, every app rendering, every MixtNet page rendering, DNS resolution and NXDOMAIN, real terminal commands, window management, persistence, and the boot-safety checks below) |
| `npm run diagnose` | boot the real entry point (`src/os/start.tsx`) inside jsdom under eleven hostile browser conditions — blocked storage, a full disk, a damaged or truncated saved filesystem, stale settings, a tiny window, no canvas — and report which ones leave a white page |
| `npm run static` | host the folder the way a normal static server does — as the web root, from a subdirectory, and from `file://` — fetch the page over HTTP, execute the script the server returns, and fail if the desktop does not mount |
| `npm run session` | boot the shipped bundle against a small fake API and walk the server-only flows: the administrator signs in and owns the desktop, System Settings reports Administrator, the Administration console lists what is waiting for approval, a standard user never sees it, logging out returns a sign-in screen you can actually type into, and empty boxes go in as a guest |
| `npm run served [url …]` | ask a running server what a browser would actually get: every asset in `index.html` must return 200 **and** a content-type the browser accepts (a stylesheet served as `text/javascript` is dropped outright, which leaves a running OS with no CSS — a white page), and the served `mixt.bundle.js` itself must mount the desktop. Defaults to `http://127.0.0.1:3000` |
| `npm run files` | the file manager and the per-account filesystem, against the shipped bundle: the path bar's Back and drive buttons, opening a folder, dragging a file onto a folder and onto empty space across two windows, `/usr/share/applications`, every account's own storage key, the administrator's `/users`, and backing an account up |
| `npm run human` | sit down and use it: write a file, back the account up, delete the file, restore it and check it came back; open a sound file; install VLC and choose it; sign in as the administrator and read another account's file through `/users`; sign out and in as somebody else |
| `npm run mail` | start an isolated server and walk the mail flows end to end — addresses resolving on both local domains, a mailbox switched off and back on, per-guest mailboxes, guest sign-in tracking, password changes |
| `npm run sdk` | the `mixt.js` runtime, called the way an application would, against the shipped bundle — including that a guest is told they are a guest, that what a guest writes is never saved, and that nothing in the API can reach the network |
| `npm run converter` | the conversion rules: remote addresses pointed inside, everything needing a foreign machine switched off, what was already local left alone, and the `website.ini` in the right form |
| `npm run localpages` | get to the converter from inside the desktop — from the bookmarks and by typing its name — and prove no other path in the repository can be opened that way |
| `npm run explore` | click through every application and every MixtNet page in the shipped bundle and fail on a console error, an unhandled rejection, or a page that renders empty |
| `npm run interact` | drive the desktop the way a person does: drag a window, snap it to an edge, switch workspaces, open a context menu, resize — and check the geometry that results |
| `npm run devgate` | `dev.html` asks the backend who is signed in: an administrator gets the source build, anyone else is sent to `index.html` |
| `npm run gen:defaultfs` | read `defaultfs/` and regenerate `src/os/defaultfs.ts` (run for you by `npm run build`) |
| `npm run gen:appindex` | read `src/apps` and regenerate `src/os/appindex.ts` (run for you by `npm run build`) |

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

## Applications (21)

Preinstalled: Files, Terminal, Mixtsfox (web browser), Software Manager, System Settings,
Text Editor (Xed), Calculator, System Monitor, Mixt Player, Image Viewer, Archive Manager,
Screenshot, Help, About This Computer.
Installable from the **Software Manager** with a simulated download: Drawing (a paint
program), Mail (a working email client), News Reader, Weather, and VLC media player.

**Mixt Player** ships with the system and is the default handler for sound and video; a
player installed later can be chosen instead in System Settings, and if the one chosen has
since been removed the built-in player takes over rather than nothing opening.

**Administration** and **Screen Viewer** are the two not everybody gets: both are listed
only for the signed-in administrator account. Everything privileged lives in
Administration — approving or rejecting apps waiting in the publish queue, adding and
removing the whitelisted accounts, switching guest mail on and off, and what the server is
holding (`data.json`, `ROOTPASS.md`, live sessions). Screen Viewer shows what the other
accounts and the guest sign-ins have on screen. Standard users and guests never see either,
and launching one by hand gets a refusal rather than the console. Guests get no Terminal at
all. The **Administration** category in the menu gathers the administrative tools together:
the console, Screen Viewer, Software Manager, System Settings and System Monitor.

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

`src/os/vfs.ts` implements a real filesystem in React state, persisted to `localStorage`:
inode-ish nodes (`dir`/`file` with size, mime, url, modified time), `normalizePath`, `join`,
`mkdir(-p)`, `list`, `read`, `write`, `rm`, `trash`, and helpers such as `humanSize`.
The same store backs the file manager, terminal, text editor, image viewer, paint, mail,
archive manager and the browser's downloads.

### The default filesystem is a folder, not code

What a new account and a guest both find when they first boot lives in **`defaultfs/`**, at the
root of the repository beside `index.html` and this README — as ordinary files. `etc/hosts`,
`home/mixt/Documents/todo.txt`, `var/log/boot.log` and the rest are real files you can open,
edit and diff.

`npm run gen:defaultfs` (which `npm run build` runs for you) reads that folder and writes
`src/os/defaultfs.ts`. Because the generated module is compiled into the bundle, the desktop
never has to fetch those files: it can produce a whole filesystem with no server and no network
at all. Adding a file to the default desktop means adding a file to `defaultfs/`.

Only the parts that are computed rather than stored are added in code: the wallpapers, listed
once and shown in both places they appear; `/usr/share/applications`, which the application
index fills in; the hosted share under `/srv/www`; and `/bin`, which holds placeholders.

### Each account has its own files, and a guest has none

Every account's filesystem is saved under its own key, `mixt.vfs.v2:<username>`, so two people
sharing a browser do not inherit each other's files. An administrator gets a read-only `/users`
folder at the root holding everybody else's current filesystem.

A guest has no saved progress. `persistsFor()` in `src/os/vfs.ts` is the one place that decides
whether a mounted tree is written out, and a guest never is — nor are their installed apps or
their settings. Everything a guest does lasts as long as the session and is gone when they sign
out, so a shared machine does not accumulate one filesystem per person who sat down at it.

### Mail stays on this machine

Two domains, both invented and both local — neither resolves in real DNS, and the server never
opens a socket to deliver anything:

| | address |
| --- | --- |
| a whitelisted account | `name@Mixt.MPL` |
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
defaultfs/            the default filesystem, as ordinary files (see below)
converter/            a second website: turns a page from out there into one for this project
wallpapers/ logo.svg  assets, referenced relatively
src/
  main.tsx            entry — imports the boot module, calls startDesktop()
  index.css           Mixt-Y theme, window/panel/menu styling
  os/                 types, zustand store, vfs, theme, bus, boot bootstrap
    start.tsx         the real boot sequence: housekeeping → error boundary → Desktop
    storage.ts        safe web-storage access (never throws, falls back to memory)
    defaultfs.ts      generated from defaultfs/ — do not edit by hand
    mailaddr.ts       the two local mail domains, in one place
    sdk.ts            mixt.js — the runtime an application calls into
    errorboundary.tsx boot failure screen + plain-DOM last resort report
  shell/              Desktop, Panel, MainMenu, WindowFrame, AppIcon, ContextMenu, Notifications
  apps/               registry.tsx + one module per application (21)
  net/                types, index (URL resolution + search), dns, sitekit, storage, downloads
    internet/         the directory: manifest + servers/*.server.tsx + /etc/hosts helpers
    sites/            portal, tech, services, social page trees
  smoke/              bundle.tsx — the jsdom smoke harness driven by scripts/smoke.mjs
scripts/smoke.mjs     runner (esbuild via Vite SSR build → jsdom → assertions)
scripts/diagnose.mjs  boot matrix runner (one process per hostile condition)
scripts/static.mjs    hosting check: plain static server, subdirectory and file://
scripts/converter.mjs checks the converter website
scripts/sdk.mjs       checks the mixt.js runtime against the shipped bundle
scripts/gen-defaultfs.mjs  defaultfs/ → src/os/defaultfs.ts
scripts/gen-appindex.mjs   src/apps → src/os/appindex.ts
scripts/build-static.mjs  publishes mixt.bundle.js/.css and dist/
vite.static.config.ts build config for the published bundle (IIFE, everything relative)
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

Plain HTML + a classic `<script>` + a stylesheet, all relative to the page. That is why it
works on a bare static host: no ES modules to MIME-type correctly, no `type="module"`
CORS rules, no server rewrites, no proxy, no build step at request time.

## Honest limitations

* The **real** internet is not reachable from the sandbox: domains that are not part of
  MixtNet fall back to an explanatory page. The browser is fully functional; the network
  it browses is the one built into the app.
* Screen capture uses `getDisplayMedia` when the host allows it and otherwise composes a
  wallpaper shot — the preview iframe blocks the former. Audio, the clipboard and storage
  are all optional too: each is detected first and has a plain-path fallback.
* No real executable installs: the Software Manager simulates installation (progress,
  notifications, menu entries).
* In a browser that refuses web storage altogether (a sandboxed frame, private mode, or
  opening `index.html` straight from disk with `file://`), the OS still runs — it just keeps
  everything in memory, so files and settings are forgotten when the tab closes. The boot
  screen says so instead of failing silently.
