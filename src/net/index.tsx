/* MixtNet — the internet inside Mixt Web OS.
   A client-side "web": sites are React components, search is an inverted index,
   and anything that is not part of MixtNet can still be opened as a real site
   through an embedded frame when the remote server allows it. */
import { SERVERS, REJECTED, webServers } from './internet/manifest'
import { readHosts } from './internet/hosts'
import { resolveHost, addressOf } from './dns'
import type { ResolvedUrl, SearchResult, SiteDef } from './types'

/* Sites are what the machines in ./internet/servers/ publish. Drop a server
   file in that directory and its hostnames and pages appear here. */
export const SITES: SiteDef[] = webServers().flatMap((server) => server.sites ?? [])
export { SERVERS, REJECTED, webServers }

export const HOME_URL = 'https://mixtnet.com/'

/** tlds that feel like "the real web" rather than MixtNet */
const REAL_TLDS = /\.(com|org|net|io|dev|gov|edu|co\.uk|de|fr|nl|es|it|ru|jp|cn|au|ca|us|info|me|app|xyz|tech|ai|sh|tv)$/i

export function stripWww(host: string) {
  return host.replace(/^www\./i, '').toLowerCase()
}

export function findSite(domain: string): SiteDef | undefined {
  // DNS decides: aliases, www CNAMEs, wildcard zones and /etc/hosts all work here
  const answer = resolveHost(domain, { hosts: readHosts() })
  if (answer.status === 'NOERROR' && answer.site) return answer.site
  const d = stripWww(domain)
  return SITES.find((s) => stripWww(s.domain) === d || (s.aliases ?? []).some((a) => stripWww(a) === d))
}

/** The machine that answers for a hostname. */
export function findServer(domain: string) {
  const answer = resolveHost(domain, { hosts: readHosts() })
  return answer.status === 'NOERROR' ? answer.server : undefined
}

/** tlds that exist only inside MixtNet, so a failed lookup is an NXDOMAIN page */
const MIXT_TLDS = /^(\.?)(mixtnet|mixt|mixt|test|local|lan|internal|lab|home)$/i

export function looksInternal(host: string) {
  const bare = stripWww(host)
  if (!bare.includes('.')) return true
  return MIXT_TLDS.test(`.${bare.split('.').pop()}`)
}

/** What the resolver thinks of an address, for the browser's status bar. */
export function dnsStatus(host: string) {
  const answer = resolveHost(host, { hosts: readHosts() })
  return {
    status: answer.status,
    address: answer.answers.find((r) => r.type === 'A')?.value,
    source: answer.source,
    cname: answer.cname,
    server: answer.server,
    rtt: answer.rtt,
  }
}

export function resolveUrl(input: string, baseUrl = HOME_URL): ResolvedUrl {
  let raw = (input ?? '').trim()
  if (!raw) raw = HOME_URL

  if (/^about:/i.test(raw)) {
    const page = raw.slice(6).replace(/\/+$/, '').toLowerCase() || 'home'
    return { kind: 'about', href: `about:${page}`, domain: '', path: `/${page}`, query: '', aboutPage: page }
  }

  if (/^mixtnet:\/\//i.test(raw)) {
    const rest = raw.replace(/^mixtnet:\/\//i, '')
    const [hostPart, queryPart] = rest.split('?')
    const host = hostPart.replace(/\/+$/, '')
    const [domain, ...pathBits] = host.split('/')
    const path = '/' + pathBits.join('/')
    const query = decodeURIComponent(queryPart ?? '')
    if (stripWww(domain) === 'search') {
      const q = new URLSearchParams(query).get('q') ?? ''
      return { kind: 'search', href: `mixtnet://search?q=${encodeURIComponent(q)}`, domain: 'search', path: '/', query, searchQuery: q }
    }
    const site = findSite(domain)
    if (site) {
      return { kind: 'site', href: `https://${site.domain}${path === '/' ? '/' : path}${query ? `?${query}` : ''}`, domain: site.domain, path: path || '/', query }
    }
  }

  // not a url at all → search
  const looksLikeHost = /^[\w-]+(\.[\w-]+)+(\/|$|:\d)/.test(raw) && !/\s/.test(raw)
  if (!/^https?:\/\//i.test(raw) && !looksLikeHost) {
    return searchUrl(raw)
  }

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  let host = ''
  let path = '/'
  let query = ''
  try {
    const u = new URL(withScheme)
    host = stripWww(u.host)
    path = u.pathname || '/'
    query = u.search.replace(/^\?/, '')
  } catch {
    return searchUrl(raw)
  }

  if (stripWww(host) === 'search.mixtnet.com' || stripWww(host) === 'search') {
    const q = new URLSearchParams(query).get('q') ?? ''
    return { kind: 'search', href: `mixtnet://search?q=${encodeURIComponent(q)}`, domain: 'search', path: '/', query, searchQuery: q }
  }

  // ask the resolver — this is where www, aliases, wildcards and /etc/hosts land
  const answer = resolveHost(host, { hosts: readHosts() })
  if (answer.status === 'NOERROR' && answer.site) {
    const site = answer.site
    return {
      kind: 'site',
      href: `https://${site.domain}${path}${query ? `?${query}` : ''}`,
      domain: site.domain,
      path: path || '/',
      query,
    }
  }
  if (answer.status === 'NOERROR' && answer.server && !answer.site) {
    // a machine with no website: mail servers, nameservers, the arcade box
    return {
      kind: 'notfound',
      href: `https://${host}${path}`,
      domain: host,
      path,
      query,
      notFoundReason: `${host} resolves to ${answer.server.id} (${answer.server.software ?? 'a MixtNet machine'}) but that machine does not serve a website on port 443.`,
    }
  }
  const internal = looksInternal(host)
  if (internal) {
    return {
      kind: 'notfound',
      href: `https://${host}${path}`,
      domain: host,
      path,
      query,
      notFoundReason: `MixtNet DNS has no record for ${host}.`,
    }
  }
  if (REAL_TLDS.test(`.${host.split('.').pop()}`) || host.includes('.')) {
    return { kind: 'real', href: `https://${host}${path}${query ? `?${query}` : ''}`, domain: host, path, query }
  }
  return searchUrl(raw)
}

export function searchUrl(q: string): ResolvedUrl {
  return {
    kind: 'search',
    href: `mixtnet://search?q=${encodeURIComponent(q)}`,
    domain: 'search',
    path: '/',
    query: '',
    searchQuery: q,
  }
}

/* ------------------------------- search index ------------------------------ */
export interface IndexEntry extends SearchResult {
  keywords: string
}

let INDEX: IndexEntry[] | null = null

export function buildIndex(): IndexEntry[] {
  if (INDEX) return INDEX
  const entries: IndexEntry[] = []
  for (const site of SITES) {
    entries.push({
      url: `https://${site.domain}/`,
      title: `${site.title} — home`,
      snippet: site.description,
      site: site.title,
      domain: site.domain,
      keywords: [site.title, site.domain, site.description, ...(site.tags ?? [])].join(' ').toLowerCase(),
    })
    for (const page of site.pages) {
      entries.push({
        url: `https://${site.domain}${page.path}`,
        title: page.title,
        snippet: page.snippet ?? site.description,
        site: site.title,
        domain: site.domain,
        keywords: [page.title, site.title, site.domain, page.snippet ?? '', ...(page.keywords ?? [])].join(' ').toLowerCase(),
      })
    }
    for (const deep of site.deepEntries ?? []) {
      entries.push({
        url: deep.url,
        title: deep.title,
        snippet: deep.snippet,
        site: site.title,
        domain: site.domain,
        keywords: [deep.title, site.title, site.domain, deep.snippet, ...deep.keywords].join(' ').toLowerCase(),
      })
    }
  }
  INDEX = entries
  return entries
}

export function searchMixtNet(query: string): SearchResult[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const terms = q.split(/\s+/)
  const idx = buildIndex()
  const scored = idx
    .map((entry) => {
      let score = 0
      for (const term of terms) {
        if (entry.title.toLowerCase().includes(term)) score += 6
        if (entry.keywords.includes(term)) score += 3
        if (entry.snippet.toLowerCase().includes(term)) score += 1
        if (entry.domain.includes(term)) score += 2
      }
      if (entry.url.endsWith('/') && score > 0) score += 1
      return { entry, score }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 22)
    .map((r) => r.entry)
  return scored
}

/** Suggested queries shown under the MixtNet search box. */
export const SUGGESTED_SEARCHES = [
  'mixt os',
  'mixt-shell desktop',
  'what is a virtual filesystem',
  'mixt recipes',
  'web development',
  'space exploration',
  'how do browsers work',
  'cheap mechanical keyboards',
]

/* ------------------------------- text output ------------------------------- */
export async function fetchAsText(input: string): Promise<string> {
  const r = resolveUrl(input)
  if (r.kind === 'site') {
    const site = findSite(r.domain)!
    if (site.text) return site.text(r.path, r.query)
    return `${site.title} (https://${site.domain}${r.path})\n\n${site.description}\n\n[This page has no plain-text version. Open it in the Web Browser to see the full layout.]`
  }
  if (r.kind === 'search') {
    const results = searchMixtNet(r.searchQuery ?? '')
    return `Mixtsfox Search — ${r.searchQuery}\n${'='.repeat(40)}\n\n${results
      .map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${x.snippet}`)
      .join('\n\n') || 'No results found.'}`
  }
  if (r.kind === 'about') {
    return `about:${r.aboutPage} — internal browser page. Open the Web Browser to view it.`
  }
  if (r.kind === 'notfound') {
    const host = r.domain
    const answer = resolveHost(host, { hosts: readHosts() })
    const internal = looksInternal(host)
    return [
      internal
        ? `curl: (6) Could not resolve host: ${host}`
        : `curl: could not reach ${r.href}`,
      '',
      internal
        ? `MixtNet DNS: NXDOMAIN for ${host} (asked 10.0.0.53, ${answer.rtt} msec)`
        : 'This sandbox cannot reach the real internet — only MixtNet names resolve.',
      internal ? 'Browse the directory at https://mixtnet.com/ to see every machine on the network.' : '',
      internal ? 'Tip: add a name to /etc/hosts, or drop a server into src/net/internet/servers/.' : '',
    ]
      .filter(Boolean)
      .join('\n')
  }
  return `curl: cannot reach ${r.href}\nThis sandbox only allows MixtNet pages and package mirrors to be fetched.\nTry: curl https://mixtnews.com/  or  curl https://mixtpedia.org/article/mixt-os`
}

export * from './types'
export { FILES as DOWNLOADABLE_FILES, downloadableUrls, findFile } from './downloads'

/* the resolver, the machines, and the local hosts file */
export {
  NAMESERVERS,
  ROOT_ZONE,
  addressFor,
  addressOf,
  hashString,
  ipv6For,
  isIpAddress,
  latencyFor,
  registerServers,
  renderDig,
  renderHost,
  renderNslookup,
  resolveHost,
  resolveSite,
  reverseLookup,
  serverAddress,
  serverById,
  servers,
  soaRecord,
  zoneRecords,
} from './dns'
export type { DnsAnswer, DnsRecord, DnsStatus, RecordType } from './dns'
export {
  DEFAULT_HOSTS,
  DEFAULT_RESOLV_CONF,
  HOSTS_PATH,
  RESOLV_CONF_PATH,
  addHostEntry,
  ensureNetworkFiles,
  parseHosts,
  readHosts,
  readHostsFile,
  readResolvConf,
  removeHostEntry,
  writeHostsFile,
} from './internet/hosts'
export type { ServerDef, ServerPort } from './internet/types'
