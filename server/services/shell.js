/**
 * The shell.
 *
 * This runs on the server, against the filesystem service, as the account that
 * typed the command — which is what makes the terminal an *isolated* thing
 * rather than a decorative one. For a standard account the shell is a jail: it
 * can create, read, move and delete files, and every one of those goes through
 * the same permission check as the Files application, so there is no path that
 * reaches another account's home, the server's own directory, or the host. The
 * administrator is the exception by design: they own the machine, and they are
 * the only session that can be given a shell on the host itself (and only when
 * the configuration says so).
 *
 * Commands that need the *desktop* rather than the filesystem — opening a
 * window, changing the wallpaper, fetching a page — do not run here. They come
 * back as effects for the client to carry out, because the server has no
 * windows and no browser.
 */
import crypto from 'node:crypto';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { BaseService } from '../lib/container.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { baseName, humanSize, join, normalizePath, parentPath, splitPath } from '../lib/util.js';
import { HOME, TRASH_FILES } from './fs.js';

const FORTUNES = [
    'Any sufficiently advanced bug is indistinguishable from a feature.',
    'There is no place like ~/',
    'Real programmers count from 0.',
    'To err is human — to blame it on the compiler is even more so.',
    'Unix is user friendly. It is just picky about its friends.',
    'A clean desk is a sign of a cluttered drawer.',
    'There are two hard problems in computing: cache invalidation, naming things, and off-by-one errors.',
    'It works on my machine. Your machine is the problem.',
];

/* --------------------------------- parsing -------------------------------- */

/**
 * Split a line into tokens.
 *
 * Quotes group, backslash escapes, and `>` `>>` `|` `;` `&&` `||` are their own
 * tokens so the grammar below can find them without re-reading the text.
 */
export function tokenize (line) {
    const out = [];
    let cur = '';
    let quote = null;
    const push = () => { if (cur !== '') { out.push(cur); cur = ''; } };
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) {
            if (ch === quote) quote = null;
            else if (ch === '\\' && quote === '"' && i + 1 < line.length) cur += line[++i];
            else cur += ch;
            continue;
        }
        if (ch === '"' || ch === "'") { quote = ch; continue; }
        if (ch === '\\' && i + 1 < line.length) { cur += line[++i]; continue; }
        if (/\s/.test(ch)) { push(); continue; }
        if (ch === '|') {
            push();
            if (line[i + 1] === '|') { out.push('||'); i++; } else out.push('|');
            continue;
        }
        if (ch === '&' && line[i + 1] === '&') { push(); out.push('&&'); i++; continue; }
        if (ch === ';') { push(); out.push(';'); continue; }
        if (ch === '>') {
            push();
            if (line[i + 1] === '>') { out.push('>>'); i++; } else out.push('>');
            continue;
        }
        if (ch === '<') { push(); out.push('<'); continue; }
        cur += ch;
    }
    push();
    return out;
}

/**
 * Commands, joined by `;` `&&` `||`, each a pipeline with an optional redirect.
 *
 *   { op: ';'|'&&'|'||', stages: [ { argv, redirect } ] }
 */
export function parse (line) {
    const tokens = tokenize(line);
    const segments = [];
    let current = { stages: [newStage()], op: ';' };
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t === '|') {
            current.stages.push(newStage());
        } else if (t === ';' || t === '&&' || t === '||') {
            segments.push(current);
            current = { stages: [newStage()], op: t, join: t };
        } else if (t === '>' || t === '>>') {
            current.stages[current.stages.length - 1].redirect = { file: tokens[++i] || '', append: t === '>>' };
        } else if (t === '<') {
            current.stages[current.stages.length - 1].input = tokens[++i] || '';
        } else {
            current.stages[current.stages.length - 1].argv.push(t);
        }
    }
    segments.push(current);
    /* The operator on a segment describes how it was joined to the *next* one,
       so it is carried forward: `a && b` is one segment with op '&&'. */
    const out = [];
    for (let i = 0; i < segments.length; i++) {
        out.push({
            ...segments[i],
            join: segments[i + 1] ? segments[i + 1].op : null,
            stages: segments[i].stages.filter((s) => s.argv.length || s.redirect),
        });
    }
    return { segments: out.filter((s) => s.stages.length), tokens };
}

const newStage = () => ({ argv: [], redirect: null, input: null });

/* ---------------------------------- shell --------------------------------- */

export class Shell {
    /**
     * @param {object} world  { fs, actor, services, config, log }
     */
    constructor (world) {
        this.fs = world.fs;
        this.actor = world.actor;
        this.services = world.services;
        this.config = world.config;
        this.log = world.log;
        this.cwd = HOME;
        this.env = {
            USER: world.actor.username,
            HOME,
            SHELL: '/bin/bash',
            PWD: HOME,
            HOSTNAME: world.config.hostname,
            TERM: 'xterm-256color',
            DESKTOP_SESSION: 'mixt-shell',
            LANG: 'en_GB.UTF-8',
        };
        this.history = [];
        this.effects = [];
        this.elevated = false;
    }

    /** Commands record something for the desktop to do. */
    effect (type, data = {}) { this.effects.push({ type, ...data }); }

    abs (p) { return normalizePath(p ?? '', this.cwd, HOME); }

    pretty (p) { return String(p).startsWith(HOME) ? '~' + String(p).slice(HOME.length) : p; }

    /* --------------------------------- run --------------------------------- */

    async run (line, { stdin = null } = {}) {
        this.effects = [];
        const output = [];
        const errors = [];
        let clear = false;
        let exit = false;

        const trimmed = String(line ?? '').trim();
        if (trimmed) this.history.push(trimmed);
        const { segments } = parse(trimmed);

        let lastOk = true;
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            /* `&&` and `||` decide whether this one runs at all. */
            if (i > 0) {
                const previous = segments[i - 1];
                if (previous.join === '&&' && !lastOk) continue;
                if (previous.join === '||' && lastOk) continue;
            }
            let text = stdin;
            try {
                for (const stage of segment.stages) {
                    if (stage.input) {
                        const source = this.abs(stage.input);
                        text = await this.fs.read(this.actor, source, { cwd: this.cwd });
                    }
                    text = await this._stage(stage, text);
                }
                if (segment.stages.length) {
                    const redirect = segment.stages[segment.stages.length - 1].redirect;
                    if (redirect) {
                        const target = this.abs(redirect.file);
                        if (redirect.append) {
                            const existing = await this.fs.read(this.actor, target, { cwd: this.cwd });
                            await this.fs.write(this.actor, target, `${existing ?? ''}${text}`, undefined, { cwd: this.cwd });
                        } else {
                            await this.fs.write(this.actor, target, text, undefined, { cwd: this.cwd });
                        }
                        text = '';
                    }
                }
                if (text != null && text !== '') output.push(String(text).replace(/\n$/, ''));
                lastOk = true;
            } catch (e) {
                errors.push(e.message || String(e));
                lastOk = false;
            }
        }

        /* `clear` and `exit` come back as effects because only the desktop can
           empty its own scrollback or close its own window. */
        for (const effect of this.effects) {
            if (effect.type === 'clear') clear = true;
            if (effect.type === 'exit') exit = true;
        }
        this.env.PWD = this.cwd;
        return {
            out: output.join('\n'),
            err: errors.join('\n'),
            effects: this.effects,
            cwd: this.cwd,
            clear,
            exit,
            rev: this.fs.rev(this.actor),
        };
    }

    async _stage (stage, stdin) {
        const [name, ...args] = stage.argv;
        const command = COMMANDS[name];
        if (!command) {
            if (String(name).startsWith('#')) return '';
            throw new Error(`${name}: command not found`);
        }
        if (command.adminOnly && this.actor.role !== 'admin') {
            throw new Error(`${name}: permission denied — that is for the administrator`);
        }
        this.elevated = false;
        return await command.run(this, args, stdin);
    }

    /** Names for tab completion, which the terminal asks for. */
    completions (prefix) {
        const names = Object.keys(COMMANDS).filter((c) => c.startsWith(prefix));
        if (names.length) return names;
        /* Not a command: complete a path in the working directory. */
        const slash = prefix.lastIndexOf('/');
        const dirPart = slash >= 0 ? prefix.slice(0, slash + 1) : '';
        const leaf = slash >= 0 ? prefix.slice(slash + 1) : prefix;
        try {
            const target = this.abs(dirPart || '.');
            const node = this.fs.resolve(this.actor, target, { cwd: this.cwd });
            if (!node) return [];
            const children = this.fs.entries.children(node.uid)
                .filter((c) => c.name.startsWith(leaf) && this.fs.acl.canRead(this.actor, c))
                .map((c) => dirPart + c.name + (c.type === 'dir' ? '/' : ''));
            return children;
        } catch {
            return [];
        }
    }
}

/* -------------------------------- commands -------------------------------- */
/* `run(shell, args, stdin)` returns the text that goes to the next stage, or
   throws with the message a terminal would print. `shell.effect()` is how a
   command asks the desktop for something the server cannot do. */

const C = (name, opts, run) => ({ name, ...opts, run });

const COMMANDS = {};

function define (name, opts, run) {
    const cmd = C(name, opts, run);
    COMMANDS[name] = cmd;
    for (const alias of opts.alias || []) COMMANDS[alias] = { ...cmd, name: alias };
}

/** Read a file, or take the piped text when there is no file named. */
async function inputOf (shell, args, stdin, { fallback = '' } = {}) {
    if (!args.length) return stdin ?? fallback;
    const path = shell.abs(args[0]);
    const text = await shell.fs.read(shell.actor, path, { cwd: shell.cwd });
    if (text === null) throw new Error(`cat: ${args[0]}: is a directory`);
    return text;
}

/* ------------------------------- filesystem -------------------------------- */

define('ls', { alias: ['dir'] }, async (shell, args) => {
    const flags = args.filter((a) => a.startsWith('-')).join('');
    const names = args.filter((a) => !a.startsWith('-'));
    const long = flags.includes('l');
    const all = flags.includes('a');
    const targets = names.length ? names : ['.'];
    const blocks = [];
    for (const target of targets) {
        const path = shell.abs(target);
        const node = shell.fs.resolve(shell.actor, path, { cwd: shell.cwd, mustExist: true });
        if (node.type === 'file') { blocks.push(long ? describe(shell, node) : node.name); continue; }
        const entries = await shell.fs.readdir(shell.actor, path, { cwd: shell.cwd });
        const shown = entries.filter((e) => all || !e.name.startsWith('.'));
        if (!shown.length) continue;
        if (targets.length > 1) blocks.push(`${target}:`);
        blocks.push(long
            ? [`total ${shown.length}`, ...shown.map((e) => longLine(e))].join('\n')
            : shown.map((e) => (e.type === 'dir' ? `${e.name}/` : e.name)).join('  '));
    }
    return blocks.join('\n\n');
});

function longLine (entry) {
    const perms = entry.type === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--';
    const size = String(entry.type === 'dir' ? 4096 : entry.size).padStart(8);
    const when = new Date(entry.modified).toLocaleString('en-GB',
        { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `${perms}  ${(entry.owner || 'user').padEnd(10)} ${size} ${when} ${entry.name}${entry.type === 'dir' ? '/' : ''}`;
}

function describe (shell, node) {
    const entry = shell.fs.toPublic(shell.actor, node);
    return longLine(entry);
}

define('ll', {}, async (shell, args) => COMMANDS.ls.run(shell, ['-la', ...args], null));

define('cd', {}, async (shell, args) => {
    const target = args[0] ?? HOME;
    const path = shell.abs(target === '-' ? (shell.env.OLDPWD || HOME) : target);
    const node = shell.fs.resolve(shell.actor, path, { cwd: shell.cwd, mustExist: true });
    if (node.type !== 'dir') throw new Error(`cd: ${args[0]}: not a directory`);
    shell.env.OLDPWD = shell.cwd;
    shell.cwd = shell.fs.pathOf(shell.actor, node);
    shell.env.PWD = shell.cwd;
    return '';
});

define('pwd', {}, async (shell) => shell.cwd);

define('cat', { alias: ['less', 'more'] }, async (shell, args, stdin) => {
    if (!args.length) return stdin ?? '';
    const parts = [];
    for (const name of args) {
        const path = shell.abs(name);
        const node = shell.fs.resolve(shell.actor, path, { cwd: shell.cwd, mustExist: true });
        if (node.type === 'dir') throw new Error(`cat: ${name}: is a directory`);
        const text = await shell.fs.read(shell.actor, path, { cwd: shell.cwd });
        parts.push(text ?? '');
    }
    return parts.join('\n');
});

define('echo', {}, async (shell, args) => args.join(' '));

define('mkdir', {}, async (shell, args) => {
    if (!args.length) throw new Error('mkdir: missing operand');
    for (const target of args.filter((a) => a !== '-p')) {
        await shell.fs.mkdir(shell.actor, shell.abs(target), { cwd: shell.cwd });
    }
    return '';
});

define('touch', {}, async (shell, args) => {
    if (!args.length) throw new Error('touch: missing operand');
    for (const target of args) {
        const path = shell.abs(target);
        const node = shell.fs.resolve(shell.actor, path, { cwd: shell.cwd });
        if (!node) await shell.fs.write(shell.actor, path, '', 'text/plain', { cwd: shell.cwd });
    }
    return '';
});

define('rm', {}, async (shell, args) => {
    const flags = args.filter((a) => a.startsWith('-')).join('');
    const names = args.filter((a) => !a.startsWith('-'));
    if (!names.length) throw new Error('rm: missing operand');
    for (const target of names) {
        const path = shell.abs(target);
        const node = shell.fs.resolve(shell.actor, path, { cwd: shell.cwd });
        if (!node) {
            if (flags.includes('f')) continue;
            throw new Error(`rm: cannot remove '${target}': no such file or directory`);
        }
        if (node.type === 'dir' && !flags.includes('r')) {
            throw new Error(`rm: cannot remove '${target}': is a directory`);
        }
        await shell.fs.remove(shell.actor, path, { cwd: shell.cwd, recursive: true });
    }
    return '';
});

define('rmdir', {}, async (shell, args) => {
    if (!args.length) throw new Error('rmdir: missing operand');
    for (const target of args) {
        await shell.fs.remove(shell.actor, shell.abs(target), { cwd: shell.cwd, recursive: false });
    }
    return '';
});

define('cp', {}, async (shell, args) => {
    if (args.length < 2) throw new Error('cp: missing operand');
    const sources = args.slice(0, -1).filter((a) => !a.startsWith('-'));
    const destination = args[args.length - 1];
    for (const source of sources) {
        await shell.fs.copy(shell.actor, shell.abs(source), shell.abs(destination), { cwd: shell.cwd });
    }
    return '';
});

define('mv', {}, async (shell, args) => {
    if (args.length < 2) throw new Error('mv: missing operand');
    await shell.fs.move(shell.actor, shell.abs(args[0]), shell.abs(args[1]), { cwd: shell.cwd });
    return '';
});

define('ln', {}, async (shell, args) => {
    const flags = args.filter((a) => a.startsWith('-'));
    const names = args.filter((a) => !a.startsWith('-'));
    if (names.length < 2) throw new Error('ln: missing operand');
    if (!flags.includes('-s')) throw new Error('ln: only symbolic links are supported on this filesystem');
    const [target, link] = names;
    await shell.fs.write(shell.actor, shell.abs(link), shell.abs(target), 'text/plain', { cwd: shell.cwd });
    return '';
});

define('tree', {}, async (shell, args) => {
    const root = shell.abs(args[0] || '.');
    const node = shell.fs.resolve(shell.actor, root, { cwd: shell.cwd, mustExist: true });
    const lines = [];
    let dirs = 0;
    let files = 0;
    const walk = async (current, prefix, depth) => {
        if (depth > 6) return;
        const children = await shell.fs.readdir(shell.actor, shell.fs.pathOf(shell.actor, current), { cwd: shell.cwd });
        const shown = children.filter((c) => !c.name.startsWith('.'));
        for (let i = 0; i < shown.length; i++) {
            const child = shown[i];
            const last = i === shown.length - 1;
            lines.push(`${prefix}${last ? '└── ' : '├── '}${child.name}`);
            if (child.type === 'dir') {
                dirs++;
                const childNode = shell.fs.entries.node(child.uid);
                if (childNode) await walk(childNode, prefix + (last ? '    ' : '│   '), depth + 1);
            } else files++;
        }
    };
    lines.push(shell.pretty(shell.fs.pathOf(shell.actor, node)));
    await walk(node, '', 0);
    lines.push('');
    lines.push(`${dirs} directories, ${files} files`);
    return lines.join('\n');
});

define('find', {}, async (shell, args) => {
    let pattern = null;
    const rest = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '-name') pattern = args[++i];
        else rest.push(args[i]);
    }
    const root = shell.abs(rest[0] || '.');
    const matches = await shell.fs.search(shell.actor, { query: pattern ? pattern.replace(/\*/g, '') : '', path: root, limit: 500 });
    if (!matches.length) return '';
    return matches.map((m) => shell.pretty(m.path)).join('\n');
});

define('grep', {}, async (shell, args, stdin) => {
    const flags = args.filter((a) => a.startsWith('-')).join('');
    const rest = args.filter((a) => !a.startsWith('-'));
    const pattern = rest.shift();
    if (!pattern) throw new Error('usage: grep [-i] [-n] [-v] pattern [file ...]');
    const source = rest.length ? await inputOf(shell, rest, null) : (stdin ?? '');
    let regex;
    try {
        regex = new RegExp(pattern, flags.includes('i') ? 'i' : '');
    } catch {
        throw new Error(`grep: ${pattern}: not a valid pattern`);
    }
    return source.split('\n')
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => (flags.includes('v') ? !regex.test(line) : regex.test(line)))
        .map(({ line, n }) => (flags.includes('n') ? `${n}:${line}` : line))
        .join('\n');
});

define('wc', {}, async (shell, args, stdin) => {
    const flag = args.find((a) => a.startsWith('-'));
    const text = await inputOf(shell, args.filter((a) => !a.startsWith('-')), stdin);
    const lines = text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0;
    const words = text.split(/\s+/).filter(Boolean).length;
    const chars = text.length;
    if (flag === '-l') return String(lines);
    if (flag === '-w') return String(words);
    if (flag === '-c') return String(chars);
    return `${lines} ${words} ${chars}`;
});

define('head', {}, async (shell, args, stdin) => {
    const n = Number((args.find((a) => a === '-n') ? args[args.indexOf('-n') + 1] : null) || 10);
    const text = await inputOf(shell, args.filter((a) => !/^-?\d+$/.test(a) && a !== '-n'), stdin);
    return text.split('\n').slice(0, n).join('\n');
});

define('tail', {}, async (shell, args, stdin) => {
    const n = Number((args.find((a) => a === '-n') ? args[args.indexOf('-n') + 1] : null) || 10);
    const text = await inputOf(shell, args.filter((a) => !/^-?\d+$/.test(a) && a !== '-n'), stdin);
    return text.split('\n').slice(-n).join('\n');
});

define('sort', {}, async (shell, args, stdin) => {
    const flags = args.filter((a) => a.startsWith('-')).join('');
    const text = await inputOf(shell, args.filter((a) => !a.startsWith('-')), stdin);
    const lines = text.split('\n');
    lines.sort(flags.includes('n')
        ? (a, b) => parseFloat(a) - parseFloat(b)
        : (a, b) => a.localeCompare(b));
    if (flags.includes('r')) lines.reverse();
    if (flags.includes('u')) return [...new Set(lines)].join('\n');
    return lines.join('\n');
});

define('uniq', {}, async (shell, args, stdin) => {
    const flags = args.filter((a) => a.startsWith('-')).join('');
    const text = await inputOf(shell, args.filter((a) => !a.startsWith('-')), stdin);
    const lines = text.split('\n');
    const out = [];
    let run = 0;
    for (let i = 0; i < lines.length; i++) {
        run = lines[i] === lines[i - 1] ? run + 1 : 1;
        if (lines[i] !== lines[i - 1]) out.push(flags.includes('c') ? `      1 ${lines[i]}` : lines[i]);
        else if (flags.includes('c') && i === lines.length - 1) out.push(`      ${run} ${lines[i]}`);
    }
    if (flags.includes('c')) {
        /* Rebuilt with counts: the first pass cannot know a run is over until
           it sees the next line. */
        const counted = [];
        let n = 0;
        for (let i = 0; i < lines.length; i++) {
            n = lines[i] === lines[i - 1] ? n + 1 : 1;
            if (lines[i] !== lines[i + 1]) counted.push(`${String(n).padStart(7)} ${lines[i]}`);
        }
        return counted.join('\n');
    }
    return out.join('\n');
});

define('rev', {}, async (shell, args, stdin) => {
    const text = await inputOf(shell, args, stdin);
    return text.split('\n').map((l) => [...l].reverse().join('')).join('\n');
});

define('tac', {}, async (shell, args, stdin) => {
    const text = await inputOf(shell, args, stdin);
    return text.split('\n').reverse().join('\n');
});

define('cut', {}, async (shell, args, stdin) => {
    const delimIdx = args.indexOf('-d');
    const delim = delimIdx >= 0 ? args[delimIdx + 1] : '\t';
    const fieldIdx = args.indexOf('-f');
    const fields = fieldIdx >= 0 ? String(args[fieldIdx + 1]).split(',').map((f) => Number(f) - 1) : [0];
    const text = await inputOf(shell, args.filter((a) => !['-d', '-f'].includes(a) && !/^[^-\w]?$/.test(a) && !/^\d+$/.test(a)), stdin);
    return text.split('\n').map((line) => {
        const parts = line.split(delim);
        return fields.map((f) => parts[f] ?? '').join(delim);
    }).join('\n');
});

define('tr', {}, async (shell, args, stdin) => {
    const [from, to] = args.slice(0, 2);
    if (!from) throw new Error('usage: tr SET1 SET2');
    const text = await inputOf(shell, [], stdin);
    /* `a-z` is a range, not three characters: without expanding it,
       `tr a-z A-Z` would map 'a', '-' and 'z' and leave the rest alone,
       which is the sort of thing that makes a pipeline quietly wrong. */
    const expand = (set) => {
        const out = [];
        for (let i = 0; i < set.length; i++) {
            if (set[i + 1] === '-' && set[i + 2] && set[i] !== '\\') {
                const start = set.charCodeAt(i);
                const end = set.charCodeAt(i + 2);
                if (start <= end) {
                    for (let c = start; c <= end; c++) out.push(String.fromCharCode(c));
                    i += 2;
                    continue;
                }
            }
            out.push(set[i]);
        }
        return out;
    };
    const source = expand(from);
    const target = expand(to || '');
    const map = new Map();
    source.forEach((ch, i) => map.set(ch, target[i] ?? target.at(-1) ?? ''));
    return [...text].map((ch) => (map.has(ch) ? map.get(ch) : ch)).join('');
});

define('basename', {}, async (shell, args) => (args[0] ? baseName(shell.abs(args[0])) : ''));
define('dirname', {}, async (shell, args) => (args[0] ? parentPath(shell.abs(args[0])) : ''));
define('realpath', {}, async (shell, args) => (args[0] ? shell.abs(args[0]) : shell.cwd));

define('stat', {}, async (shell, args) => {
    if (!args[0]) throw new Error('stat: missing operand');
    const node = shell.fs.resolve(shell.actor, shell.abs(args[0]), { cwd: shell.cwd, mustExist: true });
    const entry = shell.fs.toPublic(shell.actor, node);
    return [
        `  File: ${entry.path}`,
        `  Size: ${entry.size}${' '.repeat(4)}Blocks: ${Math.ceil(entry.size / 512)}${' '.repeat(4)}IO Block: 4096   ${entry.type}`,
        `Access: (0${entry.type === 'dir' ? '755' : '644'}/${entry.type === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--'})  Uid: ( 1000/${entry.owner})   Gid: ( 1000/${entry.owner})`,
        `Modify: ${new Date(entry.modified).toISOString().replace('T', ' ').slice(0, 19)}`,
        `Change: ${new Date(entry.modified).toISOString().replace('T', ' ').slice(0, 19)}`,
        ' Birth: -',
    ].join('\n');
});

define('file', {}, async (shell, args) => {
    if (!args[0]) throw new Error('file: missing operand');
    const node = shell.fs.resolve(shell.actor, shell.abs(args[0]), { cwd: shell.cwd, mustExist: true });
    if (node.type === 'dir') return `${args[0]}: directory`;
    const mime = node.mime || 'application/octet-stream';
    const text = /^text\//.test(mime) || mime === 'application/json';
    return `${args[0]}: ${mime}${text ? '; charset=utf-8' : ''} (${humanSize(node.size)})`;
});

define('du', {}, async (shell, args) => {
    const root = shell.abs(args.filter((a) => !a.startsWith('-'))[0] || '.');
    const node = shell.fs.resolve(shell.actor, root, { cwd: shell.cwd, mustExist: true });
    const usage = shell.fs.entries.usage(shell.actor.ownerId);
    const human = args.includes('-h');
    return `${human ? humanSize(usage.bytes) : Math.round(usage.bytes / 1024)}\t${shell.pretty(shell.fs.pathOf(shell.actor, node))}`;
});

/* --------------------------------- system --------------------------------- */

define('df', {}, async (shell) => {
    const usage = shell.fs.usage(shell.actor);
    const blobs = shell.services.get('system').sysinfo().storage.blobs;
    const total = usage.quota;
    const used = usage.bytes;
    const percent = total ? Math.round((used / total) * 100) : 0;
    return [
        'Filesystem     1K-blocks      Used Available Use% Mounted on',
        `mixtfs         ${String(Math.round(total / 1024)).padStart(10)} ${String(Math.round(used / 1024)).padStart(9)} ` +
            `${String(Math.round((total - used) / 1024)).padStart(9)} ${String(percent).padStart(3)}% /`,
        `hostfs         ${String(Math.round(blobs.bytes / 1024) || 0).padStart(10)} ${String(Math.round(blobs.bytes / 1024) || 0).padStart(9)} ` +
            `${String(0).padStart(9)} 100% ${shell.config.dataDir}`,
    ].join('\n');
});

define('uname', {}, async (shell, args) => {
    const info = { s: 'MixtOS', r: shell.config.version, m: os.arch(), n: shell.config.hostname, v: `#1 SMP ${shell.config.version}`, o: 'GNU/Mixt' };
    const flags = args.join('').replace(/-/g, '') || 's';
    if (args.includes('-a')) return `MixtOS ${shell.config.hostname} ${shell.config.version} #1 SMP GNU/Mixt ${os.arch()}`;
    return [...flags].map((f) => info[f] ?? '').filter(Boolean).join(' ');
});

define('hostname', {}, async (shell) => shell.config.hostname);
define('whoami', {}, async (shell) => (shell.actor.guest ? `${shell.actor.username} (guest)` : shell.actor.username));
define('id', {}, async (shell) => {
    const groups = shell.actor.role === 'admin' ? 'adm,sudo,audio,video,plugdev' : (shell.actor.guest ? 'guest' : 'audio,video,plugdev');
    return `uid=1000(${shell.actor.username}) gid=1000(${shell.actor.username}) groups=1000(${shell.actor.username}),${groups}`;
});
define('groups', {}, async (shell) =>
    (shell.actor.role === 'admin' ? 'adm sudo audio video plugdev' : (shell.actor.guest ? 'guest' : 'audio video plugdev')));

define('date', {}, async () => new Date().toString());

define('cal', {}, async () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const first = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    const rows = [];
    let line = '   '.repeat((first + 6) % 7);
    for (let d = 1; d <= days; d++) {
        line += String(d).padStart(3);
        if (((first + 6) % 7 + d) % 7 === 0) { rows.push(line); line = ''; }
    }
    if (line) rows.push(line);
    return [`   ${now.toLocaleString('en-GB', { month: 'long' })} ${year}`, 'Su Mo Tu We Th Fr Sa', ...rows].join('\n');
});

define('uptime', {}, async (shell) => {
    const seconds = Math.round(process.uptime() + os.uptime() * 0);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const sessions = shell.stores ? 0 : shell.services.get('auth').sessions?.count?.() || 0;
    return ` ${new Date().toTimeString().slice(0, 8)} up ${hours}h ${minutes}m,  ${sessions} user${sessions === 1 ? '' : 's'},  ` +
        `load average: ${os.loadavg().map((n) => n.toFixed(2)).join(', ')}`;
});

define('free', {}, async (shell, args) => {
    const info = shell.services.get('system').sysinfo();
    const mb = (n) => Math.round(n / 1024 / 1024);
    const swap = 0;
    return [
        '               total        used        free      shared  buff/cache   available',
        `Mem:    ${String(mb(info.memory.total)).padStart(11)} ${String(mb(info.memory.used)).padStart(11)} ` +
            `${String(mb(info.memory.free)).padStart(11)} ${String(0).padStart(11)} ${String(0).padStart(11)} ${String(mb(info.memory.free)).padStart(11)}`,
        `Swap:   ${String(swap).padStart(11)} ${String(0).padStart(11)} ${String(0).padStart(11)}`,
    ].join('\n');
});

define('ps', {}, async (shell) => {
    const sessions = shell.services.get('auth').sessions.listing({ role: 'admin' }) || [];
    const rows = sessions.map((s, i) => {
        const ago = Math.round((Date.now() - s.lastSeen) / 1000);
        return `${String(1000 + i).padStart(5)} ?        S      0:00 mixt-session ${s.username}${s.guest ? ' (guest)' : ''} ${ago}s ago`;
    });
    return ['    PID TTY          STAT   TIME COMMAND',
        '      1 ?        Ss     0:01 /sbin/init mixt',
        `     ${process.pid} ?        S      0:00 mixt-server ${shell.config.name}`,
        ...rows].join('\n');
});

define('top', {}, async (shell) => {
    const info = shell.services.get('system').sysinfo();
    const sessions = shell.services.get('auth').sessions.listing({ role: 'admin' }) || [];
    return [
        `top - ${new Date().toTimeString().slice(0, 8)} up ${Math.round(process.uptime() / 60)} min,  ${sessions.length} users,  ` +
            `load average: ${os.loadavg().map((n) => n.toFixed(2)).join(', ')}`,
        `Tasks: ${sessions.length + 2} total,   1 running, ${sessions.length + 1} sleeping,   0 stopped,   0 zombie`,
        `%Cpu(s):  ${(os.loadavg()[0] * 8).toFixed(1)} us,  1.0 sy,  0.0 ni, ${(100 - os.loadavg()[0] * 8).toFixed(1)} id`,
        `MiB Mem :  ${Math.round(info.memory.total / 1048576)} total,  ${Math.round(info.memory.free / 1048576)} free,  ` +
            `${Math.round(info.memory.used / 1048576)} used`,
        '',
        '    PID USER      PR  NI    VIRT    RES  %CPU  %MEM     TIME+ COMMAND',
        `      1 root      20   0   12000   8000   0.0   0.1   0:01.00 systemd`,
        `    ${process.pid} ${shell.actor.username.slice(0, 8).padEnd(8)} 20   0  180000  45000   1.0   0.6   0:12.34 mixt-server`,
        ...sessions.map((s, i) => `   ${2000 + i} ${s.username.slice(0, 8).padEnd(8)} 20   0   60000  22000   0.3   0.3   0:00.${String(i).padStart(2, '0')} mixt-session`),
    ].join('\n');
});

define('kill', {}, async (shell, args) => {
    throw new Error(`kill: (${args[0] || '-'} ) - No such process — this shell has no processes of its own to end`);
});

define('lscpu', {}, async () => {
    const cpus = os.cpus();
    return [
        `Architecture:        ${os.arch()}`,
        `CPU op-mode(s):      32-bit, 64-bit`,
        `Model name:          ${cpus[0]?.model || 'JS Virtual Core'}`,
        `CPU(s):              ${cpus.length}`,
        `CPU max MHz:         ${cpus[0]?.speed || 3200}.0000`,
        'Virtualisation:      mixt',
    ].join('\n');
});

define('neofetch', { alias: ['inxi'] }, async (shell) => {
    const info = shell.services.get('system').sysinfo();
    const usage = shell.fs.usage(shell.actor);
    const sessions = shell.services.get('auth').sessions.listing({ role: 'admin' }) || [];
    const gap = '                    ';
    return [
        '          ,mmm.          ' + `${shell.actor.username}@${shell.config.hostname}`,
        '         ,mmmmmm.        ' + '-'.repeat(`${shell.actor.username}@${shell.config.hostname}`.length),
        '       ,mmmmmmmmm.       ' + `OS: MixtOS ${shell.config.version} (${os.arch()})`,
        '     ,mmmmmmmmmmmmm.     ' + `Host: ${shell.config.name} — a computer on this network`,
        '   ,mmmmmmmmmmmmmmmmm.   ' + `Kernel: ${shell.config.version}-mixt`,
        '  ,mmmm  mmmmmmm  mmmm.  ' + `Uptime: ${Math.round(process.uptime() / 60)} mins`,
        ' ,mmmm    mmmmmm   mmmm. ' + `Shell: bash 5.1 (mixt-shell)`,
        ' mmmm      mmmm    mmmm  ' + `Files: ${usage.nodes} entries, ${shell.fs.usage(shell.actor).human}`,
        ' mmmmmmmmmmmmmmmmmmmmmm ' + `CPU: ${info.cpu.model} (${info.cpu.cores})`,
        ' mmmmmmmmmmmmmmmmmmmmm  ' + `Memory: ${info.memory.human}`,
        '  mmmmmmmmmmmmmmmmmm    ' + `Sessions: ${sessions.length} signed in`,
        '   mmmmmmmmmmmmmm       ' + `Network: local only — ${info.network.interfaces.join(', ') || 'no address'}`,
        '    mmmmmmmmmm          ' + `Display: the browser`,
        '     mmmmmmmm           ',
        '      mmmmmm            ' + gap,
    ].join('\n');
});

/* ------------------------------- information ------------------------------ */

define('help', {}, async (shell) => {
    const groups = {
        files: 'ls ll cd pwd cat mkdir touch rm rmdir cp mv ln tree find',
        text: 'echo grep wc head tail sort uniq rev tac cut tr sed',
        info: 'stat file du df uname hostname whoami id groups date cal uptime free ps top neofetch lscpu',
        hashes: 'sha256sum md5sum base64 diff',
        desktop: 'open xdg-open nemo xed mixtsfox theme wallpaper notify-send screenshot zip tar unzip apt',
        accounts: 'passwd users login logout exit clear history env which man sudo su',
        admin: 'useradd userdel approve reject server airgap hostshell',
    };
    return [
        'Mixt shell — commands that run on the server, against your files.',
        '',
        ...Object.entries(groups).map(([name, list]) => `  ${name.padEnd(10)} ${list}`),
        '',
        'Pipes (|), redirection (> >>) and chaining (&& || ;) all work.',
        'Your shell is your own: it can only reach your files. The administrator',
        'account is the only one that can be given a shell on the host itself.',
    ].join('\n');
});

define('which', {}, async (shell, args) => (args[0] && COMMANDS[args[0]] ? `/usr/bin/${args[0]}` : `${args[0] || ''}: not found`));
define('whereis', {}, async (shell, args) => (args[0] && COMMANDS[args[0]] ? `${args[0]}: /usr/bin/${args[0]}` : `${args[0] || ''}:`));

define('man', {}, async (shell, args) => {
    const name = args[0];
    if (!name) return 'What manual page do you want?';
    const pages = {
        ls: 'LS(1)\n\nNAME\n  ls — list directory contents\n\nSYNOPSIS\n  ls [-l] [-a] [FILE ...]\n\nDESCRIPTION\n  List information about the files. -l uses the long format, -a shows\n  entries starting with a dot.',
        cd: 'CD(1)\n\nNAME\n  cd — change the working directory\n\nSYNOPSIS\n  cd [DIR]\n\nDESCRIPTION\n  With no argument, cd returns to your home directory. "cd -" goes back to\n  the directory you were in before.',
        cat: 'CAT(1)\n\nNAME\n  cat — concatenate files and print\n\nSYNOPSIS\n  cat [FILE ...]\n\nDESCRIPTION\n  With no file, cat prints what was piped into it.',
        grep: 'GREP(1)\n\nNAME\n  grep — print lines matching a pattern\n\nSYNOPSIS\n  grep [-i] [-n] [-v] PATTERN [FILE ...]',
        sudo: 'SUDO(8)\n\nNAME\n  sudo — run a command with administrative rights\n\nDESCRIPTION\n  Only the administrator account may use sudo. Every attempt is written to\n  the audit log, including the ones that are refused.',
        hostshell: 'HOSTSHELL(8)\n\nNAME\n  hostshell — a shell on the machine running the server\n\nDESCRIPTION\n  Administrator only, and switched off unless terminal.hostShell is set in\n  server.config.json. It is the one command here that can reach the host.',
    };
    return pages[name] || `No manual entry for ${name}`;
});

define('env', { alias: ['export'] }, async (shell) =>
    Object.entries({ ...shell.env, PWD: shell.cwd, USER: shell.actor.username }).map(([k, v]) => `${k}=${v}`).join('\n'));

define('history', {}, async (shell) => shell.history.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`).join('\n'));

/* --------------------------------- hashing -------------------------------- */

define('sha256sum', {}, async (shell, args, stdin) => {
    const text = await inputOf(shell, args, stdin);
    return `${crypto.createHash('sha256').update(text).digest('hex')}  ${args[0] || '-'}`;
});

define('md5sum', {}, async (shell, args, stdin) => {
    const text = await inputOf(shell, args, stdin);
    return `${crypto.createHash('md5').update(text).digest('hex')}  ${args[0] || '-'}`;
});

define('base64', {}, async (shell, args, stdin) => {
    const text = await inputOf(shell, args.filter((a) => a !== '-d'), stdin);
    return args.includes('-d')
        ? Buffer.from(text, 'base64').toString('utf8')
        : Buffer.from(text).toString('base64');
});

define('diff', {}, async (shell, args) => {
    if (args.length < 2) throw new Error('diff: needs two files');
    const a = (await shell.fs.read(shell.actor, shell.abs(args[0]), { cwd: shell.cwd })) ?? '';
    const b = (await shell.fs.read(shell.actor, shell.abs(args[1]), { cwd: shell.cwd })) ?? '';
    if (a === b) return '';
    const la = a.split('\n');
    const lb = b.split('\n');
    const out = [];
    for (let i = 0; i < Math.max(la.length, lb.length); i++) {
        if (la[i] === lb[i]) continue;
        if (la[i] !== undefined) out.push(`< ${la[i]}`);
        if (lb[i] !== undefined) out.push(`> ${lb[i]}`);
    }
    return out.join('\n');
});

/* --------------------------------- desktop -------------------------------- */
/* These are effects: the server cannot open a window, so it tells the desktop
   to, which is also what keeps the desktop the only thing that can. */

define('open', { alias: ['xdg-open'] }, async (shell, args) => {
    if (!args[0]) throw new Error('open: missing argument');
    if (/^https?:\/\//.test(args[0]) || /^[\w-]+\.(com|org|net|io|dev|edu|gov|mixtnet)/.test(args[0])) {
        shell.effect('launch', { appId: 'browser', props: { url: args[0] } });
        return `Opening ${args[0]} in the browser…`;
    }
    const path = shell.abs(args[0]);
    const node = shell.fs.resolve(shell.actor, path, { cwd: shell.cwd });
    if (!node) throw new Error(`open: ${args[0]}: no such file`);
    shell.effect('open', { path: shell.fs.pathOf(shell.actor, node) });
    return `Opening ${shell.pretty(shell.fs.pathOf(shell.actor, node))}…`;
});

define('nemo', {}, async (shell, args) => {
    shell.effect('launch', { appId: 'nemo', props: { path: args[0] ? shell.abs(args[0]) : shell.cwd } });
    return '';
});

define('xed', { alias: ['nano', 'vim'] }, async (shell, args) => {
    const path = shell.abs(args[0] ?? join(HOME, 'Untitled.txt'));
    const node = shell.fs.resolve(shell.actor, path, { cwd: shell.cwd });
    if (!node) await shell.fs.write(shell.actor, path, '', 'text/plain', { cwd: shell.cwd });
    shell.effect('launch', { appId: 'xed', props: { path } });
    return `Opened ${shell.pretty(path)} in the Text Editor.`;
});

define('mixtsfox', { alias: ['browser'] }, async (shell, args) => {
    shell.effect('launch', { appId: 'browser', props: args[0] ? { url: args[0] } : {} });
    return '';
});

define('theme', {}, async (shell, args) => {
    const value = args[0];
    if (value !== 'dark' && value !== 'light') return 'usage: theme {dark|light}';
    shell.effect('settings', { patch: { scheme: value, themeName: value === 'dark' ? 'Mixt-Y-Dark' : 'Mixt-Y' } });
    return `Appearance switched to ${value}.`;
});

define('wallpaper', {}, async (shell, args) => {
    const node = shell.fs.resolve(shell.actor, '/usr/share/backgrounds', { cwd: shell.cwd });
    const names = node ? (await shell.fs.readdir(shell.actor, '/usr/share/backgrounds', { cwd: shell.cwd })).map((e) => e.name) : [];
    if (!args[0]) return names.map((n, i) => `${i + 1}. ${n}`).join('\n');
    const found = names.find((n) => n === args[0] || n.startsWith(args[0])) ?? names[Number(args[0]) - 1];
    if (!found) throw new Error(`wallpaper: '${args[0]}' not found`);
    shell.effect('settings', { patch: { wallpaper: `wallpapers/${found}` } });
    return `Background set to ${found}.`;
});

define('notify-send', {}, async (shell, args) => {
    shell.effect('notify', { title: args[0] ?? 'Terminal', body: args.slice(1).join(' ') });
    return '';
});

define('screenshot', {}, async (shell) => {
    shell.effect('screenshot', {});
    return 'Taking a screenshot…';
});

define('zip', { alias: ['unzip', 'tar', 'gzip'] }, async (shell, args) => {
    shell.effect('launch', { appId: 'archive', props: args[0] ? { path: shell.abs(args[0]) } : {} });
    return `Opening Archive Manager for ${args[0] ?? 'the current folder'}…`;
});

define('apt', { alias: ['apt-get', 'dpkg', 'snap', 'flatpak', 'mixtinstall'] }, async (shell, args) => {
    const verb = args[0];
    if (verb === 'install' || verb === 'remove') {
        shell.effect('launch', { appId: 'mixtinstall', props: {} });
        return `Software Manager: use it to ${verb} applications on this computer.`;
    }
    if (verb === 'list' || verb === 'update') {
        const apps = shell.services.get('apps').list(shell.actor);
        return apps.length ? apps.map((a) => `${a.id.padEnd(18)} ${a.name}`).join('\n') : 'No applications are published yet.';
    }
    return [
        'Usage: apt install|remove|list|update',
        '',
        'Applications are published to this machine and approved by the',
        'administrator; the Software Manager is where you install them.',
    ].join('\n');
});

define('clear', {}, async (shell) => { shell.effect('clear'); return ''; });
define('exit', { alias: ['logout'] }, async (shell) => { shell.effect('exit'); return ''; });

define('reboot', {}, async (shell) => { shell.effect('session', { kind: 'reboot' }); return ''; });
define('shutdown', { alias: ['poweroff'] }, async (shell) => {
    shell.effect('session', { kind: args[0] === 'poweroff' ? 'poweroff' : 'shutdown' });
    return '';
});
define('lock', {}, async (shell) => { shell.effect('session', { kind: 'lock' }); return ''; });

/* -------------------------------- amusement ------------------------------- */

define('fortune', {}, async () => FORTUNES[Math.floor(Math.random() * FORTUNES.length)]);
define('cowsay', {}, async (shell, args) => {
    const text = args.join(' ') || 'Mixt Web OS runs on this machine';
    return [
        ` ${'_'.repeat(text.length + 2)}`,
        `< ${text} >`,
        ` ${'-'.repeat(text.length + 2)}`,
        '        \\   ^__^',
        '         \\  (oo)\\_______',
        '            (__)\\       )\\/\\',
        '                ||----w |',
        '                ||     ||',
    ].join('\n');
});
define('yes', {}, async (shell, args) => `${Array(12).fill(args[0] ?? 'y').join('\n')}\n(truncated)`);
define('seq', {}, async (shell, args) => {
    const from = args.length > 1 ? Number(args[0]) : 1;
    const to = Number(args.length > 1 ? args[1] : args[0] ?? 1);
    return Array.from({ length: Math.max(0, Math.min(200, to - from + 1)) }, (_, i) => from + i).join('\n');
});
define('sleep', {}, async (shell, args) => {
    await new Promise((r) => setTimeout(r, Math.min(3000, Number(args[0] ?? 1) * 1000)));
    return '';
});
define('true', {}, async () => '');
define('false', {}, async () => { throw new Error('false: exit status 1'); });
define('sl', {}, async () => '🚂 choo choo — you meant "ls", right?');

/* -------------------------------- accounts -------------------------------- */

define('users', {}, async (shell) => {
    const auth = shell.services.get('auth');
    if (shell.actor.role === 'admin') {
        const users = auth.listUsers(shell.actor) || [];
        return ['ACCOUNT          ROLE     MAILBOX', ...users.map((u) =>
            `${u.username.padEnd(16)} ${u.role.padEnd(8)} ${u.mailbox ? 'yes' : 'no'}`)].join('\n');
    }
    return `${shell.actor.username}  ${shell.actor.guest ? 'guest' : shell.actor.role}`;
});

define('passwd', {}, async (shell, args) => {
    const auth = shell.services.get('auth');
    if (!args[0]) {
        if (shell.actor.guest) throw new Error('passwd: a guest has no password — there is no account to change');
        shell.effect('prompt', { kind: 'password', message: 'Changing your password' });
        return 'Use the dialog to set a new password.';
    }
    if (shell.actor.role !== 'admin') throw new Error('passwd: only the administrator can change another account');
    shell.effect('prompt', { kind: 'password', username: args[0], message: `New password for ${args[0]}` });
    return `Use the dialog to set a new password for ${args[0]}.`;
});

define('sudo', {}, async (shell, args) => {
    if (shell.actor.role !== 'admin') {
        /* The refusal is written to the audit log, which is the point of the
           sentence it prints: on a machine with several people on it, "who
           tried" is the interesting half of the answer. */
        shell.services.get('events')?.publish?.('terminal.sudo_refused',
            { username: shell.actor.username, command: args.join(' ').slice(0, 200) },
            { actor: shell.actor.username, scope: 'admins', audit: true });
        throw new Error(`${shell.actor.username} is not in the sudoers file. This incident has been reported.`);
    }
    if (!args.length) return `${shell.actor.username} may run every command on this computer.`;
    shell.elevated = true;
    const line = args.join(' ');
    const rest = shell._stage ? null : null;
    void rest;
    /* Run the rest as a fresh shell command so pipes and redirection work. */
    const result = await runLine(shell, line);
    return result.out || result.err || '';
});

define('su', {}, async (shell, args) => {
    if (shell.actor.role !== 'admin') throw new Error('su: only the administrator can switch accounts');
    const name = args[0] || 'root';
    shell.services.get('events')?.publish?.('terminal.su', { username: shell.actor.username, to: name },
        { actor: shell.actor.username, scope: 'admins', audit: true });
    return `su: account switching is not available — an administrator already reaches every account on this machine`;
});

/* ------------------------------ administration ---------------------------- */

define('useradd', { adminOnly: true }, async (shell, args) => {
    const name = args[0];
    if (!name) return 'usage: useradd NAME [password]';
    const auth = shell.services.get('auth');
    try {
        const user = await auth.createUser(shell.actor, { username: name, password: args[1] || 'changeme', role: args.includes('-a') ? 'admin' : 'user' });
        return `Created ${user.username}. ${args[1] ? '' : 'Password: changeme — change it with passwd.'}`;
    } catch (e) {
        throw new Error(`useradd: ${e.message}`);
    }
});

define('userdel', { adminOnly: true }, async (shell, args) => {
    if (!args[0]) return 'usage: userdel NAME';
    await shell.services.get('auth').removeUser(shell.actor, args[0]);
    return `Removed ${args[0]} and everything they had on this computer.`;
});

define('approve', { adminOnly: true }, async (shell, args) => {
    const apps = shell.services.get('apps');
    if (!args[0]) {
        const pending = apps.pending(shell.actor) || [];
        return pending.length
            ? pending.map((a) => `${a.id.padEnd(20)} ${a.name}  (${a.author})`).join('\n')
            : 'Nothing is waiting for approval.';
    }
    const app = apps.approve(shell.actor, args[0]);
    return `Approved ${app.name}. It is now in the Software Manager.`;
});

define('reject', { adminOnly: true }, async (shell, args) => {
    if (!args[0]) return 'usage: reject APP [reason]';
    const app = shell.services.get('apps').reject(shell.actor, args[0], args.slice(1).join(' ') || null);
    return `Rejected ${app.name}.`;
});

define('server', { adminOnly: true }, async (shell, args) => {
    const system = shell.services.get('system');
    const what = args[0] || 'status';
    if (what === 'airgap') {
        const report = (await import('../lib/airgap.js')).airgapReport();
        return [
            `air gap: ${report.enabled ? 'on — this machine cannot reach the Internet' : 'OFF'}`,
            `blocked attempts: ${report.blockedCount}`,
            ...report.blocked.slice(0, 10).map((b) => `  ${new Date(b.at).toISOString().slice(11, 19)}  ${b.kind}  ${b.target}${b.count > 1 ? ` (x${b.count})` : ''}`),
        ].join('\n');
    }
    if (what === 'log') {
        const lines = await system.log(shell.actor, { lines: Number(args[1] || 30) });
        if (!lines.length) return 'The audit log is empty.';
        return lines.map((l) => `${l.at}  ${String(l.type).padEnd(22)} ${l.actor ?? ''} ${l.path ?? l.username ?? l.name ?? ''}`.trimEnd()).join('\n');
    }
    const info = system.sysinfo();
    return [
        `${shell.config.name} — ${info.machine.url}`,
        `  version     ${info.machine.version}`,
        `  uptime      ${info.process.uptime}s (process), ${info.os.uptime}s (host)`,
        `  host        ${info.os.type} ${info.os.release} ${info.os.arch}`,
        `  node        ${info.process.node}`,
        `  addresses   ${info.network.interfaces.join(', ') || 'none'}`,
        `  accounts    ${shell.services.get('auth').users?.count?.() ?? 0}`,
        `  sessions    ${shell.services.get('auth').sessions?.count?.() ?? 0}`,
        `  files       ${info.storage.nodes} entries, ${humanSize(info.storage.blobs.bytes)} on disk`,
        `  air gap     ${info.network.airgapped ? 'on (no Internet)' : 'off'}`,
    ].join('\n');
});

define('airgap', { adminOnly: true }, async (shell, args) => COMMANDS.server.run(shell, ['airgap', ...args], null));

/**
 * A shell on the host itself.
 *
 * Administrator only, and switched off unless `terminal.hostShell` is set in
 * server.config.json. When it is on, it runs with the data directory as its
 * working directory — the one place on the host this machine owns.
 */
define('hostshell', { adminOnly: true }, async (shell, args) => {
    if (!shell.config.terminal.hostShell) {
        return [
            'hostshell is switched off.',
            '',
            'It opens a shell on the machine running the server, which is the one',
            'command here that leaves your files behind and reaches the host. Turn',
            'it on with terminal.hostShell in server.config.json, or MIXT_HOST_SHELL=1.',
        ].join('\n');
    }
    const command = args.join(' ');
    if (!command) return 'usage: hostshell COMMAND   (cwd: ' + shell.config.terminal.hostShellRoot + ')';
    shell.services.get('events')?.publish?.('terminal.hostshell',
        { username: shell.actor.username, command: command.slice(0, 300) },
        { actor: shell.actor.username, scope: 'admins', audit: true });
    return await new Promise((resolve, reject) => {
        execFile(shell.config.terminal.hostShellCommand, ['-c', command], {
            cwd: shell.config.terminal.hostShellRoot,
            timeout: 10000,
            maxBuffer: shell.config.terminal.maxOutputBytes,
        }, (error, stdout, stderr) => {
            const text = `${stdout || ''}${stderr || ''}`.slice(0, shell.config.terminal.maxOutputBytes);
            if (error && !stdout && !stderr) return reject(new Error(`hostshell: ${error.message}`));
            resolve(text.replace(/\n$/, ''));
        });
    });
});

/* --------------------------------- plumbing -------------------------------- */

/** Run a whole line in an existing shell — used by `sudo`, which has to re-enter the parser. */
async function runLine (shell, line) {
    const trim = String(line).trim();
    const { segments } = parse(trim);
    const out = [];
    for (const segment of segments) {
        let text = null;
        for (const stage of segment.stages) text = await shell._stage(stage, text);
        if (text) out.push(String(text).replace(/\n$/, ''));
    }
    return { out: out.join('\n'), err: '' };
}

export { COMMANDS };
