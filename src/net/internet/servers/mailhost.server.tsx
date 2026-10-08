import { defineServer } from '../types'
import { MIXTMAIL } from '../../sites/services'

/** Webmail plus the mail transport that every other zone points its MX at. */
export default defineServer({
  id: 'mail-01',
  hosts: ['mixtmail.com', 'mx1.mixtmail.com'],
  aliases: ['smtp.mixtmail.com', 'imap.mixtmail.com', 'webmail.mixtmail.com'],
  operator: 'MixtNet Foundation',
  location: 'Frankfurt',
  since: '2019-04-11',
  os: 'MixtNetOS 4.2 LTS',
  software: 'postfix 3.9 / dovecot 2.3',
  ports: [
    { port: 25, service: 'smtp', version: 'postfix 3.9' },
    { port: 143, service: 'imap', version: 'dovecot 2.3' },
    { port: 443, service: 'https', version: 'webmail' },
    { port: 993, service: 'imaps', version: 'dovecot 2.3' },
  ],
  records: { MX: ['0 mx1.mixtmail.com.'], TXT: ['"v=spf1 mx -all"', '"v=DMARC1; p=quarantine"'] },
  sites: [MIXTMAIL],
  notes: 'Every MX record in MixtNet points here.',
})
