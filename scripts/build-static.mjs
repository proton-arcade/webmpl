/**
 * Publishes the website.
 *
 *   npm run build
 *
 * Produces the plain files index.html asks for, in two places:
 *
 *   ./mixt.bundle.js, ./mixt.bundle.css   — the repository root is the website,
 *                                           committed, so the folder works on any
 *                                           static host with no build step at all
 *   ./dist/…                              — a stand-alone copy to drop into a
 *                                           web server's document root
 *
 * The bundle is a classic script (IIFE), so nothing here depends on the host
 * serving correct MIME types for ES modules, on http:// vs file://, or on the
 * folder being the web root.
 */
import { execSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const BUILD_DIR = '.static-build'
const SITE_FILES = ['mixt.bundle.js', 'mixt.bundle.css']
const ASSETS = ['wallpapers', 'logo.svg', 'converter']

/* Apache reads this on the way in. Without it a host with unusual defaults
 * serves mixt.bundle.js as text/plain, the browser refuses to run it, and the
 * site is a white page that looks like a broken build rather than a missing
 * line of configuration. */
const DOTFILES = ['.htaccess']

/* the application index is read out of src/apps, so it is rebuilt before the
   bundle is made and can never lag behind the code it describes */
console.log('• reading the applications in src/apps…')
execSync('node scripts/gen-appindex.mjs', { stdio: 'inherit' })

/* and the default filesystem is read out of the defaultfs/ folder at the root
   of the repository, for the same reason: it is edited as ordinary files and
   must not be able to drift from what the desktop actually boots */
execSync('node scripts/gen-defaultfs.mjs', { stdio: 'inherit' })

console.log('• building mixt.bundle.js (classic script) and mixt.bundle.css…')
rmSync(BUILD_DIR, { recursive: true, force: true })
execSync('npx vite build --config vite.static.config.ts --logLevel warn', { stdio: 'inherit' })

for (const file of [`${BUILD_DIR}/mixt.bundle.js`, `${BUILD_DIR}/mixt.bundle.css`]) {
  if (!existsSync(file)) {
    console.error(`✗ the build did not produce ${file}`)
    process.exit(1)
  }
}

/* ------------------- the repository root is the published site -------------- */
for (const file of SITE_FILES) copyFileSync(join(BUILD_DIR, file), file)
console.log('• published to the repository root (index.html loads these directly)')

/* ------------------------------ a copy in dist/ ----------------------------- */
rmSync('dist', { recursive: true, force: true })
mkdirSync('dist', { recursive: true })
copyFileSync('index.html', 'dist/index.html')
for (const file of SITE_FILES) copyFileSync(file, join('dist', file))
for (const asset of ASSETS) cpSync(asset, join('dist', asset), { recursive: true })
for (const dot of DOTFILES) if (existsSync(dot)) copyFileSync(dot, join('dist', dot))
console.log('• assembled dist/ (same site, for dropping into Apache or uploading)')

/* --------------------------------- summary --------------------------------- */
const kb = (file) => `${(statSync(file).size / 1024).toFixed(0)} kB`
console.log('')
console.log(`  index.html        ${kb('index.html')}`)
console.log(`  mixt.bundle.js    ${kb('mixt.bundle.js')}`)
console.log(`  mixt.bundle.css   ${kb('mixt.bundle.css')}`)
console.log(`  wallpapers/       3 files`)
console.log('')
console.log('  Drop this folder into your web server\'s document root, e.g.')
console.log('    cp -r dist/* /var/www/html/mixt/ → http://localhost/mixt/')
console.log('  or run `npm start` to serve it with the backend on port 8080.')
