import { defineServer } from '../types'

/** The authority for the whole MixtNet zone. Two machines, one file. */
export default [
  defineServer({
    id: 'ns1',
    hosts: ['ns1.mixtnet.com'],
    ip: '10.0.0.53',
    ipv6: 'fd00:0:53::1',
    operator: 'MixtNet Network Operations',
    location: 'Frankfurt',
    since: '2019-04-11',
    os: 'MixtNetOS 4 (router)',
    software: 'BIND 9.18.28-MixtNet',
    ports: [
      { port: 53, proto: 'tcp', service: 'domain' },
      { port: 53, proto: 'udp', service: 'domain' },
      { port: 22, service: 'ssh', version: 'OpenSSH 9.6' },
    ],
    records: { TXT: ['"v=spf1 -all"', '"authoritative for mixtnet."'] },
    notes: 'Primary nameserver. Answers every *.mixtnet query.',
  }),
  defineServer({
    id: 'ns2',
    hosts: ['ns2.mixtnet.com'],
    ip: '10.0.0.54',
    ipv6: 'fd00:0:54::1',
    operator: 'MixtNet Network Operations',
    location: 'Helsinki',
    since: '2019-04-11',
    os: 'MixtNetOS 4 (router)',
    software: 'BIND 9.18.28-MixtNet',
    ports: [
      { port: 53, proto: 'tcp', service: 'domain' },
      { port: 53, proto: 'udp', service: 'domain' },
    ],
    notes: 'Secondary nameserver, the one your resolv.conf lists second.',
  }),
]
