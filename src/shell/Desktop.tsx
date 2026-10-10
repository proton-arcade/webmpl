import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useOS } from '../os/store'
import { useVFS, HOME, join, vfs } from '../os/vfs'
import WindowFrame from './WindowFrame'
import Panel from './Panel'
import MainMenu from './MainMenu'
import Notifications from './Notifications'
import { Popup, usePopup, type MenuItem } from './ContextMenu'
import { AppIcon, FileIcon, Glyph } from './AppIcon'
import { getApp, visibleApps } from '../apps/registry'
import { Dialog } from '../apps/files'
import { validateUsername, ACCENTS } from '../os/users'
import * as api from '../os/api'
import { setPersistenceEnabled } from '../os/storage'
import { mountFilesystem, persistNow, setAdminView } from '../os/vfs'
import { ensureFilesystem } from '../os/bootstrap'
import { loadInstalled } from '../os/store'
import { appForFile, launch } from '../os/bus'

export default function Desktop() {
  const settings = useOS((s) => s.settings)
  const windows = useOS((s) => s.windows)
  const workspace = useOS((s) => s.workspace)
  const showDesktop = useOS((s) => s.showDesktop)
  const menuOpen = useOS((s) => s.menuOpen)
  const exposeOpen = useOS((s) => s.exposeOpen)
  const locked = useOS((s) => s.locked)
  const hasUsers = useOS((s) => s.users.length > 0)
  const runDialogOpen = useOS((s) => s.runDialogOpen)
  const vfsRevision = useVFS((s) => s.revision)

  const desktopMenu = usePopup<null>()
  const [winMenu, setWinMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [session, setSession] = useState<null | 'shutdown' | 'reboot' | 'logout'>(null)
  const [altTab, setAltTab] = useState<{ open: boolean; index: number }>({ open: false, index: 0 })
  const [showIcons, setShowIcons] = useState(true)
  /* Boot splash: the desktop renders underneath it, so nothing is delayed —
     it is only the moment of arrival that gets a little ceremony. */
  const [booting, setBooting] = useState(true)
  const [bootFade, setBootFade] = useState(false)
  useEffect(() => {
    const fade = setTimeout(() => setBootFade(true), 700)
    const done = setTimeout(() => setBooting(false), 1080)
    return () => {
      clearTimeout(fade)
      clearTimeout(done)
    }
  }, [])

  const [authGate, setAuthGate] = useState(false)
  const [serverSession, setServerSession] = useState<api.Session | null>(() => api.getSession())
  const [, bump] = useState(0)

  /* A backend account IS the account. Without adopting it, signing in as the
     administrator still showed the first-boot "create an account" form, and the
     panel, menu and settings kept showing the default local user instead. */
  const adoptServerSession = (s: api.Session | null) => {
    setServerSession(s)
    if (!s) return
    setPersistenceEnabled(s.role !== 'guest')
    /* Every account gets its own filesystem, kept in this browser under its own
     * key. Signing in swaps the mounted tree to theirs; what the previous
     * session had is written out first, so nothing is lost on the way past. */
    mountFilesystem(s.username || 'anonymous')
    /* …and what that account has installed, which is theirs too */
    loadInstalled(s.username || 'anonymous')
    /* Filled in again now that this account's tree is the one mounted. Running
     * it only at boot wrote into a tree that this mount then replaced, so the
     * home folders, the hosted share and /usr/share/applications were missing
     * for anybody who signed in. */
    ensureFilesystem()
    /* only the administrator gets the /users folder at the root */
    setAdminView(s.role === 'admin')
    const st = useOS.getState()
    st.setServerRole(s.role)
    if (st.settings.username !== s.username) st.setSettings({ username: s.username, fullName: s.username })
  }

  useEffect(() => {
    /* A stored session is adopted straight away, without waiting for the
     * backend to answer. It used to be adopted only inside this .then, so with
     * no backend reachable the desktop came up on the default account's
     * filesystem instead of the signed-in one — the wrong files, and no /users
     * for an administrator. Whether the server answers only decides whether to
     * show the sign-in gate. */
    const stored = api.getSession()
    if (stored) adoptServerSession(stored)

    /* Adopting the session and asking the server are separate jobs. The
     * session has to be adopted whatever the server does — it used to happen
     * only inside this .then, so signing in or out while the backend was
     * unreachable left the previous person's filesystem mounted, and the next
     * person to sit down could read their files. */
    const adopt = () => {
      const s = api.getSession()
      if (s) adoptServerSession(s)
      return s
    }
    const refresh = () => {
      const s = adopt()
      api
        .online()
        .then((ok) => {
          const now = api.getSession()
          setAuthGate(ok && !now)
          if (now) adoptServerSession(now)
        })
        .catch(() => setAuthGate(!s))
    }
    refresh()
    // logging out (or the server going away) re-opens the login gate
    window.addEventListener('mixt:authchanged', refresh)
    return () => window.removeEventListener('mixt:authchanged', refresh)
  }, [])

  const desktopFiles = useMemo(() => {
    const list = vfs.list(`${HOME}/Desktop`) ?? []
    return list.filter((f) => !f.name.startsWith('.'))
  }, [vfsRevision, windows.length])

  /* ----------------------------- global events ----------------------------- */
  useEffect(() => {
    const onWindowMenu = (e: any) => setWinMenu(e.detail)
    const onLaunch = (e: any) => {
      const { appId, props } = e.detail ?? {}
      if (appId) launch(appId, props ?? {})
    }
    const onFile = (e: any) => {
      const { path, content, mime } = e.detail ?? {}
      if (path) {
        vfs.write(path, content, mime)
        useOS.getState().notify({
          title: 'File saved',
          body: `${path.replace('/home/mixt/', '~/')}`,
          appId: 'nemo',
        })
      }
    }
    const onNotify = (e: any) => {
      const { title, body, appId } = e.detail ?? {}
      if (title) useOS.getState().notify({ title, body, appId })
    }
    const onSession = (e: any) => {
      const detail = e.detail
      if (detail === 'shutdown' || detail === 'poweroff') setSession('shutdown')
      else if (detail === 'reboot') setSession('reboot')
      else if (detail === 'logout') setSession('logout')
    }
    window.addEventListener('mixt:windowmenu', onWindowMenu)
    window.addEventListener('mixt:launch', onLaunch)
    window.addEventListener('mixt:file', onFile)
    window.addEventListener('mixt:notify', onNotify)
    window.addEventListener('mixt:session', onSession)
    return () => {
      window.removeEventListener('mixt:windowmenu', onWindowMenu)
      window.removeEventListener('mixt:launch', onLaunch)
      window.removeEventListener('mixt:file', onFile)
      window.removeEventListener('mixt:notify', onNotify)
      window.removeEventListener('mixt:session', onSession)
    }
  }, [])

  /* ------------------------------ keyboard -------------------------------- */
  useEffect(() => {
    let altTabActive = false
    const onKeyDown = (e: KeyboardEvent) => {
      const S = useOS.getState()
      const target = e.target as HTMLElement
      const typing = ['INPUT', 'TEXTAREA'].includes(target?.tagName) || target?.isContentEditable

      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault()
        launch('terminal', {})
        return
      }
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        S.setLocked(true)
        return
      }
      if (e.ctrlKey && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        S.switchWorkspace(S.workspace + (e.key === 'ArrowRight' ? 1 : -1))
        return
      }
      if (e.key === 'F2' && e.altKey) {
        e.preventDefault()
        S.setRunDialog(true)
        return
      }
      if (e.key === 'F4' && e.altKey && S.activeId) {
        e.preventDefault()
        S.closeWindow(S.activeId)
        return
      }
      if (e.key === 'Tab' && e.altKey) {
        e.preventDefault()
        altTabActive = true
        setAltTab((s) => ({ open: true, index: e.shiftKey ? Math.max(0, s.index - 1) : s.index + 1 }))
        return
      }
      if (e.key === 'Meta' && !e.ctrlKey && !e.altKey && !e.shiftKey && !typing) {
        S.setMenuOpen(!S.menuOpen)
        return
      }
      if (e.key.toLowerCase() === 'd' && e.metaKey && !typing) {
        e.preventDefault()
        S.toggleShowDesktop()
        return
      }
      if (e.key === 'Escape') {
        if (S.exposeOpen) S.setExposeOpen(false)
        else if (S.runDialogOpen) S.setRunDialog(false)
      }
      if (e.key === 'ArrowLeft' && e.metaKey && S.activeId) {
        e.preventDefault()
        S.snap(S.activeId, 'left')
      }
      if (e.key === 'ArrowRight' && e.metaKey && S.activeId) {
        e.preventDefault()
        S.snap(S.activeId, 'right')
      }
      if (e.key === 'ArrowUp' && e.metaKey && S.activeId) {
        e.preventDefault()
        S.snap(S.activeId, 'max')
      }
      if (e.key === 'ArrowDown' && e.metaKey && S.activeId) {
        e.preventDefault()
        S.snap(S.activeId, 'bottom')
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt' && altTabActive) {
        altTabActive = false
        const S = useOS.getState()
        const list = S.windows.filter((w) => w.workspace === S.workspace)
        const n = Math.max(1, list.length)
        const target = list[((altTab.index % n) + n) % n]
        setAltTab({ open: false, index: 0 })
        if (target) S.focusWindow(target.id)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [altTab.index])

  /* ------------------------------ desktop menu ---------------------------- */
  function desktopMenuItems(): MenuItem[] {
    return [
      {
        label: 'New Folder…',
        icon: <Glyph name="Folder" size={14} />,
        onClick: () => {
          let name = 'New Folder'
          let i = 1
          while (vfs.exists(join(HOME, 'Desktop', name))) name = `New Folder ${++i}`
          vfs.mkdir(join(HOME, 'Desktop', name))
        },
      },
      {
        label: 'New Document',
        icon: <Glyph name="FileText" size={14} />,
        submenu: [
          { label: 'Empty File', onClick: () => createDesktopFile('Untitled.txt', '') },
          { label: 'Text Document', onClick: () => createDesktopFile('note.txt', 'A new note.\n') },
          { label: 'Markdown Document', onClick: () => createDesktopFile('document.md', '# A new document\n') },
        ],
      },
      { separator: true },
      { label: 'Open Terminal Here', icon: <Glyph name="Terminal" size={14} />, onClick: () => launch('terminal', { cwd: `${HOME}/Desktop` }) },
      { label: 'Open Files', icon: <Glyph name="FolderOpen" size={14} />, onClick: () => launch('nemo', { path: `${HOME}/Desktop` }) },
      { separator: true },
      { label: showIcons ? 'Hide Desktop Icons' : 'Show Desktop Icons', checked: showIcons, onClick: () => setShowIcons((v) => !v) },
      {
        label: 'Change Background…',
        icon: <Glyph name="Image" size={14} />,
        onClick: () => launch('settings', { page: 'appearance' }),
      },
      {
        label: 'Display Settings',
        icon: <Glyph name="Monitor" size={14} />,
        onClick: () => launch('settings', { page: 'display' }),
      },
      {
        label: 'Desktop Settings',
        icon: <Glyph name="Settings" size={14} />,
        onClick: () => launch('settings', { page: 'desktop' }),
      },
      { separator: true },
      { label: 'System Settings', icon: <Glyph name="Settings" size={14} />, onClick: () => launch('settings', {}) },
      { label: 'About This Computer', icon: <Glyph name="Info" size={14} />, onClick: () => launch('about', {}) },
    ]
  }

  function createDesktopFile(name: string, content: string) {
    let candidate = name
    let i = 1
    while (vfs.exists(join(HOME, 'Desktop', candidate))) {
      candidate = `${name.replace(/(\.\w+)$/, '')} ${++i}${name.match(/(\.\w+)$/)?.[0] ?? ''}`
    }
    vfs.write(join(HOME, 'Desktop', candidate), content)
  }

  /* ------------------------------- rendering ------------------------------- */
  const wallpaper = settings.wallpaper

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: '#16181a',
        backgroundImage: wallpaper.startsWith('#') ? undefined : `url(${wallpaper})`,
        backgroundColor: wallpaper.startsWith('#') ? wallpaper : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        fontFamily: 'var(--font-sans)',
      }}
      onContextMenu={(e) => {
        const t = e.target as HTMLElement
        if (t.closest('.wm-window') || t.closest('.wm-shell-ui')) return
        desktopMenu.open(e)
      }}
      onMouseDown={(e) => {
        const t = e.target as HTMLElement
        if (t.closest('.wm-window')) return
        // The menu, its popups and the panel are part of the shell: closing the
        // menu on a mousedown inside them unmounts the very element the user is
        // pressing, and a browser only fires `click` if the element survived —
        // so every menu item silently did nothing.
        if (t.closest('.wm-shell-ui')) return
        if (useOS.getState().menuOpen) useOS.getState().setMenuOpen(false)
      }}
    >
      {/* hot corner */}
      {settings.hotCorner && (
        <div
          style={{ position: 'fixed', left: 0, top: 0, width: 4, height: 4, zIndex: 120000 }}
          onMouseEnter={() => useOS.getState().setMenuOpen(true)}
        />
      )}

      {/* desktop icons */}
      {showIcons && !showDesktop && (
        <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', flexDirection: 'column', flexWrap: 'wrap', maxHeight: 'calc(100vh - 120px)', gap: 2 }}>
          {settings.desktopIcons
            .map((id) => getApp(id))
            .filter(Boolean)
            .map((app) => (
              <DesktopIcon
                key={app!.id}
                label={app!.name}
                node={{ type: 'app', name: app!.name }}
                openOnClick
                onOpen={() => launch(app!.id, {})}
                onMenu={() =>
                  setWinMenu({
                    x: 12,
                    y: 12,
                    items: [
                      { label: 'Open', onClick: () => launch(app!.id, {}) },
                      {
                        label: 'Remove from Desktop',
                        onClick: () =>
                          useOS.getState().setSettings({
                            desktopIcons: settings.desktopIcons.filter((d) => d !== app!.id),
                          }),
                      },
                      { label: 'Open in Terminal', onClick: () => launch('terminal', {}) },
                    ],
                  })
                }
                appIcon={app!}
              />
            ))}
          {desktopFiles.map((f) => (
            <DesktopIcon
              key={f.name}
              label={f.name}
              node={{ type: f.node.type, mime: (f.node as any).mime, name: f.name }}
              onOpen={() => {
                const path = join(HOME, 'Desktop', f.name)
                if (f.node.type === 'dir') launch('nemo', { path })
                else {
                  const appId = appForFile(path)
                  if (appId) launch(appId, { path })
                  else launch('xed', { path })
                }
              }}
              onMenu={() =>
                setWinMenu({
                  x: 12,
                  y: 12,
                  items: [
                    { label: 'Open', onClick: () => launch('nemo', { path: join(HOME, 'Desktop', f.name) }) },
                    { label: 'Rename…', onClick: () => launch('nemo', { path: `${HOME}/Desktop` }) },
                    {
                      label: 'Move to Trash',
                      onClick: () => {
                        vfs.trash(join(HOME, 'Desktop', f.name))
                        vfs.rm(join(HOME, 'Desktop', f.name))
                      },
                    },
                    { separator: true },
                    { label: 'Properties', onClick: () => launch('nemo', { path: `${HOME}/Desktop` }) },
                  ],
                })
              }
            />
          ))}
        </div>
      )}

      {/* windows */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: showDesktop ? 'none' : 'auto', opacity: showDesktop ? 0 : 1, transition: 'opacity .12s linear' }}>
        {windows
          .filter((w) => w.workspace === workspace)
          .map((w) => {
            const def = getApp(w.appId)
            if (!def) return null
            const Cmp = def.component
            const api = {
              setTitle: (t: string) => useOS.getState().setTitle(w.id, t),
              setProps: (p: Record<string, any>) => useOS.getState().patchProps(w.id, p),
              close: () => useOS.getState().closeWindow(w.id),
              openApp: (appId: string, props?: Record<string, any>) => useOS.getState().openApp(appId, props ?? {}),
              notify: (n: { title: string; body?: string; appId?: string }) => useOS.getState().notify(n),
            }
            return (
              <WindowFrame key={w.id} win={w}>
                <Cmp win={w} api={api} />
              </WindowFrame>
            )
          })}
      </div>

      {/* panel */}
      <Panel />

      {/* main menu */}
      {menuOpen && <MainMenu onClose={() => useOS.getState().setMenuOpen(false)} />}

      {/* alt-tab */}
      {altTab.open && (
        <AltTabOverlay index={altTab.index} />
      )}

      {/* expose */}
      {exposeOpen && <Expose onClose={() => useOS.getState().setExposeOpen(false)} />}

      {/* notifications */}
      <Notifications />

      {/* context menus */}
      {desktopMenu.state && <Popup x={desktopMenu.state.x} y={desktopMenu.state.y} items={desktopMenuItems()} onClose={desktopMenu.close} />}
      {winMenu && <Popup x={winMenu.x} y={winMenu.y} items={winMenu.items} onClose={() => setWinMenu(null)} />}

      {/* dialogs */}
      {runDialogOpen && <RunDialog onClose={() => useOS.getState().setRunDialog(false)} />}
      {session && <SessionDialog kind={session} onCancel={() => setSession(null)} />}
      {locked && <LockScreen />}
      {booting && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 400000,
            background: '#101314',
            display: 'grid',
            placeItems: 'center',
            alignContent: 'center',
            gap: 16,
            opacity: bootFade ? 0 : 1,
            transition: 'opacity .38s ease',
            pointerEvents: bootFade ? 'none' : 'auto',
          }}
        >
          <img src="logo.svg" width="74" height="74" alt="" />
          <div style={{ color: '#9ede6a', fontSize: 15, fontWeight: 600, letterSpacing: 0.5 }}>Mixt Web OS</div>
          <div
            className="spin"
            style={{
              width: 18,
              height: 18,
              border: '2px solid rgba(158,222,106,0.22)',
              borderTopColor: '#9ede6a',
              borderRadius: 999,
            }}
          />
        </div>
      )}
      {authGate && !api.getSession() && <AuthGate onDone={() => { adoptServerSession(api.getSession()); setAuthGate(false); bump((x) => x + 1) }} />}
      {/* Never for a guest: a guest is not an account and must not be able to
          create one. Without this the form only stayed hidden by accident,
          because a guest session happens to set serverSession. */}
      {!hasUsers && !authGate && !serverSession && <FirstBootSetup />}
    </div>
  )
}

function DesktopIcon({
  label,
  node,
  onOpen,
  onMenu,
  appIcon,
  openOnClick,
}: {
  label: string
  node: { type: string; mime?: string; name: string }
  onOpen: () => void
  onMenu: () => void
  appIcon?: { glyph: string; color: string; color2?: string; icon?: (size: number) => React.ReactNode }
  /* An app on the desktop opens the same way it opens everywhere else — one
   * click, like the Menu and the taskbar. Waiting for a double-click made the
   * desktop icons look broken next to the rest of the system. */
  openOnClick?: boolean
}) {
  const [selected, setSelected] = useState(false)
  return (
    <div
      className="desktop-icon"
      data-selected={selected}
      onClick={(e) => {
        e.stopPropagation()
        setSelected(true)
        if (openOnClick) onOpen()
      }}
      onDoubleClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setSelected(true)
        onMenu()
      }}
      title={label}
    >
      {appIcon ? (
        <AppIcon glyph={appIcon.glyph} color={appIcon.color} color2={appIcon.color2} icon={appIcon.icon} size={46} />
      ) : (
        <FileIcon node={node} size={46} />
      )}
      <div className="label">{label}</div>
    </div>
  )
}

function AltTabOverlay({ index }: { index: number }) {
  const { windows, workspace } = useOS()
  const list = windows.filter((w) => w.workspace === workspace)
  const n = Math.max(1, list.length)
  const active = list[((index % n) + n) % n]
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 170000,
        display: 'grid',
        placeItems: 'center',
        pointerEvents: 'none',
      }}
    >
      <div style={{ background: 'rgba(28,32,34,0.9)', borderRadius: 12, padding: 14, maxWidth: '80vw', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.12)' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          {list.map((w) => {
            const def = getApp(w.appId)
            const isActive = active?.id === w.id
            return (
              <div
                key={w.id}
                style={{
                  width: 150,
                  padding: 10,
                  borderRadius: 8,
                  textAlign: 'center',
                  color: '#eef2ef',
                  background: isActive ? 'color-mix(in srgb, var(--wm-accent) 32%, transparent)' : 'rgba(255,255,255,0.06)',
                  border: isActive ? '1px solid var(--wm-accent)' : '1px solid transparent',
                }}
              >
                <AppIcon glyph={def?.glyph ?? 'AppWindow'} color={def?.color ?? '#5b8def'} icon={def?.icon} size={40} />
                <div style={{ marginTop: 6, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Expose({ onClose }: { onClose: () => void }) {
  const { windows, workspace, focusWindow, workspaceCount, switchWorkspace } = useOS()
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 169000,
        background: 'rgba(16,20,22,0.88)',
        backdropFilter: 'blur(3px)',
        padding: '50px 40px 70px',
        overflow: 'auto',
      }}
      onClick={onClose}
    >
      <div style={{ color: '#eef2ef', fontSize: 15, marginBottom: 18, textAlign: 'center', opacity: 0.9 }}>
        All windows on this workspace — click one to focus it, click the background to go back
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: 16 }}>
        {windows.map((w) => {
          const def = getApp(w.appId)
          const minimised = w.minimized
          return (
            <div
              key={w.id}
              onClick={(e) => {
                e.stopPropagation()
                focusWindow(w.id)
                onClose()
              }}
              style={{
                background: 'var(--wm-window-bg)',
                borderRadius: 8,
                overflow: 'hidden',
                border: w.workspace === workspace ? '2px solid var(--wm-accent)' : '2px solid rgba(255,255,255,0.15)',
                cursor: 'pointer',
                opacity: minimised ? 0.6 : 1,
              }}
            >
              <div style={{ height: 26, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', backgroundImage: 'linear-gradient(to bottom,#4b5054,#35393c)', color: '#f0f2ef', fontSize: 12 }}>
                <AppIcon glyph={def?.glyph ?? 'AppWindow'} color={def?.color ?? '#5b8def'} icon={def?.icon} size={15} rounded={0.3} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title}</span>
              </div>
              <div style={{ height: 120, padding: 10, color: 'var(--wm-window-fg)', fontSize: 11.5, opacity: 0.75 }}>
                {def?.comment}
                <div style={{ marginTop: 6, opacity: 0.7 }}>
                  workspace {w.workspace + 1} · {w.w}×{w.h}
                  {minimised ? ' · minimised' : ''}
                </div>
              </div>
            </div>
          )
        })}
        {windows.length === 0 && <div style={{ color: '#cfd6d1' }}>No windows open. Enjoy the wallpaper.</div>}
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 26 }}>
        {Array.from({ length: workspaceCount }).map((_, i) => (
          <div
            key={i}
            onClick={(e) => {
              e.stopPropagation()
              switchWorkspace(i)
            }}
            style={{
              width: 120,
              height: 70,
              borderRadius: 6,
              display: 'grid',
              placeItems: 'center',
              color: '#eef2ef',
              background: i === workspace ? 'color-mix(in srgb, var(--wm-accent) 30%, transparent)' : 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.2)',
              fontSize: 12.5,
              cursor: 'pointer',
            }}
          >
            Workspace {i + 1}
          </div>
        ))}
      </div>
    </div>
  )
}

function RunDialog({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState('')
  const run = () => {
    const cmd = value.trim()
    onClose()
    if (!cmd) return
    const app = visibleApps().find((a) => a.id === cmd || a.name.toLowerCase() === cmd.toLowerCase())
    if (app) {
      launch(app.id, {})
      return
    }
    if (/^https?:|^[\w-]+\.[\w.]+/.test(cmd)) {
      launch('browser', { url: cmd })
      return
    }
    // otherwise hand it to the terminal as a fresh command
    useOS.getState().notify({ title: 'Run command', body: `Unknown command “${cmd}”. Try an application name or a web address.` })
  }
  return (
    <Dialog title="Run Application" width={430} onClose={onClose}>
      <p style={{ marginTop: 0, opacity: 0.8 }}>Type the name of an application or a web address.</p>
      <input
        className="entry"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && run()}
        placeholder="terminal, files, mixtnet.com…"
        style={{ width: '100%' }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {['terminal', 'files', 'browser', 'settings', '2048'].map((s) => (
          <button key={s} className="btn-ghost" onClick={() => setValue(s)}>
            {s}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-mixt" onClick={run}>
          Run
        </button>
      </div>
    </Dialog>
  )
}

function SessionDialog({ kind, onCancel }: { kind: 'shutdown' | 'reboot' | 'logout'; onCancel: () => void }) {
  const [busy, setBusy] = useState(false)
  const [seconds, setSeconds] = useState(30)
  const S = useOS.getState()

  useEffect(() => {
    if (kind === 'logout') return
    const t = setInterval(() => setSeconds((s) => s - 1), 1000)
    return () => clearInterval(t)
  }, [kind])

  useEffect(() => {
    if (kind !== 'logout' && seconds <= 0 && !busy) doIt()
  }, [seconds, busy])

  function doIt() {
    setBusy(true)
    setTimeout(() => {
      if (kind === 'logout') {
        S.closeAll()
        const had = api.getSession()
        if (had) {
          // a server account goes back to the sign-in screen, not the local
          // lock screen — two stacked overlays fought over the keyboard
          /* write this account's filesystem out, then unmount it */
          persistNow(useVFS.getState().root)
          setAdminView(false)
          api.setSession(null)
          S.setServerRole(null)
          S.setLocked(false)
          window.dispatchEvent(new CustomEvent('mixt:authchanged'))
        } else {
          S.setLocked(true)
        }
        S.notify({
          title: 'Logged out',
          body: had ? `Signed out of ${had.username}. Log back in to continue.` : 'Your session is locked. Log back in from the lock screen.',
        })
        onCancel()
        return
      }
      // pretend to power off: black screen, then boot again
      const overlay = document.createElement('div')
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:999999;background:#05070a;display:grid;place-items:center;color:#9ede6a;font-family:var(--font-mono);font-size:13px;white-space:pre;transition:opacity .4s linear'
      overlay.textContent = kind === 'reboot' ? 'Rebooting…\n\n[  OK  ] Stopped target Graphical Interface\n[  OK  ] Reached target Reboot' : 'Shutting down…\n\n[  OK  ] Stopped target Graphical Interface\n\nIt is now safe to close this tab.'
      document.body.appendChild(overlay)
      setTimeout(() => {
        if (kind === 'shutdown') {
          overlay.textContent = '\n\n\n                 Goodbye.\n\n     (Reload the page to boot Mixt Web OS again)'
          return
        }
        overlay.style.opacity = '0'
        setTimeout(() => {
          overlay.remove()
          window.location.reload()
        }, 420)
      }, 1400)
    }, 900)
  }

  return (
    <Dialog title={kind === 'logout' ? 'Log Out' : kind === 'reboot' ? 'Restart' : 'Shut Down'} width={420} onClose={onCancel}>
      <p style={{ marginTop: 0 }}>
        {kind === 'logout'
          ? 'End this session? Open windows will be closed and the screen locked.'
          : kind === 'reboot'
            ? 'Restart Mixt Web OS? The page will reload and your files will still be here.'
            : `Shut down the computer?${seconds > 0 ? ` Automatic shutdown in ${seconds} s.` : ''}`}
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-mixt" onClick={doIt} disabled={busy}>
          {kind === 'logout' ? 'Log out' : kind === 'reboot' ? 'Restart' : 'Shut down'}
        </button>
      </div>
    </Dialog>
  )
}

function LockScreen() {
  const { settings, setLocked, users, activeUserId, loginUser } = useOS()
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [time, setTime] = useState(new Date())
  /* Which account is being unlocked. With no accounts created yet the session
     is a guest session and any password is accepted, as before. */
  const [pickedId, setPickedId] = useState<string | null>(activeUserId ?? users[0]?.id ?? null)
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const picked = users.find((u) => u.id === pickedId) ?? null

  const unlock = () => {
    if (!picked) {
      setLocked(false)
      return
    }
    if (loginUser(picked.id, value)) {
      setError('')
      setValue('')
      return
    }
    setError('Incorrect password.')
    setValue('')
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200000,
        backgroundImage: `url(${settings.wallpaper})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        display: 'grid',
        placeItems: 'center',
        color: '#fff',
      }}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(10,14,12,0.62)', backdropFilter: 'blur(7px)' }} />
      <div style={{ position: 'relative', textAlign: 'center' }}>
        <div style={{ fontSize: 66, fontWeight: 300, letterSpacing: -1 }}>
          {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: !settings.clock24 })}
        </div>
        <div style={{ fontSize: 17, opacity: 0.85, marginTop: -6 }}>{time.toDateString()}</div>

        {/* account chooser */}
        {users.length > 1 && (
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 26, flexWrap: 'wrap' }}>
            {users.map((u) => (
              <button
                key={u.id}
                className="btn-ghost"
                onClick={() => {
                  setPickedId(u.id)
                  setError('')
                  setValue('')
                }}
                style={{
                  color: '#e7ece8',
                  display: 'grid',
                  placeItems: 'center',
                  gap: 4,
                  padding: '8px 12px',
                  border: u.id === pickedId ? '2px solid var(--wm-accent)' : '2px solid rgba(255,255,255,0.18)',
                  borderRadius: 12,
                  minWidth: 82,
                }}
              >
                <span style={{ fontSize: 12.5 }}>{u.fullName}</span>
              </button>
            ))}
          </div>
        )}

        <div style={{ marginTop: 34, display: 'grid', placeItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 17 }}>{picked?.fullName ?? settings.fullName}</div>
          {picked && !picked.passwordHash ? (
            <div style={{ fontSize: 12.5, opacity: 0.8 }}>This account has no password.</div>
          ) : (
            <input
              className="entry"
              autoFocus
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && unlock()}
              placeholder={users.length ? 'Password' : 'Password (any will do)'}
              style={{ width: 240, textAlign: 'center' }}
            />
          )}
          {error && <div style={{ color: '#ffb3ad', fontSize: 12.5 }}>{error}</div>}
          <button className="btn-mixt" onClick={unlock}>
            Unlock
          </button>
          {users.length === 0 && (
            <div style={{ fontSize: 12, opacity: 0.75, maxWidth: 300, lineHeight: 1.5 }}>
              No accounts yet. Open the Terminal and type <b>/startup</b> to create one — it is
              saved in this browser.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ----------------------- first-boot account setup ------------------------ */
/* Shown instead of the desktop until an account exists, mirroring the Linux
   Mint installer's "who are you?" step: your name, the computer's name, a
   username and a password. */
function FirstBootSetup() {
  const settings = useOS((s) => s.settings)
  /* Guarded here too, so nothing that mounts this component by mistake can
     hand a guest the account form. */
  const guest = api.getSession()?.role === 'guest'
  const setSettings = useOS((s) => s.setSettings)
  const createUser = useOS((s) => s.createUser)
  const [fullName, setFullName] = useState('')
  const [hostname, setHostname] = useState('mixt-desktop')
  const [username, setUsername] = useState('')
  const [usernameTouched, setUsernameTouched] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [accent, setAccent] = useState(ACCENTS[0])
  const [error, setError] = useState('')

  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '.').replace(/^\.+|\.+$/g, '') || 'mixt'
  const onName = (v: string) => {
    setFullName(v)
    if (!usernameTouched) setUsername(slug(v))
  }

  const submit = () => {
    const uErr = validateUsername(username)
    if (uErr) return setError(uErr)
    if (password !== confirm) return setError('The passwords do not match.')
    setSettings({ hostname: hostname.trim().replace(/\s+/g, '-') || 'mixt-desktop', accent })
    const res = createUser({ username, fullName, password, accent, wallpaper: settings.wallpaper })
    if (!('ok' in res) || !res.ok) return setError((res as { error?: string }).error ?? 'Could not create the account.')
    setError('')
  }

  const field = (label: string, node: React.ReactNode, hint?: string) => (
    <label style={{ display: 'grid', gap: 4, textAlign: 'left' }}>
      <span style={{ fontSize: 12.5, opacity: 0.8 }}>{label}</span>
      {node}
      {hint && <span style={{ fontSize: 11, opacity: 0.6 }}>{hint}</span>}
    </label>
  )

  /* A guest is let in without an account, so there is nothing to set up and no
     account for them to create. */
  if (guest) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300000,
        backgroundImage: `url(${settings.wallpaper})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(10,14,12,0.6)', backdropFilter: 'blur(8px)' }} />
      <div style={{ position: 'relative', width: 430, maxWidth: '92vw', background: '#fbfbf9', color: '#22261f', borderRadius: 12, boxShadow: '0 30px 80px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
        <div style={{ background: 'linear-gradient(180deg,#87cf3e,#6fa34c)', color: '#fff', padding: '16px 22px' }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Welcome to Mixt</div>
          <div style={{ fontSize: 12.5, opacity: 0.95 }}>Let&apos;s set up an account for you, just like a fresh install.</div>
        </div>
        <div style={{ padding: '18px 22px', display: 'grid', gap: 14 }}>
          {field('Your name', <input className="entry" value={fullName} onChange={(e) => onName(e.target.value)} placeholder="e.g. Ada Lovelace" />)}
          {field(
            "Your computer's name",
            <input className="entry" value={hostname} onChange={(e) => setHostname(e.target.value)} />,
            'The name it uses on the network and in the terminal.',
          )}
          {field(
            'Pick a username',
            <input
              className="entry"
              value={username}
              onChange={(e) => {
                setUsernameTouched(true)
                setUsername(e.target.value.toLowerCase())
              }}
            />,
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {field('Choose a password', <input className="entry" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />)}
            {field('Confirm password', <input className="entry" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />)}
          </div>
          {field(
            'Accent colour',
            <div style={{ display: 'flex', gap: 8 }}>
              {ACCENTS.map((c) => (
                <span
                  key={c}
                  onClick={() => setAccent(c)}
                  style={{ width: 24, height: 24, borderRadius: '50%', cursor: 'pointer', background: c, border: accent === c ? '3px solid #22261f' : '1px solid rgba(0,0,0,0.25)' }}
                />
              ))}
            </div>,
          )}
          {error && <div style={{ color: '#c0392b', fontSize: 12.5 }}>{error}</div>}
          <button className="btn-mixt" onClick={submit} style={{ justifyContent: 'center' }}>
            Create account &amp; start using Mixt
          </button>
        </div>
      </div>
    </div>
  )
}

/* --------------------------- online login gate --------------------------- */
/* Shown only when the Mixt backend (server.cjs) is reachable on this origin.
   Whitelisted users log in; anyone else may continue as a guest, which is
   never saved. Offline, this never renders and the OS behaves as before.    */
function AuthGate({ onDone }: { onDone: () => void }) {
  const settings = useOS((s) => s.settings)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  /* A guest is still not an account — nothing of theirs is saved — but they
   * sign in with a username, a name and a password, so the administrator sees
   * who has been using the machine instead of an anonymous extra session. */
  const [guestMode, setGuestMode] = useState(false)
  const [guestName, setGuestName] = useState('')
  const [guestUser, setGuestUser] = useState('')
  const [guestPass, setGuestPass] = useState('')

  const doGuest = async () => {
    if (!guestUser.trim() || !guestPass) {
      setError('A guest signs in with a username and a password, and a name to be known by.')
      return
    }
    setBusy(true)
    await api.guest({ username: guestUser.trim(), name: guestName.trim(), password: guestPass })
    setBusy(false)
    onDone()
  }
  /* Pressing Enter with nothing typed at all still goes straight in, as before:
   * no password to get wrong, no account to create. The sign-in is logged. */
  const doAnonymous = async () => {
    setBusy(true)
    await api.guest({})
    setBusy(false)
    onDone()
  }
  const doLogin = async () => {
    if (!username.trim() && !password) return doAnonymous()
    setBusy(true)
    const res = await api.login(username.trim(), password)
    setBusy(false)
    if (!res.ok) return setError(res.error ?? 'Could not sign in.')
    onDone()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300000, backgroundImage: `url(${settings.wallpaper})`, backgroundSize: 'cover', backgroundPosition: 'center', display: 'grid', placeItems: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(10,14,12,0.6)', backdropFilter: 'blur(8px)' }} />
      <div style={{ position: 'relative', width: 360, maxWidth: '92vw', background: '#fbfbf9', color: '#22261f', borderRadius: 12, boxShadow: '0 30px 80px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
        <div style={{ background: 'linear-gradient(180deg,#87cf3e,#6fa34c)', color: '#fff', padding: '14px 20px' }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{guestMode ? 'Guest sign-in' : 'Sign in to Mixt'}</div>
          <div style={{ fontSize: 12.5, opacity: 0.95 }}>
            {guestMode
              ? 'No account is created and nothing is saved for you — but the administrator sees this sign-in.'
              : 'Whitelisted accounts are saved. Guests are not.'}
          </div>
          {!guestMode && (
            <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 2 }}>
              Leave both boxes empty and press Enter to go straight in without an account.
            </div>
          )}
        </div>
        <div style={{ padding: '16px 20px', display: 'grid', gap: 12 }}>
          {!guestMode && (
            <>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 12.5, opacity: 0.8 }}>Username</span>
                <input
                  className="entry"
                  autoFocus
                  autoComplete="username"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value)
                    setError('')
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && doLogin()}
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 12.5, opacity: 0.8 }}>Password</span>
                <input
                  className="entry"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setError('')
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && doLogin()}
                />
              </label>
            </>
          )}
          {guestMode && (
            <>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 12.5, opacity: 0.8 }}>Your name</span>
                <input
                  className="entry"
                  autoFocus
                  placeholder="Who is using this computer?"
                  value={guestName}
                  onChange={(e) => {
                    setGuestName(e.target.value)
                    setError('')
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && doGuest()}
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 12.5, opacity: 0.8 }}>Username</span>
                <input
                  className="entry"
                  placeholder="visitor"
                  value={guestUser}
                  onChange={(e) => {
                    setGuestUser(e.target.value)
                    setError('')
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && doGuest()}
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 12.5, opacity: 0.8 }}>Password</span>
                <input
                  className="entry"
                  type="password"
                  value={guestPass}
                  onChange={(e) => {
                    setGuestPass(e.target.value)
                    setError('')
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && doGuest()}
                />
              </label>
            </>
          )}
          {error && <div style={{ color: '#c0392b', fontSize: 12.5 }}>{error}</div>}
          {!guestMode ? (
            <>
              <button className="btn-mixt" disabled={busy} onClick={doLogin} style={{ justifyContent: 'center' }}>
                Log in
              </button>
              <button
                className="btn-ghost"
                disabled={busy}
                onClick={() => {
                  setError('')
                  setGuestMode(true)
                }}
                style={{ justifyContent: 'center' }}
              >
                Continue as guest
              </button>
            </>
          ) : (
            <>
              <button className="btn-mixt" disabled={busy} onClick={doGuest} style={{ justifyContent: 'center' }}>
                Enter as guest
              </button>
              <button className="btn-ghost" disabled={busy} onClick={() => setGuestMode(false)} style={{ justifyContent: 'center' }}>
                Back to sign-in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
