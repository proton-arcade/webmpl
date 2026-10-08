/* Smoke test bundle — built with `vite build --ssr` and executed inside jsdom
   by scripts/smoke.mjs. It mounts the real desktop and renders every
   application and every MintNet page, so a broken import or a bad hook shows
   up as a test failure instead of a blank screen. */
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import Desktop from '../shell/Desktop'
import { APPS } from '../apps/registry'
import {
  SITES,
  SERVERS,
  REJECTED,
  addressOf,
  resolveHost,
  reverseLookup,
  resolveUrl,
  renderDig,
  renderHost,
  renderNslookup,
  searchMintNet,
  fetchAsText,
  buildIndex,
  readHosts,
  addHostEntry,
  removeHostEntry,
  readResolvConf,
  serverAddress,
  zoneRecords,
} from '../net'
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

  /* ------------------------------- DNS ------------------------------- */

  await check('every server file loads', () => {
    assert(REJECTED.length === 0, `rejected server files: ${REJECTED.map((r) => `${r.file} (${r.reason})`).join(', ')}`)
    assert(SERVERS.length >= 13, `only ${SERVERS.length} machines registered`)
    const ids = SERVERS.map((s) => s.id)
    assert(new Set(ids).size === ids.length, 'two machines share an id')
  })

  await check('names resolve to addresses in the MintNet block', () => {
    for (const name of ['mintnet.com', 'mintpedia.org', 'mintnews.com', 'mintmail.com', 'pastemint.com', 'example.mintnet']) {
      const answer = resolveHost(name)
      assert(answer.status === 'NOERROR', `${name} did not resolve (${answer.status})`)
      const a = answer.answers.find((r) => r.type === 'A')
      assert(a, `${name} has no A record`)
      const [first, second] = a!.value.split('.').map(Number)
      assert(first === 10 && second >= 64 && second <= 127, `${name} resolved outside the block: ${a!.value}`)
    }
  })

  await check('aliases and wildcards are CNAMEs', () => {
    const www = resolveHost('www.mintpedia.org')
    assert(www.status === 'NOERROR', 'www.mintpedia.org did not resolve')
    assert(www.cname === 'mintpedia.org', `www CNAME points at ${www.cname}`)
    const sub = resolveHost('en.mintpedia.org')
    assert(sub.status === 'NOERROR', 'the wildcard zone did not answer for en.mintpedia.org')
    assert(sub.server?.id === 'pedia-web-02', 'wildcard resolved to the wrong machine')
    const search = resolveHost('search.mintnet.com')
    assert(search.site?.domain === 'mintnet.com', 'the search alias should land on the portal')
  })

  await check('unknown names are NXDOMAIN, and the browser explains why', () => {
    assert(resolveHost('nope.mintnet').status === 'NXDOMAIN', 'a fake name resolved')
    assert(resolveHost('mintpedia.org.invalid-tld').status === 'NXDOMAIN', 'an absurd name resolved')
    const resolved = resolveUrl('https://nope.mintnet/')
    assert(resolved.kind === 'notfound', `nope.mintnet should be notfound, got ${resolved.kind}`)
    assert(!!resolved.notFoundReason, 'no explanation attached to the failure')
    assert(resolveUrl('example.com').kind === 'real', 'real-world domains should still be honest')
  })

  await check('reverse lookup and by-address navigation', () => {
    const ip = addressOf('mintnews.com')!
    assert(reverseLookup(ip) === 'mintnews.com', `PTR for ${ip} said ${reverseLookup(ip)}`)
    const byIp = resolveHost(ip)
    assert(byIp.status === 'NOERROR' && byIp.site?.domain === 'mintnews.com', 'navigating by address did not find the site')
    const resolved = resolveUrl(`https://${ip}/`)
    assert(resolved.kind === 'site' && resolved.domain === 'mintnews.com', 'the browser cannot open addresses by IP')
  })

  await check('/etc/hosts overrides the zone', () => {
    const before = readHosts().get('smoke.local')
    assert(!before, 'the test name already existed')
    addHostEntry('smoke.local', '10.9.9.9')
    const answer = resolveHost('smoke.local', { hosts: readHosts() })
    assert(answer.status === 'NOERROR', 'a name from /etc/hosts did not resolve')
    assert(answer.source === 'hosts', `resolution source was ${answer.source}`)
    assert(answer.answers[0].value === '10.9.9.9', 'the hosts file address was ignored')
    removeHostEntry('smoke.local')
    assert(resolveHost('smoke.local', { hosts: readHosts() }).status === 'NXDOMAIN', 'removing the entry had no effect')
  })

  await check('resolver configuration is real and complete', () => {
    const resolv = readResolvConf()
    assert(resolv.nameservers.includes('10.0.0.53'), 'resolv.conf has no MintNet nameserver')
    assert(resolv.search.includes('mintnet'), 'resolv.conf has no search domain')
    assert(vfs.read('/etc/hosts')?.includes('localhost'), '/etc/hosts is missing')
    assert(zoneRecords().length > 20, `only ${zoneRecords().length} records in the zone`)
  })

  await check('dig/host/nslookup render like the real tools', () => {
    const dig = renderDig(resolveHost('mintpedia.org'))
    assert(dig.includes('status: NOERROR'), 'dig did not report NOERROR')
    assert(/10\.\d+\.\d+\.\d+/.test(dig), 'dig printed no address')
    assert(dig.includes('ns1.mintnet.com'), 'dig printed no authority')
    const nx = renderDig(resolveHost('nope.mintnet'))
    assert(nx.includes('status: NXDOMAIN'), 'dig did not report NXDOMAIN')
    assert(renderHost(resolveHost('mintube.com')).includes('has address'), 'host printed nothing useful')
    assert(renderNslookup(resolveHost('mintnet.com')).includes('Non-authoritative answer'), 'nslookup output is wrong')
  })

  await check('server addresses are unique and stable', () => {
    const seen = new Map<string, string>()
    for (const server of SERVERS) {
      const ip = serverAddress(server)
      assert(!seen.has(ip), `${server.id} and ${seen.get(ip)} share the address ${ip}`)
      seen.set(ip, server.id)
      assert(serverAddress(server) === ip, `${server.id} changed address between calls`)
      for (const host of server.hosts) {
        assert(addressOf(host) === ip, `${host} resolved to ${addressOf(host)} instead of ${ip}`)
      }
    }
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
    await runTerminal(term.host, 'dig mintpedia.org')
    const afterDig = term.text()
    assert(afterDig.includes('status: NOERROR'), 'dig did not resolve mintpedia.org')
    assert(/10\.\d+\.\d+\.\d+/.test(afterDig), 'dig printed no address')
    await runTerminal(term.host, 'dig nope.mintnet')
    assert(term.text().includes('NXDOMAIN'), 'dig did not report NXDOMAIN for an unknown name')
    await runTerminal(term.host, 'nslookup mintnews.com')
    assert(term.text().includes('Non-authoritative answer'), 'nslookup printed nothing')
    await runTerminal(term.host, 'host mintcart.com')
    assert(term.text().includes('has address'), 'host printed nothing')
    await runTerminal(term.host, 'getent hosts ns1.mintnet.com')
    assert(term.text().includes('10.0.0.53'), 'getent did not read /etc/hosts')
    await runTerminal(term.host, 'nmap mintcart.com')
    const afterNmap = term.text()
    assert(afterNmap.includes('PORT'), 'nmap printed no port table')
    assert(afterNmap.includes('https'), 'nmap lost the https port')
    await runTerminal(term.host, 'ping mintube.com')
    assert(term.text().includes('0% packet loss'), 'ping failed on a resolvable name')
    await runTerminal(term.host, 'ping nope.mintnet')
    assert(term.text().includes('Name or service not known'), 'ping should fail on NXDOMAIN')
    await runTerminal(term.host, 'cat /etc/resolv.conf')
    assert(term.text().includes('10.0.0.53'), 'resolv.conf is not readable from the shell')
    await runTerminal(term.host, 'curl https://pastemint.com/')
    await new Promise((r) => setTimeout(r, 260))
    assert(term.text().includes('hello1'), 'curl could not list the dropped-in server')
    await runTerminal(term.host, 'curl https://pastemint.com/raw/hello1')
    await new Promise((r) => setTimeout(r, 260))
    assert(term.text().includes('Paste anything here'), 'curl could not read a raw paste')
    await runTerminal(term.host, 'curl https://pastemint.com/raw/nothing-here')
    await new Promise((r) => setTimeout(r, 260))
    assert(term.text().includes('404: no paste'), 'the pastebin 404 is missing')
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

  await check('browser shows the MintNet registry', async () => {
    const browser = await mountApp('browser', { url: 'about:dns' })
    await new Promise((r) => setTimeout(r, 800))
    const text = browser.text()
    assert(text.includes('MintNet Registry'), 'about:dns did not render')
    assert(text.includes('pedia-web-02'), 'the registry lists no machines')
    assert(text.includes('pastemint.com'), 'the registry does not show dropped-in servers')
    browser.unmount()
  })

  await check('browser renders the DNS failure page', async () => {
    const browser = await mountApp('browser', { url: 'https://nope.mintnet/' })
    await new Promise((r) => setTimeout(r, 800))
    const text = browser.text()
    assert(text.includes('Server not found'), `no DNS error page (saw: ${text.slice(0, 120)})`)
    assert(text.includes('NXDOMAIN'), 'the error page does not show the resolver answer')
    browser.unmount()
  })

  await check('browser resolves a subdomain of a wildcard zone', async () => {
    const browser = await mountApp('browser', { url: 'https://en.mintpedia.org/' })
    await new Promise((r) => setTimeout(r, 900))
    assert(browser.text().includes('MintPedia'), 'the wildcard host did not load the encyclopaedia')
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
