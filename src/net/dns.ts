/* MixtNet DNS — a fake but faithful resolver.
 *
 * Every machine in the Internet directory (src/net/internet/servers/) registers
 * the hostnames it answers for. Those names get a stable fake address in the
 * 10.64.0.0/10 "MixtNet block", a PTR record back to the name, CNAMEs for www
 * and for aliases, and optional MX/TXT/NS records.
 *
 * On top of the zone sits /etc/hosts — a real file in the virtual filesystem.
 * Entries there win over the zone, exactly like a real resolver.
 *
 * Nothing here touches a network. It is a data structure with self-respect.
 */
import type { SiteDef } from './types'
import type { ServerDef } from './internet/types'

export type RecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS' | 'SOA' | 'PTR'

export type DnsStatus = 'NOERROR' | 'NXDOMAIN' | 'SERVFAIL' | 'REFUSED'

export interface DnsRecord {
  name: string
  type: RecordType
  value: string
  ttl: number
}

export interface DnsAnswer {
  status: DnsStatus
  /** the name that was asked about */
  name: string
  type: RecordType
  answers: DnsRecord[]
  authority: DnsRecord[]
  /** the machine that answers for this name, when there is one */
  server?: ServerDef
  /** the site that should be rendered for this name */
  site?: SiteDef
  /** set when the name was an alias */
  cname?: string
  source: 'zone' | 'hosts' | 'loopback' | 'reverse' | 'none'
  /** deterministic fake latency in milliseconds */
  rtt: number
}

/* --------------------------------- zones ---------------------------------- */

/** The nameservers every client in MixtNet is configured to ask. */
export const NAMESERVERS = ['ns1.mixtnet.com', 'ns2.mixtnet.com']

export const ROOT_ZONE = 'mixtnet'

interface ZoneEntry {
  server: ServerDef
  site?: SiteDef
  ttl: number
}

interface WildcardEntry {
  suffix: string
  server: ServerDef
  ttl: number
}

let SERVERS: ServerDef[] = []
const ZONE = new Map<string, ZoneEntry>()
const ALIASES = new Map<string, string>()
let WILDCARDS: WildcardEntry[] = []
const PTR = new Map<string, string>()
let RECORDS: DnsRecord[] = []

/* ------------------------------- addresses -------------------------------- */

/** FNV-1a — small, stable, and good enough for handing out addresses. */
export function hashString(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** The address a hostname would get if nothing else had claimed it. */
export function addressFor(hostname: string): string {
  const h = hashString(`mixtnet://${hostname}`)
  const b = 64 + (h % 64)
  const c = (h >>> 8) % 256
  const d = 1 + ((h >>> 16) % 254)
  return `10.${b}.${c}.${d}`
}

export function ipv6For(hostname: string): string {
  const h = hashString(`mixtnet6://${hostname}`)
  const hex = (n: number) => n.toString(16).padStart(4, '0')
  return `fd00:${hex((h >>> 16) % 0xffff)}:${hex(h % 0xffff)}::1`
}

export function isIpAddress(value: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    return value.split('.').every((octet) => Number(octet) <= 255)
  }
  return value.includes(':') && /^[0-9a-f:]{2,39}$/i.test(value)
}

function nextAddress(candidate: string): string {
  const [a, b, c, d] = candidate.split('.').map(Number)
  return `${a}.${b}.${c}.${d >= 254 ? 1 : d + 1}`
}

const LOOPBACK = ['localhost', 'localhost.localdomain', '127.0.0.1', '::1']

/** Deterministic "network" latency, so `dig` reports a believable number. */
export function latencyFor(hostname: string): number {
  return 2 + (hashString(`rtt://${hostname}`) % 17)
}

/* ----------------------------- zone building ------------------------------ */

function siteFor(server: ServerDef, host: string): SiteDef | undefined {
  const sites = server.sites ?? []
  if (!sites.length) return undefined
  const bare = host.replace(/^www\./i, '').toLowerCase()
  const match = sites.find((s) => {
    const d = s.domain.replace(/^www\./i, '').toLowerCase()
    return d === bare || (s.aliases ?? []).some((a) => a.replace(/^www\./i, '').toLowerCase() === bare)
  })
  return match ?? (server.hosts.includes(host) ? sites[0] : undefined)
}

function cleanHost(host: string) {
  return host.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim()
}

/** Registers every machine in the directory. Called once, by the manifest. */
export function registerServers(servers: ServerDef[]) {
  SERVERS = servers
  ZONE.clear()
  ALIASES.clear()
  WILDCARDS = []
  PTR.clear()
  RECORDS = []

  // 1. real names (A records): server hosts and site domains
  const hosts: Array<{ host: string; server: ServerDef }> = []
  const known = new Set<string>()
  const addHost = (raw: string, server: ServerDef) => {
    const host = cleanHost(raw)
    if (!host || known.has(host)) return
    known.add(host)
    hosts.push({ host, server })
  }
  for (const server of servers) {
    for (const host of server.hosts) addHost(host, server)
  }
  for (const server of servers) {
    for (const site of server.sites ?? []) addHost(site.domain, server)
  }

  // 2. one address per machine (explicit or derived), never colliding
  const taken = new Map<string, string>()
  for (const server of servers) {
    const primary = cleanHost(server.hosts[0] ?? server.sites?.[0]?.domain ?? server.id)
    let ip = server.ip && !taken.has(server.ip) ? server.ip : addressFor(primary)
    while (taken.has(ip)) ip = nextAddress(ip)
    taken.set(ip, primary)
    PTR.set(ip, primary)
    ;(server as ServerDef & { address?: string }).address = ip
  }

  for (const { host, server } of hosts) {
    const ttl = server.ttl ?? 300
    ZONE.set(host, { server, site: siteFor(server, host), ttl })
    const ip = (server as ServerDef & { address?: string }).address!
    RECORDS.push({ name: host, type: 'A', value: ip, ttl })
  }

  // 3. aliases → CNAME to the canonical name
  const addAlias = (raw: string, canonical: string, server: ServerDef) => {
    const alias = cleanHost(raw)
    const target = cleanHost(canonical)
    if (!alias || alias === target || ZONE.has(alias) || ALIASES.has(alias)) return
    ALIASES.set(alias, target)
    RECORDS.push({ name: alias, type: 'CNAME', value: `${target}.`, ttl: server.ttl ?? 300 })
  }
  for (const server of servers) {
    const primary = cleanHost(server.hosts[0] ?? server.sites?.[0]?.domain ?? server.id)
    // an alias of a site belongs to that site, everything else follows the machine
    const canonicalFor = (alias: string) => {
      const match = (server.sites ?? []).find((site) => {
        const domain = cleanHost(site.domain)
        return alias.endsWith(`.${domain}`) || domain.endsWith(`.${alias}`)
      })
      return match ? cleanHost(match.domain) : primary
    }
    for (const alias of server.aliases ?? []) addAlias(alias, canonicalFor(cleanHost(alias)), server)
    for (const site of server.sites ?? []) {
      for (const alias of site.aliases ?? []) addAlias(alias, site.domain, server)
      addAlias(`www.${site.domain}`, site.domain, server)
    }
  }

  // 4. wildcards, mail/authority records
  for (const server of servers) {
    for (const suffix of server.wildcard ?? []) {
      WILDCARDS.push({ suffix: cleanHost(suffix).replace(/^\*\./, ''), server, ttl: server.ttl ?? 300 })
    }
    for (const [type, values] of Object.entries(server.records ?? {})) {
      if (type === 'SOA') continue
      for (const value of values ?? []) {
        for (const host of server.hosts) {
          RECORDS.push({ name: cleanHost(host), type: type as RecordType, value, ttl: 3600 })
        }
      }
    }
  }
  for (const ns of NAMESERVERS) {
    RECORDS.push({ name: ROOT_ZONE, type: 'NS', value: `${ns}.`, ttl: 3600 })
  }
}

export function servers(): ServerDef[] {
  return SERVERS
}

export function serverById(id: string): ServerDef | undefined {
  return SERVERS.find((s) => s.id === id)
}

/** The address of a machine, as assigned when the zone was built. */
export function serverAddress(server: ServerDef): string {
  return (server as ServerDef & { address?: string }).address ?? addressFor(server.hosts[0] ?? server.id)
}

/** Every record in the zone — for the registry page and `dig -t ANY`. */
export function zoneRecords(): DnsRecord[] {
  return [...RECORDS].sort(
    (a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type) || a.value.localeCompare(b.value),
  )
}

export function soaRecord(): DnsRecord {
  return {
    name: `${ROOT_ZONE}.`,
    type: 'SOA',
    value: `ns1.mixtnet.com. hostmaster.mixtnet.com. 2025${String(hashString('serial') % 10000).padStart(4, '0')} 7200 3600 1209600 3600`,
    ttl: 3600,
  }
}

/* -------------------------------- resolving ------------------------------- */

function normalizeName(name: string) {
  return (name ?? '').trim().toLowerCase().replace(/\.$/, '')
}

export function reverseLookup(ip: string): string | undefined {
  if (ip === '127.0.0.1' || ip === '::1') return 'localhost'
  return PTR.get(ip)
}

export interface ResolveOptions {
  /** hostname → address overrides, i.e. the contents of /etc/hosts */
  hosts?: Map<string, string>
  /** registry page: show the zone itself, ignore /etc/hosts */
  ignoreHosts?: boolean
}

export function resolveHost(input: string, opts: ResolveOptions = {}): DnsAnswer {
  const name = normalizeName(input)
  const rtt = latencyFor(name || 'root')
  const base: DnsAnswer = {
    status: 'NXDOMAIN',
    name,
    type: 'A',
    answers: [],
    authority: [soaRecord()],
    source: 'none',
    rtt,
  }
  if (!name) return { ...base, status: 'REFUSED' }

  if (LOOPBACK.includes(name)) {
    return {
      ...base,
      status: 'NOERROR',
      source: 'loopback',
      answers: [{ name, type: 'A', value: '127.0.0.1', ttl: 0 }],
      authority: [],
    }
  }

  // an address: reverse lookup
  if (isIpAddress(name)) {
    const host = reverseLookup(name)
    if (!host) return { ...base, type: 'PTR' }
    const entry = ZONE.get(host) ?? wildcardFor(host)?.entry
    return {
      ...base,
      type: 'PTR',
      status: 'NOERROR',
      source: 'reverse',
      answers: [{ name: `${name}.in-addr.arpa.`, type: 'PTR', value: `${host}.`, ttl: 300 }],
      authority: [],
      server: entry?.server,
      site: entry?.site,
    }
  }

  // /etc/hosts wins over the zone
  const override = opts.ignoreHosts ? undefined : opts.hosts?.get(name)
  if (override) {
    const zoneName = reverseLookup(override)
    const entry = zoneName ? ZONE.get(zoneName) : undefined
    return {
      ...base,
      status: 'NOERROR',
      source: 'hosts',
      answers: [{ name, type: 'A', value: override, ttl: 0 }],
      authority: [],
      server: entry?.server,
      site: entry?.site,
    }
  }

  const direct = ZONE.get(name)
  const aliasTarget = ALIASES.get(name)
  const wildcard = direct || aliasTarget ? undefined : wildcardFor(name)
  const entry = direct ?? (aliasTarget ? ZONE.get(aliasTarget) : undefined) ?? wildcard?.entry
  if (!entry) return base
  if (!direct && !aliasTarget && wildcard) ALIASES.set(name, wildcard.canonical ?? name)

  const answers: DnsRecord[] = []
  const canonical = aliasTarget ?? wildcard?.canonical
  if (canonical) {
    answers.push({ name, type: 'CNAME', value: `${canonical}.`, ttl: entry.ttl })
  }
  const target = canonical ?? name
  const ip = RECORDS.find((r) => r.name === target && r.type === 'A')?.value ?? addressFor(target)
  answers.push({ name: target, type: 'A', value: ip, ttl: entry.ttl })
  if (!canonical) answers.push({ name: target, type: 'AAAA', value: ipv6For(target), ttl: entry.ttl })

  return {
    ...base,
    status: 'NOERROR',
    source: 'zone',
    answers,
    authority: RECORDS.filter((r) => r.name === ROOT_ZONE && r.type === 'NS'),
    server: entry.server,
    site: entry.site,
    cname: canonical,
  }
}

function wildcardFor(name: string): { entry: ZoneEntry; canonical?: string } | undefined {
  for (const wild of [...WILDCARDS].sort((a, b) => b.suffix.length - a.suffix.length)) {
    if (name.endsWith(`.${wild.suffix}`) && name !== wild.suffix) {
      const canonical = cleanHost(wild.server.hosts[0] ?? wild.suffix)
      return {
        entry: { server: wild.server, site: siteFor(wild.server, name), ttl: wild.ttl },
        canonical,
      }
    }
  }
  return undefined
}

/** Convenience: the address a name resolves to, or undefined. */
export function addressOf(host: string, opts: ResolveOptions = {}): string | undefined {
  const answer = resolveHost(host, opts)
  const a = answer.answers.find((r) => r.type === 'A')
  return a?.value
}

/** Resolves whatever a user typed — returns the site that should be served. */
export function resolveSite(input: string, opts: ResolveOptions = {}): { answer: DnsAnswer; site?: SiteDef } {
  const answer = resolveHost(input, opts)
  return { answer, site: answer.status === 'NOERROR' ? answer.site : undefined }
}

/* ------------------------------- rendering -------------------------------- */

const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))

/** `dig` output, minus the parts nobody reads. */
export function renderDig(answer: DnsAnswer, type: RecordType | 'ANY' = 'A', at = new Date()): string {
  const id = hashString(`${answer.name}|${type}`) % 65535
  const lines = [
    `; <<>> DiG 9.18.28-MixtNet <<>> ${answer.name || '.'}${type === 'ANY' ? '' : ` ${type}`}`,
    ';; global options: +cmd',
    ';; Got answer:',
    `;; ->>HEADER<<- opcode: QUERY, status: ${answer.status}, id: ${id}`,
    `;; flags: qr rd ra; QUERY: 1, ANSWER: ${answer.answers.length}, AUTHORITY: ${answer.authority.length}, ADDITIONAL: 1`,
    '',
    ';; QUESTION SECTION:',
    `;${pad(`${answer.name}.`, 30)} IN      ${type}`,
    '',
  ]
  if (answer.answers.length) {
    lines.push(';; ANSWER SECTION:')
    for (const record of answer.answers) {
      lines.push(
        `${pad(`${record.name}.`, 30)} ${pad(String(record.ttl), 8)} IN      ${pad(record.type, 8)}${record.value}`,
      )
    }
    lines.push('')
  }
  if (answer.authority.length) {
    lines.push(';; AUTHORITY SECTION:')
    for (const record of answer.authority.slice(0, 2)) {
      lines.push(`${pad(record.name, 30)} ${pad(String(record.ttl), 8)} IN      ${pad(record.type, 8)}${record.value}`)
    }
    lines.push('')
  }
  lines.push(
    `;; Query time: ${answer.rtt} msec`,
    `;; SERVER: 10.0.0.53#53(ns1.mixtnet.com) (${answer.source === 'hosts' ? 'hosts file' : 'MixtNet DNS'})`,
    `;; WHEN: ${at.toUTCString()}`,
    `;; MSG SIZE  rcvd: ${54 + answer.answers.length * 16}`,
  )
  return lines.join('\n')
}

/** `host` output. */
export function renderHost(answer: DnsAnswer): string {
  if (answer.status !== 'NOERROR') return `Host ${answer.name} not found: 3(NXDOMAIN)`
  const lines: string[] = []
  if (answer.cname) lines.push(`${answer.name} is an alias for ${answer.cname}.`)
  for (const record of answer.answers.filter((r) => r.type === 'A')) lines.push(`${answer.name} has address ${record.value}`)
  for (const record of answer.answers.filter((r) => r.type === 'AAAA')) {
    lines.push(`${answer.name} has IPv6 address ${record.value}`)
  }
  for (const record of answer.answers.filter((r) => r.type === 'PTR')) {
    lines.push(`${answer.name} domain name pointer ${record.value}`)
  }
  if (answer.server) {
    for (const record of RECORDS.filter((r) => r.type === 'MX' && r.name === answer.name)) {
      lines.push(`${record.name} mail is handled by ${record.value}.`)
    }
  }
  if (!lines.length) lines.push(`${answer.name} has no records`)
  return lines.join('\n')
}

/** `nslookup` output. */
export function renderNslookup(answer: DnsAnswer): string {
  if (answer.status !== 'NOERROR') {
    return ['Server:\t\t10.0.0.53', 'Address:\t10.0.0.53#53', '', `** server can't find ${answer.name}: NXDOMAIN`].join('\n')
  }
  const a = answer.answers.find((r) => r.type === 'A')
  return [
    'Server:\t\t10.0.0.53',
    'Address:\t10.0.0.53#53',
    '',
    'Non-authoritative answer:',
    answer.cname ? `${answer.name}\tcanonical name = ${answer.cname}.` : `Name:\t${answer.name}`,
    a ? `Address: ${a.value}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
