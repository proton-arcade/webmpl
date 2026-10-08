/* A starter machine on a private zone — the "hello world" of this directory.
 *
 * It uses no TLD of its own: example.mintnet resolves because *you* own this
 * zone. Copy this file, change the hostnames and the page, and you have
 * published something.
 *
 * (Note there is no wildcard here: anything.mintnet stays NXDOMAIN, which is
 * what you want. Add `wildcard: ['*.mintnet']` if you really do own the zone.)
 */
import React from 'react'
import { defineServer } from '../types'
import { SiteShell, Btn, H, Meta, Pill } from '../../sitekit'
import { addressFor, ipv6For, servers } from '../../dns'
import type { PageCtx, SiteDef } from '../../types'

const SANDBOX_SITE: SiteDef = {
  domain: 'example.mintnet',
  title: 'Sandbox',
  glyph: 'Box',
  color: '#7b8794',
  color2: '#4c565f',
  description: 'A blank machine with a tiny website — the starting point for your own server.',
  tags: ['sandbox', 'example', 'starter', 'local'],
  defaultPath: '/',
  pages: [
    {
      path: '/',
      title: 'example.mintnet — sandbox',
      keywords: ['example', 'sandbox', 'hello', 'starter'],
      snippet: 'A minimal site served from a machine you can edit.',
      render: (ctx) => <SandboxHome ctx={ctx} />,
    },
    {
      path: '/dns',
      title: 'This machine — sandbox',
      keywords: ['dns', 'records', 'ports'],
      render: (ctx) => <SandboxDns ctx={ctx} />,
    },
  ],
  text: () =>
    [
      'example.mintnet — sandbox',
      '========================',
      '',
      'A blank machine on the local zone.',
      'It resolves to ' + addressFor('example.mintnet') + ' because this zone is yours.',
      '',
      'Edit src/net/internet/servers/sandbox.server.tsx to change this page.',
    ].join('\n'),
}

function SandboxHome({ ctx }: { ctx: PageCtx }) {
  return (
    <SiteShell site={SANDBOX_SITE} ctx={ctx} maxWidth={720}>
      <H>Hello from example.mintnet</H>
      <p>
        This page is served by <code>sandbox-01</code>, a machine defined in{' '}
        <code>src/net/internet/servers/sandbox.server.tsx</code> — the same file that declares its hostnames,
        ports and DNS records.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '14px 0' }}>
        <Pill>.mintnet is a private zone</Pill>
        <Pill tone="#eef2f7" color="#3f4d5a">
          no TLD needed
        </Pill>
      </div>
      <H level={2}>Publish your own</H>
      <ol style={{ lineHeight: 1.7, color: '#3f4a43' }}>
        <li>
          Copy <code>pastemint.server.tsx</code> in the same folder to a new name.
        </li>
        <li>Change <code>hosts</code> to the name you want, e.g. <code>myapp.mintnet</code>.</li>
        <li>Replace the site with your own pages.</li>
        <li>
          Reload — the address resolves, and <code>dig myapp.mintnet</code> shows your machine.
        </li>
      </ol>
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn onClick={() => ctx.navigate('https://example.mintnet/dns')}>What DNS knows</Btn>
        <Btn tone="grey" onClick={() => ctx.navigate('https://mintdev.io/')}>
          Developer docs
        </Btn>
      </div>
    </SiteShell>
  )
}

function SandboxDns({ ctx }: { ctx: PageCtx }) {
  const self = servers().find((s) => s.id === 'sandbox-01')
  return (
    <SiteShell site={SANDBOX_SITE} ctx={ctx} maxWidth={720}>
      <H>This machine</H>
      <Meta>Live from the MintNet zone — the same data `dig` reads.</Meta>
      <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 14, fontSize: 13.5 }}>
        <tbody>
          {[
            ['machine', self?.id ?? 'sandbox-01'],
            ['A record', addressFor('example.mintnet')],
            ['AAAA record', ipv6For('example.mintnet')],
            ['hosts', (self?.hosts ?? []).join(', ')],
            ['aliases', (self?.aliases ?? []).join(', ') || '—'],
            ['wildcard', (self?.wildcard ?? []).join(', ') || '—'],
            ['operator', self?.operator ?? 'you'],
            ['open ports', (self?.ports ?? []).map((p) => `${p.port}/${p.service}`).join(', ') || '—'],
          ].map(([label, value]) => (
            <tr key={label}>
              <td style={{ padding: '6px 12px 6px 0', color: '#77807a', whiteSpace: 'nowrap' }}>{label}</td>
              <td style={{ padding: '6px 0', fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: 16 }}>
        Drop more files into the internet directory and they show up here too.
      </p>
    </SiteShell>
  )
}

export default defineServer({
  id: 'sandbox-01',
  hosts: ['example.mintnet', 'sandbox.mintnet'],
  aliases: ['test.mintnet'],
  operator: 'you (local user)',
  location: 'this computer',
  since: 'boot time',
  os: 'MintNetOS 4.2 LTS',
  software: 'mintdev preview 0.9',
  ports: [{ port: 3000, service: 'http-alt', version: 'local preview' }],
  sites: [SANDBOX_SITE],
  notes: 'Not a real TLD — resolvable because this zone is yours.',
})
