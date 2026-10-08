/* The Internet directory.
 *
 * Every `*.server.tsx` file in ./servers/ is picked up automatically by Vite at
 * build time — drop a file in, save, and the machine is on the network with its
 * hostnames resolved. Nothing else to register anywhere.
 *
 * See ./README.md for the file format, and ./servers/pastemixt.server.tsx for a
 * complete worked example.
 */
/// <reference types="vite/client" />
import { registerServers } from '../dns'
import type { ServerDef } from './types'

const modules = import.meta.glob('./servers/*.server.tsx', { eager: true }) as Record<
  string,
  { default?: ServerDef | ServerDef[] }
>

export interface RejectedServer {
  file: string
  reason: string
}

/** Machines that are on the network, sorted by their first hostname. */
export const SERVERS: ServerDef[] = []
/** Files that were dropped in but could not be used — surfaced in the registry. */
export const REJECTED: RejectedServer[] = []

const claims = new Map<string, string>()

for (const [file, module] of Object.entries(modules)) {
  const short = file.replace('./servers/', '')
  const exported = module?.default
  // a file may publish one machine, or several (see nameservers.server.tsx)
  const list = Array.isArray(exported) ? exported : [exported]
  if (!exported || !list.length || typeof list[0] !== 'object') {
    REJECTED.push({ file: short, reason: 'no default export' })
    continue
  }
  for (const [index, server] of list.entries()) {
    const where = list.length > 1 ? `${short} [${index}]` : short
    if (!server?.id) {
      REJECTED.push({ file: where, reason: 'missing "id"' })
      continue
    }
    const hosts = (server.hosts ?? []).filter(Boolean)
    if (!hosts.length) {
      REJECTED.push({ file: where, reason: 'no hostnames in "hosts"' })
      continue
    }
    const clash = hosts.map((h) => h.toLowerCase()).find((h) => claims.has(h))
    if (clash) {
      REJECTED.push({ file: where, reason: `hostname ${clash} is already served by ${claims.get(clash)}` })
      continue
    }
    hosts.forEach((h) => claims.set(h.toLowerCase(), server.id))
    SERVERS.push({ ...server, hosts })
  }
}

SERVERS.sort((a, b) => a.hosts[0].localeCompare(b.hosts[0]))
registerServers(SERVERS)

/** Machines that host at least one website. */
export function webServers(): ServerDef[] {
  return SERVERS.filter((s) => (s.sites ?? []).length > 0)
}

if (REJECTED.length && typeof console !== 'undefined') {
  for (const bad of REJECTED) console.warn(`[mixtnet] ${bad.file} ignored: ${bad.reason}`)
}
