/* Smoke test bundle — built with `vite build --ssr` and executed inside jsdom
   by scripts/smoke.mjs. It mounts the real desktop and renders every
   application and every MixtNet page, so a broken import or a bad hook shows
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
  searchMixtNet,
  fetchAsText,
  buildIndex,
  registerServers,
  findSite,
  readHosts,
  addHostEntry,
  removeHostEntry,
  readResolvConf,
  serverAddress,
  zoneRecords,
} from '../net'
import { useOS, sanitizeSettings, DEFAULT_SETTINGS } from '../os/store'
import { vfs, useVFS, parseTree, ensureWebShare } from '../os/vfs'
import { migrateBranding } from '../os/migrate'
import { bootstrap } from '../os/bootstrap'
import { safeLocal, safeSession, clearSavedData } from '../os/storage'
import { appForFile, mediaPlayer } from '../os/bus'
import { BootBoundary, renderPlainFailure } from '../os/errorboundary'
import type { PageCtx } from '../net/types'
import type { ServerDef } from '../net/internet/types'
import type { WinState } from '../os/types'
import { INSTALLED_VERSION, REPO_VERSIONS, hasUpdate, installedVersion, repoVersion, versionLabel } from '../apps/versions'

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
  url: 'https://example.mixtnet/',
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
    assert(document.body.textContent?.includes('Mixt Web OS') || document.body.textContent?.length > 50, 'desktop looks empty')
  })

  await check('main menu opens', () => {
    const button = document.querySelector('.menu-button') as HTMLElement
    assert(button, 'menu button missing')
    button.click()
  })
  await new Promise((r) => setTimeout(r, 120))
  await check('menu lists applications', () => {
    const text = document.body.textContent ?? ''
    for (const name of ['Files', 'Terminal', 'Mixtsfox', 'Software Manager', 'Help']) {
      assert(text.includes(name), `menu is missing ${name}`)
    }
  })

  await check('no previous branding survives anywhere', () => {
    const haystack = [
      document.body.textContent ?? '',
      APPS.map((a) => `${a.name} ${a.generic} ${a.comment} ${(a.keywords ?? []).join(' ')}`).join(' '),
      SITES.map((s) => `${s.title} ${s.domain} ${(s.aliases ?? []).join(' ')} ${s.description}`).join(' '),
      SERVERS.map((s) => `${s.id} ${s.hosts.join(' ')} ${s.os ?? ''} ${s.software ?? ''}`).join(' '),
      vfs.read('/etc/os-release') ?? '',
      vfs.read('/etc/hosts') ?? '',
      vfs.read('/etc/resolv.conf') ?? '',
      ...SITES.map((site) => (site.text ? site.text(site.defaultPath, '') : '')),
    ].join('\n')
    const found = haystack.match(/mint|webmpl/i)
    assert(!found, `old branding still rendered: "${found?.[0]}"`)
    assert(haystack.includes('Mixt'), 'the new name is not rendered anywhere')
  })

  await check('old browser state is migrated to the new name', () => {
    const vfsKey = 'mixt.vfs.v2'
    const savedVfs = localStorage.getItem(vfsKey)
    const savedSettings = localStorage.getItem('mixt.settings.v2')
    try {
      localStorage.removeItem('mixt.settings.v2')
      localStorage.setItem('webmpl.settings.v2', JSON.stringify({ accent: '#61ad2b' }))
      localStorage.setItem(
        'webmpl.vfs.v2',
        JSON.stringify({
          type: 'dir',
          name: '/',
          children: { home: { type: 'dir', name: 'home', children: { mint: { type: 'dir', name: 'mint', children: {} } } } },
        }),
      )
      migrateBranding()
      assert(localStorage.getItem('mixt.settings.v2')?.includes('61ad2b'), 'settings were not migrated')
      assert(localStorage.getItem('webmpl.settings.v2') === null, 'the old settings key was left behind')
      const tree = localStorage.getItem(vfsKey) ?? ''
      assert(tree.includes('"mixt"'), 'the home directory was not renamed')
      assert(!tree.includes('"mint"'), 'the old home directory name is still in the tree')
      assert(localStorage.getItem('webmpl.vfs.v2') === null, 'the old filesystem key was left behind')
    } finally {
      localStorage.removeItem('webmpl.settings.v2')
      localStorage.removeItem('webmpl.vfs.v2')
      if (savedSettings === null) localStorage.removeItem('mixt.settings.v2')
      else localStorage.setItem('mixt.settings.v2', savedSettings)
      if (savedVfs === null) localStorage.removeItem(vfsKey)
      else localStorage.setItem(vfsKey, savedVfs)
    }
  })

  await check('filesystem seeds and reads/writes', () => {
    assert(vfs.exists('/home/mixt/Documents/welcome.md'), 'welcome.md missing')
    vfs.write('/home/mixt/Documents/smoke.txt', 'hello from the smoke test')
    assert(vfs.read('/home/mixt/Documents/smoke.txt') === 'hello from the smoke test', 'write/read mismatch')
    assert(Array.isArray(vfs.list('/home/mixt')), 'listing home failed')
    vfs.mkdir('/home/mixt/smoke-dir')
    assert(vfs.node('/home/mixt/smoke-dir')?.type === 'dir', 'mkdir failed')
    vfs.trash('/home/mixt/Documents/smoke.txt')
    assert(!vfs.exists('/home/mixt/Documents/smoke.txt'), 'trash did not remove the file')
    vfs.rm('/home/mixt/smoke-dir')
  })

  await check('the hosted share and its manifest', () => {
    const manifest = vfs.read('/srv/www/mixt/index.js') ?? ''
    assert(manifest.length > 0, '/srv/www/mixt/index.js is missing')
    assert(/ALL_FILES/.test(manifest) && /ALL_DIRS/.test(manifest), 'the manifest does not list files and directories')
    /* every path the manifest names must really exist, or the site would serve
       a listing of files that are not there */
    const paths = [
      '/srv/www/mixt/audio/chime.ogg',
      '/srv/www/mixt/audio/notify.wav',
      '/srv/www/mixt/audio/startup.ogg',
      '/srv/www/mixt/text/welcome.txt',
      '/srv/www/mixt/text/readme.txt',
      '/srv/www/mixt/text/notes.txt',
      '/srv/www/mixt/images/banner.png',
      '/srv/www/mixt/images/leaf.svg',
      '/srv/www/mixt/video/intro.mp4',
    ]
    for (const p of paths) assert(vfs.exists(p), `the manifest names ${p} but it is not there`)
    for (const d of ['/srv/www/mixt/audio', '/srv/www/mixt/text', '/srv/www/mixt/images', '/srv/www/mixt/video'])
      assert(vfs.node(d)?.type === 'dir', `${d} is not a directory`)
    assert((vfs.read('/srv/www/mixt/text/welcome.txt') ?? '').includes('Mixt Web OS'), 'welcome.txt has no content')
    assert(vfs.exists('/srv/www/index.html'), 'the hosted site has no index.html')

    /* the record describing the hosted site is INI: a [Website] section, one
       key per line, and every key the format promises */
    const ini = vfs.read('/srv/www/website.ini') ?? ''
    assert(ini.startsWith('[Website]'), `the record does not open with a [Website] section:\n${ini}`)
    const keys: Record<string, string> = {}
    for (const line of ini.split('\n')) {
      const m = line.match(/^([A-Za-z]+)=(.*)$/)
      if (m) keys[m[1]] = m[2]
    }
    for (const k of ['URL', 'Server', 'Path', 'Description', 'keywords'])
      assert(k in keys, `the record is missing ${k}=`)
    assert(keys.Path === '/srv/www', `Path= says ${keys.Path}, not where the share is`)
    assert(!!keys.URL && !!keys.Server, 'the record names no URL or Server')
    assert(keys.keywords.split(',').length >= 2, 'keywords= should be a comma-separated list')

    /* a filesystem saved before the share existed must gain it on boot */
    vfs.rm('/srv')
    assert(!vfs.exists('/srv/www/mixt/index.js'), 'the share was not removed for the migration test')
    ensureWebShare()
    assert(vfs.exists('/srv/www/mixt/index.js'), 'ensureWebShare did not walk the share back in')
    assert(vfs.exists('/srv/www/website.ini'), 'ensureWebShare did not write the website record')
    assert(vfs.exists('/srv/www/mixt/text/welcome.txt'), 'the migration left the text files behind')
  })

  /* --- audio and video open a player that is actually installed --- */

  await check('media opens the player that ships, not an uninstalled extra', () => {
    const st = useOS.getState()
    st.setInstalled('mediaplayer', false) // VLC not installed
    st.setSettings({ mediaApp: 'mixtplayer' })
    assert(mediaPlayer() === 'mixtplayer', `wanted the built-in player, got ${mediaPlayer()}`)
    assert(appForFile('/srv/www/mixt/audio/chime.ogg') === 'mixtplayer', 'an audio file did not open the built-in player')
    assert(appForFile('/srv/www/mixt/video/intro.mp4') === 'mixtplayer', 'a video file did not open the built-in player')
    /* a stale choice must fall back rather than launch something absent */
    st.setSettings({ mediaApp: 'mediaplayer' })
    assert(mediaPlayer() === 'mixtplayer', 'a player that is not installed was still chosen')
    /* choosing an installed VLC is honoured */
    st.setInstalled('mediaplayer', true)
    assert(mediaPlayer() === 'mediaplayer', 'the installed VLC was not chosen')
    st.setSettings({ mediaApp: 'mixtplayer' })
  })

  await check('the player that ships is installed by default and renders', () => {
    const found = APPS.find((a) => a.id === 'mixtplayer')
    assert(!!found, 'Mixt Player is not in the registry')
    assert(found!.preinstalled !== false, 'Mixt Player must ship with the system')
    const Player = found!.component
    const out = renderToString(<Player win={{ id: 'w-mp', appId: 'mixtplayer', title: 'Mixt Player', props: {}, z: 1, minimized: false, maximized: false, x: 0, y: 0, w: 780, h: 520 } as any} api={{} as any} />)
    assert(/Mixt Player|Music/.test(out), 'the player did not render its library')
  })

  /* --- an archive can actually be unzipped --- */
  await check('an archive round-trips: compress writes it, extract unpacks it', async () => {
    const zip = '/home/mixt/Downloads/roundtrip.zip'
    const body = {
      kind: 'mixt-archive',
      version: 1,
      created: Date.now(),
      entries: [
        { path: 'notes/', type: 'dir', size: 0, modified: Date.now() },
        { path: 'notes/readme.txt', type: 'file', size: 24, modified: Date.now(), content: 'extracted correctly', mime: 'text/plain' },
        { path: 'top.txt', type: 'file', size: 9, modified: Date.now(), content: 'top level', mime: 'text/plain' },
      ],
    }
    vfs.mkdirp('/home/mixt/Downloads')
    vfs.write(zip, JSON.stringify(body), 'application/zip')

    /* Extracting opens the file manager on the result; remember what was open
       so this check does not leave windows behind for the next one. */
    const before = new Set(useOS.getState().windows.map((w) => w.id))
    const host = await mountApp('archive', { path: zip })
    assert(host.text().includes('readme.txt'), `the archive listing did not show its entries: ${host.text().slice(0, 200)}`)

    const btns = [...host.host.querySelectorAll('button')]
    const extractAll = btns.find((b) => (b.textContent ?? '').includes('Extract All'))
    assert(!!extractAll, 'there is no Extract All button')
    extractAll!.click()
    /* extraction now runs on a clock scaled to the payload, so give it room */
    await new Promise((r) => setTimeout(r, 1400))

    const made = (vfs.list('/home/mixt/Downloads') ?? []).map((e) => e.name).filter((n) => n !== 'roundtrip.zip')
    assert(made.length > 0, 'nothing was extracted next to the archive')
    const root = `/home/mixt/Downloads/${made[0]}`
    assert(vfs.exists(`${root}/notes/readme.txt`), `the tree was not preserved: ${JSON.stringify(made)}`)
    assert(vfs.read(`${root}/notes/readme.txt`) === 'extracted correctly', 'the extracted file lost its contents')
    assert(vfs.exists(`${root}/top.txt`), 'the top-level entry was not extracted')
    host.unmount()
    for (const w of useOS.getState().windows) if (!before.has(w.id)) useOS.getState().closeWindow(w.id)
    vfs.rm(zip)
    vfs.rm(root)
  })

  /* The reported bug: an archive this system did not create refused to open at
     all, so nothing could ever be unzipped from it. */
  await check('an archive with no manifest still lists and extracts', async () => {
    const foreign = '/home/mixt/Downloads/someone-elses.zip'
    vfs.mkdirp('/home/mixt/Downloads')
    vfs.write(foreign, 'PK\u0003\u0004 not a manifest, just bytes ' + 'x'.repeat(4000), 'application/zip')
    const before = new Set(useOS.getState().windows.map((w) => w.id))
    const host = await mountApp('archive', { path: foreign })
    assert(!/can’t be decoded|nothing is extracted/.test(host.text()), 'the archive was still refused')
    assert(/items/.test(host.text()), `no listing was shown: ${host.text().slice(0, 160)}`)
    const btn = [...host.host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Extract All'))
    assert(!!btn, 'there is no Extract All button')
    btn!.click()
    await new Promise((r) => setTimeout(r, 1600))
    const made = (vfs.list('/home/mixt/Downloads') ?? []).map((e) => e.name).filter((n) => n.includes('someone-elses') && n !== 'someone-elses.zip')
    assert(made.length > 0, 'a foreign archive extracted nothing')
    const inner = vfs.list(`/home/mixt/Downloads/${made[0]}`) ?? []
    assert(inner.length > 0, `the extracted folder is empty: ${made[0]}`)
    host.unmount()
    for (const w of useOS.getState().windows) if (!before.has(w.id)) useOS.getState().closeWindow(w.id)
    vfs.rm(foreign)
    vfs.rm(`/home/mixt/Downloads/${made[0]}`)
  })

  /* Bigger payloads must take longer, not both snap to done at once. */
  await check('a big archive takes longer to extract than a small one', async () => {
    const mk = (path: string, kb: number) => {
      const body = {
        kind: 'mixt-archive', version: 1, created: Date.now(),
        entries: [{ path: 'payload.bin', type: 'file', size: kb * 1024, modified: Date.now(), content: 'y'.repeat(64), mime: 'application/octet-stream' }],
      }
      vfs.write(path, JSON.stringify(body), 'application/zip')
    }
    const small = '/home/mixt/Downloads/small.zip'
    const big = '/home/mixt/Downloads/big.zip'
    vfs.mkdirp('/home/mixt/Downloads')
    mk(small, 1)
    mk(big, 900)
    const before = new Set(useOS.getState().windows.map((w) => w.id))

    /* The notification goes to the desktop, not into the app's own DOM, so the
       filesystem itself is the signal: has the extracted folder appeared yet? */
    const folderFor = (n: string) =>
      (vfs.list('/home/mixt/Downloads') ?? []).map((e) => e.name).find((x) => x === n || x.startsWith(`${n} (`))

    const a = await mountApp('archive', { path: small })
    ;[...a.host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Extract All'))!.click()
    await new Promise((r) => setTimeout(r, 1400))
    const smallFolder = folderFor('small')
    a.unmount()

    const b = await mountApp('archive', { path: big })
    ;[...b.host.querySelectorAll('button')].find((x) => (x.textContent ?? '').includes('Extract All'))!.click()
    /* at the moment the small one had landed, the big one must still be going */
    await new Promise((r) => setTimeout(r, 1400))
    const bigFolderEarly = folderFor('big')
    await new Promise((r) => setTimeout(r, 8000))
    const bigFolderLate = folderFor('big')
    b.unmount()

    assert(!!smallFolder, 'the small archive did not finish extracting')
    assert(!bigFolderEarly, 'the big archive finished at the same speed as the small one')
    assert(!!bigFolderLate, 'the big archive never finished')
    for (const w of useOS.getState().windows) if (!before.has(w.id)) useOS.getState().closeWindow(w.id)
    for (const f of [small, big]) vfs.rm(f)
    for (const e of vfs.list('/home/mixt/Downloads') ?? []) if (/^(small|big)( \(\d+\))?$/.test(e.name)) vfs.rm(`/home/mixt/Downloads/${e.name}`)
  })

  await check('url resolution', () => {
    assert(resolveUrl('mixtnews.com').kind === 'site', 'mixtnews.com should resolve to a site')
    assert(resolveUrl('https://mixtpedia.org/article/mixt-os').path === '/article/mixt-os', 'path parsing failed')
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

  await check('names resolve to addresses in the MixtNet block', () => {
    for (const name of ['mixtnet.com', 'mixtpedia.org', 'mixtnews.com', 'mixtmail.com', 'pastemixt.com', 'example.mixtnet']) {
      const answer = resolveHost(name)
      assert(answer.status === 'NOERROR', `${name} did not resolve (${answer.status})`)
      const a = answer.answers.find((r) => r.type === 'A')
      assert(a, `${name} has no A record`)
      const [first, second] = a!.value.split('.').map(Number)
      assert(first === 10 && second >= 64 && second <= 127, `${name} resolved outside the block: ${a!.value}`)
    }
  })

  await check('aliases and wildcards are CNAMEs', () => {
    const www = resolveHost('www.mixtpedia.org')
    assert(www.status === 'NOERROR', 'www.mixtpedia.org did not resolve')
    assert(www.cname === 'mixtpedia.org', `www CNAME points at ${www.cname}`)
    const sub = resolveHost('en.mixtpedia.org')
    assert(sub.status === 'NOERROR', 'the wildcard zone did not answer for en.mixtpedia.org')
    assert(sub.server?.id === 'pedia-web-02', 'wildcard resolved to the wrong machine')
    const search = resolveHost('search.mixtnet.com')
    assert(search.site?.domain === 'mixtnet.com', 'the search alias should land on the portal')
  })

  await check('unknown names are NXDOMAIN, and the browser explains why', () => {
    assert(resolveHost('nope.mixtnet').status === 'NXDOMAIN', 'a fake name resolved')
    assert(resolveHost('mixtpedia.org.invalid-tld').status === 'NXDOMAIN', 'an absurd name resolved')
    const resolved = resolveUrl('https://nope.mixtnet/')
    assert(resolved.kind === 'notfound', `nope.mixtnet should be notfound, got ${resolved.kind}`)
    assert(!!resolved.notFoundReason, 'no explanation attached to the failure')
    assert(resolveUrl('example.com').kind === 'real', 'real-world domains should still be honest')
  })

  await check('reverse lookup and by-address navigation', () => {
    const ip = addressOf('mixtnews.com')!
    assert(reverseLookup(ip) === 'mixtnews.com', `PTR for ${ip} said ${reverseLookup(ip)}`)
    const byIp = resolveHost(ip)
    assert(byIp.status === 'NOERROR' && byIp.site?.domain === 'mixtnews.com', 'navigating by address did not find the site')
    const resolved = resolveUrl(`https://${ip}/`)
    assert(resolved.kind === 'site' && resolved.domain === 'mixtnews.com', 'the browser cannot open addresses by IP')
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
    assert(resolv.nameservers.includes('10.0.0.53'), 'resolv.conf has no MixtNet nameserver')
    assert(resolv.search.includes('mixtnet'), 'resolv.conf has no search domain')
    assert(vfs.read('/etc/hosts')?.includes('localhost'), '/etc/hosts is missing')
    assert(zoneRecords().length > 20, `only ${zoneRecords().length} records in the zone`)
  })

  await check('dig/host/nslookup render like the real tools', () => {
    const dig = renderDig(resolveHost('mixtpedia.org'))
    assert(dig.includes('status: NOERROR'), 'dig did not report NOERROR')
    assert(/10\.\d+\.\d+\.\d+/.test(dig), 'dig printed no address')
    assert(dig.includes('ns1.mixtnet.com'), 'dig printed no authority')
    const nx = renderDig(resolveHost('nope.mixtnet'))
    assert(nx.includes('status: NXDOMAIN'), 'dig did not report NXDOMAIN')
    assert(renderHost(resolveHost('mixtube.com')).includes('has address'), 'host printed nothing useful')
    assert(renderNslookup(resolveHost('mixtnet.com')).includes('Non-authoritative answer'), 'nslookup output is wrong')
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

  /* A machine published at runtime — the low-level path a dropped-in file takes
     through manifest.ts. Search is built from the files discovered at load time
     (SITES), so a runtime registration shows up in DNS, the browser, curl and
     nmap, but the index is only refreshed for files on disk. */
  await check('a machine registered at runtime joins the zone, the browser and curl', async () => {
    // registerServers() rebuilds the whole zone from the list it is handed, the
    // way manifest.ts does when a file appears — so hand it everything, plus one
    // extra machine, exactly like a dropped-in server file would arrive.
    const dropIn: ServerDef = {
        id: 'smoke-dropin',
        hosts: ['dropin.smoketest'],
        operator: 'the smoke suite',
        ports: [{ port: 443, service: 'https', version: 'smoked/1.0' }],
        sites: [
          {
            domain: 'dropin.smoketest',
            title: 'Drop-in Test',
            glyph: 'Box',
            color: '#61ad2b',
            description: 'A machine that was published at runtime, the way a dropped-in file is.',
            tags: ['smoke'],
            defaultPath: '/',
            pages: [
              {
                path: '/',
                title: 'Drop-in Test — home',
                keywords: ['dropin', 'smoke'],
                snippet: 'The page of a runtime-registered machine.',
                render: () => 'drop-in page',
              },
            ],
            text: (path: string) => `drop-in ok ${path}`,
          },
        ],
    }
    registerServers([...SERVERS, dropIn])

    assert(
      resolveHost('mixtnews.com').status === 'NOERROR',
      'registering the dropped-in machine wiped the rest of the zone',
    )
    assert(resolveHost('dropin.smoketest').status === 'NOERROR', 'the dropped-in machine is not in the zone')

    const answer = resolveHost('dropin.smoketest')
    assert(answer.status === 'NOERROR', `dropin.smoketest is ${answer.status}`)
    assert(answer.server?.id === 'smoke-dropin', 'the dropped-in machine did not answer')
    assert(addressOf('dropin.smoketest'), 'the dropped-in machine has no address')

    const resolved = resolveUrl('https://dropin.smoketest/')
    assert(resolved.kind === 'site', `the browser resolved the drop-in as ${resolved.kind}`)
    assert(findSite('dropin.smoketest')?.title === 'Drop-in Test', 'findSite() missed the drop-in')

    assert((await fetchAsText('https://dropin.smoketest/')) === 'drop-in ok /', 'curl text is wrong')
  })

  await check('search index finds articles', () => {
    const index = buildIndex()
    assert(index.length > 30, `index too small: ${index.length}`)
    const hits = searchMixtNet('mixt-shell desktop')
    assert(hits.length > 0, 'no results for "mixt-shell desktop"')
    const mixtHits = searchMixtNet('mixt os')
    assert(mixtHits.some((h) => h.url.includes('mixt-os')), 'expected the Mixt OS article in the results')
  })

  await check('plain-text rendering works for the terminal', async () => {
    const text = await fetchAsText('https://mixtpedia.org/article/mixt-os')
    assert(text.includes('Mixt OS'), 'curl text output looks wrong')
    const news = await fetchAsText('https://mixtnews.com/')
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
        props: app.id === 'xed' ? { path: '/home/mixt/Documents/welcome.md' } : {},
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

  /* every MixtNet page renders */
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
    assert(term.text().includes('/home/mixt'), 'pwd output missing')
    await runTerminal(term.host, 'mkdir smoke-terminal-dir')
    await runTerminal(term.host, 'ls')
    assert(term.text().includes('smoke-terminal-dir'), 'ls did not show the new directory')
    await runTerminal(term.host, 'echo write-me > ~/Documents/terminal-write.txt && cat ~/Documents/terminal-write.txt')
    await new Promise((r) => setTimeout(r, 200))
    assert(vfs.read('/home/mixt/Documents/terminal-write.txt')?.includes('write-me'), 'redirection did not write the file')
    await runTerminal(term.host, 'neofetch')
    assert(term.text().includes('Mixt Web OS'), 'neofetch output missing OS line')
    await runTerminal(term.host, 'apt search paint')
    assert(term.text().includes('Drawing'), 'apt search did not find the drawing package')
    await runTerminal(term.host, 'curl https://mixtpedia.org/article/mixt-os')
    await new Promise((r) => setTimeout(r, 300))
    assert(term.text().includes('Mixt OS'), 'curl did not render the MixtNet page as text')
    await runTerminal(term.host, 'wallpaper 2')
    assert(useOS.getState().settings.wallpaper.includes('mixt-facets'), 'wallpaper command did not change the background')
    await runTerminal(term.host, 'ls | wc -l')
    await runTerminal(term.host, 'dig mixtpedia.org')
    const afterDig = term.text()
    assert(afterDig.includes('status: NOERROR'), 'dig did not resolve mixtpedia.org')
    assert(/10\.\d+\.\d+\.\d+/.test(afterDig), 'dig printed no address')
    await runTerminal(term.host, 'dig nope.mixtnet')
    assert(term.text().includes('NXDOMAIN'), 'dig did not report NXDOMAIN for an unknown name')
    await runTerminal(term.host, 'nslookup mixtnews.com')
    assert(term.text().includes('Non-authoritative answer'), 'nslookup printed nothing')
    await runTerminal(term.host, 'host mixtcart.com')
    assert(term.text().includes('has address'), 'host printed nothing')
    await runTerminal(term.host, 'getent hosts ns1.mixtnet.com')
    assert(term.text().includes('10.0.0.53'), 'getent did not read /etc/hosts')
    await runTerminal(term.host, 'nmap mixtcart.com')
    const afterNmap = term.text()
    assert(afterNmap.includes('PORT'), 'nmap printed no port table')
    assert(afterNmap.includes('https'), 'nmap lost the https port')
    await runTerminal(term.host, 'ping mixtube.com')
    assert(term.text().includes('0% packet loss'), 'ping failed on a resolvable name')
    await runTerminal(term.host, 'ping nope.mixtnet')
    assert(term.text().includes('Name or service not known'), 'ping should fail on NXDOMAIN')
    await runTerminal(term.host, 'cat /etc/resolv.conf')
    assert(term.text().includes('10.0.0.53'), 'resolv.conf is not readable from the shell')
    await runTerminal(term.host, 'curl https://pastemixt.com/')
    await new Promise((r) => setTimeout(r, 260))
    assert(term.text().includes('hello1'), 'curl could not list the dropped-in server')
    await runTerminal(term.host, 'curl https://pastemixt.com/raw/hello1')
    await new Promise((r) => setTimeout(r, 260))
    assert(term.text().includes('Paste anything here'), 'curl could not read a raw paste')
    await runTerminal(term.host, 'curl https://pastemixt.com/raw/nothing-here')
    await new Promise((r) => setTimeout(r, 260))
    assert(term.text().includes('404: no paste'), 'the pastebin 404 is missing')
    assert(term.title().includes('@'), 'terminal title is not the prompt')
    vfs.rm('/home/mixt/smoke-terminal-dir')
    vfs.rm('/home/mixt/Documents/terminal-write.txt')
    term.unmount()
  })

  await check('files app lists and navigates', async () => {
    const files = await mountApp('nemo', { path: '/home/mixt' })
    assert(files.text().includes('Documents'), 'home listing is missing Documents')
    assert(files.text().includes('Downloads'), 'home listing is missing Downloads')
    assert(files.title().includes('mixt') || files.title().includes('home'), 'files window title looks wrong')
    files.unmount()
  })

  await check('browser renders a MixtNet site and follows links', async () => {
    const browser = await mountApp('browser', { url: 'https://mixtnews.com/' })
    await new Promise((r) => setTimeout(r, 700))
    const text = browser.text()
    assert(text.includes('Mixt Shell 6.4'), `front page did not render (saw: ${text.slice(0, 120)})`)
    assert(text.includes('MixtNews'), 'site frame missing')
    browser.unmount()
  })

  await check('browser shows the MixtNet registry', async () => {
    const browser = await mountApp('browser', { url: 'about:dns' })
    await new Promise((r) => setTimeout(r, 800))
    const text = browser.text()
    assert(text.includes('MixtNet Registry'), 'about:dns did not render')
    assert(text.includes('pedia-web-02'), 'the registry lists no machines')
    assert(text.includes('pastemixt.com'), 'the registry does not show dropped-in servers')
    browser.unmount()
  })

  await check('browser renders the DNS failure page', async () => {
    const browser = await mountApp('browser', { url: 'https://nope.mixtnet/' })
    await new Promise((r) => setTimeout(r, 800))
    const text = browser.text()
    assert(text.includes('Server not found'), `no DNS error page (saw: ${text.slice(0, 120)})`)
    assert(text.includes('NXDOMAIN'), 'the error page does not show the resolver answer')
    browser.unmount()
  })

  await check('browser resolves a subdomain of a wildcard zone', async () => {
    const browser = await mountApp('browser', { url: 'https://en.mixtpedia.org/' })
    await new Promise((r) => setTimeout(r, 900))
    assert(
      resolveHost('en.mixtpedia.org').status === 'NOERROR',
      'the wildcard host stopped resolving',
    )
    assert(
      browser.text().includes('MixtPedia'),
      `the wildcard host did not load the encyclopaedia (saw: ${browser.text().slice(0, 200)})`,
    )
    browser.unmount()
  })

  await check('browser search page works', async () => {
    const browser = await mountApp('browser', { url: 'mixtnet://search?q=virtual+file+system' })
    await new Promise((r) => setTimeout(r, 700))
    assert(browser.text().includes('Virtual file system'), 'search results did not include the encyclopaedia article')
    browser.unmount()
  })

  await check('browser refuses to render unknown pages gracefully', async () => {
    const browser = await mountApp('browser', { url: 'https://mixtpedia.org/article/not-a-real-slug' })
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
    const raw = localStorage.getItem('mixt.vfs.v2')
    assert(raw && raw.length > 100, 'vfs was never written to localStorage')
  })

  /* ---- the white-screen regressions: a desktop that never mounts ---------- *
   * Each of these used to throw before React's first render, which leaves a
   * blank page with no message and no way out until the browser is cleared.  */

  await check('a damaged saved filesystem cannot stop the boot', () => {
    // a directory with no children map (older build, interrupted write)
    const damaged = parseTree(
      JSON.stringify({ type: 'dir', children: { home: { type: 'dir', name: 'home', children: { mixt: { type: 'dir' } } } } }),
    )
    assert(damaged.type === 'dir', 'the root should always be a directory')
    const home = damaged.children.home as any
    assert(home?.type === 'dir' && typeof home.children?.mixt?.children === 'object', 'a children-less directory was not repaired')

    // rubbish in storage falls back to the seed filesystem rather than nothing
    assert(vfs.list('/home/mixt/Desktop') !== undefined, 'listing should never throw')
    const seeded = parseTree('{ this is not json')
    assert(seeded.type === 'dir' && !!(seeded.children.home as any)?.children?.mixt, 'a corrupt blob should reseed the filesystem')

    // and the tree itself is defensive even if something bypasses parseTree
    const broken: any = { type: 'dir', children: { home: { type: 'dir', children: { mixt: { type: 'dir' } } } }, created: 0, modified: 0 }
    useVFS.setState({ root: broken })
    assert(vfs.list('/home/mixt/Desktop') === null, 'a damaged tree should read as "not there"')
    assert(vfs.node('/home/mixt/Desktop/nope.txt') === null, 'walking a damaged tree must not throw')
    assert(vfs.mkdir('/home/mixt/Desktop') === true, 'writing should repair the damaged directory')
    assert(vfs.exists('/home/mixt/Desktop') === true, 'the repaired directory should exist')
    vfs.reset()
    assert(vfs.exists('/home/mixt/Documents/welcome.md'), 'reset should restore the seed filesystem')
  })

  await check('settings from an older build are repaired, not trusted', () => {
    const repaired = sanitizeSettings({
      wallpaper: null,
      desktopIcons: null,
      startupApps: null,
      panelSize: 'huge',
      panelPosition: 'sideways',
      accent: 'not-a-colour',
      scheme: 'neon',
      volume: 900,
      username: '',
      clock24: 'yes',
    })
    assert(typeof repaired.wallpaper === 'string' && repaired.wallpaper.length > 0, 'wallpaper must stay a string')
    assert(Array.isArray(repaired.desktopIcons) && Array.isArray(repaired.startupApps), 'icon lists must stay arrays')
    assert(repaired.panelSize >= 24 && repaired.panelSize <= 96, 'panel size must stay usable')
    assert(!repaired.panelPosition || repaired.panelPosition === 'bottom' || repaired.panelPosition === 'top', 'bad panel position survived')
    assert(repaired.accent.startsWith('#'), 'accent must stay a colour')
    assert(repaired.scheme === 'light' || repaired.scheme === 'dark', 'scheme must stay light or dark')
    assert(repaired.volume <= 100, 'volume must stay in range')
    assert(repaired.username.length > 0, 'an empty username should fall back to the default')
    assert(sanitizeSettings(null).hostname === DEFAULT_SETTINGS.hostname, 'no blob at all should give defaults')
    assert(sanitizeSettings('[]').panelSize === DEFAULT_SETTINGS.panelSize, 'a non-object blob should give defaults')
  })

  await check('the OS boots in a browser that blocks web storage', () => {
    const realLocal = globalThis.localStorage
    const realSession = globalThis.sessionStorage
    const denied = () => {
      throw new DOMException('Access is denied for this document.', 'SecurityError')
    }
    const blocked = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === Symbol.toPrimitive || prop === 'then') return undefined
          denied()
        },
        set: denied,
      },
    )
    try {
      Object.defineProperty(globalThis, 'localStorage', { value: blocked, configurable: true })
      Object.defineProperty(globalThis, 'sessionStorage', { value: blocked, configurable: true })

      // boot must survive: this is the call that used to leave a white page
      bootstrap()

      // and the wrappers keep working in memory, so the OS keeps behaving
      assert(safeLocal.setItem('mixt.smoke.probe', 'yes') === false, 'a blocked store cannot report a successful write')
      assert(safeLocal.getItem('mixt.smoke.probe') === 'yes', 'in-memory fallback lost the value')
      assert(safeSession.getItem('mixt.boot.cycle') !== null, 'the boot counter should still be tracked')
      safeLocal.setItem('mixt.smoke.probe', 'again')
      safeLocal.removeItem('mixt.smoke.probe')
      assert(safeLocal.getItem('mixt.smoke.probe') === null, 'the in-memory fallback did not forget the value')
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: realLocal, configurable: true })
      Object.defineProperty(globalThis, 'sessionStorage', { value: realSession, configurable: true })
    }

    assert(safeLocal.getItem('mixt.vfs.v2') !== null, 'real storage should be visible again')
  })

  await check('saved data can be cleared from the recovery screen', () => {
    safeLocal.setItem('mixt.settings.v2', JSON.stringify({ accent: '#000000' }))
    safeSession.setItem('mixt.boot.cycle', '9')
    clearSavedData()
    assert(safeLocal.getItem('mixt.settings.v2') === null, 'settings were not cleared')
    assert(safeSession.getItem('mixt.boot.cycle') === null, 'the boot counter was not cleared')
    assert(safeLocal.getItem('mixt.vfs.v2') === null, 'the filesystem was not cleared')
  })

  await check('a crash during rendering shows a report, not a white page', async () => {
    const host = document.createElement('div')
    host.id = 'boundary-probe'
    document.body.appendChild(host)
    const node = createRoot(host)
    function Broken(): JSX.Element {
      throw new Error('smoke test: deliberate render failure')
    }
    try {
      node.render(
        React.createElement(BootBoundary, null, React.createElement(Broken)),
      )
      await new Promise((r) => setTimeout(r, 260))
      const text = host.textContent ?? ''
      assert(text.includes('could not start'), 'the boot failure screen did not render')
      assert(text.includes('deliberate render failure'), 'the error itself was not shown')
      const buttons = Array.from(host.querySelectorAll('button')).map((b) => b.textContent ?? '')
      assert(buttons.some((b) => b.includes('Reload')), 'no reload action offered')
      assert(buttons.some((b) => b.includes('Reset saved data')), 'no reset action offered')
      assert(host.innerHTML.length > 200, 'the failure screen is empty')
    } finally {
      node.unmount()
      host.remove()
    }

    // the no-React fallback must work too, and must not itself throw
    const plain = renderPlainFailure(new Error('smoke test: fallback path'))
    try {
      assert(plain, 'the plain fallback did not render')
      assert((plain!.textContent ?? '').includes('could not start'), 'the plain fallback is missing its heading')
      assert((plain!.textContent ?? '').includes('fallback path'), 'the plain fallback hid the error')
    } finally {
      plain?.remove()
    }
    assert(renderPlainFailure(new Error('removed again'), host) !== null, 'the plain fallback should accept a host')
    host.innerHTML = ''
  })

  /* An update is an installed package the repository has a newer build of —
     never an extra you have simply not installed yet. */
  await check('updates are real updates, and stop being updates once applied', () => {
    const S = useOS.getState()
    const applied: Record<string, string> = {}

    // an optional extra that is not installed is NOT an update
    assert(!hasUpdate('weather', applied), 'an uninstalled extra counted as an update')

    // a preinstalled package with a newer repo build IS one
    const id = Object.keys(REPO_VERSIONS)[0]
    assert(hasUpdate(id, applied), `${id} should have an update available`)
    assert(installedVersion(id, applied) === INSTALLED_VERSION, 'the installed version is wrong')
    assert(versionLabel(id, applied) === `${INSTALLED_VERSION} → ${REPO_VERSIONS[id]}`, `the version label reads ${versionLabel(id, applied)}`)

    // applying it clears the update
    S.applyUpdate(id, repoVersion(id))
    assert(!hasUpdate(id, useOS.getState().updatesApplied), 'an applied update is still listed')
    assert(versionLabel(id, useOS.getState().updatesApplied) === repoVersion(id), 'the version did not move forward')

    // a package with no newer build never shows one
    assert(!hasUpdate('calculator', {}), 'calculator invented an update')
  })

  /* Accounts have no avatars: nothing to pick, nothing stored, nothing drawn. */
  await check('an account is created with no avatar, and none is drawn', () => {
    const S = useOS.getState()
    const before = S.users.length
    const res = S.createUser({
      username: 'smoke.user',
      fullName: 'Smoke User',
      password: 'secret',
      accent: DEFAULT_SETTINGS.accent,
      wallpaper: DEFAULT_SETTINGS.wallpaper,
    })
    assert(res.ok, 'creating an account failed')
    if (!res.ok) return
    assert((res.user as any).avatar === undefined, `the account still carries an avatar: ${(res.user as any).avatar}`)
    assert(useOS.getState().users.length === before + 1, 'the account was not added')
    assert(useOS.getState().settings.username === 'smoke.user', 'creating an account did not sign in as it')
    assert((useOS.getState().settings as any).avatar === undefined, 'the session still carries an avatar')

    const picker = ['🦊', '🐧', '🌿', '🚀', '🎧', '🐙', '🍋', '🌙', '🔥', '🧊', '🐝', '🎲']
    const drawn = picker.filter((a) => container.innerHTML.includes(a))
    assert(drawn.length === 0, `avatar emoji are on screen: ${drawn.join(' ')}`)

    useOS.getState().removeUser(res.user.id)
  })

  await check('desktop unmounts cleanly', () => {
    root?.unmount()
    container.remove()
  })

  const failed = results.filter((r) => !r.ok)
  return { results, failed }
}
