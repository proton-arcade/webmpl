import { defineServer } from '../types'
import { MIXTBOOK, MIXTUBE } from '../../sites/social'

/** Social and video live on the same box — virtual hosting, two hostnames. */
export default defineServer({
  id: 'social-web-01',
  hosts: ['mixtbook.com', 'mixtube.com'],
  aliases: ['cdn.mixtube.com', 'api.mixtbook.com'],
  operator: 'Mixt Media',
  location: 'Dublin',
  since: '2020-06-19',
  os: 'MixtNetOS 4.2 LTS',
  software: 'feedsrv 5.1 / tubesrv 3.7',
  ports: [
    { port: 80, service: 'http' },
    { port: 443, service: 'https' },
    { port: 8080, service: 'http-alt' },
  ],
  records: { TXT: ['"v=spf1 mx -all"'] },
  sites: [MIXTBOOK, MIXTUBE],
  notes: 'One machine, two web sites picked by the Host: header.',
})
