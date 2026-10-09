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
| `npm run dev` | dev server on port 3000, hot reload through `dev.html`; the published `index.html`, bundle, logo and wallpapers are served as raw bytes with correct MIME types, so `http://localhost:3000/` is the real site |
| `npm run build` | build `mixt.bundle.js` + `mixt.bundle.css` into the root, and assemble `dist/` |
| `npm run preview` | serve the assembled `dist/` copy |
| `npm run smoke` | build `src/smoke/bundle.tsx` for node, run it inside jsdom, assert 102 behaviours (desktop mounting, every app rendering, every MixtNet page rendering, DNS resolution and NXDOMAIN, real terminal commands, window management, persistence, and the boot-safety checks below) |
| `npm run diagnose` | boot the real entry point (`src/os/start.tsx`) inside jsdom under eleven hostile browser conditions — blocked storage, a full disk, a damaged or truncated saved filesystem, stale settings, a tiny window, no canvas — and report which ones leave a white page |
| `npm run static` | host the folder the way a normal static server does — as the web root, from a subdirectory, and from `file://` — fetch the page over HTTP, execute the script the server returns, and fail if the desktop does not mount |
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

## Applications (19)

Preinstalled: Files, Terminal, Mixtsfox (web browser), Software Manager, System Settings,
Text Editor (Xed), Calculator, System Monitor, Media Player, Image Viewer, Weather,
Archive Manager, Screenshot, 2048, Help, About This Computer.
Installable from the **Software Manager** with a simulated download: Drawing (a paint
program), Mail (a working email client), News Reader.

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
`mkdir(-p)`, `list`, `read`, `write`, `rm`, `trash`, and helpers such as `humanSize`. It is
seeded on boot with the usual directories: `~`, `Desktop`, `Documents`, `Downloads`, `Music`, `Pictures`,
`Public`, `Templates`, `Videos`, `/etc`, `/usr`, and a Trash that deleted files land in.
The same store backs the file manager, terminal, text editor, image viewer, paint, mail,
archive manager and the browser's downloads.

`src/os/store.ts` (zustand) holds windows, workspaces, settings, the installed-app list,
notifications and the session/lock state; `src/os/bootstrap.tsx` runs the boot sequence.

## Project layout

```
index.html            the published site (classic script + stylesheet, relative paths)
dev.html              the dev-server entry (loads src/main.tsx, hot reload)
mixt.bundle.js/.css   built by `npm run build`, committed — index.html loads these
wallpapers/ logo.svg  assets, referenced relatively
src/
  main.tsx            entry — imports the boot module, calls startDesktop()
  index.css           Mixt-Y theme, window/panel/menu styling
  os/                 types, zustand store, vfs, theme, bus, boot bootstrap
    start.tsx         the real boot sequence: housekeeping → error boundary → Desktop
    storage.ts        safe web-storage access (never throws, falls back to memory)
    errorboundary.tsx boot failure screen + plain-DOM last resort report
  shell/              Desktop, Panel, MainMenu, WindowFrame, AppIcon, ContextMenu, Notifications
  apps/               registry.tsx + one module per application (19)
  net/                types, index (URL resolution + search), dns, sitekit, storage, downloads
    internet/         the directory: manifest + servers/*.server.tsx + /etc/hosts helpers
    sites/            portal, tech, services, social page trees
  smoke/              bundle.tsx — the jsdom smoke harness driven by scripts/smoke.mjs
scripts/smoke.mjs     runner (esbuild via Vite SSR build → jsdom → assertions)
scripts/diagnose.mjs  boot matrix runner (one process per hostile condition)
scripts/static.mjs    hosting check: plain static server, subdirectory and file://
scripts/build-static.mjs  publishes mixt.bundle.js/.css and dist/
vite.static.config.ts build config for the published bundle (IIFE, everything relative)
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
