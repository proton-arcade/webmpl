import { defineServer } from '../types'
import { MIXTOS } from '../../sites/tech'

/** The distribution mirror. Packages, ISOs, and the odd donation page. */
export default defineServer({
  id: 'mirror-eu-01',
  hosts: ['mixtos.com', 'mirror.mixtos.com'],
  aliases: ['ftp.mixtos.com', 'packages.mixtos.com'],
  operator: 'Mixt OS project',
  location: 'London',
  since: '2006-08-27',
  os: 'Mixt 12',
  software: 'nginx 1.24 (mirror)',
  banner: 'nginx/1.24.0 (Mixt mirror)',
  ports: [
    { port: 80, service: 'http' },
    { port: 443, service: 'https' },
    { port: 873, service: 'rsync', version: 'rsync 3.2.7' },
    { port: 22, service: 'ssh' },
  ],
  records: { MX: ['10 mx1.mixtmail.com.'], TXT: ['"v=spf1 mx -all"'] },
  sites: [MIXTOS],
  notes: 'Mirrors the packages you pretend to install.',
})
