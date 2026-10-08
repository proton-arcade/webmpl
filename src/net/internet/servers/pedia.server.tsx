import { defineServer } from '../types'
import { MIXTPEDIA } from '../../sites/portal'

/** The encyclopaedia — one very large machine with language subdomains. */
export default defineServer({
  id: 'pedia-web-02',
  hosts: ['mixtpedia.org'],
  aliases: ['static.mixtpedia.org', 'upload.mixtpedia.org'],
  wildcard: ['*.mixtpedia.org'],
  operator: 'MixtPedia Foundation',
  location: 'Amsterdam',
  since: '2020-01-08',
  os: 'MixtNetOS 4.2 LTS',
  software: 'mixtwiki 1.41',
  banner: 'mixtwiki/1.41 MixtPedia at mixtpedia.org',
  ports: [
    { port: 80, service: 'http' },
    { port: 443, service: 'https', version: 'MixtTLS 1.3' },
    { port: 22, service: 'ssh' },
  ],
  records: { TXT: ['"v=spf1 mx -all"'], MX: ['10 mx1.mixtmail.com.'] },
  sites: [MIXTPEDIA],
  notes: 'Serves en./de./fr. subdomains from the same machine — the zone is a wildcard.',
})
