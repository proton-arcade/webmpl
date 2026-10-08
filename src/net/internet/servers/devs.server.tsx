import { defineServer } from '../types'
import { MINTDEV, WEBMPL } from '../../sites/tech'

/** Documentation, protocol specs and the home of this very project. */
export default defineServer({
  id: 'dev-web-01',
  hosts: ['mintdev.io', 'webmpl.dev'],
  aliases: ['docs.mintdev.io', 'api.mintdev.io'],
  wildcard: ['*.mintdev.io'],
  operator: 'MintNet Foundation',
  location: 'Helsinki',
  since: '2021-02-02',
  os: 'MintNetOS 4.2 LTS',
  software: 'mintdocs 3.1',
  ports: [
    { port: 80, service: 'http' },
    { port: 443, service: 'https' },
    { port: 3000, service: 'http-alt', version: 'vite dev server (this OS)' },
    { port: 9418, service: 'git', version: 'git daemon' },
  ],
  records: { TXT: ['"v=spf1 -all"', '"you are reading this from inside the project"'] },
  sites: [MINTDEV, WEBMPL],
})
