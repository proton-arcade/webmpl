import { defineServer } from '../types'
import { MINTNET } from '../../sites/portal'

/** The front door: the portal, the search engine, and the zone itself. */
export default defineServer({
  id: 'portal-web-01',
  hosts: ['mintnet.com'],
  aliases: ['search.mintnet.com', 'home.mintnet.com', 'www.mintnet.com'],
  wildcard: ['*.mintnet.com'],
  operator: 'MintNet Foundation',
  location: 'Frankfurt',
  since: '2019-04-11',
  os: 'MintNetOS 4.2 LTS',
  software: 'mintnet-httpd 2.4 / searchd 1.9',
  banner: 'mintnet-httpd/2.4 (MintNetOS) Server at mintnet.com Port 80',
  ttl: 120,
  ports: [
    { port: 80, service: 'http', version: 'mintnet-httpd 2.4' },
    { port: 443, service: 'https', version: 'mintnet-httpd 2.4 (MintTLS 1.3)' },
    { port: 22, service: 'ssh', version: 'OpenSSH 9.6' },
  ],
  records: {
    TXT: ['"v=spf1 mx -all"', '"at the end of the day, the internet is just a folder"'],
    NS: ['ns1.mintnet.com', 'ns2.mintnet.com'],
  },
  sites: [MINTNET],
  notes: 'Answers for the entire mintnet.com zone, including search.',
})
