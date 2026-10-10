/* Administration — the administrator console.
 *
 * Everything that is privileged on the Mixt backend lives here, in one place,
 * and the app itself only exists for the administrator account: approving or
 * rejecting published apps, managing the whitelisted accounts, and reading what
 * the server is holding. Standard users and guests never see it.
 */
import React, { useCallback, useEffect, useState } from 'react'
import * as backend from '../os/api'
import { GUEST_DOMAIN } from '../os/mailaddr'
import type { AppProps } from '../os/types'

type Tab = 'apps' | 'users' | 'server'

const card: React.CSSProperties = {
  border: '1px solid rgba(0,0,0,0.14)',
  borderRadius: 10,
  padding: 14,
  background: 'color-mix(in srgb, var(--wm-window-bg) 94%, #ffffff)',
}
const row: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 110px 92px 118px 96px',
  gap: 8,
  alignItems: 'center',
  padding: '7px 0',
  borderBottom: '1px solid rgba(0,0,0,0.08)',
  fontSize: 13,
}
const head: React.CSSProperties = { ...row, fontWeight: 700, opacity: 0.72, fontSize: 12, borderBottom: '1px solid rgba(0,0,0,0.2)' }

export default function AdminApp({ api }: AppProps) {
  const session = backend.getSession()
  const [tab, setTab] = useState<Tab>('apps')
  const [apps, setApps] = useState<{ id: string; name: string; author: string; status: string }[]>([])
  const [users, setUsers] = useState<backend.ServerUser[] | null>(null)
  const [stats, setStats] = useState<backend.ServerStats | null>(null)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [newUser, setNewUser] = useState({ username: '', password: '', admin: false })
  /* publishing from the console: the code is part of the submission */
  const [newApp, setNewApp] = useState({ name: '', code: '' })
  /* which account's password is being replaced, and with what */
  const [pwFor, setPwFor] = useState<{ username: string; password: string } | null>(null)
  const [guests, setGuests] = useState<backend.GuestLogin[] | null>(null)

  const refresh = useCallback(async () => {
    const [a, u, s, g] = await Promise.all([backend.serverApps(), backend.allUsers(), backend.stats(), backend.guestLog()])
    setApps(a)
    setUsers(u)
    setStats(s)
    setGuests(g)
  }, [])

  useEffect(() => {
    api.setTitle('Administration')
    refresh()
  }, [])

  if (!session || session.role !== 'admin') {
    return (
      <div style={{ padding: 26, fontSize: 13.5, lineHeight: 1.6 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Administrator access only</div>
        <div style={{ opacity: 0.8 }}>
          This console manages the Mixt server: published apps, whitelisted accounts and server data. Sign in with the
          administrator account to use it.
        </div>
      </div>
    )
  }

  const flash = (m: string) => {
    setMessage(m)
    setTimeout(() => setMessage(''), 4000)
  }

  const act = async (label: string, fn: () => Promise<boolean | { ok: boolean; error?: string }>) => {
    setBusy(label)
    const r = await fn()
    setBusy('')
    const good = typeof r === 'boolean' ? r : r.ok
    flash(good ? `${label} — done.` : `${label} — ${typeof r === 'boolean' ? 'the server refused it.' : r.error}`)
    await refresh()
  }

  const pending = apps.filter((a) => a.status === 'pending')
  const approved = apps.filter((a) => a.status === 'approved')

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--wm-window-bg)', color: 'var(--wm-fg)', fontSize: 13.5 }}>
      {/* header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(0,0,0,0.14)', background: 'linear-gradient(180deg,#87cf3e,#6fa34c)', color: '#fff' }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Administration</div>
        <div style={{ fontSize: 12, opacity: 0.95 }}>
          Signed in as {session.username} · administrator · {stats ? `${stats.users} accounts, ${stats.appsPending} pending` : 'reading server…'}
        </div>
      </div>

      {/* tabs */}
      <div style={{ display: 'flex', gap: 4, padding: '8px 12px', borderBottom: '1px solid rgba(0,0,0,0.12)' }}>
        {(
          [
            ['apps', `Published apps${pending.length ? ` (${pending.length})` : ''}`],
            ['users', `Accounts${users ? ` (${users.length})` : ''}`],
            ['server', 'Server'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? 'btn-mixt' : 'btn-ghost'}
            onClick={() => setTab(id)}
            style={{ padding: '5px 12px', fontSize: 12.5 }}
          >
            {label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="btn-ghost" onClick={refresh} style={{ padding: '5px 12px', fontSize: 12.5 }}>
          Refresh
        </button>
      </div>

      {message && <div style={{ padding: '8px 16px', fontSize: 12.5, background: 'rgba(158,222,106,0.22)', borderBottom: '1px solid rgba(0,0,0,0.1)' }}>{message}</div>}

      <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'grid', gap: 14, alignContent: 'start' }}>
        {/* --------------------------- published apps -------------------------- */}
        {tab === 'apps' && (
          <>
            <div style={card}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Waiting for approval</div>
              {pending.length === 0 ? (
                <div style={{ opacity: 0.7, fontSize: 12.5 }}>Nothing is waiting. Apps published by whitelisted users appear here first.</div>
              ) : (
                <>
                  <div style={head}>
                    <span>App</span>
                    <span>Author</span>
                    <span>Status</span>
                    <span style={{ textAlign: 'right' }}>Decision</span>
                  </div>
                  {pending.map((a) => (
                    <div style={row} key={a.id}>
                      <span style={{ fontWeight: 600 }}>{a.name}</span>
                      <span style={{ opacity: 0.8 }}>{a.author}</span>
                      <span style={{ opacity: 0.7 }}>pending</span>
                      <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button className="btn-mixt" disabled={!!busy} onClick={() => act('Approve', () => backend.approveApp(a.id))} style={{ padding: '3px 10px', fontSize: 12 }}>
                          Approve
                        </button>
                        <button className="btn-ghost" disabled={!!busy} onClick={() => act('Reject', () => backend.rejectApp(a.id))} style={{ padding: '3px 10px', fontSize: 12 }}>
                          Reject
                        </button>
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>

            <div style={card}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Publish an app</div>
              <div style={{ fontSize: 12.5, opacity: 0.8, lineHeight: 1.5, marginBottom: 10 }}>
                What the administrator publishes goes straight out approved — there is nobody above you to approve it.
                The code is part of the submission: the server refuses an app that has none.
              </div>
              <input
                className="entry"
                placeholder="App name"
                value={newApp.name}
                onChange={(e) => setNewApp({ ...newApp, name: e.target.value })}
                style={{ width: '100%', marginBottom: 8 }}
              />
              <textarea
                className="entry"
                placeholder="The code of the app"
                value={newApp.code}
                onChange={(e) => setNewApp({ ...newApp, code: e.target.value })}
                style={{ width: '100%', height: 130, fontFamily: 'var(--font-mono)', fontSize: 12 }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                <button
                  className="btn-mixt"
                  disabled={!!busy || !newApp.name || !newApp.code}
                  onClick={() =>
                    act('Publish app', async () => {
                      const r = await backend.publishApp(newApp.name.trim(), newApp.code, { approved: true, author: session.username })
                      if (r.ok) setNewApp({ name: '', code: '' })
                      return r
                    })
                  }
                  style={{ padding: '5px 14px', fontSize: 12.5 }}
                >
                  Publish approved
                </button>
              </div>
            </div>

            <div style={card}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Published ({approved.length})</div>
              {approved.length === 0 ? (
                <div style={{ opacity: 0.7, fontSize: 12.5 }}>No approved apps yet.</div>
              ) : (
                <>
                  <div style={head}>
                    <span>App</span>
                    <span>Author</span>
                    <span>Status</span>
                    <span style={{ textAlign: 'right' }}>Remove</span>
                  </div>
                  {approved.map((a) => (
                    <div style={row} key={a.id}>
                      <span style={{ fontWeight: 600 }}>{a.name}</span>
                      <span style={{ opacity: 0.8 }}>{a.author}</span>
                      <span style={{ opacity: 0.7 }}>approved</span>
                      <span style={{ textAlign: 'right' }}>
                        <button className="btn-ghost" disabled={!!busy} onClick={() => act('Remove', () => backend.rejectApp(a.id))} style={{ padding: '3px 10px', fontSize: 12 }}>
                          Remove
                        </button>
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </>
        )}

        {/* ------------------------------ accounts ----------------------------- */}
        {tab === 'users' && (
          <>
            <div style={card}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Whitelisted accounts</div>
              {!users ? (
                <div style={{ opacity: 0.7, fontSize: 12.5 }}>The server did not return the account list.</div>
              ) : (
                <>
                  <div style={head}>
                    <span>Username</span>
                    <span>Role</span>
                    <span>Mailbox</span>
                    <span>Password</span>
                    <span style={{ textAlign: 'right' }}>Remove</span>
                  </div>
                  {users.map((u) => (
                    <div style={row} key={u.username}>
                      <span style={{ fontWeight: 600 }}>
                        {u.username}
                        {u.username === session.username && <span style={{ fontWeight: 400, opacity: 0.65 }}> · this session</span>}
                      </span>
                      <span>{u.role === 'admin' ? 'Administrator' : 'Standard user'}</span>
                      <span>
                        <button
                          className={u.mailbox ? 'btn-mixt' : 'btn-ghost'}
                          disabled={!!busy}
                          title={u.mailbox ? 'Switch this mailbox off (the mail is kept, not deleted)' : 'Give this account a mailbox'}
                          onClick={() => act(`${u.mailbox ? 'Close' : 'Open'} ${u.username}'s mailbox`, () => backend.setMailbox(u.username, !u.mailbox))}
                          style={{ padding: '3px 10px', fontSize: 12 }}
                        >
                          {u.mailbox ? 'On' : 'Off'}
                        </button>
                      </span>
                      <span>
                        {pwFor?.username === u.username ? (
                          <span style={{ display: 'flex', gap: 4 }}>
                            <input
                              className="entry"
                              type="password"
                              autoFocus
                              placeholder="new password"
                              value={pwFor.password}
                              onChange={(e) => setPwFor({ ...pwFor, password: e.target.value })}
                              style={{ width: 86, padding: '2px 6px', fontSize: 12 }}
                            />
                            <button
                              className="btn-mixt"
                              disabled={!!busy || !pwFor.password}
                              onClick={() =>
                                act(`Set ${u.username}'s password`, async () => {
                                  const r = await backend.setUserPassword(u.username, pwFor.password)
                                  if (r.ok) setPwFor(null)
                                  return r
                                })
                              }
                              style={{ padding: '3px 8px', fontSize: 12 }}
                            >
                              Set
                            </button>
                          </span>
                        ) : (
                          <button
                            className="btn-ghost"
                            disabled={!!busy}
                            title="Set a new password for this account"
                            onClick={() => setPwFor({ username: u.username, password: '' })}
                            style={{ padding: '3px 10px', fontSize: 12 }}
                          >
                            Set
                          </button>
                        )}
                      </span>
                      <span style={{ textAlign: 'right' }}>
                        <button
                          className="btn-ghost"
                          disabled={!!busy || u.username === session.username}
                          title={u.username === session.username ? 'You cannot remove your own account' : 'Remove this account'}
                          onClick={() => act('Remove account', () => backend.removeUser(u.username))}
                          style={{ padding: '3px 10px', fontSize: 12 }}
                        >
                          Remove
                        </button>
                      </span>
                    </div>
                  ))}
                </>
              )}
              <div style={{ fontSize: 12, opacity: 0.72, marginTop: 10, lineHeight: 1.5 }}>
                Guests are not listed: they are allowed in without an account and nothing is ever saved for them.
              </div>
            </div>

            <div style={card}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Guest accounts</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  className={stats?.guestMailbox ? 'btn-mixt' : 'btn-ghost'}
                  disabled={!!busy}
                  onClick={() => act(`${stats?.guestMailbox ? 'Close' : 'Open'} guest mail`, () => backend.setMailbox('guest', !stats?.guestMailbox))}
                  style={{ padding: '4px 12px', fontSize: 12.5 }}
                >
                  Guest mail: {stats?.guestMailbox ? 'on' : 'off'}
                </button>
                <span style={{ fontSize: 12.5, opacity: 0.78, lineHeight: 1.5 }}>
                  Guests are not accounts and nothing of theirs is saved, but they sign in with a username, a name and a
                  password, and those sign-ins are logged below. With guest mail switched on, each guest gets a mailbox
                  of their own at <code>NAME@{GUEST_DOMAIN}</code> — not one shared box — and it goes away when they
                  sign out. Mail never leaves this computer.
                </span>
              </div>
              {guests && guests.length > 0 && (
                <>
                  <div style={{ ...head, gridTemplateColumns: '1fr 1fr 160px', marginTop: 12 }}>
                    <span>Username</span>
                    <span>Name</span>
                    <span>Signed in</span>
                  </div>
                  {guests
                    .slice()
                    .reverse()
                    .map((g, i) => (
                      <div style={{ ...row, gridTemplateColumns: '1fr 1fr 160px' }} key={`${g.username}-${g.at}-${i}`}>
                        <span style={{ fontWeight: 600 }}>{g.username || 'guest'}</span>
                        <span>{g.name || '—'}</span>
                        <span style={{ opacity: 0.75 }}>{new Date(g.at).toLocaleString()}</span>
                      </div>
                    ))}
                </>
              )}
              {(!guests || guests.length === 0) && (
                <div style={{ fontSize: 12.5, opacity: 0.7, marginTop: 10 }}>No guest has signed in yet.</div>
              )}
            </div>

            <div style={card}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Add an account</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto', gap: 8, alignItems: 'center' }}>
                <input className="entry" placeholder="username" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value.toLowerCase() })} />
                <input className="entry" type="password" placeholder="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
                <label style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={newUser.admin} onChange={(e) => setNewUser({ ...newUser, admin: e.target.checked })} />
                  administrator
                </label>
                <button
                  className="btn-mixt"
                  disabled={!!busy || !newUser.username}
                  onClick={() =>
                    act('Add account', async () => {
                      const r = await backend.addUser(newUser.username, newUser.password, newUser.admin)
                      if (r.ok) setNewUser({ username: '', password: '', admin: false })
                      return r
                    })
                  }
                  style={{ padding: '5px 14px', fontSize: 12.5 }}
                >
                  Add
                </button>
              </div>
              <div style={{ fontSize: 12, opacity: 0.72, marginTop: 8 }}>
                2–24 characters: letters, digits, dot, dash or underscore. Passwords are stored salted and hashed in
                <code> data.json</code>.
              </div>
            </div>
          </>
        )}

        {/* ------------------------------- server ------------------------------ */}
        {tab === 'server' && (
          <>
            <div style={card}>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>What the server is holding</div>
              {!stats ? (
                <div style={{ opacity: 0.7, fontSize: 12.5 }}>No statistics came back — is the backend running?</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10 }}>
                  {(
                    [
                      ['Accounts', stats.users],
                      ['Administrators', stats.admins],
                      ['Live sessions', stats.sessions],
                      ['Apps pending', stats.appsPending],
                      ['Apps published', stats.appsApproved],
                      ['Mailboxes', stats.mailboxes],
                      ['Saved settings', stats.savedSettings],
                    ] as [string, number][]
                  ).map(([label, n]) => (
                    <div key={label} style={{ border: '1px solid rgba(0,0,0,0.12)', borderRadius: 8, padding: '8px 10px' }}>
                      <div style={{ fontSize: 20, fontWeight: 700 }}>{n}</div>
                      <div style={{ fontSize: 11.5, opacity: 0.72 }}>{label}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={card}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>How it is put together</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7, opacity: 0.85 }}>
                <li>
                  <code>server.cjs</code> serves this site and the API on one port; restart it with <code>node server.cjs</code>.
                </li>
                <li>
                  Everything is stored in <code>data.json</code> — accounts, sessions, published apps, mail and saved
                  settings. Delete that file to start the server over.
                </li>
                <li>
                  The administrator password is read from <code>ROOTPASS.md</code> on start-up; edit the line and restart
                  to change it.
                </li>
                <li>Guests are never written to <code>data.json</code> and their writes are refused with 403.</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
