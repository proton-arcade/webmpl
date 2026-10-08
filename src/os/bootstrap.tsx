import { applyThemeVars } from '../os/theme'
import { useOS } from '../os/store'
import { useVFS } from '../os/vfs'

/** One-time session boot: theme, seed notifications, housekeeping. */
export function bootstrap() {
  const os = useOS.getState()
  applyThemeVars(os.settings)

  // Make sure the user's home directories exist (fresh installs / old stores).
  const vfs = useVFS.getState()
  for (const dir of [
    '/home/mint/Desktop',
    '/home/mint/Documents',
    '/home/mint/Downloads',
    '/home/mint/Music',
    '/home/mint/Pictures',
    '/home/mint/Videos',
    '/home/mint/.local/share/Trash/files',
    '/home/mint/.config',
    '/tmp',
    '/var/tmp',
  ]) {
    if (!vfs.exists(dir)) vfs.mkdir(dir)
  }

  const uptimeKey = 'webmpl.boot.cycle'
  const cycles = Number(sessionStorage.getItem(uptimeKey) ?? '0') + 1
  sessionStorage.setItem(uptimeKey, String(cycles))

  setTimeout(() => {
    if (cycles <= 1) {
      os.notify({
        title: 'Welcome to Mint Web OS',
        body: `${os.settings.username}@${os.settings.hostname} is ready.\nOpen the Menu to explore, or type "help" in the Terminal.`,
        appId: 'help',
      })
    }
    if (os.settings.autoUpdates) {
      setTimeout(() => {
        os.notify({
          title: 'Update Manager',
          body: 'Your system is up to date.\n3 packages can be installed from the Software Manager.',
          appId: 'mintinstall',
        })
      }, 5200)
    }
    if (os.settings.startupApps.includes('update-notifier')) {
      os.notify({
        title: 'Network',
        body: os.settings.wifi ? 'Connected to "MintNet" wireless network.' : 'Wireless is switched off.',
        appId: 'network',
      })
    }
  }, 900)
}
