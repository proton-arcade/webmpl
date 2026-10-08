/** A machine on the MintNet — the thing you "drop in" to publish hostnames. */
import type { SiteDef } from '../types'

export interface ServerPort {
  port: number
  proto?: 'tcp' | 'udp'
  service: string
  /** shown by `nmap` / the registry */
  version?: string
}

export interface ServerRecords {
  MX?: string[]
  TXT?: string[]
  NS?: string[]
  SOA?: string
}

export interface ServerDef {
  /** machine name, e.g. "pedia-web-01" */
  id: string
  /** A records — the hostnames this machine answers for */
  hosts: string[]
  /** CNAMEs included for convenience */
  aliases?: string[]
  /** zones it answers for, e.g. "*.mintnet.com" */
  wildcard?: string[]
  /** override the generated address (must be unique) */
  ip?: string
  ipv6?: string
  /** who runs it — shown in the MintNet Registry */
  operator?: string
  location?: string
  since?: string
  os?: string
  software?: string
  banner?: string
  ttl?: number
  ports?: ServerPort[]
  records?: ServerRecords
  /** what it serves. Empty for infrastructure (nameservers, mail relays…) */
  sites?: SiteDef[]
  notes?: string
}

/** Identity helper — gives editors/TS a place to check the shape. */
export function defineServer(server: ServerDef): ServerDef {
  return server
}
