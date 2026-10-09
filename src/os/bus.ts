/* App launching helpers shared by every application. */
import { useOS } from './store'
import { getApp } from '../apps/registry'
import { vfs, baseName } from './vfs'

export function launch(appId: string, props: Record<string, any> = {}, title?: string) {
  return useOS.getState().openApp(appId, props, title ? { title } : {})
}

export function notify(title: string, body?: string, appId?: string) {
  useOS.getState().notify({ title, body, appId })
}

/** Which player opens media.
 *
 *  The player that ships with the system is the default. The user can choose an
 *  installed extra instead — but if the one they chose has since been removed,
 *  or was never installed, this falls back to the built-in player rather than
 *  opening an application that is not there. */
export function mediaPlayer(): string {
  const s = useOS.getState()
  const chosen = s.settings.mediaApp || 'mixtplayer'
  const installed = (id: string) => {
    const app = getApp(id)
    return !!app && (app.preinstalled !== false || !!s.installed[id])
  }
  if (installed(chosen)) return chosen
  /* The built-in player is always present, so this is always a real app. */
  return 'mixtplayer'
}

/** Which application should handle a file? */
export function appForFile(path: string): string | null {
  const name = baseName(path).toLowerCase()
  const node = vfs.node(path)
  const mime = node && node.type === 'file' ? node.mime ?? '' : ''
  if (mime.startsWith('image/')) return 'imageviewer'
  if (mime.startsWith('audio/') || mime.startsWith('video/')) return mediaPlayer()
  if (mime.startsWith('application/zip') || /\.(zip|tar|tar\.gz|tgz|tar\.bz2|7z|rar)$/.test(name)) return 'archive'
  if (mime.startsWith('application/pdf') || /\.(pdf|odt|odp|ods|docx?)$/.test(name)) return 'xed'
  if (/\.(md|txt|log|conf|cfg|ini|json|sh|js|ts|tsx|css|html?|xml|yml|yaml|csv|py|bashrc|profile)$/.test(name)) return 'xed'
  if (name.startsWith('.')) return 'xed'
  return null
}

export function openPath(path: string) {
  const node = vfs.node(path)
  if (!node) {
    notify('Files', `“${path}” no longer exists.`)
    return
  }
  if (node.type === 'dir') {
    launch('nemo', { path })
    return
  }
  const app = appForFile(path)
  if (!app) {
    notify('Files', `There is no application installed for “${baseName(path)}”.\nTry the Software Manager.`)
    return
  }
  launch(app, { path })
}

export function openUrl(url: string) {
  launch('browser', { url })
}

export function openTerminal(cwd = '/home/mixt') {
  launch('terminal', { cwd })
}

export function appMeta(appId: string) {
  return getApp(appId)
}
