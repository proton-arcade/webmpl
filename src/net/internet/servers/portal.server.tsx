import { defineServer } from '../types'
import { MIXTNET } from '../../sites/portal'

/** The front door: the portal, the search engine, and the zone itself. */
export default defineServer({
  id: 'portal-web-01',
  hosts: ['mixtnet.com'],
  aliases: ['search.mixtnet.com', 'home.mixtnet.com', 'www.mixtnet.com'],
  wildcard: ['*.mixtnet.com'],
  operator: 'MixtNet Foundation',
  location: 'Frankfurt',
  since: '2019-04-11',
  os: 'MixtNetOS 4.2 LTS',
  software: 'mixtnet-httpd 2.4 / searchd 1.9',
  banner: 'mixtnet-httpd/2.4 (MixtNetOS) Server at mixtnet.com Port 80',
  ttl: 120,
  ports: [
    { port: 80, service: 'http', version: 'mixtnet-httpd 2.4' },
    { port: 443, service: 'https', version: 'mixtnet-httpd 2.4 (MixtTLS 1.3)' },
    { port: 22, service: 'ssh', version: 'OpenSSH 9.6' },
  ],
  records: {
    TXT: ['"v=spf1 mx -all"', '"at the end of the day, the internet is just a folder"'],
    NS: ['ns1.mixtnet.com', 'ns2.mixtnet.com'],
  },
  sites: [MIXTNET],
  notes: 'Answers for the entire mixtnet.com zone, including search.',
})
