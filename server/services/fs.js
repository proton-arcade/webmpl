/**
 * The filesystem service.
 *
 * This is what "the computer" means: a tree of nodes per account, held on disk,
 * addressed by path or by uid, with permissions checked on every call by the ACL
 * service and every change announced so the other desktops on the network see
 * it. Puter's FSService is the same idea at the same place in the stack — the
 * stores know how to store, this knows what is allowed and what it means.
 *
 * The desktop keeps a *mirror* of this tree in memory (see `snapshot`) and
 * streams its changes back to here as operations, which is why every app in the
 * desktop stayed synchronous and instant: reading a file is a memory access,
 * and the server is what makes it real, shared and permanent.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { BaseService } from '../lib/container.js';
import { badRequest, exists as existsErr, forbidden, notFound, quota, tooLarge } from '../lib/errors.js';
import {
    baseName, humanSize, isWithin, join, mimeOf, normalizePath, parentPath, safeSegment,
    splitPath, uid as newUid,
} from '../lib/util.js';

export const HOME = '/home/mixt';
export const TRASH_FILES = '/home/mixt/.local/share/Trash/files';
export const TRASH_INFO = '/home/mixt/.local/share/Trash/info';
export const GUEST_PREFIX = 'guest:';

/** The same extensions the repository's defaultfs/ generator recognises. */
const SEED_MIME = {
    '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
    '.webm': 'video/webm', '.mp4': 'video/mp4', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.gif': 'image/gif', '.html': 'text/html', '.htm': 'text/html',
    '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.json': 'application/json', '.ini': 'text/plain', '.md': 'text/markdown',
};

const IGNORED_SEED_FILES = new Set(['README.md', 'readme.md', 'README']);

/** Directories every account has, whether or not they are in the seed folder. */
const SKELETON = [
    '/home/mixt/Desktop', '/home/mixt/Documents', '/home/mixt/Downloads',
    '/home/mixt/Music', '/home/mixt/Pictures', '/home/mixt/Videos',
    '/home/mixt/Templates', '/home/mixt/Public', '/home/mixt/.config',
    TRASH_FILES, TRASH_INFO, '/srv/www', '/usr/share/applications',
    '/usr/share/mixt', '/tmp', '/var/tmp', '/var/log', '/bin', '/etc',
];

export class FileSystemService extends BaseService {
    static SERVICE_NAME = 'fs';
    static DEPENDENCIES = ['acl'];

    async _init () {
        this.entries = this.stores.get('fsentry');
        this.users = this.stores.get('user');
        this.kv = this.stores.get('kv');
        this.shares = this.stores.get('share');
        this.blobs = this.clients.get('blobstore');
        this.acl = this.services.get('acl');
        this.events = this.services.get('events');
        /* One revision counter per account. The client sends the revision it
           was editing at; if the server has moved on, somebody else changed
           the tree and the client re-reads it rather than writing over them. */
        this.revs = new Map();
        this.seedDir = this.config.seedDir;
        await this._pruneGuestTrees();
        for (const user of this.users.list()) await this.ensureAccount(user);
    }

    /* ------------------------------- identity ------------------------------ */

    /** The owner id an actor's files are stored under. A guest's is their
        session, so their tree dies with the session it belongs to. */
    ownerId (actor) {
        if (!actor) return null;
        if (actor.guest) return GUEST_PREFIX + actor.sessionId;
        return actor.uid;
    }

    isGuestOwner (ownerId) { return String(ownerId || '').startsWith(GUEST_PREFIX); }

    home (_actor) { return HOME; }

    rev (actor) { return this.revs.get(this.ownerId(actor)) || 0; }

    bump (actor) {
        const id = this.ownerId(actor);
        const next = (this.revs.get(id) || 0) + 1;
        this.revs.set(id, next);
        return next;
    }

    /* ------------------------------- accounts ------------------------------ */

    /**
     * Give an account a filesystem if it has not got one.
     *
     * Seeded from `defaultfs/` in the repository — a folder of ordinary files,
     * which is why what a new account finds can be read and edited like the
     * rest of the project instead of being string literals in a module.
     */
    async ensureAccount (user) {
        if (!user) return null;
        let root = this.entries.rootOf(user.uid);
        if (root) return root;
        root = this.entries.create({
            owner: user.uid, parent: null, name: '', type: 'dir', mime: 'directory',
        });
        for (const dir of SKELETON) await this._mkdirp(root, dir, user.uid);
        if (this.seedDir && fs.existsSync(this.seedDir)) {
            await this._seed(root, this.seedDir, '/', user.uid);
        }
        await this._seedWallpapers(root, user.uid);
        this.users.attachRoot(user, root.uid);
        this.log?.info?.(`seeded a filesystem for ${user.username}`);
        return root;
    }

    /** A guest's tree: seeded the same way, and thrown away when they go. */
    async ensureGuest (actor) {
        const ownerId = this.ownerId(actor);
        let root = this.entries.rootOf(ownerId);
        if (root) return root;
        root = this.entries.create({ owner: ownerId, parent: null, name: '', type: 'dir', mime: 'directory' });
        for (const dir of SKELETON) await this._mkdirp(root, dir, ownerId);
        if (this.seedDir && fs.existsSync(this.seedDir)) {
            await this._seed(root, this.seedDir, '/', ownerId);
        }
        await this._seedWallpapers(root, ownerId);
        return root;
    }

    async _seed (root, absDir, relDir, owner) {
        let names = [];
        try { names = await fsp.readdir(absDir); } catch { return; }
        for (const name of names.sort()) {
            if (relDir === '/' && IGNORED_SEED_FILES.has(name)) continue;
            const abs = path.join(absDir, name);
            const rel = join(relDir, name);
            let st;
            try { st = await fsp.stat(abs); } catch { continue; }
            if (st.isDirectory()) {
                await this._mkdirp(root, rel, owner);
                await this._seed(root, abs, rel, owner);
            } else if (st.isFile()) {
                const existing = this.entries.resolve(owner, rel);
                if (existing) continue;
                const parent = this.entries.resolve(owner, parentPath(rel));
                if (!parent) continue;
                const node = this.entries.create({
                    owner, parent: parent.uid, name, type: 'file', mime: mimeOf(name, SEED_MIME[path.extname(name).toLowerCase()] || 'text/plain'),
                });
                const bytes = await fsp.readFile(abs);
                await this.entries.writeBytes(node, bytes, node.mime);
            }
        }
    }

    /**
     * The backgrounds, in both of the places they are offered.
     *
     * They are not copied in: they are files the site already serves, so each
     * one is recorded as a link to where it really lives rather than as a
     * second copy that would drift out of date. `wallpapers/index.json` says
     * what order they come in — the same order the desktop lists them in — and
     * anything in the folder that is not in it is appended alphabetically, so
     * dropping a file in is enough to offer it.
     */
    async _seedWallpapers (root, owner) {
        const dir = this.config.wallpaperDir;
        if (!dir || !fs.existsSync(dir)) return;
        let present = [];
        try { present = (await fsp.readdir(dir)).filter((n) => /\.(jpe?g|png|svg|webp|gif)$/i.test(n)); } catch { return; }
        if (!present.length) return;
        let order = [];
        try {
            const raw = await fsp.readFile(path.join(dir, 'index.json'), 'utf8');
            const parsed = JSON.parse(raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''));
            if (Array.isArray(parsed)) order = parsed;
        } catch { order = []; }
        const names = [...order.filter((n) => present.includes(n)), ...present.filter((n) => !order.includes(n)).sort()];
        const targets = ['/usr/share/backgrounds', `${HOME}/Pictures/Wallpapers`];
        for (const target of targets) {
            const parent = await this._mkdirp(root, target, owner);
            for (const name of names) {
                if (this.entries.resolve(owner, join(target, name))) continue;
                let size = 0;
                try { size = (await fsp.stat(path.join(dir, name))).size; } catch { continue; }
                this.entries.create({
                    owner,
                    parent: parent.uid,
                    name,
                    type: 'file',
                    mime: mimeOf(name),
                    url: `wallpapers/${name}`,
                    size,
                });
            }
        }
    }

    /**
     * Delete everything a guest left behind.
     *
     * A guest is promised that nothing of theirs is kept. The promise is kept
     * when they sign out, and again here at boot, because a server that was
     * stopped mid-session never got to hear them leave.
     */
    async _pruneGuestTrees () {
        const sessions = this.stores.get('session');
        const live = new Set(sessions.list().filter((s) => s.guest).map((s) => GUEST_PREFIX + s.uid));
        let pruned = 0;
        /* Collected first: `remove` mutates the array being iterated, so the
           owners are read out before anything is deleted. */
        const owners = new Set(this.entries.t.find((n) => this.isGuestOwner(n.owner)).map((n) => n.owner));
        for (const owner of owners) {
            if (live.has(owner)) continue;
            for (const root of this.entries.t.find((n) => n.owner === owner && n.parent === null)) {
                for (const key of this.entries.remove(root)) await this.blobs.remove(key);
                pruned++;
            }
        }
        if (pruned) this.log?.info?.(`discarded ${pruned} guest filesystem(s) left behind`);
        return pruned;
    }

    /** Sign-out housekeeping: a guest's files go with them. */
    async discard (actor) {
        const ownerId = this.ownerId(actor);
        if (!ownerId || !this.isGuestOwner(ownerId)) return 0;
        let removed = 0;
        for (const root of this.entries.t.find((n) => n.owner === ownerId && n.parent === null)) {
            for (const key of this.entries.remove(root)) await this.blobs.remove(key);
            removed++;
        }
        this.revs.delete(ownerId);
        return removed;
    }

    /* ------------------------------- resolving ----------------------------- */

    root (actor) {
        const ownerId = this.ownerId(actor);
        return ownerId ? this.entries.rootOf(ownerId) : null;
    }

    /**
     * Resolve a path for an actor.
     *
     * `~` is their home, a relative path is taken from `cwd` (the terminal's
     * working directory, or home), and `/users/<name>/…` is the administrator's
     * window onto somebody else's files — the only path that can leave an
     * account's own tree, and it is checked before it is walked.
     */
    resolve (actor, selector, { cwd = HOME, mustExist = false } = {}) {
        const ownerId = this.ownerId(actor);
        if (!ownerId) throw forbidden('no_session', 'Sign in first.');

        const raw = String(selector ?? '');
        if (raw.startsWith('/users/') || raw === '/users') {
            if (actor.role !== 'admin') {
                if (mustExist) throw forbidden('forbidden', 'Only the administrator can read other accounts.');
                return null;
            }
            return this._resolveUsersPath(raw, mustExist);
        }
        const full = normalizePath(raw, cwd, HOME);
        return this.entries.resolve(ownerId, full, { mustExist });
    }

    _resolveUsersPath (raw, mustExist) {
        const parts = splitPath(raw);           // ['users', name, ...rest]
        if (parts.length < 2) {
            /* /users itself is a directory full of the other accounts. */
            return { virtual: 'users', name: 'users', type: 'dir', uid: 'virtual-users' };
        }
        const user = this.users.byUsername(parts[1]);
        if (!user) {
            if (mustExist) throw notFound('no_user', `There is no account called ${parts[1]}.`);
            return null;
        }
        const rest = '/' + parts.slice(2).join('/');
        const root = this.entries.rootOf(user.uid);
        if (!root) {
            if (mustExist) throw notFound('no_filesystem', `${parts[1]} has no filesystem yet.`);
            return null;
        }
        return rest === '/' ? root : this.entries.resolve(user.uid, rest, { mustExist });
    }

    /** The uid whose tree a node belongs to — their own, or somebody else's. */
    ownerIdOfNode (node, actor) {
        if (!node) return null;
        return node.owner || this.ownerId(actor);
    }

    pathOf (actor, node) {
        if (!node) return '/';
        if (node.virtual === 'users') return '/users';
        return this.entries.pathOf(node);
    }

    /* ------------------------------- metadata ------------------------------ */

    toPublic (actor, node) {
        if (!node) return null;
        if (node.virtual === 'users') {
            return { uid: 'virtual-users', name: 'users', path: '/users', type: 'dir', mime: 'directory', size: 0, permission: 'admin', created: 0, modified: 0 };
        }
        const nodePath = this.entries.pathOf(node);
        const owner = node.owner?.startsWith(GUEST_PREFIX)
            ? { username: 'guest', displayName: 'Guest' }
            : (this.users.byId(node.owner) || null);
        return {
            uid: node.uid,
            name: node.name,
            path: nodePath,
            type: node.type,
            mime: node.type === 'dir' ? 'directory' : (node.mime || 'text/plain'),
            size: node.type === 'dir' ? this.entries.children(node.uid).length : (node.size || 0),
            created: node.created,
            modified: node.modified,
            owner: owner ? owner.username : null,
            permission: this.acl.grant(actor, node),
        };
    }

    /* -------------------------------- reading ------------------------------ */

    async stat (actor, selector, { cwd } = {}) {
        const node = this.resolve(actor, selector, { cwd, mustExist: true });
        this.acl.assertRead(actor, node, this.pathOf(actor, node));
        return this.toPublic(actor, node);
    }

    async readdir (actor, selector, { cwd } = {}) {
        const node = this.resolve(actor, selector, { cwd, mustExist: true });
        this.acl.assertRead(actor, node, this.pathOf(actor, node));
        if (node.type !== 'dir') throw badRequest('not_a_directory', 'That is not a directory.');

        const entries = this.entries.children(node.uid)
            .filter((child) => this.acl.canRead(actor, child))
            .map((child) => this.toPublic(actor, child));

        /* The administrator sees the other accounts at the root, next to /home
           and /srv. It is a window onto their trees, not a folder of their own. */
        if (actor.role === 'admin' && node.parent === null && !entries.some((e) => e.name === 'users')) {
            entries.push(this.toPublic(actor, { virtual: 'users', name: 'users', type: 'dir', created: 0, modified: 0 }));
        }
        return entries.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
            return String(a.name).localeCompare(String(b.name), undefined, { numeric: true });
        });
    }

    /** What an editor or a terminal wants: the text, or null for a directory. */
    async read (actor, selector, { cwd } = {}) {
        const node = this.resolve(actor, selector, { cwd, mustExist: true });
        this.acl.assertRead(actor, node, this.pathOf(actor, node));
        if (node.type === 'dir') return null;
        return await this.entries.readContent(node);
    }

    async readBuffer (actor, selector, { cwd } = {}) {
        const node = this.resolve(actor, selector, { cwd, mustExist: true });
        this.acl.assertRead(actor, node, this.pathOf(actor, node));
        if (node.type !== 'file') return null;
        return { buffer: await this.entries.readBytes(node), node };
    }

    /* -------------------------------- writing ------------------------------ */

    async _mkdirp (root, dirPath, owner) {
        let cur = root;
        for (const segment of splitPath(dirPath)) {
            const child = this.entries.childNamed(cur.uid, segment);
            if (child) {
                if (child.type !== 'dir') throw existsErr('not_a_directory', `${segment}: a file is in the way.`);
                cur = child;
            } else {
                cur = this.entries.create({ owner, parent: cur.uid, name: segment, type: 'dir', mime: 'directory' });
            }
        }
        return cur;
    }

    /** Make a directory and any parents it needs. */
    async mkdir (actor, selector, { cwd, recursive = true } = {}) {
        const ownerId = this.ownerId(actor);
        const full = normalizePath(selector, cwd || HOME, HOME);
        const existing = this.entries.resolve(ownerId, full);
        if (existing) {
            if (existing.type === 'dir') return this.toPublic(actor, existing);
            throw existsErr('already_exists', `${full}: that is already there.`);
        }
        const parentPathName = parentPath(full);
        const parent = this.entries.resolve(ownerId, parentPathName);
        if (!parent) {
            if (!recursive) throw notFound('no_parent', `${parentPathName}: no such directory.`);
            const root = this.root(actor) || await this.ensureAccount(this.users.byId(actor.uid));
            await this._mkdirp(root, parentPathName, ownerId);
            return this.mkdir(actor, selector, { cwd, recursive });
        }
        if (parent.type !== 'dir') throw badRequest('not_a_directory', `${parentPathName}: not a directory.`);
        this.acl.assertWrite(actor, parent, parentPathName);
        const created = this.entries.create({
            owner: ownerId, parent: parent.uid, name: baseName(full), type: 'dir', mime: 'directory',
        });
        this._changed(actor, 'mkdir', full);
        return this.toPublic(actor, created);
    }

    /**
     * Write a file.
     *
     * `content` is what the desktop holds: plain text, or a data URL for
     * something binary. Quota is checked first, because discovering that the
     * disk is full after the write has replaced the file is how people lose
     * the copy they had.
     */
    async write (actor, selector, content, mime, { cwd, createParents = true } = {}) {
        const ownerId = this.ownerId(actor);
        const full = normalizePath(selector, cwd || HOME, HOME);
        const text = content == null ? '' : String(content);
        const bytes = Buffer.byteLength(text, 'utf8');

        if (bytes > this.config.limits.maxFileBytes) {
            throw tooLarge('too_large', `That file is ${humanSize(bytes)}; the limit is ${humanSize(this.config.limits.maxFileBytes)}.`);
        }
        await this._checkQuota(ownerId, bytes);

        const existing = this.entries.resolve(ownerId, full);
        if (existing && existing.type === 'dir') throw existsErr('is_a_directory', `${full}: that is a directory.`);

        if (existing) {
            this.acl.assertWrite(actor, existing, full);
            const updated = await this.entries.writeContent(existing, text, mime);
            this._changed(actor, 'write', full);
            return this.toPublic(actor, updated);
        }

        const parentPathName = parentPath(full);
        let parent = this.entries.resolve(ownerId, parentPathName);
        if (!parent) {
            if (!createParents) throw notFound('no_parent', `${parentPathName}: no such directory.`);
            const root = this.root(actor);
            if (!root) throw notFound('no_root', 'This session has no filesystem.');
            parent = await this._mkdirp(root, parentPathName, ownerId);
        }
        this.acl.assertWrite(actor, parent, parentPathName);
        const created = this.entries.create({
            owner: ownerId, parent: parent.uid, name: safeSegment(baseName(full)),
            type: 'file', mime: mime || mimeOf(baseName(full)),
        });
        const written = await this.entries.writeContent(created, text, mime);
        this._changed(actor, 'write', full);
        return this.toPublic(actor, written);
    }

    /**
     * Write real bytes — an upload, or a file pushed over WebDAV.
     *
     * The desktop's mirror holds the same file as text or as a data URL, so the
     * two are kept in step here: what is binary on disk is handed back as a
     * data URL, and what is text stays text.
     */
    async writeBytes (actor, selector, buffer, mime, { cwd, createParents = true } = {}) {
        const ownerId = this.ownerId(actor);
        const full = normalizePath(selector, cwd || HOME, HOME);
        const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer ?? ''), 'utf8');
        if (data.length > this.config.limits.maxFileBytes) {
            throw tooLarge('too_large', `That is ${humanSize(data.length)}; the limit is ${humanSize(this.config.limits.maxFileBytes)}.`);
        }
        await this._checkQuota(ownerId, data.length);
        const existing = this.entries.resolve(ownerId, full);
        if (existing && existing.type === 'dir') throw existsErr('is_a_directory', `${full}: that is a directory.`);
        if (existing) {
            this.acl.assertWrite(actor, existing, full);
            const node = await this.entries.writeBytes(existing, data, mime);
            this._changed(actor, 'write', full);
            return this.toPublic(actor, node);
        }
        const parentName = parentPath(full);
        let parent = this.entries.resolve(ownerId, parentName);
        if (!parent) {
            if (!createParents) throw notFound('no_parent', `${parentName}: no such directory.`);
            const root = this.root(actor);
            if (!root) throw notFound('no_root', 'This session has no filesystem.');
            parent = await this._mkdirp(root, parentName, ownerId);
        }
        this.acl.assertWrite(actor, parent, parentName);
        const created = this.entries.create({
            owner: ownerId, parent: parent.uid, name: safeSegment(baseName(full)), type: 'file', mime: mime || mimeOf(baseName(full)),
        });
        const node = await this.entries.writeBytes(created, data, mime);
        this._changed(actor, 'write', full);
        return this.toPublic(actor, node);
    }

    async _checkQuota (ownerId, extra = 0) {
        const limit = this.config.limits.quotaBytes;
        if (!limit) return;
        const usage = this.entries.usage(ownerId);
        if (usage.bytes + extra > limit) {
            throw quota('quota_exceeded',
                `That would be ${humanSize(usage.bytes + extra)}; this account has ${humanSize(limit)}.`);
        }
        if (usage.nodes > this.config.limits.maxNodes) {
            throw quota('too_many_files', `This account has ${usage.nodes} files, which is the limit.`);
        }
    }

    /* ------------------------------ operations ----------------------------- */

    async remove (actor, selector, { cwd, recursive = false } = {}) {
        const node = this.resolve(actor, selector, { cwd, mustExist: true });
        const nodePath = this.pathOf(actor, node);
        this.acl.assertOwner(actor, node, nodePath);
        if (node.type === 'dir' && this.entries.children(node.uid).length && !recursive) {
            throw badRequest('not_empty', `${nodePath}: that directory is not empty.`);
        }
        const keys = this.entries.remove(node);
        for (const key of keys) await this.blobs.remove(key);
        this._changed(actor, 'remove', nodePath);
        return true;
    }

    async move (actor, from, to, { cwd } = {}) {
        const node = this.resolve(actor, from, { cwd, mustExist: true });
        const fromPath = this.pathOf(actor, node);
        this.acl.assertOwner(actor, node, fromPath);

        let destPath = normalizePath(to, cwd || HOME, HOME);
        const dest = this.entries.resolve(this.ownerId(actor), destPath);
        if (dest && dest.type === 'dir') destPath = join(destPath, baseName(fromPath));
        if (isWithin(fromPath, destPath) && fromPath !== destPath) {
            throw badRequest('into_itself', 'A directory cannot be moved inside itself.');
        }
        const newParentPath = parentPath(destPath);
        const newParent = this.entries.resolve(this.ownerId(actor), newParentPath);
        if (!newParent) throw notFound('no_parent', `${newParentPath}: no such directory.`);
        this.acl.assertWrite(actor, newParent, newParentPath);
        const moved = this.entries.move(node, newParent.uid, baseName(destPath));
        this._changed(actor, 'move', `${fromPath} -> ${destPath}`);
        return this.toPublic(actor, moved);
    }

    async copy (actor, from, to, { cwd } = {}) {
        const node = this.resolve(actor, from, { cwd, mustExist: true });
        const fromPath = this.pathOf(actor, node);
        this.acl.assertRead(actor, node, fromPath);
        let destPath = normalizePath(to, cwd || HOME, HOME);
        const dest = this.entries.resolve(this.ownerId(actor), destPath);
        if (dest && dest.type === 'dir') destPath = join(destPath, baseName(fromPath));
        const newParent = this.entries.resolve(this.ownerId(actor), parentPath(destPath));
        if (!newParent) throw notFound('no_parent', `${parentPath(destPath)}: no such directory.`);
        this.acl.assertWrite(actor, newParent, parentPath(destPath));
        const clone = await this.entries.copy(node, newParent.uid, baseName(destPath));
        this._changed(actor, 'copy', `${fromPath} -> ${destPath}`);
        return this.toPublic(actor, clone);
    }

    /**
     * Move something to the Trash, the way the file manager does — with a
     * `.trashinfo` file beside it saying where it came from, which is what
     * makes "restore" possible rather than a guess.
     */
    async trash (actor, selector, { cwd } = {}) {
        const node = this.resolve(actor, selector, { cwd, mustExist: true });
        const from = this.pathOf(actor, node);
        this.acl.assertOwner(actor, node, from);
        if (isWithin(TRASH_FILES, from)) throw badRequest('already_in_trash', 'That is already in the trash.');
        await this._mkdirp(this.root(actor), TRASH_INFO, this.ownerId(actor));
        const infoPath = join(TRASH_INFO, `${baseName(from)}.${Date.now()}.trashinfo`);
        await this.write(actor, infoPath, `[Trash Info]\nPath=${from}\nDeletionDate=${new Date().toISOString()}\n`, 'text/plain');
        const name = baseName(from);
        let target = join(TRASH_FILES, name);
        if (this.entries.resolve(this.ownerId(actor), target)) {
            target = join(TRASH_FILES, `${name}.${Date.now()}`);
        }
        return this.move(actor, from, target);
    }

    async emptyTrash (actor) {
        const node = this.entries.resolve(this.ownerId(actor), TRASH_FILES);
        if (!node) return 0;
        let n = 0;
        for (const child of this.entries.children(node.uid)) {
            const keys = this.entries.remove(child);
            for (const key of keys) await this.blobs.remove(key);
            n++;
        }
        const info = this.entries.resolve(this.ownerId(actor), TRASH_INFO);
        if (info) {
            for (const child of this.entries.children(info.uid)) this.entries.remove(child);
        }
        this._changed(actor, 'empty_trash', TRASH_FILES);
        return n;
    }

    /* --------------------------------- ops --------------------------------- */

    /**
     * Apply a batch of operations from a desktop.
     *
     * The desktop mirrors the tree in memory and sends what changed, with the
     * revision it was editing at. If the server has moved on since then, the
     * batch is refused and the desktop re-reads — two people typing in the same
     * document is a real possibility on a shared machine, and silently picking
     * a winner would lose one of their work.
     */
    async applyOps (actor, ops, baseRev = null) {
        if (!Array.isArray(ops)) throw badRequest('bad_ops', 'That is not a list of operations.');
        const ownerId = this.ownerId(actor);
        if (baseRev !== null && baseRev !== undefined) {
            const current = this.revs.get(ownerId) || 0;
            if (Number(baseRev) !== current) {
                return { ok: false, conflict: true, rev: current };
            }
        }
        const applied = [];
        for (const op of ops) {
            try {
                applied.push(await this._applyOp(actor, op));
            } catch (e) {
                /* One bad operation in a batch must not lose the rest: the
                   desktop applies them in order and cannot un-apply the ones
                   that worked, so the failures are reported per operation. */
                applied.push({ op: op?.op, path: op?.path, ok: false, error: e.message, code: e.code });
            }
        }
        return { ok: true, rev: this.bump(actor), applied };
    }

    async _applyOp (actor, op) {
        const type = String(op?.op || '').toLowerCase();
        switch (type) {
        case 'write':
        case 'writefile':
            return { ok: true, node: await this.write(actor, op.path, op.content ?? '', op.mime) };
        case 'mkdir':
            return { ok: true, node: await this.mkdir(actor, op.path) };
        case 'touch': {
            const node = this.entries.resolve(this.ownerId(actor), normalizePath(op.path, HOME, HOME));
            if (!node) return { ok: true, node: await this.write(actor, op.path, '', op.mime || 'text/plain') };
            return { ok: true, node: this.toPublic(actor, node) };
        }
        case 'remove':
        case 'rm':
            return { ok: await this.remove(actor, op.path, { recursive: true }) };
        case 'move':
        case 'mv':
            return { ok: true, node: await this.move(actor, op.path, op.to) };
        case 'copy':
        case 'cp':
            return { ok: true, node: await this.copy(actor, op.path, op.to) };
        case 'trash':
            return { ok: true, node: await this.trash(actor, op.path) };
        case 'reset':
            return { ok: true, node: await this.reset(actor) };
        default:
            throw badRequest('unknown_op', `${type}: that is not a filesystem operation.`);
        }
    }

    /** Throw the tree away and seed it again. "Reset the computer" in Settings. */
    async reset (actor) {
        const ownerId = this.ownerId(actor);
        for (const root of this.entries.t.find((n) => n.owner === ownerId && n.parent === null)) {
            for (const key of this.entries.remove(root)) await this.blobs.remove(key);
        }
        const user = actor.guest ? null : this.users.byId(actor.uid);
        const root = user ? await this.ensureAccount(user) : await this.ensureGuest(actor);
        this._changed(actor, 'reset', '/');
        return this.toPublic(actor, root);
    }

    /* -------------------------------- search ------------------------------- */

    async search (actor, { query = '', path: start = '/', limit = 200 } = {}) {
        const startNode = this.resolve(actor, start, { mustExist: true });
        this.acl.assertRead(actor, startNode, start);
        const needle = String(query).toLowerCase();
        const out = [];
        const queue = [startNode];
        let guard = 0;
        while (queue.length && out.length < limit && guard++ < 20000) {
            const node = queue.shift();
            if (!node) continue;
            if (node.name && node.name.toLowerCase().includes(needle)) {
                out.push(this.toPublic(actor, node));
            }
            if (node.type === 'dir') {
                for (const child of this.entries.children(node.uid)) {
                    if (this.acl.canRead(actor, child)) queue.push(child);
                }
            }
        }
        return out;
    }

    /* -------------------------------- mirrors ------------------------------ */

    /** The whole tree, in the shape the desktop mounts as its filesystem. */
    async snapshot (actor) {
        const root = this.root(actor);
        if (!root) return null;
        return await this.entries.snapshot(this.ownerId(actor), { rootUid: root.uid });
    }

    /** An administrator looking at another account's tree. */
    async snapshotOfUser (actor, username) {
        if (actor.role !== 'admin') throw forbidden('forbidden', 'Only the administrator can do that.');
        const user = this.users.byUsername(username);
        if (!user) throw notFound('no_user', `There is no account called ${username}.`);
        const root = this.entries.rootOf(user.uid);
        if (!root) return null;
        return await this.entries.snapshot(user.uid, { rootUid: root.uid });
    }

    /** The other accounts, as the /users folder in the administrator's Files. */
    async usersListing (actor) {
        if (actor.role !== 'admin') return [];
        return this.users.list().map((user) => ({
            name: user.username,
            type: 'dir',
            uid: user.rootUid,
            path: join('/users', user.username),
            owner: user.username,
            role: user.role,
        }));
    }

    usage (actor) {
        const ownerId = this.ownerId(actor);
        return {
            ...this.entries.usage(ownerId),
            quota: this.config.limits.quotaBytes,
            human: humanSize(this.entries.usage(ownerId).bytes),
        };
    }

    /* -------------------------------- plumbing ----------------------------- */

    _changed (actor, op, path) {
        const rev = this.bump(actor);
        this.events?.publish?.('fs.changed', {
            op, path, rev,
            owner: actor.username,
            ownerId: this.ownerId(actor),
            guest: !!actor.guest,
        }, { actor: actor.username });
        return rev;
    }

    /** Everything an account is holding, for the console and `df`. */
    report (actor = null) {
        if (!actor) {
            return {
                nodes: this.entries.countAll(),
                blobs: this.blobs.usage(),
                accounts: this.users.count(),
            };
        }
        return { ...this.usage(actor), rev: this.rev(actor) };
    }
}
