import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useOS } from '../os/store'
import { HOME, join, splitPath, normalizePath, vfs, humanSize, countNodes, nodeSize } from '../os/vfs'
import { APPS, getApp } from './registry'
import {
  addressFor,
  dnsStatus,
  hashString,
  soaRecord,
  fetchAsText,
  latencyFor,
  readHosts,
  readResolvConf,
  renderDig,
  renderHost,
  renderNslookup,
  resolveHost,
  reverseLookup,
  servers,
  serverAddress,
  zoneRecords,
} from '../net'
import { launch } from '../os/bus'
import type { AppProps } from '../os/types'

interface Line {
  id: number
  kind: 'in' | 'out' | 'err' | 'ok' | 'dim'
  text: string
}

let lineId = 0
const COMMANDS = [
  'dig',
  'host',
  'nslookup',
  'getent',
  'nmap',
  'help', 'ls', 'll', 'cd', 'pwd', 'cat', 'echo', 'mkdir', 'touch', 'rm', 'rmdir', 'mv', 'cp',
  'ln', 'tree', 'find', 'grep', 'wc', 'head', 'tail', 'sort', 'uniq', 'sed', 'awk', 'less',
  'more', 'nano', 'vim', 'xed', 'open', 'xdg-open', 'clear', 'history', 'whoami', 'id', 'groups',
  'uname', 'hostname', 'date', 'cal', 'uptime', 'free', 'df', 'du', 'ps', 'top', 'htop', 'kill',
  'apt', 'apt-get', 'dpkg', 'snap', 'flatpak', 'sudo', 'su', 'neofetch', 'inxi', 'lscpu', 'lsblk',
  'lsusb', 'lspci', 'ifconfig', 'ip', 'ping', 'curl', 'wget', 'ssh', 'scp', 'git', 'python3',
  'node', 'npm', 'which', 'whereis', 'man', 'info', 'fortune', 'cowsay', 'sl', 'yes', 'seq',
  'env', 'export', 'alias', 'uname', 'notify-send', 'theme', 'wallpaper', 'lock', 'logout',
  'reboot', 'shutdown', 'poweroff', 'exit', 'screenshot', 'xrandr', 'battery', 'volume', 'mixtupdate',
  'mixtinstall', 'nemo', 'xed', 'firefox', 'top', 'killall', 'chmod', 'chown', 'stat', 'file',
  'basename', 'dirname', 'realpath', 'sleep', 'true', 'false', 'time', 'watch', 'diff', 'tar',
  'zip', 'unzip', 'gzip', 'sha256sum', 'md5sum', 'base64', 'rev', 'tac', 'cut', 'tr', 'echo',
]

const FORTUNES = [
  'Any sufficiently advanced bug is indistinguishable from a feature.',
  'There is no place like ~/',
  'Real programmers count from 0.',
  'To err is human — to blame it on the compiler is even more so.',
  'Unix is user friendly. It is just picky about its friends.',
  'A clean desk is a sign of a cluttered drawer.',
  'sudo make me a sandwich.',
  'Mixt condition: a computer that has never been rebooted into Windows.',
  'The best way to accelerate a browser is at 9.8 m/s².',
  'Documentation is like a love letter to your future self.',
  'rm -rf is the fastest way to free disk space and regret.',
  'You can never have too much RAM, only too little money.',
  '99 little bugs in the code, take one down, patch it around… 127 little bugs in the code.',
]

function fmtDate(d: Date, long = false) {
  return long ? d.toString().slice(0, 33) : d.toDateString()
}

export default function TerminalApp({ win, api }: AppProps) {
  const settings = useOS((s) => s.settings)
  const setSettings = useOS((s) => s.setSettings)
  const installed = useOS((s) => s.installed)
  const setInstalled = useOS((s) => s.setInstalled)
  const [lines, setLines] = useState<Line[]>([
    { id: lineId++, kind: 'dim', text: 'Welcome to Mixt Web OS 1.0 (GNU/JavaScript) — type "help" for a list of commands.' },
    { id: lineId++, kind: 'out', text: '' },
  ])
  const [cwd, setCwd] = useState<string>(win.props?.cwd ?? HOME)
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)
  const [root, setRoot] = useState(false)
  const [busy, setBusy] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const prompt = `${root ? 'root' : settings.username}@${settings.hostname}:${prettyCwd(cwd)}`

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [lines, busy])

  useEffect(() => {
    if (win.props?.cwd && win.props.cwd !== cwd) setCwd(win.props.cwd)
  }, [win.props?.cwd])

  useEffect(() => {
    api.setTitle(`${settings.username}@${settings.hostname}: ${prettyCwd(cwd)} — Terminal`)
  }, [cwd, settings.username, settings.hostname])

  function prettyCwd(p: string) {
    return p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p
  }

  function push(kind: Line['kind'], text: string) {
    setLines((ls) => [...ls, { id: lineId++, kind, text }])
  }
  function pushMany(items: [Line['kind'], string][]) {
    setLines((ls) => [...ls, ...items.map(([kind, text]) => ({ id: lineId++, kind, text }))])
  }

  /* ------------------------------- execution ------------------------------- */
  async function run(raw: string, opts: { silent?: boolean } = {}): Promise<boolean> {
    const line = raw.trim()
    if (!line) return true
    if (!opts.silent) {
      setLines((ls) => [
        ...ls,
        { id: lineId++, kind: 'in', text: `${prompt}${root ? '#' : '$'} ${raw}` },
      ])
    }
    setHistory((h) => [...h.filter((x) => x !== line), line].slice(-200))

    // chaining: cmd && cmd2 (on success), cmd || cmd2 (on failure), cmd ; cmd2
    const chain = splitChain(line)
    if (chain) {
      let ok = true
      for (let i = 0; i < chain.parts.length; i++) {
        const op = i === 0 ? null : chain.ops[i - 1]
        if (op === '&&' && !ok) break
        if (op === '||' && ok) continue
        ok = await run(chain.parts[i], { silent: true })
      }
      return ok
    }

    // pipelines and redirection
    const redirect = line.match(/(.*?)\s*(>>|>)\s*(\S+)$/)
    const pipeParts = line.split('|').map((s) => s.trim()).filter(Boolean)

    try {
      if (pipeParts.length > 1) {
        let data = ''
        for (let i = 0; i < pipeParts.length; i++) {
          const out = await exec(pipeParts[i], data)
          if (typeof out === 'string') data = out
          else return true
        }
        if (data) data.split('\n').forEach((l) => l !== '' && push('out', l))
        return true
      }
      if (redirect) {
        const [, cmd, op, target] = redirect
        const out = await exec(cmd.trim(), '')
        const path = normalizePath(target, cwd, HOME)
        const text = typeof out === 'string' ? out : ''
        const written =
          op === '>>'
            ? vfs.write(path, (vfs.read(path) ?? '') + text)
            : vfs.write(path, text)
        if (!written) throw new Error(`${target}: Not a directory or invalid path`)
        return true
      }
      const result = await exec(line, '')
      if (typeof result === 'string' && result.length) {
        for (const outLine of result.split('\n')) push('out', outLine)
      }
      return true
    } catch (e: any) {
      push('err', `${e?.message ?? e}`)
      return false
    }
  }

  /** Executes one command; returns stdout when it should feed a pipe. */
  async function exec(line: string, stdin: string): Promise<string | void> {
    const tokens = tokenize(line)
    let cmd = tokens[0] ?? ''
    let args = tokens.slice(1)
    let asRoot = root

    if (cmd === 'sudo' || cmd === 'su') {
      if (!root) {
        push('dim', '[sudo] password for ' + settings.username + ': ********')
        setRoot(true)
        asRoot = true
      }
      if (cmd === 'su') {
        if (args.length === 0) {
          push('ok', 'You are now root. Be careful out there.')
          return
        }
        cmd = args[0]
        args = args.slice(1)
      } else {
        if (!args.length) {
          push('err', 'usage: sudo <command>')
          return
        }
        cmd = args[0]
        args = args.slice(1)
      }
    }

    const out = (s: string) => s
    switch (cmd) {
      case 'help': {
        pushMany([
          ['ok', 'Mixt Web OS shell — available commands'],
          ['out', '  Files      ls, cd, pwd, cat, tree, find, grep, wc, head, tail, mkdir, touch, rm, mv, cp, du, df, stat, file'],
          ['out', '  System     uname, hostname, date, cal, uptime, free, ps, top, kill, neofetch, inxi, lscpu, lsblk, whoami, id'],
          ['out', '  Packages   apt search|install|remove|list, dpkg -l, mixtinstall, mixtupdate'],
          ['out', '  Network    ping, curl, wget, dig, host, nslookup, getent, nmap, ifconfig, ssh, git'],
          ['out', '  Desktop    open, xed, nano, nemo, theme, wallpaper, notify-send, lock, screenshot, volume'],
          ['out', '  Session    history, clear, fortune, cowsay, exit, reboot, shutdown'],
          ['out', ''],
          ['dim', 'Tip: pipes (ls | wc -l), redirection (echo hi > file), Tab completion and ↑/↓ history all work.'],
        ])
        return
      }
      case 'ls':
      case 'll':
      case 'dir': {
        const long = cmd === 'll' || args.includes('-l') || args.includes('-la') || args.includes('-al')
        const showAll = cmd !== 'ls' || args.some((a) => a.includes('a'))
        const target = args.filter((a) => !a.startsWith('-')).slice(-1)[0] ?? '.'
        const path = normalizePath(target, cwd, HOME)
        const node = vfs.node(path)
        if (!node) throw new Error(`ls: cannot access '${target}': No such file or directory`)
        if (node.type === 'file') return out(baseOf(path))
        const entries = Object.entries(node.children)
          .filter(([n]) => showAll || !n.startsWith('.'))
          .sort(([an, a], [bn, b]) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : an.localeCompare(bn)))
        if (!entries.length) return out('')
        if (long) {
          const rows = ['total ' + entries.length]
          for (const [name, n] of entries) {
            const perms = n.type === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--'
            const size = String(n.type === 'dir' ? 4096 : nodeSize(n)).padStart(9)
            const date = new Date(n.modified).toISOString().slice(0, 16).replace('T', ' ')
            rows.push(`${perms} ${asRoot ? 'root' : settings.username} ${asRoot ? 'root' : settings.username} ${size} ${date} ${colorName(name, n.type === 'dir')}`)
          }
          return out(rows.join('\n'))
        }
        return out(entries.map(([n, node2]) => colorName(n, node2.type === 'dir')).join('  '))
      }
      case 'cd': {
        const target = args[0] ?? HOME
        const path = normalizePath(target, cwd, HOME)
        const node = vfs.node(path)
        if (!node) throw new Error(`cd: ${target}: No such file or directory`)
        if (node.type !== 'dir') throw new Error(`cd: ${target}: Not a directory`)
        setCwd(path)
        return
      }
      case 'pwd':
        return out(cwd)
      case 'cat':
      case 'less':
      case 'more': {
        if (!args.length) return out(stdin)
        let buff = ''
        for (const a of args.filter((x) => !x.startsWith('-'))) {
          const path = normalizePath(a, cwd, HOME)
          const node = vfs.node(path)
          if (!node) throw new Error(`cat: ${a}: No such file or directory`)
          if (node.type === 'dir') throw new Error(`cat: ${a}: Is a directory`)
          buff += (node.url ? `[binary image data: ${node.url}]` : node.content) + '\n'
        }
        return out(buff.replace(/\n$/, ''))
      }
      case 'echo':
        return out(args.filter((a) => !a.startsWith('>')).join(' ').replace(/^"|"$/g, ''))
      case 'mkdir': {
        const dirs = args.filter((a) => !a.startsWith('-'))
        if (!dirs.length) throw new Error('mkdir: missing operand')
        for (const d of dirs) {
          const p = normalizePath(d, cwd, HOME)
          if (vfs.exists(p)) throw new Error(`mkdir: cannot create directory '${d}': File exists`)
          if (!vfs.mkdir(p)) throw new Error(`mkdir: cannot create directory '${d}'`)
        }
        return
      }
      case 'touch': {
        for (const f of args) {
          const p = normalizePath(f, cwd, HOME)
          if (!vfs.exists(p)) vfs.write(p, '')
        }
        return
      }
      case 'rmdir':
      case 'rm': {
        const recursive = args.some((a) => a.includes('r'))
        const files = args.filter((a) => !a.startsWith('-'))
        if (!files.length) throw new Error(`rm: missing operand`)
        for (const f of files) {
          const p = normalizePath(f, cwd, HOME)
          const node = vfs.node(p)
          if (!node) throw new Error(`rm: cannot remove '${f}': No such file or directory`)
          if (node.type === 'dir' && !recursive && cmd === 'rm') {
            throw new Error(`rm: cannot remove '${f}': Is a directory`)
          }
          if (slashProtected(p) && !asRoot) {
            throw new Error(`rm: cannot remove '${f}': Permission denied`)
          }
          vfs.rm(p)
        }
        return
      }
      case 'cp': {
        const [src, dst] = args.filter((a) => !a.startsWith('-'))
        if (!src || !dst) throw new Error('cp: missing file operand')
        if (!vfs.cp(normalizePath(src, cwd, HOME), normalizePath(dst, cwd, HOME))) {
          throw new Error(`cp: cannot stat '${src}'`)
        }
        return
      }
      case 'mv': {
        const [src, dst] = args.filter((a) => !a.startsWith('-'))
        if (!src || !dst) throw new Error('mv: missing file operand')
        if (!vfs.mv(normalizePath(src, cwd, HOME), normalizePath(dst, cwd, HOME))) {
          throw new Error(`mv: cannot stat '${src}'`)
        }
        return
      }
      case 'tree': {
        const path = normalizePath(args[0] ?? '.', cwd, HOME)
        const node = vfs.node(path)
        if (!node || node.type !== 'dir') throw new Error('tree: not a directory')
        const rows: string[] = [prettyCwd(path)]
        let dirs = 0
        let files = 0
        const walk = (n: any, prefix: string) => {
          const entries = Object.entries(n.children).sort(([a], [b]) => a.localeCompare(b))
          entries.forEach(([name, child]: [string, any], i) => {
            const last = i === entries.length - 1
            rows.push(`${prefix}${last ? '└── ' : '├── '}${name}${child.type === 'dir' ? '/' : ''}`)
            if (child.type === 'dir') {
              dirs++
              walk(child, prefix + (last ? '    ' : '│   '))
            } else files++
          })
        }
        walk(node, '')
        rows.push('', `${dirs} directories, ${files} files`)
        return out(rows.join('\n'))
      }
      case 'find': {
        const root2 = normalizePath(args[0] && !args[0].startsWith('-') ? args[0] : '.', cwd, HOME)
        const pattern = args.includes('-name') ? args[args.indexOf('-name') + 1]?.replace(/\*/g, '') : ''
        const results: string[] = []
        const walk = (p: string, n: any) => {
          for (const [name, child] of Object.entries(n.children) as [string, any][]) {
            const child_path = join(p, name)
            if (!pattern || name.includes(pattern)) results.push(child_path)
            if (child.type === 'dir') walk(child_path, child)
          }
        }
        const node = vfs.node(root2)
        if (node?.type === 'dir') walk(root2, node)
        return out(results.join('\n'))
      }
      case 'grep': {
        const flags = args.filter((a) => a.startsWith('-')).join('')
        const rest = args.filter((a) => !a.startsWith('-'))
        let pattern = rest[0] ?? ''
        const targets = rest.slice(1)
        if (!pattern) throw new Error('usage: grep PATTERN [FILE...]')
        const rx = new RegExp(pattern, flags.includes('i') ? 'i' : '')
        const results: string[] = []
        if (!targets.length) {
          return out(stdin.split('\n').filter((l) => rx.test(l)).join('\n'))
        }
        for (const t of targets) {
          const p = normalizePath(t, cwd, HOME)
          const node = vfs.node(p)
          if (!node) throw new Error(`grep: ${t}: No such file or directory`)
          if (node.type === 'dir') {
            const walk = (pp: string, n: any) => {
              for (const [name, child] of Object.entries(n.children) as [string, any][]) {
                const cp = join(pp, name)
                if (child.type === 'dir') walk(cp, child)
                else
                  child.content
                    ?.split('\n')
                    .forEach((l: string, i: number) => rx.test(l) && results.push(`${cp}:${i + 1}:${l}`))
              }
            }
            walk(p, node)
          } else {
            node.content.split('\n').forEach((l, i) => rx.test(l) && results.push(i === 0 || targets.length > 1 ? `${p}:${i + 1}:${l}` : l))
          }
        }
        return out(results.join('\n'))
      }
      case 'wc': {
        const text = args.length ? (vfs.read(normalizePath(args[0], cwd, HOME)) ?? '') : stdin
        const ls = text.split('\n')
        return out(`  ${ls.length}  ${text.split(/\s+/).filter(Boolean).length}  ${text.length} ${args[0] ?? ''}`.trimEnd())
      }
      case 'head':
      case 'tail': {
        const n = Number(args.find((a) => /^\d+$/.test(a)) ?? 10)
        const fileArg = args.find((a) => !/^-?\d+$/.test(a) && !a.startsWith('-'))
        const text = fileArg ? (vfs.read(normalizePath(fileArg, cwd, HOME)) ?? '') : stdin
        const ls = text.split('\n')
        return out((cmd === 'head' ? ls.slice(0, n) : ls.slice(-n)).join('\n'))
      }
      case 'sort':
        return out(stdin.split('\n').sort().join('\n'))
      case 'rev':
        return out((args.length ? vfs.read(normalizePath(args[0], cwd, HOME)) ?? '' : stdin).split('').reverse().join(''))
      case 'cut': {
        const d = args[args.indexOf('-d') + 1] ?? '\t'
        const f = Number(String(args[args.indexOf('-f') + 1] ?? '1')) - 1
        const fileArg = args.find((a) => !a.startsWith('-') && !args.includes(a === '-d' ? '-d' : a))
        const text = fileArg ? vfs.read(normalizePath(fileArg, cwd, HOME)) ?? '' : stdin
        return out(text.split('\n').map((l) => (l.split(d)[f] ?? '')).join('\n'))
      }
      case 'basename':
        return out(baseOf(normalizePath(args[0] ?? '.', cwd, HOME)))
      case 'dirname':
        return out(normalizePath(args[0] ?? '.', cwd, HOME).replace(/\/[^/]*$/, '') || '/')
      case 'realpath':
        return out(normalizePath(args[0] ?? '.', cwd, HOME))
      case 'stat': {
        const p = normalizePath(args[0] ?? '.', cwd, HOME)
        const n = vfs.node(p)
        if (!n) throw new Error(`stat: cannot statx '${args[0]}': No such file or directory`)
        return out(
          `  File: ${p}\n  Size: ${n.type === 'dir' ? 4096 : nodeSize(n)}\tType: ${n.type === 'dir' ? 'directory' : n.mime ?? 'regular file'}\nAccess: (0${root ? '644' : '600'}/-${n.type === 'dir' ? 'rwxr-xr-x' : 'rw-r--r--'})\tUid: (${root ? 0 : 1000}/ ${root ? 'root' : settings.username})\nModify: ${new Date(n.modified).toString().slice(0, 33)}`,
        )
      }
      case 'file': {
        const p = normalizePath(args[0] ?? '.', cwd, HOME)
        const n = vfs.node(p)
        if (!n) throw new Error(`file: cannot open '${args[0]}' (No such file or directory)`)
        return out(`${p}: ${n.type === 'dir' ? 'directory' : (n.mime ?? 'ASCII text')}`)
      }
      case 'du': {
        const p = normalizePath(args[0] ?? '.', cwd, HOME)
        const n = vfs.node(p)
        if (!n) throw new Error(`du: cannot access '${args[0]}'`)
        return out(`${humanSize(nodeSize(n))}\t${prettyCwd(p)}`)
      }
      case 'df':
        return out(
          [
            'Filesystem      Size  Used Avail Use% Mounted on',
            `localStorage     10G  ${humanSize(nodeSize(vfs.node('/')!)).padStart(4)}  9.5G  ${Math.min(99, Math.round(nodeSize(vfs.node('/')!) / 1e8))}% /`,
            'tmpfs             2G   12M  2.0G   1% /run',
            'mixtnetfs          ∞    0B     ∞    - /media/mixtnet',
          ].join('\n'),
        )
      case 'uname':
        return out(
          args.includes('-a')
            ? `Linux ${settings.hostname} 6.8.0-mixt #1 SMP PREEMPT_DYNAMIC ${new Date().toDateString()} x86_64 GNU/JavaScript`
            : 'Linux',
        )
      case 'hostname':
        return out(settings.hostname)
      case 'whoami':
        return out(root ? 'root' : settings.username)
      case 'id':
        return out(root ? 'uid=0(root) gid=0(root) groups=0(root)' : `uid=1000(${settings.username}) gid=1000(${settings.username}) groups=1000(${settings.username}),4(adm),24(cdrom),27(sudo)`)
      case 'groups':
        return out(root ? 'root' : `${settings.username} adm cdrom sudo audio video plugdev` )
      case 'date':
        return out(args[0]?.startsWith('+') ? fmtDate(new Date(), true) : `${fmtDate(new Date(), true)} ${Intl.DateTimeFormat().resolvedOptions().timeZone}`)
      case 'cal': {
        const now = new Date()
        const first = new Date(now.getFullYear(), now.getMonth(), 1)
        const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
        const title = now.toLocaleString('en-GB', { month: 'long', year: 'numeric' })
        const head = 'Su Mo Tu We Th Fr Sa'
        const cells: string[] = []
        for (let i = 0; i < first.getDay(); i++) cells.push('  ')
        for (let d = 1; d <= days; d++) cells.push(String(d).padStart(2))
        const rows = [title.padStart(Math.floor((20 + title.length) / 2)), head]
        for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7).join(' '))
        return out(rows.join('\n'))
      }
      case 'uptime': {
        const secs = Math.round((Date.now() - useOS.getState().bootTime) / 1000)
        const m = Math.floor(secs / 60)
        return out(` ${new Date().toTimeString().slice(0, 5)} up ${m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : `${m} min`}, 1 user, load average: 0.42, 0.31, 0.28`)
      }
      case 'free':
        return out(
          [
            '               total        used        free      shared  buff/cache   available',
            'Mem:            3.9G      812.4M        2.6G       31.2M      521.8M        2.9G',
            'Swap:           2.0G          0B        2.0G',
          ].join('\n'),
        )
      case 'ps':
      case 'top': {
        const wins = useOS.getState().windows
        const rows = ['  PID TTY          TIME CMD']
        rows.push(`    1 ?        00:00:01 systemd(web)`)
        rows.push(`  512 ?        00:00:02 cinnamon(mixt-shell)`)
        wins.forEach((w, i) => rows.push(`${(900 + i * 7).toString().padStart(5)} pts/0    00:0${i}:0${(i + 1) % 9} ${w.appId}`))
        rows.push('')
        rows.push(`Tasks: ${wins.length + 2} total, 1 running, ${wins.length + 1} sleeping`)
        rows.push(`CPU:  ${(2 + wins.length * 1.3).toFixed(1)}%us  ${(0.8 + wins.length * 0.4).toFixed(1)}%sy`)
        return out(rows.join('\n'))
      }
      case 'htop':
        launch('system-monitor')
        push('dim', 'Opened System Monitor.')
        return
      case 'kill':
      case 'killall': {
        const target = args[args.length - 1]
        const win = useOS.getState().windows.find(
          (w) => w.appId === target || w.id === target || w.title.toLowerCase().includes(String(target).toLowerCase()),
        )
        if (!win) throw new Error(`killall: ${target}: no process found`)
        useOS.getState().closeWindow(win.id)
        push('ok', `killed ${target} (pid ${Math.floor(Math.random() * 9000) + 1000})`)
        return
      }
      case 'lscpu':
        return out(
          [
            'Architecture:            x86_64 (simulated)',
            'CPU op-mode(s):          32-bit, 64-bit',
            `CPU(s):                  ${navigator.hardwareConcurrency || 4}`,
            'Model name:              JS Virtual Core @ 3.20GHz',
            `CPU MHz:                 3200.000`,
            `L1d cache:               ${navigator.hardwareConcurrency || 4} × 32 KiB`,
            'Flags:                   fpu vme de pse tsc msr pae mce cx8 apic sep',
          ].join('\n'),
        )
      case 'lsblk':
        return out(
          [
            'NAME   MAJ:MIN RM   SIZE RO TYPE MOUNTPOINTS',
            'vda    254:0    0    64G  0 disk',
            '├─vda1 254:1    0   512M  0 part /boot/efi',
            '├─vda2 254:2    0    60G  0 part /',
            '└─vda3 254:3    0   3.5G  0 part [SWAP]',
            `localStorage 0:0 0 10.0G 0 virtual /home/${settings.username} (.mixt)`,
          ].join('\n'),
        )
      case 'lsusb':
        return out('Bus 001 Device 001: ID 1d6b:0002 Mixt Virtual Hub\nBus 001 Device 002: ID 046d:c52b Logitech Virtual Mouse\nBus 001 Device 003: ID 1bcf:0005 WebCam (emulated)')
      case 'lspci':
        return out('00:00.0 Host bridge: Mixt JS Bridge\n00:02.0 VGA compatible controller: WebGPU Virtual Display Adapter\n00:1f.3 Audio device: WebAudio HDA Controller\n00:1f.6 Ethernet controller: MixtNet Virtual NIC')
      case 'dig': {
        const flags = args.filter((a) => a.startsWith('-'))
        const isType = (a: string) => /^(A|AAAA|CNAME|MX|TXT|NS|SOA|PTR|ANY)$/i.test(a)
        const positional = args.filter((a) => !a.startsWith('-'))
        const typeArg = positional.find(isType)
        // `dig -t MX example.com` and `dig example.com MX` both work
        const target = positional.filter((a) => !isType(a)).pop() ?? 'mixtnet.com'
        const type = (typeArg?.toUpperCase() ?? 'A') as any
        if (flags.includes('-x')) {
          const reverseName = reverseLookup(target)
          if (!reverseName) throw new Error(`${cmd}: no PTR record for ${target}`)
          return out(renderDig(resolveHost(target), 'PTR'))
        }
        const answer = resolveHost(target, { hosts: readHosts() })
        if (type === 'ANY') {
          const extra = zoneRecords().filter((r) => r.name === target.toLowerCase())
          return out(
            renderDig(answer, 'ANY') +
              (extra.length ? `\n;; matches in the zone file:\n${extra.map((r) => `;;   ${r.type} ${r.value}`).join('\n')}` : ''),
          )
        }
        if (type === 'MX' || type === 'TXT' || type === 'NS' || type === 'SOA') {
          const records = type === 'SOA' ? [soaRecord()] : zoneRecords().filter((r) => r.type === type)
          const scoped = target === 'mixtnet' || target === 'mixtnet.' ? records : records.filter((r) => r.name === target.toLowerCase())
          if (!scoped.length) return out(renderDig({ ...answer, answers: [] }, type))
          return out(
            renderDig({ ...answer, answers: scoped.map((r) => ({ ...r, name: target })) }, type),
          )
        }
        return out(renderDig(answer, type))
      }
      case 'host':
        return out(renderHost(resolveHost(args[0] ?? 'mixtnet.com', { hosts: readHosts() })))
      case 'nslookup': {
        const target = args.find((a) => !a.startsWith('-')) ?? 'mixtnet.com'
        const header = 'Server:\t\t10.0.0.53\nAddress:\t\t10.0.0.53#53'
        if (args.includes('-type=mx')) {
          const mx = zoneRecords().filter((r) => r.type === 'MX' && r.name === target.toLowerCase())
          return out(
            [header, '', `Non-authoritative answer:`, ...mx.map((r) => `${r.name}\tmail exchanger = ${r.value}`)].join('\n'),
          )
        }
        return out(renderNslookup(resolveHost(target, { hosts: readHosts() })))
      }
      case 'getent': {
        // getent hosts <name> — the glibc way, and it reads /etc/hosts first
        const target = args[args.length - 1] ?? 'localhost'
        const hosts = readHosts()
        const fromHosts = hosts.get(target.toLowerCase())
        const answer = resolveHost(target, { hosts })
        const ip = fromHosts ?? answer.answers.find((r) => r.type === 'A')?.value
        if (!ip) return out('')
        return out(`${ip}  ${target}${fromHosts ? '   (from /etc/hosts)' : ''}`)
      }
      case 'nmap': {
        const host = args.find((a) => !a.startsWith('-')) ?? 'localhost'
        const answer = resolveHost(host, { hosts: readHosts() })
        if (answer.status !== 'NOERROR' || !answer.server) {
          return out(
            [
              `Starting Nmap 7.94 ( https://nmap.org ) at ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
              `Failed to resolve "${host}".`,
              '',
              'Nmap done: 0 IP addresses (0 hosts up) scanned in 0.31 seconds',
            ].join('\n'),
          )
        }
        const server = answer.server
        const rows = [
          `Starting Nmap 7.94 ( https://nmap.org ) at ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
          `Nmap scan report for ${host} (${serverAddress(server)})`,
          'Host is up (0.00' + answer.rtt + 's latency).',
          'Not shown: 995 closed tcp ports (reset)',
          'PORT     STATE SERVICE     VERSION',
        ]
        for (const port of server.ports ?? []) {
          rows.push(
            `${String(port.port).padEnd(4)}/tcp ${'open'.padEnd(5)} ${port.service.padEnd(11)} ${port.version ?? server.software ?? ''}`.trimEnd(),
          )
        }
        if (server.banner) rows.push('', `Service Info: ${server.banner}`)
        rows.push(
          '',
          `Nmap done: 1 IP address (1 host up) scanned in ${(0.4 + answer.rtt / 100).toFixed(2)} seconds`,
        )
        return out(rows.join('\n'))
      }
      case 'ifconfig':
      case 'ip': {
        const resolv = readResolvConf()
        const hostsFile = readHosts()
        if (args[0] === 'route' || args[1] === 'route') {
          return out(
            [
              'default via 10.0.2.2 dev wlan0 proto dhcp src 10.0.2.15 metric 100',
              '10.0.2.0/24 dev wlan0 proto kernel scope link src 10.0.2.15',
              '10.0.0.0/8 via 10.0.2.2 dev wlan0',
            ].join('\n'),
          )
        }
        if (args[0] === 'addr' || args[0] === 'a' || cmd === 'ifconfig') {
          return out(
            [
              'wlan0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500',
              '        inet 10.0.2.15  netmask 255.255.255.0  broadcast 10.0.2.255',
              '        ether 02:42:0a:00:02:0f  txqueuelen 1000  (Ethernet)',
              `        RX packets ${Math.floor(nodeSize(vfs.node('/')!) / 1000)}  TX packets 8841`,
              '        status: ' + (settings.wifi ? 'connected (MixtNet)' : 'disconnected'),
              '',
              'lo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536',
              '        inet 127.0.0.1  netmask 255.0.0.0',
              '',
              `resolv.conf: ${resolv.nameservers.join(', ') || 'none'}  search ${resolv.search.join(' ') || '—'}`,
              `hosts file: ${hostsFile.size} entries`,
            ].join('\n'),
          )
        }
        return out(
          [
            '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536',
            '    inet 127.0.0.1/8 scope host lo',
            '2: wlan0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500',
            '    inet 10.0.2.15/24 brd 10.0.2.255 scope global wlan0',
            '    link/ether 02:42:0a:00:02:0f brd ff:ff:ff:ff:ff:ff',
          ].join('\n'),
        )
      }
      case 'ping': {
        const host = args.find((a) => !a.startsWith('-')) ?? 'mixtnet.com'
        const info = dnsStatus(host)
        if (info.status !== 'NOERROR' || !info.address) {
          return out(`ping: ${host}: Name or service not known`)
        }
        const ttl = 52 + (hashString(host) % 12)
        const rows = [`PING ${host} (${info.address}) 56(84) bytes of data.`]
        let total = 0
        for (let i = 0; i < 4; i++) {
          const time = latencyFor(`${host}${i}`)
          total += time
          rows.push(`64 bytes from ${host} (${info.address}): icmp_seq=${i + 1} ttl=${ttl} time=${time}.${i} ms`)
        }
        rows.push(
          '',
          `--- ${host} ping statistics ---`,
          '4 packets transmitted, 4 received, 0% packet loss, time ' + (total + 12) + 'ms',
          `rtt min/avg/max/mdev = ${Math.min(...[1, 2, 3, 4].map((i) => latencyFor(`${host}${i - 1}`)))}/${(
            total / 4
          ).toFixed(3)}/${Math.max(...[1, 2, 3, 4].map((i) => latencyFor(`${host}${i - 1}`)))}/${(
            total / 12
          ).toFixed(3)} ms`,
        )
        return out(rows.join('\n'))
      }
      case 'curl':
      case 'wget': {
        const url = args.find((a) => !a.startsWith('-'))
        if (!url) throw new Error(`${cmd}: missing URL`)
        const text = await fetchAsText(url)
        if (cmd === 'wget') {
          const name = baseOf(url.replace(/^https?:\/\//, '')) || 'index.html'
          const target = normalizePath(args.includes('-O') ? args[args.indexOf('-O') + 1] : join(HOME, 'Downloads', name), cwd, HOME)
          vfs.write(target, text, 'text/html')
          push('dim', `--${new Date().toISOString().replace('T', ' ').slice(0, 19)}--  ${url}`)
          push('ok', `Saving to: '${prettyCwd(target)}'  —  ${humanSize(text.length)} saved`)
          return
        }
        return out(text)
      }
      case 'ssh':
        return out(
          `The authenticity of host '${args[0] ?? 'mixtnet.com'}' can't be established.\nED25519 key fingerprint is SHA256:mixt+VirtualHost+NoRealCrypto.\nThis key is not known by any other names.\nConnection closed by remote host (no real SSH inside a browser sandbox).`,
        )
      case 'git':
        if (args[0] === 'init') {
          vfs.mkdirp(join(cwd, '.git'))
          vfs.write(join(cwd, '.git', 'HEAD'), 'ref: refs/heads/main\n')
          push('ok', `Initialized empty Git repository in ${prettyCwd(join(cwd, '.git'))}/`)
        } else if (args[0] === 'status') {
          push('out', `On branch main\n\nNo commits yet\n\nnothing to commit (create/copy files and use "git add" to track)`)
        } else if (args[0] === '--version') {
          return out('git version 2.46.0-mixt')
        } else {
          push('dim', 'git: this is a mini implementation — try git init, git status, git --version.')
        }
        return
      case 'python3':
      case 'node':
      case 'npm':
        return out(
          args[0] === '--version' || args[0] === '-v'
            ? { python3: 'Python 3.12.4 (mixt)', node: 'v22.0.0-mixt', npm: '10.9.0' }[cmd]!
            : `${cmd}: interactive sessions are not available in this shell. Try ${cmd} --version`,
        )
      case 'which':
      case 'whereis':
        return out(COMMANDS.includes(args[0]) ? `/usr/bin/${args[0]}` : `${args[0]} not found`)
      case 'man': {
        const topic = args[0]
        if (!topic) throw new Error('What manual page do you want?')
        const summaries: Record<string, string> = {
          ls: 'list directory contents',
          cd: 'change the working directory',
          dig: 'DNS lookup utility — queries the MixtNet resolver',
          host: 'DNS lookup utility (concise form)',
          nslookup: 'query name servers interactively',
          getent: 'get entries from the hosts database (/etc/hosts first)',
          nmap: 'network exploration tool and port scanner',
          curl: 'transfer a MixtNet url and print the plain-text version',
          ping: 'send ICMP ECHO_REQUEST to network hosts',
          ifconfig: 'configure the network interface',
        }
        return out(
          [
            `NAME`,
            `     ${topic} — ${summaries[topic] ?? 'Mixt Web OS command'}`,
            '',
            'SYNOPSIS',
            `     ${topic} [OPTION]... [FILE]...`,
            '',
            'DESCRIPTION',
            '     This is a virtual manual page. Mixt Web OS implements a subset of the',
            '     GNU coreutils inside a browser, backed by the localStorage filesystem.',
            '',
            'SEE ALSO',
            '     help(1), neofetch(1), mixt(1)',
            '',
            'RESOLVER',
            '     Names are resolved from /etc/hosts first, then from MixtNet DNS',
            '     (10.0.0.53, 10.0.0.54). The zone is built from the machines in',
            '     src/net/internet/servers/ — see about:dns in the Web Browser.',
          ].join('\n'),
        )
      }
      case 'neofetch':
      case 'inxi': {
        const art = [
          '        ,gggg,    ',
          '     ,d8"  "Y8b,   ',
          '   ,8"       `Y8,  ',
          '   d8           8b ',
          '   Y8,          ,8 ',
          '    `8b,,____,,d8" ',
          '      "Y8b,,d8P"   ',
        ]
        const info = [
          `${settings.username}@${settings.hostname}`,
          '-----------------------------',
          `OS: Mixt Web OS 1.0 x86_64 (GNU/JavaScript)`,
          `Host: ${navigator.vendor || 'Mixt'} ${navigator.platform}`,
          `Kernel: 6.8.0-mixt`,
          `Uptime: ${Math.max(1, Math.round((Date.now() - useOS.getState().bootTime) / 60000))} mins`,
          `Packages: ${APPS.filter((a) => (a.preinstalled !== false ? true : installed[a.id])).length} (dpkg), 4 (snap)`,
          `Shell: bash 5.2.21`,
          `Resolution: ${window.innerWidth}x${window.innerHeight}`,
          `DE: Cinnamon (web edition)`,
          `WM: mixtwm (React)`,
          `Theme: ${settings.themeName} [GTK3]`,
          `Icons: ${settings.iconTheme} [GTK3]`,
          `Terminal: mixt-terminal`,
          `CPU: JS Virtual Core (${navigator.hardwareConcurrency || 4}) @ 3.2GHz`,
          `GPU: WebGPU Virtual Display`,
          `Memory: ${Math.round(380 + useOS.getState().windows.length * 34)}MiB / 3939MiB`,
        ]
        const rows = art.map((a, i) => `${a}   ${info[i] ?? ''}`)
        return out(rows.join('\n'))
      }
      case 'apt':
      case 'apt-get':
      case 'dpkg':
      case 'snap':
      case 'flatpak': {
        const sub = args[0]
        if (cmd === 'dpkg' && (args[0] === '-l' || args[0] === '--list')) {
          const rows = ['Desired=Unknown/Install/Remove/Purge/Hold', '||/ Name                 Version        Description', '+++-====================-==============-=========================']
          APPS.filter((a) => a.preinstalled !== false || installed[a.id]).forEach((a) =>
            rows.push(`ii  ${a.id.padEnd(20)} ${'1.0.0'.padEnd(14)} ${a.comment}`),
          )
          return out(rows.join('\n'))
        }
        if (cmd === 'apt' && (sub === 'update' || sub === 'upgrade')) {
          push('out', 'Hit:1 http://packages.mixtnet.com mixt mixt/stable InRelease')
          push('out', 'Reading package lists... Done')
          push('ok', 'All packages are up to date.')
          return
        }
        if (sub === 'search' || (cmd === 'apt' && sub === 'list')) {
          const q = (args[1] ?? '').toLowerCase()
          const found = APPS.filter((a) => a.id.includes(q) || a.name.toLowerCase().includes(q) || a.comment.toLowerCase().includes(q))
          if (!found.length) throw new Error(`E: Unable to locate package ${args[1]}`)
          return out(
            found
              .map((a) => `${a.id}/${a.preinstalled === false && !installed[a.id] ? 'new' : 'installed'}\n    ${a.name} — ${a.comment}`)
              .join('\n\n'),
          )
        }
        if (sub === 'install') {
          const names = args.slice(1).filter((a) => !a.startsWith('-'))
          if (!names.length) throw new Error('apt install: no package specified')
          for (const name of names) {
            const def =
              APPS.find((a) => a.id === name) ??
              APPS.find((a) => a.name.toLowerCase().replace(/\s/g, '-') === name) ??
              APPS.find((a) => a.id.startsWith(name))
            if (!def) throw new Error(`E: Unable to locate package ${name}`)
            if (def.preinstalled !== false || installed[def.id]) {
              push('out', `${def.id} is already the newest version (1.0.0).`)
              continue
            }
            setInstalled(def.id, true)
            push('out', `Unpacking ${def.id} (1.0.0) ...`)
            push('ok', `Setting up ${def.id} (1.0.0) ... done — “${def.name}” is now in your Menu.`)
          }
          return
        }
        if (sub === 'remove' || sub === 'purge' || sub === 'uninstall') {
          const name = args.slice(1).find((a) => !a.startsWith('-'))
          const def = APPS.find((a) => a.id === name || a.name.toLowerCase() === name)
          if (!def) throw new Error(`E: Unable to locate package ${name}`)
          if (def.preinstalled !== false) throw new Error(`E: ${name} is a core system package and cannot be removed in the web edition.`)
          setInstalled(def.id, false)
          push('ok', `Removing ${def.id} (1.0.0) ... done`)
          return
        }
        push('dim', `usage: ${cmd} {update|upgrade|search|install|remove|list}`)
        return
      }
      case 'mixtinstall':
        launch('mixtinstall')
        push('dim', 'Opening the Software Manager…')
        return
      case 'mixtupdate':
        push('out', 'Refreshing package list… done')
        push('ok', 'Your system is up to date. 3 optional applications are available in the Software Manager.')
        return
      case 'open':
      case 'xdg-open': {
        const target = args[0]
        if (!target) throw new Error('xdg-open: missing argument')
        if (/^https?:\/\//.test(target) || /^[\w-]+\.(com|org|net|io|dev|edu|gov|mixtnet)/.test(target)) {
          launch('browser', { url: target })
          push('dim', `Opening ${target} in the Web Browser…`)
        } else {
          const p = normalizePath(target, cwd, HOME)
          if (!vfs.exists(p)) throw new Error(`xdg-open: ${target}: no such file`)
          const { openPath } = await import('../os/bus')
          openPath(p)
          push('dim', `Opening ${prettyCwd(p)}…`)
        }
        return
      }
      case 'nano':
      case 'vim':
      case 'xed': {
        const p = normalizePath(args[0] ?? join(HOME, 'Untitled.txt'), cwd, HOME)
        if (!vfs.exists(p)) vfs.write(p, '')
        launch('xed', { path: p })
        push('dim', `Opened ${prettyCwd(p)} in the Text Editor.`)
        return
      }
      case 'nemo':
        launch('nemo', args[0] ? { path: normalizePath(args[0], cwd, HOME) } : { path: cwd })
        return
      case 'firefox':
      case 'browser':
        launch('browser', args[0] ? { url: args[0] } : {})
        return
      case 'clear':
        setLines([])
        return
      case 'history':
        return out(history.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`).join('\n'))
      case 'env':
      case 'export':
        return out(
          [
            `USER=${root ? 'root' : settings.username}`,
            `HOME=${root ? '/root' : HOME}`,
            `SHELL=/bin/bash`,
            `PWD=${cwd}`,
            `HOSTNAME=${settings.hostname}`,
            `TERM=xterm-256color`,
            `DESKTOP_SESSION=cinnamon`,
            `LANG=en_GB.UTF-8`,
          ].join('\n'),
        )
      case 'alias':
        return out("alias ll='ls -la'\nalias ..='cd ..'")
      case 'notify-send': {
        const title = args[0] ?? 'Terminal'
        const body = args.slice(1).join(' ')
        api.notify({ title, body })
        return
      }
      case 'theme': {
        const v = args[0]
        if (v === 'dark' || v === 'light') {
          setSettings({ scheme: v, themeName: v === 'dark' ? 'Mixt-Y-Dark' : 'Mixt-Y' })
          push('ok', `Appearance switched to ${v}.`)
        } else push('dim', 'usage: theme {dark|light}')
        return
      }
      case 'wallpaper': {
        const list = Object.keys((vfs.node('/usr/share/backgrounds') as any)?.children ?? {})
        const v = args[0]
        if (!v) return out(list.map((l, i) => `${i + 1}. ${l}`).join('\n'))
        const file2 = list.find((l) => l === v || l.startsWith(v)) ?? list[Number(v) - 1]
        if (!file2) throw new Error(`wallpaper: '${v}' not found`)
        setSettings({ wallpaper: `/wallpapers/${file2}` })
        push('ok', `Background set to ${file2}.`)
        return
      }
      case 'volume': {
        const n = Number(args[0])
        if (Number.isNaN(n)) return out(`volume: ${settings.muted ? 'muted' : `${settings.volume}%`}`)
        setSettings({ volume: Math.max(0, Math.min(100, n)), muted: false })
        return
      }
      case 'battery':
        return out('Battery 0: Discharging, 87%, 03:41 remaining\nBattery 0: design capacity 5200 mAh, last full capacity 4980 mAh = 95%')
      case 'xrandr':
        return out(`${window.innerWidth}x${window.innerHeight}   60.00*+`)
      case 'screenshot': {
        const { saveWallpaperShot } = await import('./screenshot-utils')
        const res = await saveWallpaperShot()
        push('ok', res)
        return
      }
      case 'lock':
        useOS.getState().setLocked(true)
        return
      case 'logout':
      case 'exit':
        push('dim', 'Closing this terminal…')
        api.close()
        return
      case 'reboot':
      case 'shutdown':
      case 'poweroff':
        window.dispatchEvent(new CustomEvent('mixt:session', { detail: cmd }))
        return
      case 'fortune':
        return out(FORTUNES[Math.floor(Math.random() * FORTUNES.length)])
      case 'cowsay': {
        const text = args.join(' ') || 'Mixt Web OS is a full computer in your browser'
        const top = '_'.repeat(text.length + 2)
        return out(
          [
            ` ${top}`,
            `< ${text} >`,
            ` ${'-'.repeat(text.length + 2)}`,
            '        \\   ^__^',
            '         \\  (oo)\\_______',
            '            (__)\\       )\\/\\',
            '                ||----w |',
            '                ||     ||',
          ].join('\n'),
        )
      }
      case 'sl':
        return out('🚂 choo choo — you meant "ls", right?')
      case 'yes':
        return out(Array(12).fill(args[0] ?? 'y').join('\n') + '\n(truncated)')
      case 'seq': {
        const from = args.length > 1 ? Number(args[0]) : 1
        const to = Number(args.length > 1 ? args[1] : args[0] ?? 1)
        const count = Math.max(0, Math.min(200, to - from + 1))
        return out(Array.from({ length: count }, (_, i) => from + i).join('\n'))
      }
      case 'sleep':
        await new Promise((r) => setTimeout(r, Math.min(3000, Number(args[0] ?? 1) * 1000)))
        return
      case 'true':
        return
      case 'false':
        throw new Error('false: exit status 1')
      case 'time':
        return out('real\t0m0.012s\nuser\t0m0.008s\nsys\t0m0.004s')
      case 'chmod':
      case 'chown':
        push('dim', `${cmd}: permission bits are virtual, but noted.`)
        return
      case 'sha256sum':
      case 'md5sum': {
        const p = normalizePath(args[0] ?? '', cwd, HOME)
        const content = vfs.read(p) ?? args[0]
        let h = 0x811c9dc5
        for (let i = 0; i < content.length; i++) {
          h ^= content.charCodeAt(i)
          h = Math.imul(h, 0x01000193) >>> 0
        }
        const hex = (h.toString(16).padStart(8, '0') + h.toString(2).padStart(24, '0')).slice(0, 32)
        return out(`${hex}  ${args[0]}`)
      }
      case 'base64': {
        const p = normalizePath(args.find((a) => !a.startsWith('-')) ?? '', cwd, HOME)
        const text = vfs.read(p) ?? args.filter((a) => !a.startsWith('-')).join(' ')
        try {
          return out(args.includes('-d') ? atob(text) : btoa(text.slice(0, 200)))
        } catch {
          throw new Error('base64: invalid input')
        }
      }
      case 'zip':
      case 'unzip':
      case 'tar':
        launch('archive', {})
        push('dim', `Opening Archive Manager for ${args[0] ?? 'the current folder'}…`)
        return
      default:
        if (cmd.startsWith('#')) return
        throw new Error(`${cmd}: command not found`)
    }
  }

  /* ------------------------------ interactive ------------------------------ */
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const value = input
      setInput('')
      setHistIdx(-1)
      void run(value)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!history.length) return
      const idx = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1)
      setHistIdx(idx)
      setInput(history[idx])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (histIdx === -1) return
      const idx = histIdx + 1
      if (idx >= history.length) {
        setHistIdx(-1)
        setInput('')
      } else {
        setHistIdx(idx)
        setInput(history[idx])
      }
    } else if (e.key === 'Tab') {
      e.preventDefault()
      complete()
    } else if (e.ctrlKey && e.key.toLowerCase() === 'c') {
      e.preventDefault()
      setLines((ls) => [...ls, { id: lineId++, kind: 'in', text: `${prompt}${root ? '#' : '$'} ${input}^C` }])
      setInput('')
    } else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
      e.preventDefault()
      setLines([])
    } else if (e.ctrlKey && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      api.close()
    }
  }

  function complete() {
    const parts = input.split(/\s+/)
    const last = parts[parts.length - 1] ?? ''
    if (parts.length === 1) {
      const matches = COMMANDS.filter((c) => c.startsWith(last))
      if (matches.length === 1) setInput(matches[0] + ' ')
      else if (matches.length > 1) pushMany([['out', matches.join('  ')], ['out', '']])
      return
    }
    const dir = last.includes('/') ? normalizePath(last.replace(/\/[^/]*$/, '') || '.', cwd, HOME) : cwd
    const frag = last.split('/').pop() ?? ''
    const entries = vfs.list(dir)
    if (!entries) return
    const matches = entries.filter((en) => en.name.startsWith(frag))
    if (matches.length === 1) {
      const completed = last.includes('/') ? last.replace(/[^/]*$/, matches[0].name) : matches[0].name
      parts[parts.length - 1] = completed + (matches[0].node.type === 'dir' ? '/' : '')
      setInput(parts.join(' '))
    } else if (matches.length > 1) {
      pushMany([['out', matches.map((m) => m.name + (m.node.type === 'dir' ? '/' : '')).join('  ')], ['out', '']])
    }
  }

  async function paste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData('text')
    if (!text) return
    e.preventDefault()
    for (const line of text.split('\n')) {
      // eslint-disable-next-line no-await-in-loop
      await run(line, { silent: line !== text.split('\n')[0] })
    }
  }

  const colors: Record<Line['kind'], string> = {
    in: 'var(--wm-window-fg)',
    out: '#d7dbd8',
    err: '#ff8a80',
    ok: '#b6e88a',
    dim: '#8b9490',
  }

  return (
    <div
      style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#1b1f22', color: '#d7dbd8', minHeight: 0 }}
      onClick={() => inputRef.current?.focus()}
    >
      <div ref={scroller} style={{ flex: 1, overflow: 'auto', padding: '8px 10px', fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.5 }}>
        {lines.map((l) => (
          <div key={l.id} style={{ color: colors[l.kind], whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontStyle: l.kind === 'dim' ? 'italic' : undefined }}>
            {l.kind === 'in' ? <PromptLine text={l.text} /> : <Ansi text={l.text} />}
          </div>
        ))}
        {busy && <div className="cursor-blink">▌</div>}
        <div style={{ display: 'flex', alignItems: 'center', whiteSpace: 'pre-wrap' }}>
          <PromptLine text={`${prompt}${root ? '#' : '$'}`} />
          <input
            ref={inputRef}
            value={input}
            autoFocus
            spellCheck={false}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={paste}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#eef2ef',
              fontFamily: 'var(--font-mono)',
              fontSize: 12.5,
              padding: 0,
              caretColor: 'var(--wm-accent)',
            }}
          />
        </div>
      </div>
    </div>
  )
}

/** Renders `user@host:~$` with Mixt-Y colours. */
function PromptLine({ text }: { text: string }) {
  const m = text.match(/^(.*?)(:.*?)([#$])\s?(.*)$/s)
  if (!m) return <span style={{ color: '#eef2ef' }}>{text}</span>
  return (
    <span>
      <span style={{ color: '#9ede6a', fontWeight: 700 }}>{m[1]}</span>
      <span style={{ color: '#7fb2e8' }}>{m[2]}</span>
      <span style={{ color: '#eef2ef' }}>{m[3]}</span>
      <span style={{ color: '#eef2ef' }}>{m[4] ? ' ' + m[4] : ''}</span>
    </span>
  )
}

/** Minimal ANSI SGR colour support so `ls` output can look like Mixt's. */
const ANSI_COLORS: Record<string, string> = {
  '30': '#6b7280', '31': '#ff8a80', '32': '#9ede6a', '33': '#e8c46a', '34': '#7fb2e8',
  '35': '#d79ae8', '36': '#68d8d0', '37': '#d7dbd8', '90': '#7c8580', '1': 'bold',
}

function Ansi({ text }: { text: string }) {
  const parts = text.split(/\u001b\[([0-9;]*)m/)
  return (
    <>
      {parts.map((chunk, i) => {
        if (i % 2 === 1) return null
        const code = parts[i - 1]
        const style: React.CSSProperties = {}
        if (code) {
          const bits = code.split(';')
          for (const bit of bits) {
            if (bit === '1') style.fontWeight = 700
            else if (ANSI_COLORS[bit]) style.color = ANSI_COLORS[bit]
          }
        }
        return <span key={i} style={style}>{chunk}</span>
      })}
    </>
  )
}

function colorName(name: string, isDir: boolean) {
  const hidden = name.startsWith('.')
  if (isDir) return `\u001b[34m${name}\u001b[0m`
  if (hidden) return `\u001b[90m${name}\u001b[0m`
  return name
}

function baseOf(p: string) {
  return p.replace(/\/+$/, '').split('/').pop() || p
}

function slashProtected(p: string) {
  return ['/bin', '/etc', '/usr', '/var'].some((x) => p === x || p.startsWith(x + '/'))
}

/** Splits a command line on top-level &&, || and ; (ignoring quotes). */
function splitChain(line: string): { parts: string[]; ops: string[] } | null {
  const parts: string[] = []
  const ops: string[] = []
  let cur = ''
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      cur += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
      continue
    }
    const two = line.slice(i, i + 2)
    if (two === '&&' || two === '||') {
      parts.push(cur)
      ops.push(two)
      cur = ''
      i++
      continue
    }
    if (ch === ';') {
      parts.push(cur)
      ops.push(';')
      cur = ''
      continue
    }
    cur += ch
  }
  parts.push(cur)
  if (!ops.length) return null
  return { parts: parts.map((p) => p.trim()).filter(Boolean), ops }
}

function tokenize(line: string) {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (/\s/.test(ch)) {
      if (cur) out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}
