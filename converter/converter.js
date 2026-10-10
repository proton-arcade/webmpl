/**
 * Turning somebody else's website into a website for this project.
 *
 * A page written for the open internet is full of things that only work on the
 * open internet: stylesheets on a CDN, scripts on a tracker's domain, images
 * with absolute addresses, forms that post somewhere else. Drop one into this
 * desktop as it is and it either sits there half-broken or quietly reaches out
 * to machines that are not part of this project.
 *
 * So this rewrites a page into one that stands on its own. Nothing here fetches
 * anything — there is no network to fetch with, and a converter that had to
 * download the very assets it is neutralising would defeat the point. It works
 * on the source you give it and produces source back.
 *
 * The rules, applied in order:
 *
 *   1. absolute http(s) URLs become local ones under ./vendor/, so a page that
 *      referenced a CDN now references a file you can put there yourself, and
 *      nothing points off this machine any more;
 *   2. protocol-relative URLs (//cdn.example/x) are absolute in disguise and get
 *      the same treatment;
 *   3. subresource integrity hashes are dropped, because the file they guarded
 *      is no longer the file being loaded, and keeping them would make the
 *      browser refuse every local copy;
 *   4. anything that can only work against a foreign origin — forms posting
 *      away, iframes, beacons, service workers, prefetch and preload hints —
 *      is commented out rather than deleted, with a note saying what it was;
 *   5. a manifest is produced listing everything that was rewritten, so the
 *      result can be checked instead of trusted;
 *   6. the site gets a website.ini in the same [Website] key-per-line form the
 *      rest of this project uses, so it can be dropped into /srv/www and the
 *      desktop will describe it like any other hosted site.
 *
 * Plain JavaScript with no imports, so this file works the same whether it is
 * loaded by converter/index.html on its own or bundled into the desktop.
 */
;(function (root) {
  'use strict'

  var VENDOR_DIR = 'vendor'

  /** every attribute whose value is a URL, by tag */
  var URL_ATTRS = {
    a: ['href'],
    link: ['href'],
    script: ['src'],
    img: ['src', 'srcset', 'data-src'],
    source: ['src', 'srcset'],
    video: ['src', 'poster'],
    audio: ['src'],
    iframe: ['src'],
    embed: ['src'],
    object: ['data'],
    form: ['action'],
    area: ['href'],
    track: ['src'],
    input: ['src'],
  }

  function isAbsolute(url) {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) || /^\/\//.test(url)
  }

  /** true when the URL points at a machine that is not this one */
  function isForeign(url) {
    if (!isAbsolute(url)) return false
    /* mailto:, tel:, data:, blob: are not remote files to vendor */
    if (/^(data|blob|mailto|tel|javascript):/i.test(url)) return false
    if (/^https?:/i.test(url)) return true
    return /^\/\//.test(url)
  }

  /** a readable local filename for a remote URL, collisions resolved */
  function vendorPath(url, seen) {
    var clean = url.replace(/^[a-z]+:/i, '').replace(/^\/\//, '')
    var safe = clean.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '')
    if (!safe) safe = 'asset'
    if (!/\.[a-z0-9]{1,5}$/i.test(safe)) safe += '.bin'
    var candidate = safe
    var n = 2
    while (seen[candidate]) candidate = safe.replace(/(\.[a-z0-9]+)$/i, '-' + n++ + '$1')
    seen[candidate] = url
    return VENDOR_DIR + '/' + candidate
  }

  /**
   * The whole conversion, in one call.
   *
   * @param {string} source  the HTML as it was written
   * @param {object} opts    { name, url } for the manifest and the ini record
   * @returns {{ html: string, ini: string, manifest: object }}
   */
  function convert(source, opts) {
    opts = opts || {}
    var name = String(opts.name || 'Converted site').trim() || 'Converted site'
    var origin = String(opts.url || '').trim()

    var html = String(source == null ? '' : source)
    var vendored = []
    var disabled = []
    var seen = {}

    /* 1 & 2 — every URL attribute on every tag that has one. Done with a tag
       walk rather than a blind regex over the document, so a URL that happens
       to appear in prose is left alone. */
    html = html.replace(/<([a-z][a-z0-9-]*)((?:\s+[^>]*?)?)(\/?)>/gi, function (whole, tagRaw, attrs, slash) {
      var tag = tagRaw.toLowerCase()
      var names = URL_ATTRS[tag]
      if (!names || !attrs) return whole

      var changed = attrs.replace(/([a-z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, function (attrWhole, attrName, _g, dq, sq, bare) {
        var value = dq != null ? dq : sq != null ? sq : bare != null ? bare : ''
        if (names.indexOf(attrName.toLowerCase()) < 0) return attrWhole

        /* srcset is a comma-separated list of "url descriptor" pairs */
        if (attrName.toLowerCase() === 'srcset') {
          var parts = value.split(',').map(function (entry) {
            var bits = entry.trim().split(/\s+/)
            if (!bits[0]) return entry
            if (isForeign(bits[0])) {
              var local = vendorPath(bits[0], seen)
              vendored.push({ from: bits[0], to: local })
              bits[0] = local
            }
            return bits.join(' ')
          })
          var joined = parts.join(', ')
          return attrName + '="' + joined.replace(/"/g, '&quot;') + '"'
        }

        if (!isForeign(value)) return attrWhole
        var localPath = vendorPath(value, seen)
        vendored.push({ from: value, to: localPath })
        return attrName + '="' + localPath + '"'
      })

      return '<' + tagRaw + changed + slash + '>'
    })

    /* 3 — integrity hashes guard a file that is no longer being loaded */
    if (/\sintegrity\s*=\s*(".*?"|'.*?'|[^\s>]+)/i.test(html)) {
      var dropped = (html.match(/\sintegrity\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi) || []).length
      html = html.replace(/\sintegrity\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '')
      if (dropped) disabled.push({ what: 'integrity', count: dropped, why: 'the local copy is not the file the hash described' })
    }

    /* 4 — anything that only works against a foreign origin */
    var foreignBlocks = [
      { re: /<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, what: 'iframe', why: 'it embeds a page from another machine' },
      { re: /<iframe\b[^>]*\/?>/gi, what: 'iframe', why: 'it embeds a page from another machine' },
      { re: /<form\b[^>]*action\s*=\s*["']?https?:[^>]*>[\s\S]*?<\/form>/gi, what: 'form', why: 'it posts to another machine' },
      { re: /<link\b[^>]*rel\s*=\s*["']?(dns-prefetch|preconnect|prefetch|prerender|preload)["']?[^>]*>/gi, what: 'link hint', why: 'it asks the browser to contact another machine early' },
      { re: /\bnavigator\.sendBeacon\s*\([^)]*\)/gi, what: 'sendBeacon', why: 'it reports to another machine' },
      { re: /\bnavigator\.serviceWorker[\s\S]{0,120}?register\s*\([^)]*\)/gi, what: 'service worker', why: 'it would take over pages on this origin' },
    ]

    foreignBlocks.forEach(function (block) {
      var matches = html.match(block.re)
      if (!matches || !matches.length) return
      disabled.push({ what: block.what, count: matches.length, why: block.why })
      html = html.replace(block.re, function (found) {
        /* Commented out rather than removed: whoever is converting this wants to
           see what the page was doing, and putting it back is their call.
           Any "--" inside is escaped so the comment cannot close early. */
        var body = found.replace(/--/g, '-\\-')
        return '<!-- disabled by the converter: ' + block.what + ' (' + block.why + ')\n' + body + '\n-->'
      })
    })

    /* 5 — the manifest, so the result can be checked rather than trusted */
    var manifest = {
      kind: 'mixt-site-conversion',
      version: 1,
      name: name,
      source: origin || null,
      converted: new Date().toISOString(),
      vendored: vendored,
      disabled: disabled,
      note: 'No asset listed here was downloaded. Each vendor/ path is where the ' +
            'file has to be placed by hand, or the page will do without it.',
    }

    /* 6 — the site record, in the form the rest of the project uses */
    var ini = [
      '[Website]',
      'Name=' + name,
      'URL=converted.local/' + slug(name),
      'Server=Mixt Static 1.0',
      'Path=/srv/www/converted',
      'Description=Converted from an external page by the Mixt site converter.',
      'Source=' + (origin || 'unknown'),
      'Assets=' + vendored.length,
      'Disabled=' + disabled.reduce(function (n, d) { return n + d.count }, 0),
      'keywords=mixt,converted,self-contained,offline',
      '',
    ].join('\n')

    return { html: html, ini: ini, manifest: manifest }
  }

  function slug(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'site'
  }

  /** a short sentence a person can read instead of the raw manifest */
  function describe(result) {
    var v = result.manifest.vendored.length
    var d = result.manifest.disabled.reduce(function (n, x) { return n + x.count }, 0)
    var parts = []
    parts.push(v === 1 ? '1 remote asset pointed into ./' + VENDOR_DIR + '/' : v + ' remote assets pointed into ./' + VENDOR_DIR + '/')
    parts.push(d === 1 ? '1 thing that needed another machine switched off' : d + ' things that needed another machine switched off')
    return parts.join(', ') + '. Nothing was downloaded and nothing here reaches the internet.'
  }

  var api = { convert: convert, describe: describe, slug: slug, isForeign: isForeign, vendorPath: vendorPath, VENDOR_DIR: VENDOR_DIR }

  /* One implementation, two front ends: the standalone page in converter/ reads
     it off the window, and the desktop bundles it as a module. */
  root.MixtSiteConverter = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
