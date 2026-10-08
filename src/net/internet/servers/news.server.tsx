import { defineServer } from '../types'
import { MINTNEWS } from '../../sites/portal'

/** The newspaper. Type is set by hand, the server is not. */
export default defineServer({
  id: 'news-web-01',
  hosts: ['mintnews.com'],
  aliases: ['editor.mintnews.com', 'static.mintnews.com'],
  operator: 'MintNews Media Group',
  location: 'London',
  since: '2019-11-02',
  os: 'MintNetOS 4.2 LTS',
  software: 'pressroom-cms 8.2',
  banner: 'pressroom-cms/8.2 (MintNews)',
  ports: [
    { port: 80, service: 'http' },
    { port: 443, service: 'https' },
    { port: 8080, service: 'http-alt', version: 'preview server' },
  ],
  records: { MX: ['5 mx1.mintmail.com.', '10 mx2.mintmail.com.'], TXT: ['"v=spf1 mx -all"'] },
  sites: [MINTNEWS],
})
