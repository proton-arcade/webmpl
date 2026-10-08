import { defineServer } from '../types'
import { MIXTNEWS } from '../../sites/portal'

/** The newspaper. Type is set by hand, the server is not. */
export default defineServer({
  id: 'news-web-01',
  hosts: ['mixtnews.com'],
  aliases: ['editor.mixtnews.com', 'static.mixtnews.com'],
  operator: 'MixtNews Media Group',
  location: 'London',
  since: '2019-11-02',
  os: 'MixtNetOS 4.2 LTS',
  software: 'pressroom-cms 8.2',
  banner: 'pressroom-cms/8.2 (MixtNews)',
  ports: [
    { port: 80, service: 'http' },
    { port: 443, service: 'https' },
    { port: 8080, service: 'http-alt', version: 'preview server' },
  ],
  records: { MX: ['5 mx1.mixtmail.com.', '10 mx2.mixtmail.com.'], TXT: ['"v=spf1 mx -all"'] },
  sites: [MIXTNEWS],
})
