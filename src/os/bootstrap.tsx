import { applyThemeVars } from '../os/theme'
import { useOS } from '../os/store'
import { vfs } from '../os/vfs'
import { ensureNetworkFiles } from '../net/internet/hosts'
import { safeSession } from './storage'
import { INSTALLED_VERSION, REPO_VERSIONS } from '../apps/versions'

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
