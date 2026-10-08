import { defineServer } from '../types'
import { LINUXMINT } from '../../sites/tech'

/** The distribution mirror. Packages, ISOs, and the odd donation page. */
export default defineServer({
  id: 'mirror-eu-01',
  hosts: ['linuxmint.com', 'mirror.linuxmint.com'],
  aliases: ['ftp.linuxmint.com', 'packages.linuxmint.com'],
  operator: 'Linux Mint project',
  location: 'London',
  since: '2006-08-27',
  os: 'Debian GNU/Linux 12',
  software: 'nginx 1.24 (mirror)',
  banner: 'nginx/1.24.0 (Mint mirror)',
  ports: [
    { port: 80, service: 'http' },
    { port: 443, service: 'https' },
    { port: 873, service: 'rsync', version: 'rsync 3.2.7' },
    { port: 22, service: 'ssh' },
  ],
  records: { MX: ['10 mx1.mintmail.com.'], TXT: ['"v=spf1 mx -all"'] },
  sites: [LINUXMINT],
  notes: 'Mirrors the packages you pretend to install.',
})
