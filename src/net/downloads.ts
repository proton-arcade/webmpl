import type { DownloadableFile } from './types'

/** Files offered for download on the MixtNet sites. */
export const FILES: DownloadableFile[] = [
  {
    id: 'mixtos-iso',
    filename: 'mixtos-1.0-cinnamon-64bit.iso',
    mime: 'application/x-iso9660-image',
    size: 2_910_000_000,
    from: 'https://mixtos.com/download.php',
    content:
      'This file is a placeholder for the Mixt OS 1.0 ISO image.\nMixt Web OS cannot ship a 2.9 GB image inside a web page, but the download,\nthe progress bar and the notification are all real.\n',
  },
  {
    id: 'mixt-wallpaper-pack',
    filename: 'mixt-wallpapers.tar.gz',
    mime: 'application/gzip',
    size: 18_400_000,
    from: 'https://mixtos.com/download.php',
    content: 'Placeholder archive: the three wallpapers are already in ~/Pictures/Wallpapers.\n',
  },
  {
    id: 'mixt-source',
    filename: 'mixt-1.0.0.tar.gz',
    mime: 'application/gzip',
    size: 940_000,
    from: 'https://mixt.dev/download',
    content: 'Source tarball placeholder. The running system is the best documentation there is.\n',
  },
  {
    id: 'mixtnet-spec',
    filename: 'mixtnet-protocol-spec.pdf',
    mime: 'application/pdf',
    size: 420_000,
    from: 'https://mixtdev.io/protocol',
    content:
      'MixtNet Protocol Specification v1.0\n\n1. Everything is resolved and rendered on the client.\n2. Pages are React components, links are hrefs, and search is an inverted index.\n3. Real websites may be embedded, or politely refused by their servers.\n',
  },
  {
    id: 'mixt-cheatsheet',
    filename: 'mixt-shell-cheatsheet.txt',
    mime: 'text/plain',
    size: 7_800,
    from: 'https://mixtdev.io/shell',
    content: `Mixt Web OS shell cheat sheet
=============================
Navigation : ls, cd, pwd, tree, find
Files      : cat, mkdir, touch, rm, mv, cp, du, stat
Text       : grep, wc, head, tail, sort, cut, echo >, echo >>
Packages   : apt search / install / remove, dpkg -l
Network    : ping, curl, wget, ifconfig, ssh
Desktop    : open, theme, wallpaper, notify-send, lock, screenshot
Fun        : neofetch, fortune, cowsay, sl, seq, yes
`,
  },
  {
    id: 'tux-plush',
    filename: 'tux-plush-toy.png',
    mime: 'image/png',
    size: 260_000,
    from: 'https://mixtcart.com/product/tux-plush',
    content: '',
    url: '/wallpapers/mixt-leaf.jpg',
  },
  {
    id: 'photo-mixt-wave',
    filename: 'mixt-wave-wallpaper.jpg',
    mime: 'image/jpeg',
    size: 310_000,
    from: 'https://mixtcart.com/product/wallpaper-pack',
    content: '',
    url: '/wallpapers/mixt-wave.jpg',
  },
  {
    id: 'photo-mixt-facets',
    filename: 'mixt-facets-wallpaper.jpg',
    mime: 'image/jpeg',
    size: 210_000,
    from: 'https://mixtcart.com/product/wallpaper-pack',
    content: '',
    url: '/wallpapers/mixt-facets.jpg',
  },
  {
    id: 'snake-source',
    filename: 'arcade-games.js',
    mime: 'text/javascript',
    size: 12_600,
    from: 'https://mixtgames.com/source',
    content: `// MixtNet arcade — extract of the games shipped on mixtgames.com
export function reactionGame(now, startedAt) {
  return Math.round(now - startedAt) // ms of your reflexes
}
export function guessHigher(lower, upper, guess) {
  if (guess < lower || guess > upper) throw new Error('out of range')
  return Math.floor((lower + upper) / 2)
}
`,
  },
]

export function findFile(id: string) {
  return FILES.find((f) => f.id === id)
}

export function downloadableUrls(url: string) {
  return FILES.filter((f) => f.from.split('?')[0] === url.replace(/#.*$/, ''))
}
