import { defineServer } from '../types'
import { MINTMAIL } from '../../sites/services'

/** Webmail plus the mail transport that every other zone points its MX at. */
export default defineServer({
  id: 'mail-01',
  hosts: ['mintmail.com', 'mx1.mintmail.com'],
  aliases: ['smtp.mintmail.com', 'imap.mintmail.com', 'webmail.mintmail.com'],
  operator: 'MintNet Foundation',
  location: 'Frankfurt',
  since: '2019-04-11',
  os: 'MintNetOS 4.2 LTS',
  software: 'postfix 3.9 / dovecot 2.3',
  ports: [
    { port: 25, service: 'smtp', version: 'postfix 3.9' },
    { port: 143, service: 'imap', version: 'dovecot 2.3' },
    { port: 443, service: 'https', version: 'webmail' },
    { port: 993, service: 'imaps', version: 'dovecot 2.3' },
  ],
  records: { MX: ['0 mx1.mintmail.com.'], TXT: ['"v=spf1 mx -all"', '"v=DMARC1; p=quarantine"'] },
  sites: [MINTMAIL],
  notes: 'Every MX record in MintNet points here.',
})
