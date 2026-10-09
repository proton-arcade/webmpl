import { applyThemeVars } from '../os/theme'
import { useOS } from '../os/store'
import { vfs } from '../os/vfs'
import { ensureNetworkFiles } from '../net/internet/hosts'
import { ensureWebShare } from '../os/vfs'
import { safeSession } from './storage'
import { INSTALLED_VERSION, REPO_VERSIONS } from '../apps/versions'
import { getSession, serverMail } from './api'
import { readMailCache, writeMailCache } from '../apps/mailstore'

/** One-time session boot: theme, seed notifications, housekeeping.
 *
 *  Everything here is best-effort. The desktop must be able to mount even if a
 *  browser denies storage or a saved filesystem is incomplete, so nothing in
 *  this function is allowed to throw — main.tsx calls it before the first
 *  render, and an exception there means no desktop at all. */
export function bootstrap() {
  const os = useOS.getState()
  applyThemeVars(os.settings)

  // Make sure the user's home directories exist (fresh installs, old stores,
  // a home directory that was deleted). mkdirp creates any missing parent, so
  // an incomplete tree still ends up with a usable home.
  for (const dir of [
    '/home/mixt/Desktop',
    '/home/mixt/Documents',
    '/home/mixt/Downloads',
    '/home/mixt/Music',
    '/home/mixt/Pictures',
    '/home/mixt/Videos',
    '/home/mixt/.local/share/Trash/files',
    '/home/mixt/.config',
    '/tmp',
    '/var/tmp',
  ]) {
    try {
      vfs.mkdirp(dir)
    } catch {
      /* a damaged tree must not stop the session */
    }
  }

  // /etc/hosts and /etc/resolv.conf — the local resolver's configuration
  try {
    ensureNetworkFiles()
  } catch {
    /* ignore */
  }

  /* /srv/www — the hosted site and the default user's file share. A saved
   * filesystem replaces the seed outright, so a session that booted before the
   * share existed needs it walked in; anything already there is left alone. */
  try {
    ensureWebShare()
  } catch {
    /* ignore */
  }

  const uptimeKey = 'mixt.boot.cycle'
  const cycles = Number(safeSession.getItem(uptimeKey) ?? '0') + 1
  safeSession.setItem(uptimeKey, String(cycles))

  setTimeout(() => {
    try {
      if (cycles <= 1) {
        os.notify({
          title: 'Welcome to Mixt Web OS',
          body: `${os.settings.username}@${os.settings.hostname} is ready.\nOpen the Menu to explore, or type "help" in the Terminal.`,
          appId: 'help',
        })
      }
      if (os.settings.autoUpdates) {
        /* report what is actually out of date, not a hard-coded count */
        const pending = Object.keys(REPO_VERSIONS).filter(
          (id) => REPO_VERSIONS[id] !== (os.updatesApplied?.[id] ?? INSTALLED_VERSION),
        )
        setTimeout(() => {
          os.notify({
            title: 'Update Manager',
            body: pending.length
              ? `${pending.length} package${pending.length === 1 ? '' : 's'} can be updated in the Software Manager.`
              : 'Your system is up to date.',
            appId: 'mixtinstall',
          })
        }, 5200)
      }
      /* Mail another account on this computer has sent. Compared against the
       * local cache, so a message is announced once and not on every boot; the
       * messages are then folded into the cache, which is what stops the repeat.
       * Guests have no mailbox, and with no server behind the page there is
       * nothing to ask — both cases fall through silently. */
      const session = getSession()
      if (session && session.role !== 'guest') {
        const user = session.username
        setTimeout(async () => {
          try {
            const box = await serverMail()
            if (!box) return
            const cached = readMailCache(user)
            const seen = new Set(cached.map((m) => m.id))
            const unseen = box.filter((m) => !seen.has(m.id))
            if (unseen.length) writeMailCache(user, [...cached, ...unseen])
            const fresh = unseen.filter((m) => m.folder === 'Inbox')
            if (!fresh.length) return
            const newest = fresh.reduce((a, b) => (b.date > a.date ? b : a), fresh[0])
            const who = newest.fromName || newest.from
            useOS.getState().notify({
              title: 'Mail',
              body:
                fresh.length === 1
                  ? `1 new message from ${who}.`
                  : `${fresh.length} new messages, the newest from ${who}.`,
              appId: 'mail',
            })
          } catch {
            /* notifications are decoration — never fatal */
          }
        }, 6400)
      }
      if (os.settings.startupApps.includes('update-notifier')) {
        os.notify({
          title: 'Network',
          body: os.settings.wifi ? 'Connected to "MixtNet" wireless network.' : 'Wireless is switched off.',
          appId: 'network',
        })
      }
    } catch {
      /* notifications are decoration — never fatal */
    }
  }, 900)
}
