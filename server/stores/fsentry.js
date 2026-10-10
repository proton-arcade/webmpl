/**
 * Filesystem entries.
 *
 * The table of nodes: every file and every directory, with its parent, its
 * owner and the key of the blob holding its bytes. This is the same shape
 * Puter uses — a node is addressed by uid, and a path is resolved by walking
 * parents — which is what makes a rename cheap: the bytes do not move.
 *
 * The tree is per account. An account's root node is `parent: null` and
 * `owner: <their uid>`, so `/` means one thing to one person and another to
 * the next; there is no shared namespace to collide in unless an administrator
 * asks for one (`/users`, in the console).
 */
import { BaseStore } from '../lib/container.js';
import { notFound, badRequest, exists as existsErr } from '../lib/errors.js';
import { baseName, decodeContent, encodeContent, isTextual, parentPath, splitPath, uid as newUid } from '../lib/util.js';

export class FSEntryStore extends BaseStore {
    static SERVICE_NAME = 'fsentry';

    async _init () {
        this.t = this.db.table('fsentries');
        this.blobs = this.clients.get('blobstore');
        /* Path resolution walks parent links one row at a time. For a personal
           filesystem of a few thousand entries that is fine, but it happens on
           every keystroke in the terminal, so the last-seen uid for each path is
           remembered and thrown away the moment anything writes. */
        this.resolveCache = new Map();
        this.cacheEnabled = true;
    }

    invalidate () { this.resolveCache.clear(); }

    /* ------------------------------- reading ------------------------------- */

    node (nodeUid) { return this.t.findOne((n) => n.uid === nodeUid); }

    rootOf (ownerUid) {
        return this.t.findOne((n) => n.owner === ownerUid && n.parent === null);
    }

    children (parentUid) {
        return this.t.find((n) => n.parent === parentUid);
    }

    childNamed (parentUid, name) {
        return this.t.findOne((n) => n.parent === parentUid && n.name === name);
    }

    /**
     * Resolve a path to a node.
     *
     * Accepts an absolute path ('/home/mixt/Documents/a.txt') or a uid — Puter
     * calls that a "node selector", and being able to name a node either way is
     * what lets the client send `move` without first asking for an id.
     */
    resolve (ownerUid, selector, { mustExist = false } = {}) {
        if (!selector || selector === '/' || selector === '') {
            const root = this.rootOf(ownerUid);
            if (!root && mustExist) throw notFound('no_root', 'This account has no filesystem yet.');
            return root || null;
        }
        /* A bare uid, or one wrapped the way an API client sends it. */
        const maybeUid = typeof selector === 'object'
            ? (selector.uid || selector.id)
            : (/^[0-9a-f]{32}$/.test(selector) ? selector : null);
        if (maybeUid) {
            const byId = this.t.findOne((n) => n.uid === maybeUid);
            if (!byId && mustExist) throw notFound('no_entry', 'No such file or directory.');
            return byId || null;
        }
        if (typeof selector === 'object' && selector.path) return this.resolve(ownerUid, selector.path, { mustExist });

        const cacheKey = `${ownerUid}:${selector}`;
        if (this.cacheEnabled && this.resolveCache.has(cacheKey)) {
            const hit = this.node(this.resolveCache.get(cacheKey));
            if (hit) return hit;
            this.resolveCache.delete(cacheKey);
        }

        const root = this.rootOf(ownerUid);
        if (!root) {
            if (mustExist) throw notFound('no_root', 'This account has no filesystem yet.');
            return null;
        }
        let node = root;
        for (const segment of splitPath(selector)) {
            if (node.type !== 'dir') {
                if (mustExist) throw notFound('not_a_directory', `${selector}: not a directory.`);
                return null;
            }
            const next = this.childNamed(node.uid, segment);
            if (!next) {
                if (mustExist) throw notFound('no_entry', `${selector}: no such file or directory.`);
                return null;
            }
            node = next;
        }
        if (this.cacheEnabled) this.resolveCache.set(cacheKey, node.uid);
        return node;
    }

    /** The absolute path of a node, by walking up to the root. */
    pathOf (node) {
        if (!node) return '/';
        const parts = [];
        let cur = node;
        let guard = 0;
        while (cur && cur.parent !== null && guard++ < 256) {
            parts.unshift(cur.name);
            cur = this.t.findOne((n) => n.uid === cur.parent);
        }
        return '/' + parts.join('/');
    }

    /** Every node underneath `nodeUid`, deepest last, so deletions are safe. */
    subtree (nodeUid) {
        const out = [];
        const queue = [nodeUid];
        const seen = new Set();
        while (queue.length) {
            const id = queue.shift();
            if (seen.has(id)) continue; // a damaged parent link must not loop forever
            seen.add(id);
            const node = this.node(id);
            if (node) out.push(node);
            for (const child of this.children(id)) queue.push(child.uid);
        }
        return out;
    }

    /* ------------------------------- writing ------------------------------- */

    create ({ owner, parent, name, type = 'file', mime = 'text/plain', blob = null, size = 0, url = null, immutable = false }) {
        /* A root has no parent, and there is one per account — the sibling
           name check would match every other account's root, which are all
           called '' and all have no parent. */
        if (parent !== null && this.childNamed(parent, name)) {
            throw existsErr('already_exists', `${name}: that is already there.`);
        }
        const record = this.t.insert({
            uid: newUid(),
            owner,
            parent,
            name,
            type,
            mime,
            size: size || 0,
            blob,
            url: url || null,
            immutable: !!immutable,
            created: Date.now(),
            modified: Date.now(),
        });
        this.invalidate();
        this.db.dirty();
        return record;
    }

    update (node, patch) {
        this.t.update((n) => n.uid === node.uid, { ...patch, modified: Date.now() });
        this.invalidate();
        return this.node(node.uid);
    }

    /**
     * Move a node. Refuses to move a directory inside itself, which is the
     * one operation that turns a tree into a loop and the filesystem into
     * something nobody can list.
     */
    move (node, newParentUid, newName = node.name) {
        if (!node) throw notFound('no_entry', 'No such file or directory.');
        if (newName !== node.name && this.childNamed(newParentUid, newName)) {
            throw existsErr('already_exists', `${newName}: that is already there.`);
        }
        if (newParentUid === node.uid) {
            throw badRequest('into_itself', 'A directory cannot be moved inside itself.');
        }
        for (const descendant of node.type === 'dir' ? this.subtree(node.uid) : []) {
            if (descendant.uid === newParentUid) {
                throw badRequest('into_itself', 'A directory cannot be moved inside itself.');
            }
        }
        this.t.update((n) => n.uid === node.uid, { parent: newParentUid, name: newName });
        this.invalidate();
        this.db.dirty();
        return this.node(node.uid);
    }

    /**
     * Copy a node, and its contents if it is a directory.
     *
     * The bytes are copied rather than shared: two files that happen to have
     * started life as one should not change together, which is what a
     * copy-on-write link would give you in a filesystem this size.
     */
    async copy (node, newParentUid, newName = node.name) {
        if (!node) throw notFound('no_entry', 'No such file or directory.');
        if (this.childNamed(newParentUid, newName)) {
            throw existsErr('already_exists', `${newName}: that is already there.`);
        }
        const clone = this.create({
            owner: node.owner,
            parent: newParentUid,
            name: newName,
            type: node.type,
            mime: node.mime,
            size: node.size,
            url: node.url,
        });
        if (node.type === 'file') {
            if (node.blob) {
                const bytes = await this.blobs.get(node.blob);
                if (bytes) {
                    const key = newUid();
                    await this.blobs.put(key, bytes);
                    this.t.update((n) => n.uid === clone.uid, { blob: key });
                }
            }
        } else {
            for (const child of this.children(node.uid)) {
                await this.copy(child, clone.uid, child.name);
            }
        }
        this.invalidate();
        return this.node(clone.uid);
    }

    /** Delete a node and everything under it, and return the blobs to free. */
    remove (node) {
        if (!node) return [];
        const doomed = node.type === 'dir' ? this.subtree(node.uid) : [node];
        const keys = doomed.filter((n) => n.blob).map((n) => n.blob);
        const uids = new Set(doomed.map((n) => n.uid));
        this.t.remove((n) => uids.has(n.uid));
        this.invalidate();
        this.db.dirty();
        return keys;
    }

    /* -------------------------------- bytes -------------------------------- */

    async readBytes (node) {
        if (!node || node.type !== 'file') return null;
        if (node.url && !node.blob) return null; // a wallpaper-style asset reference
        if (!node.blob) return Buffer.alloc(0);
        return await this.blobs.get(node.blob);
    }

    /** The text a terminal or an editor wants. Binary files come back as null. */
    async readText (node) {
        const buffer = await this.readBytes(node);
        if (buffer === null) return null;
        if (!isTextual(node.mime)) return null;
        return buffer.toString('utf8');
    }

    /**
     * Store the bytes of a file.
     *
     * `dataUrl` records how the desktop should be handed the file back: as text,
     * or as a data URL describing real bytes. It follows the mime type unless
     * the caller knows better — an upload is binary because it is binary, while
     * a seeded placeholder that happens to be called `.ogg` is text and must
     * come back as text, or an editor would silently rewrite it.
     */
    async writeBytes (node, buffer, mime, { dataUrl = null } = {}) {
        const key = node.blob || newUid();
        const { size } = await this.blobs.put(key, buffer);
        const finalMime = mime || node.mime;
        this.t.update((n) => n.uid === node.uid, {
            blob: key,
            size,
            mime: finalMime,
            url: null,
            dataUrl: dataUrl === null ? !isTextual(finalMime) : !!dataUrl,
            modified: Date.now(),
        });
        this.db.dirty();
        return this.node(node.uid);
    }

    /**
     * Write the shape the desktop sends.
     *
     * The desktop's filesystem is one JSON tree, so a picture is a data URL
     * inside a file's text. On disk it is the real bytes, so the hosted site,
     * WebDAV and `file` all see a PNG and not a million-character string.
     */
    /**
     * Write the shape the desktop sends.
     *
     * The desktop's filesystem is one JSON tree, so a picture is a data URL
     * inside a file's text. On disk it becomes the real bytes, so the hosted
     * site, WebDAV and `file` all see a PNG and not a million-character
     * string. Whether the original was a data URL is remembered on the node,
     * because that — not the mime type — is what decides how to hand it back:
     * a file that arrived as text must come back as text, byte for byte, or an
     * edit in the editor would silently turn it into something else.
     */
    async writeContent (node, content, mime) {
        const decoded = decodeContent(content);
        const finalMime = mime || decoded.mime || node.mime || 'text/plain';
        const written = await this.writeBytes(node, decoded.buffer, finalMime);
        if (decoded.dataUrl !== !!node.dataUrl) {
            this.t.update((n) => n.uid === node.uid, { dataUrl: decoded.dataUrl });
            written.dataUrl = decoded.dataUrl;
        }
        return written;
    }

    /** The inverse: what the desktop's tree holds for this node. */
    async readContent (node) {
        if (!node) return null;
        if (node.type === 'dir') return null;
        if (node.url && !node.blob) return ''; // an asset reference: the client resolves it
        const buffer = await this.readBytes(node);
        if (buffer === null) return '';
        if (node.dataUrl) return encodeContent(buffer, node.mime || 'application/octet-stream').content;
        return buffer.toString('utf8');
    }

    /* ------------------------------ snapshots ------------------------------ */

    /**
     * The whole tree, in the shape the desktop mounts.
     *
     * This is what makes the browser's copy a *mirror* rather than a second
     * filesystem: the client keeps a synchronous tree in memory (so every app
     * stays instant) and it is, byte for byte, what the server holds.
     */
    async snapshot (ownerUid, { rootUid = null } = {}) {
        const root = rootUid ? this.node(rootUid) : this.rootOf(ownerUid);
        if (!root) return null;
        return await this._nodeToTree(root);
    }

    async _nodeToTree (node) {
        if (node.type === 'file') {
            return {
                type: 'file',
                content: await this.readContent(node),
                mime: node.mime || 'text/plain',
                ...(node.url && !node.blob ? { url: node.url } : {}),
                created: node.created,
                modified: node.modified,
            };
        }
        const children = {};
        for (const child of this.children(node.uid)) {
            children[child.name] = await this._nodeToTree(child);
        }
        return { type: 'dir', children, created: node.created, modified: node.modified };
    }

    /* -------------------------------- stats -------------------------------- */

    usage (ownerUid) {
        let bytes = 0, files = 0, dirs = 0;
        for (const node of this.t.find((n) => n.owner === ownerUid)) {
            if (node.type === 'file') { files++; bytes += node.size || 0; }
            else dirs++;
        }
        return { bytes, files, dirs, nodes: files + dirs };
    }

    countAll () { return this.t.count(); }
}
