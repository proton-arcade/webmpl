import { defineServer } from '../types'
import { MINTGAMES } from '../../sites/social'

/** The arcade. Small machine, high scores. */
export default defineServer({
  id: 'games-web-01',
  hosts: ['mintgames.com'],
  aliases: ['play.mintgames.com'],
  operator: 'Mint Media',
  location: 'Dublin',
  since: '2021-03-14',
  os: 'MintNetOS 4.2 LTS',
  software: 'arcaded 2.0',
  ports: [
    { port: 80, service: 'http' },
    { port: 443, service: 'https' },
    { port: 2048, service: 'game', version: '2048 (the real one)' },
  ],
  sites: [MINTGAMES],
  notes: 'The 2048 machine is on port 2048. It seemed funny at the time.',
})
