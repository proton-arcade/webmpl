# defaultfs — the default filesystem

This folder **is** the filesystem that every new account and every guest starts with. It sits at
the root of the repository beside `index.html` and the main README, and it is made of ordinary
files: `etc/hosts`, `home/mixt/Documents/todo.txt`, `var/log/boot.log` and the rest can be opened,
edited and diffed like any other part of the project.

## How it reaches the desktop

```bash
npm run gen:defaultfs     # writes src/os/defaultfs.ts
npm run build             # runs it for you, then builds the bundle
```

`scripts/gen-defaultfs.mjs` walks this folder and generates `src/os/defaultfs.ts` from it. That
module is compiled into `mixt.bundle.js`, so the running desktop never has to fetch these files —
it can build a whole filesystem with no server and no network at all.

**Do not edit `src/os/defaultfs.ts`.** It is overwritten on every build. Edit the files here.

## Adding something

Drop a file in. That is the whole process — there is no list to update and nothing to register.

* Empty directories are real empty directories on disk, so they survive being checked out and are
  still here to be listed.
* The mime type is taken from the extension. Anything that is not a recognised media, image or
  markup type is treated as `text/plain`, which is right for `hosts`, `.conf` and the rest.
* Names are used exactly as written, including spaces and leading dots — `Empty Document.txt` and
  `.bashrc` both work.

## What is *not* here

A few parts of the tree are computed rather than stored, so they are added in code in
`src/os/vfs.ts` (`seedTree`) instead:

* **the wallpapers** — one list, shown in both `/usr/share/backgrounds` and `~/Pictures/Wallpapers`,
  so adding a background needs no edit here;
* **`/usr/share/applications`** — filled in later from the application index;
* **`/srv/www`** — the hosted share, built from the same constants the boot migration uses, so
  there is one copy of it;
* **`/bin`** — placeholders standing in for executables.

## Who gets this, and what is kept

* A **new account** gets a copy, saved under its own key (`mixt.vfs.v2:<username>`), so two people
  sharing a browser do not inherit each other's files.
* A **guest** gets a copy for the length of the session and nothing is written to storage at all.
  Guests have no saved progress by design — see `persistsFor()` in `src/os/vfs.ts`.
