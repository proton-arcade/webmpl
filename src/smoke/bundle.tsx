/* Smoke test bundle — built with `vite build --ssr` and executed inside jsdom
   by scripts/smoke.mjs. It mounts the real desktop and renders every
   application and every MintNet page, so a broken import or a bad hook shows
   up as a test failure instead of a blank screen. */
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import Desktop from '../shell/Desktop'
import { APPS } from '../apps/registry'
import { SITES, resolveUrl, searchMintNet, fetchAsText, buildIndex } from '../net'
import { useOS } from '../os/store'
import { vfs, useVFS } from '../os/vfs'
import type { PageCtx } from '../net/types'
import type { WinState } from '../os/types'

interface Result {
  name: string
  ok: boolean
  detail?: string
}

const results: Result[] = []
function check(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn()
      results.push({ name, ok: true })
    } catch (e: any) {
      results.push({ name, ok: false, detail: e?.stack ?? String(e) })
    }
  })()
}

function assert(cond: any, message: string) {
  if (!cond) throw new Error(message)
}

const ctx: PageCtx = {
  path: '/',
  query: '',
  url: 'https://example.mintnet/',
  tabId: 'smoke',
  navigate: () => {},
  openTab: () => {},
}


/* ------------------------ interactive component tests ---------------------- */
function nativeSetValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(el)
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new window.Event('input', { bubbles: true }))
}

async function mountApp(appId: string, props: Record<string, any> = {}) {
  const app = APPS.find((a) => a.id === appId)!
  const host = document.createElement('div')
  document.body.appendChild(host)
  const win: WinState = {
    id: `smoke-${appId}-${Math.random().toString(36).slice(2, 6)}`,
    appId,
    title: app.name,
    x: 0, y: 0, w: 1000, h: 700, z: 1,
    minimized: false, maximized: false, workspace: 0,
    props, createdAt: Date.now(),
  }
  let title = app.name
  const node = createRoot(host)
  const api = {
    setTitle: (t: string) => { title = t },
    setProps: () => {},
    close: () => {},
    openApp: () => null,
    notify: () => {},
  }
  node.render(React.createElement(app.component, { win: { ...win, props }, api }))
  await new Promise((r) => setTimeout(r, 220))
  return {
    host,
    text: () => host.textContent ?? '',
    unmount: () => { node.unmount(); host.remove() },
    title: () => title,
  }
}

async function runTerminal(host: HTMLElement, text: string) {
  const input = host.querySelector('input') as HTMLInputElement
  assert(input, 'terminal input missing')
  nativeSetValue(input, text)
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  await new Promise((r) => setTimeout(r, 260))
}

export async function runSmoke() {
  const container = document.createElement('div')
  container.id = 'root'
  document.body.appendChild(container)
  let root: Root | null = null

  await check('desktop mounts', () => {
    root = createRoot(container)
    root.render(React.createElement(Desktop))
  })
  await new Promise((r) => setTimeout(r, 300))

  await check('panel and desktop render', () => {
    assert(document.querySelector('.panel'), 'no .panel element found')
    assert(document.body.textContent?.includes('Mint Web OS') || document.body.textContent?.length > 50, 'desktop looks empty')
  })

  await check('main menu opens', () => {
    const button = document.querySelector('.menu-button') as HTMLElement
    assert(button, 'menu button missing')
    button.click()
  })
  await new Promise((r) => setTimeout(r, 120))
  await check('menu lists applications', () => {
    const text = document.body.textContent ?? ''
    for (const name of ['Files', 'Terminal', 'Web Browser', 'Software Manager', 'Help']) {
      assert(text.includes(name), `menu is missing ${name}`)
    }
  })

  await check('filesystem seeds and reads/writes', () => {
    assert(vfs.exists('/home/mint/Documents/welcome.md'), 'welcome.md missing')
    vfs.write('/home/mint/Documents/smoke.txt', 'hello from the smoke test')
    assert(vfs.read('/home/mint/Documents/smoke.txt') === 'hello from the smoke test', 'write/read mismatch')
    assert(Array.isArray(vfs.list('/home/mint')), 'listing home failed')
    vfs.mkdir('/home/mint/smoke-dir')
    assert(vfs.node('/home/mint/smoke-dir')?.type === 'dir', 'mkdir failed')
    vfs.trash('/home/mint/Documents/smoke.txt')
    assert(!vfs.exists('/home/mint/Documents/smoke.txt'), 'trash did not remove the file')
    vfs.rm('/home/mint/smoke-dir')
  })

  await check('url resolution', () => {
    assert(resolveUrl('mintnews.com').kind === 'site', 'mintnews.com should resolve to a site')
    assert(resolveUrl('https://mintpedia.org/article/linux-mint').path === '/article/linux-mint', 'path parsing failed')
    assert(resolveUrl('how do browsers work').kind === 'search', 'plain words should search')
    assert(resolveUrl('about:blank').kind === 'about', 'about: pages should resolve')
    assert(resolveUrl('example.com').kind === 'real', 'a foreign domain should be treated as the real web')
  })

  await check('search index finds articles', () => {
    const index = buildIndex()
    assert(index.length > 30, `index too small: ${index.length}`)
    const hits = searchMintNet('cinnamon desktop')
    assert(hits.length > 0, 'no results for "cinnamon desktop"')
    const linux = searchMintNet('linux mint')
    assert(linux.some((h) => h.url.includes('linux-mint')), 'expected the Linux Mint article in the results')
  })

  await check('plain-text rendering works for the terminal', async () => {
    const text = await fetchAsText('https://mintpedia.org/article/linux-mint')
    assert(text.includes('Linux Mint'), 'curl text output looks wrong')
    const news = await fetchAsText('https://mintnews.com/')
    assert(news.length > 100, 'news text output too short')
  })

  /* every registered application renders without throwing */
  for (const app of APPS) {
    await check(`app renders: ${app.id}`, () => {
      const win: WinState = {
        id: `smoke-${app.id}`,
        appId: app.id,
        title: app.name,
        x: 0,
        y: 0,
        w: 900,
        h: 600,
        z: 1,
        minimized: false,
        maximized: false,
        workspace: 0,
        props: app.id === 'xed' ? { path: '/home/mint/Documents/welcome.md' } : {},
        createdAt: Date.now(),
      }
      const api = {
        setTitle: () => {},
        setProps: () => {},
        close: () => {},
        openApp: () => null,
        notify: () => {},
      }
      const html = renderToString(React.createElement(app.component, { win, api }))
      assert(html.length > 40, `${app.id} rendered almost nothing`)
    })
  }

  /* every MintNet page renders */
  for (const site of SITES) {
    for (const page of site.pages) {
      await check(`site page renders: ${site.domain}${page.path}`, () => {
        const samplePath =
          page.path.replace(/\/$/, '') ||
          '/'
        const html = renderToString(
          React.createElement(React.Fragment, null, page.render({ ...ctx, path: samplePath }) ),
        )
        assert(html.length > 80, `page rendered ${html.length} characters`)
      })
    }
  }

  /* the window manager really opens windows */

  await check('terminal runs real commands', async () => {
    const term = await mountApp('terminal')
    await runTerminal(term.host, 'echo hello-from-the-smoke-test')
    assert(term.text().includes('hello-from-the-smoke-test'), 'echo produced no output')
    await runTerminal(term.host, 'pwd')
    assert(term.text().includes('/home/mint'), 'pwd output missing')
    await runTerminal(term.host, 'mkdir smoke-terminal-dir')
    await runTerminal(term.host, 'ls')
    assert(term.text().includes('smoke-terminal-dir'), 'ls did not show the new directory')
    await runTerminal(term.host, 'echo write-me > ~/Documents/terminal-write.txt && cat ~/Documents/terminal-write.txt')
    await new Promise((r) => setTimeout(r, 200))
    assert(vfs.read('/home/mint/Documents/terminal-write.txt')?.includes('write-me'), 'redirection did not write the file')
    await runTerminal(term.host, 'neofetch')
    assert(term.text().includes('Mint Web OS'), 'neofetch output missing OS line')
    await runTerminal(term.host, 'apt search game')
    assert(term.text().includes('2048'), 'apt search did not find the game')
    await runTerminal(term.host, 'curl https://mintpedia.org/article/linux-mint')
    await new Promise((r) => setTimeout(r, 300))
    assert(term.text().includes('Linux Mint'), 'curl did not render the MintNet page as text')
    await runTerminal(term.host, 'wallpaper 2')
    assert(useOS.getState().settings.wallpaper.includes('mint-facets'), 'wallpaper command did not change the background')
    await runTerminal(term.host, 'ls | wc -l')
    assert(term.title().includes('@'), 'terminal title is not the prompt')
    vfs.rm('/home/mint/smoke-terminal-dir')
    vfs.rm('/home/mint/Documents/terminal-write.txt')
    term.unmount()
  })

  await check('files app lists and navigates', async () => {
    const files = await mountApp('nemo', { path: '/home/mint' })
    assert(files.text().includes('Documents'), 'home listing is missing Documents')
    assert(files.text().includes('Downloads'), 'home listing is missing Downloads')
    assert(files.title().includes('mint') || files.title().includes('home'), 'files window title looks wrong')
    files.unmount()
  })

  await check('browser renders a MintNet site and follows links', async () => {
    const browser = await mountApp('browser', { url: 'https://mintnews.com/' })
    await new Promise((r) => setTimeout(r, 700))
    const text = browser.text()
    assert(text.includes('Cinnamon 6.4'), `front page did not render (saw: ${text.slice(0, 120)})`)
    assert(text.includes('MintNews'), 'site chrome missing')
    browser.unmount()
  })

  await check('browser search page works', async () => {
    const browser = await mountApp('browser', { url: 'mintnet://search?q=virtual+file+system' })
    await new Promise((r) => setTimeout(r, 700))
    assert(browser.text().includes('Virtual file system'), 'search results did not include the encyclopaedia article')
    browser.unmount()
  })

  await check('browser refuses to render unknown pages gracefully', async () => {
    const browser = await mountApp('browser', { url: 'https://mintpedia.org/article/not-a-real-slug' })
    await new Promise((r) => setTimeout(r, 800))
    assert(browser.text().includes('404') || browser.text().includes('could not find'), 'missing 404 page')
    browser.unmount()
  })

  await check('desktop opens and manages windows', async () => {
    const os = useOS.getState()
    const id = os.openApp('terminal', {}, { title: 'Terminal' })!
    assert(id, 'openApp returned no id')
    assert(useOS.getState().windows.length === 1, 'window was not added')
    os.minimize(id)
    assert(useOS.getState().windows[0].minimized === true, 'minimise failed')
    os.unminimize(id)
    assert(useOS.getState().windows[0].minimized === false, 'restore failed')
    os.toggleMaximize(id)
    assert(useOS.getState().windows[0].maximized === true, 'maximise failed')
    os.snap(id, 'left')
    assert(useOS.getState().windows[0].w === Math.round(window.innerWidth / 2), 'snap left failed')
    os.sendToWorkspace(id, 2)
    assert(useOS.getState().windows[0].workspace === 2, 'workspace move failed')
    os.closeWindow(id)
    assert(useOS.getState().windows.length === 0, 'window did not close')
  })

  await check('settings persist', () => {
    const os = useOS.getState()
    os.setSettings({ scheme: 'dark', accent: '#4aa8a0' })
    assert(document.documentElement.dataset.scheme === 'dark', 'theme was not applied to the document')
    os.setSettings({ scheme: 'light', accent: '#9ede6a' })
  })

  await check('apps install from the software store', () => {
    const os = useOS.getState()
    os.setInstalled('paint', true)
    assert(useOS.getState().installed.paint === true, 'install state not stored')
    os.setInstalled('paint', false)
  })

  await check('notifications arrive', () => {
    useOS.getState().notify({ title: 'Smoke test', body: 'A notification from the test harness.' })
    assert(useOS.getState().notifications.length === 1, 'notification was not registered')
    useOS.getState().clearNotifications()
  })

  await new Promise((r) => setTimeout(r, 700))
  await check('filesystem persists to localStorage', () => {
    const raw = localStorage.getItem('webmpl.vfs.v2')
    assert(raw && raw.length > 100, 'vfs was never written to localStorage')
  })

  await check('desktop unmounts cleanly', () => {
    root?.unmount()
    container.remove()
  })

  const failed = results.filter((r) => !r.ok)
  return { results, failed }
}
