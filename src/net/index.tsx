/* MintNet — the internet inside Mint Web OS.
   A client-side "web": sites are React components, search is an inverted index,
   and anything that is not part of MintNet can still be opened as a real site
   through an embedded frame when the remote server allows it. */
import { PORTAL_SITES } from './sites/portal'
import { TECH_SITES } from './sites/tech'
import { SERVICE_SITES } from './sites/services'
import { SOCIAL_SITES } from './sites/social'
import type { ResolvedUrl, SearchResult, SiteDef } from './types'

export const SITES: SiteDef[] = [...PORTAL_SITES, ...TECH_SITES, ...SERVICE_SITES, ...SOCIAL_SITES]

export const HOME_URL = 'https://mintnet.com/'

/** tlds that feel like "the real web" rather than MintNet */
const REAL_TLDS = /\.(com|org|net|io|dev|gov|edu|co\.uk|de|fr|nl|es|it|ru|jp|cn|au|ca|us|info|me|app|xyz|tech|ai|sh|tv)$/i

export function stripWww(host: string) {
  return host.replace(/^www\./i, '').toLowerCase()
}

export function findSite(domain: string): SiteDef | undefined {
  const d = stripWww(domain)
  return SITES.find((s) => stripWww(s.domain) === d || (s.aliases ?? []).some((a) => stripWww(a) === d))
}

export function resolveUrl(input: string, baseUrl = HOME_URL): ResolvedUrl {
  let raw = (input ?? '').trim()
  if (!raw) raw = HOME_URL

  if (/^about:/i.test(raw)) {
    const page = raw.slice(6).replace(/\/+$/, '').toLowerCase() || 'home'
    return { kind: 'about', href: `about:${page}`, domain: '', path: `/${page}`, query: '', aboutPage: page }
  }

  if (/^mintnet:\/\//i.test(raw)) {
    const rest = raw.replace(/^mintnet:\/\//i, '')
    const [hostPart, queryPart] = rest.split('?')
    const host = hostPart.replace(/\/+$/, '')
    const [domain, ...pathBits] = host.split('/')
    const path = '/' + pathBits.join('/')
    const query = decodeURIComponent(queryPart ?? '')
    if (stripWww(domain) === 'search') {
      const q = new URLSearchParams(query).get('q') ?? ''
      return { kind: 'search', href: `mintnet://search?q=${encodeURIComponent(q)}`, domain: 'search', path: '/', query, searchQuery: q }
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

  const site = findSite(host)
  if (site) {
    return { kind: 'site', href: `https://${site.domain}${path}${query ? `?${query}` : ''}`, domain: site.domain, path: path || '/', query }
  }
  if (stripWww(host) === 'search.mintnet.com' || stripWww(host) === 'search') {
    const q = new URLSearchParams(query).get('q') ?? ''
    return { kind: 'search', href: `mintnet://search?q=${encodeURIComponent(q)}`, domain: 'search', path: '/', query, searchQuery: q }
  }
  if (REAL_TLDS.test(`.${host.split('.').pop()}`) || host.includes('.')) {
    return { kind: 'real', href: `https://${host}${path}${query ? `?${query}` : ''}`, domain: host, path, query }
  }
  return searchUrl(raw)
}

export function searchUrl(q: string): ResolvedUrl {
  return {
    kind: 'search',
    href: `mintnet://search?q=${encodeURIComponent(q)}`,
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

export function searchMintNet(query: string): SearchResult[] {
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

/** Suggested queries shown under the MintNet search box. */
export const SUGGESTED_SEARCHES = [
  'linux mint',
  'cinnamon desktop',
  'what is a virtual filesystem',
  'mint recipes',
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
    const results = searchMintNet(r.searchQuery ?? '')
    return `MintNet Search — ${r.searchQuery}\n${'='.repeat(40)}\n\n${results
      .map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${x.snippet}`)
      .join('\n\n') || 'No results found.'}`
  }
  if (r.kind === 'about') {
    return `about:${r.aboutPage} — internal browser page. Open the Web Browser to view it.`
  }
  return `curl: cannot reach ${r.href}\nThis sandbox only allows MintNet pages and package mirrors to be fetched.\nTry: curl https://mintnews.com/  or  curl https://mintpedia.org/article/linux-mint`
}

export * from './types'
export { FILES as DOWNLOADABLE_FILES, downloadableUrls, findFile } from './downloads'
