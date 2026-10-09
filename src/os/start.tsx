/* The real entry point of the OS: housekeeping, then the desktop, wrapped so
 * that nothing can leave the user in front of a white page.
 *
 * main.tsx is a two-line file that calls startDesktop(); keeping the boot
 * sequence in its own module means `npm run diagnose` can boot exactly what
 * the browser boots, under browsers that behave badly (blocked storage, a full
 * disk, a damaged saved filesystem, a tiny window).
 */
import './migrate' // must run before the stores read storage (idempotent)
import '../index.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import Desktop from '../shell/Desktop'
import { bootstrap } from './bootstrap'
import { BootBoundary, renderPlainFailure } from './errorboundary'

/* Last resort, installed before anything can fail: if a script error escapes
 * React entirely and the page is still empty, put a readable report on screen
 * instead of leaving a white page. Errors raised while the desktop is running
 * normally (a missing wallpaper, a failed drag) are left to the console. */
function reportIfBlank(event: ErrorEvent | PromiseRejectionEvent) {
  try {
    const root = document.getElementById('root')
    if (root && root.childElementCount > 0) return
    const error = 'error' in event ? event.error ?? event.message : event.reason
    console.error('[mixt] boot failure:', error)
    renderPlainFailure(error)
  } catch {
    /* nothing sensible left to do */
  }
}

export function startDesktop(target?: HTMLElement | null) {
  try {
    window.addEventListener('error', reportIfBlank)
    window.addEventListener('unhandledrejection', reportIfBlank as EventListener)
  } catch {
    /* no window to listen to */
  }

  // Session housekeeping (theme, home directories, welcome notifications) must
  // never be able to stop the desktop from mounting: a browser that blocks
  // storage, a full disk or a damaged saved filesystem used to throw here and
  // leave a white page with no explanation.
  try {
    bootstrap()
  } catch (error) {
    console.error('[mixt] boot housekeeping failed; starting the desktop anyway:', error)
  }

  let container = target ?? document.getElementById('root')
  if (!container) {
    container = document.createElement('div')
    container.id = 'root'
    document.body.appendChild(container)
  }

  return ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <BootBoundary>
        <Desktop />
      </BootBoundary>
    </React.StrictMode>,
  )
}
