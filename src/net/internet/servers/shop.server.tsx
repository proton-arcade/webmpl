import { defineServer } from '../types'
import { MINTCART } from '../../sites/services'

/** The shop, with a payment terminal that only accepts imaginary cards. */
export default defineServer({
  id: 'cart-web-01',
  hosts: ['mintcart.com'],
  aliases: ['checkout.mintcart.com', 'cdn.mintcart.com'],
  operator: 'MintCart Trading',
  location: 'Rotterdam',
  since: '2020-09-30',
  os: 'MintNetOS 4.0',
  software: 'storefront 7.3',
  banner: 'storefront/7.3 (MintCart)',
  ports: [
    { port: 80, service: 'http' },
    { port: 443, service: 'https', version: 'MintTLS 1.3' },
    { port: 5432, service: 'postgresql', version: 'orders database' },
  ],
  records: { TXT: ['"v=spf1 include:mintmail.com -all"', '"returns accepted within 30 imaginary days"'] },
  sites: [MINTCART],
})
