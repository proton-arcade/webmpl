import React from 'react'

export interface PageCtx {
  /** path within the site, e.g. "/article/mixt-os" */
  path: string
  /** decoded query string of the URL */
  query: string
  /** full url of the page being rendered */
  url: string
  /** navigates the browser (or the tab) to another url */
  navigate: (url: string) => void
  /** opens a new browser tab */
  openTab: (url: string) => void
  /** current tab id, useful for per-tab state */
  tabId: string
}

export interface SitePage {
  path: string
  title: string
  keywords?: string[]
  snippet?: string
  render: (ctx: PageCtx) => React.ReactNode
}

export interface SiteDef {
  domain: string
  aliases?: string[]
  title: string
  glyph: string
  color: string
  color2?: string
  description: string
  /** shown on the MixtNet home page */
  tags?: string[]
  defaultPath: string
  pages: SitePage[]
  /** plain-text version used by `curl`/`wget` in the Terminal */
  text?: (path: string, query: string) => string
  /** individual pages (articles, videos, products…) that should be searchable */
  deepEntries?: { url: string; title: string; snippet: string; keywords: string[] }[]
}

export interface SearchResult {
  url: string
  title: string
  snippet: string
  site: string
  domain: string
}

/**
 * `local` is a page that ships in this repository beside the desktop — the site
 * converter, for one. It is loaded by relative path from the same origin, so it
 * needs no DNS record, no network, and no exception to the rule that nothing
 * here reaches the outside.
 */
export type UrlKind = 'site' | 'search' | 'about' | 'real' | 'local' | 'notfound' | 'invalid'

export interface ResolvedUrl {
  kind: UrlKind
  href: string
  domain: string
  path: string
  query: string
  searchQuery?: string
  aboutPage?: string
  /** why a name does not resolve, shown on the browser's error page */
  notFoundReason?: string
}

export interface DownloadableFile {
  id: string
  filename: string
  mime: string
  /** approximate size in bytes used for the fake progress bar */
  size: number
  /** content written into the vfs */
  content: string
  /** optional external url (wallpapers, images) */
  url?: string
  from: string
}
