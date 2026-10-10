/* The application tree in the virtual filesystem.
 *
 * Every application gets a directory under /usr/share/applications laid out the
 * same way:
 *
 *   /usr/share/applications/<id>/
 *       main.js            the main file — what the app is and how it starts
 *       _Dependencies/     what that file is built from, one note per module
 *       README.md          everything else: the long description, categories
 *
 * and one index for the whole set, listing each application's name, summary,
 * description and file. Both are generated from APP_INDEX, which is itself read
 * out of src/apps, so the filesystem cannot disagree with the code.
 */
import { vfs } from './vfs'
import { APP_INDEX, APP_SHARED_FILES } from './appindex'

export const APPS_DIR = '/usr/share/applications'
export const APP_INDEX_FILE = `${APPS_DIR}/index`

/** the INI index: one section per application, the four fields it asks for */
export function indexFile(): string {
  const lines = [
    '; The application index.',
    ';',
    '; One section per application, listing its name, summary, description and',
    '; the file that implements it. Generated from src/apps — edit the source,',
    '; not this file.',
    '',
  ]
  for (const a of APP_INDEX) {
    lines.push(`[${a.name}]`)
    lines.push(`Name=${a.name}`)
    lines.push(`Summary=${a.summary}`)
    lines.push(`Description=${a.description}`)
    lines.push(`File=${APPS_DIR}/${a.id}/main.js`)
    lines.push('')
  }
  return lines.join('\n')
}

/** the main file of one application */
function mainFile(id: string): string {
  const a = APP_INDEX.find((x) => x.id === id)
  if (!a) return ''
  return `/* ${a.name} — ${a.summary}
 *
 * ${a.description}
 *
 * This is the main file of the application. Everything it is built from is
 * listed in _Dependencies/; the long description and the categories it appears
 * under are in README.md.
 *
 * The code itself is compiled into the desktop bundle. This file is the record
 * of what that application is, where it comes from and what it needs.
 */
var APP = {
  id: ${JSON.stringify(a.id)},
  name: ${JSON.stringify(a.name)},
  summary: ${JSON.stringify(a.summary)},
  description: ${JSON.stringify(a.description)},
  source: ${JSON.stringify(a.file)},
  categories: ${JSON.stringify(a.categories)},
  keywords: ${JSON.stringify(a.keywords)},
  dependencies: ${JSON.stringify(a.dependencies)}
}

/* Opening the application from here: the desktop listens for this event. */
function launch() {
  if (typeof window === 'undefined') return false
  window.dispatchEvent(new CustomEvent('mixt:launch', { detail: { appId: APP.id } }))
  return true
}

if (typeof module !== 'undefined') module.exports = { APP: APP, launch: launch }
`
}

/** one note per module the main file imports */
function dependencyNotes(id: string): [string, string][] {
  const a = APP_INDEX.find((x) => x.id === id)
  if (!a) return []
  const out: [string, string][] = []
  for (const dep of a.dependencies) {
    /* a file name that is safe on any filesystem */
    const safe = dep.replace(/[^A-Za-z0-9._-]+/g, '_')
    const local = dep.startsWith('src/')
    out.push([
      `${safe}.txt`,
      `${dep}
${local ? 'Part of this project. ' : 'An external package. '}Imported by ${a.file}.
`,
    ])
  }
  out.push([
    'list.txt',
    [`${a.name} is built from ${a.dependencies.length} module${a.dependencies.length === 1 ? '' : 's'}:`, '', ...a.dependencies.map((d) => `  ${d}`), ''].join('\n'),
  ])
  return out
}

function readme(id: string): string {
  const a = APP_INDEX.find((x) => x.id === id)
  if (!a) return ''
  return `# ${a.name}

${a.summary}

${a.description}

## Where it appears

${a.categories.map((c) => `- ${c}`).join('\n') || '- (no category)'}

## Search terms

${a.keywords.join(', ') || '(none)'}

## Built from

${a.dependencies.map((d) => `- \`${d}\``).join('\n') || '- nothing outside itself'}

Source file in this repository: \`${a.file}\`
`
}

/** every file in the tree, as [path, content, mime] */
export function appTreeFiles(): [string, string, string][] {
  const out: [string, string, string][] = [[APP_INDEX_FILE, indexFile(), 'text/plain']]
  for (const a of APP_INDEX) {
    const dir = `${APPS_DIR}/${a.id}`
    out.push([`${dir}/main.js`, mainFile(a.id), 'text/javascript'])
    out.push([`${dir}/README.md`, readme(a.id), 'text/markdown'])
    for (const [name, body] of dependencyNotes(a.id))
      out.push([`${dir}/_Dependencies/${name}`, body, 'text/plain'])
  }
  /* the shared helpers belong in the listing too, so the tree covers src/apps */
  out.push([
    `${APPS_DIR}/_shared.txt`,
    [
      'These files in src/apps belong to no single application; the applications',
      'import them:',
      '',
      ...APP_SHARED_FILES.map((f) => `  ${f}`),
      '',
    ].join('\n'),
    'text/plain',
  ])
  return out
}

/**
 * Write the tree, filling in whatever is missing.
 *
 * A filesystem saved before this existed has no /usr/share/applications at all,
 * and an older one has the directories but not the index — so nothing here is
 * allowed to assume the shape it left behind last time.
 */
export function ensureAppTree() {
  for (const [path, content, mime] of appTreeFiles()) {
    try {
      if (vfs.read(path) !== null) continue
      const parts = path.split('/').filter(Boolean)
      parts.pop()
      let cur = ''
      for (const part of parts) {
        cur += `/${part}`
        if (!vfs.exists(cur)) vfs.mkdir(cur)
      }
      vfs.write(path, content, mime)
    } catch {
      /* a blocked or full store must not cost the user their session */
    }
  }
}
