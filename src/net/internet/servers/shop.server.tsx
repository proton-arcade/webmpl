import { defineServer } from '../types'
import { MIXTCART } from '../../sites/services'

/** The shop, with a payment terminal that only accepts imaginary cards. */
export default defineServer({
  id: 'cart-web-01',
  hosts: ['mixtcart.com'],
  aliases: ['checkout.mixtcart.com', 'cdn.mixtcart.com'],
  operator: 'MixtCart Trading',
  location: 'Rotterdam',
  since: '2020-09-30',
  os: 'MixtNetOS 4.0',
  software: 'storefront 7.3',
  banner: 'storefront/7.3 (MixtCart)',
  ports: [
    { port: 80, service: 'http' },
    { port: 443, service: 'https', version: 'MixtTLS 1.3' },
    { port: 5432, service: 'postgresql', version: 'orders database' },
  ],
  records: { TXT: ['"v=spf1 include:mixtmail.com -all"', '"returns accepted within 30 imaginary days"'] },
  sites: [MIXTCART],
})
