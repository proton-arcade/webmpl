import { defineServer } from '../types'
import { MINTBPEDIA } from '../../sites/portal'

/** The encyclopaedia — one very large machine with language subdomains. */
export default defineServer({
  id: 'pedia-web-02',
  hosts: ['mintpedia.org'],
  aliases: ['static.mintpedia.org', 'upload.mintpedia.org'],
  wildcard: ['*.mintpedia.org'],
  operator: 'MintPedia Foundation',
  location: 'Amsterdam',
  since: '2020-01-08',
  os: 'MintNetOS 4.2 LTS',
  software: 'mintwiki 1.41',
  banner: 'mintwiki/1.41 MintPedia at mintpedia.org',
  ports: [
    { port: 80, service: 'http' },
    { port: 443, service: 'https', version: 'MintTLS 1.3' },
    { port: 22, service: 'ssh' },
  ],
  records: { TXT: ['"v=spf1 mx -all"'], MX: ['10 mx1.mintmail.com.'] },
  sites: [MINTBPEDIA],
  notes: 'Serves en./de./fr. subdomains from the same machine — the zone is a wildcard.',
})
