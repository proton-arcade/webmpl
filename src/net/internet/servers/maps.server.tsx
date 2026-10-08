import { defineServer } from '../types'
import { MINTMAPS } from '../../sites/services'

/** Tile server for the cartography. It draws every tile by hand. */
export default defineServer({
  id: 'maps-web-01',
  hosts: ['mintmaps.com'],
  aliases: ['tiles.mintmaps.com'],
  operator: 'MintNet Foundation',
  location: 'Frankfurt',
  since: '2021-07-07',
  os: 'MintNetOS 4.2 LTS',
  software: 'tileserver 1.4',
  ports: [
    { port: 80, service: 'http' },
    { port: 443, service: 'https' },
  ],
  sites: [MINTMAPS],
})
