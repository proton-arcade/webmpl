/**
 * The filesystem, over HTTP.
 *
 * Two ways in, for two jobs. The desktop mirrors the whole tree once
 * (`GET /api/fs/tree`) and then streams what it changes (`POST /api/fs/ops`),
 * which is what lets twenty applications stay synchronous and instant while
 * the files are really on this machine. Everything else — a share, WebDAV, a
 * hosted site, an `<img src>` — reads one file at a time through the same
 * permissions as the desktop.
 */
import { BaseController } from '../lib/container.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { handled, reply } from '../lib/http.js';
import { baseName, join, mimeOf, normalizePath } from '../lib/util.js';

export class FSController extends BaseController {
    static SERVICE_NAME = 'fs';

    async _init () {
        this.fs = this.services.get('fs');
        this.apps = this.services.get('apps');
    }

    /* --------------------------------- mirror ------------------------------ */

    /** The whole tree, in the shape the desktop mounts as its filesystem. */
    async tree (ctx) {
        const actor = ctx.require();
        const snapshot = await this.fs.snapshot(actor);
        if (!snapshot) throw notFound('no_filesystem', 'This account has no filesystem yet.');
        return { ok: true, rev: this.fs.rev(actor), root: snapshot, username: actor.username };
    }

    /** Another account's tree. The administrator's /users window. */
    async treeOf (ctx) {
        const actor = ctx.require();
        const snapshot = await this.fs.snapshotOfUser(actor, ctx.params.username);
        return { ok: true, username: ctx.params.username, root: snapshot || { type: 'dir', children: {} } };
    }

    /**
     * Apply what the desktop changed.
     *
     * The revision guards against two people editing the same tree from two
     * browsers: the loser is told to re-read rather than having their work
     * written over, and re-sends.
     */
    async ops (ctx) {
        const actor = ctx.require();
        const { ops, rev } = ctx.body || {};
        const result = await this.fs.applyOps(actor, ops, rev);
        if (result.conflict) {
            return reply({ ok: false, conflict: true, rev: result.rev }, { status: 409 });
        }
        return { ok: true, rev: result.rev, applied: result.applied };
    }

    /** The accounts on this machine, as the /users folder. */
    users (ctx) {
        const actor = ctx.require();
        return this.fs.usersListing(actor);
    }

    /* --------------------------------- browse ------------------------------ */

    async stat (ctx) {
        const actor = ctx.require();
        return await this.fs.stat(actor, ctx.query.path || '/', { cwd: ctx.query.cwd });
    }

    async readdir (ctx) {
        const actor = ctx.require();
        return await this.fs.readdir(actor, ctx.query.path || '/', { cwd: ctx.query.cwd });
    }

    async read (ctx) {
        const actor = ctx.require();
        const content = await this.fs.read(actor, ctx.query.path, { cwd: ctx.query.cwd });
        if (content === null) throw notFound('no_entry', 'No such file, or it is a directory.');
        return { ok: true, path: ctx.query.path, content };
    }

    async write (ctx) {
        const actor = ctx.require();
        const { path, content, mime } = ctx.body || {};
        if (!path) throw badRequest('no_path', 'A path is needed.');
        const node = await this.fs.write(actor, path, content ?? '', mime, { cwd: ctx.query.cwd });
        return { ok: true, node, rev: this.fs.rev(actor) };
    }

    async mkdir (ctx) {
        const actor = ctx.require();
        const node = await this.fs.mkdir(actor, (ctx.body || {}).path, { cwd: ctx.query.cwd });
        return { ok: true, node, rev: this.fs.rev(actor) };
    }

    async remove (ctx) {
        const actor = ctx.require();
        await this.fs.remove(actor, ctx.query.path || (ctx.body || {}).path, { recursive: true, cwd: ctx.query.cwd });
        return { ok: true, rev: this.fs.rev(actor) };
    }

    async move (ctx) {
        const actor = ctx.require();
        const node = await this.fs.move(actor, (ctx.body || {}).path, (ctx.body || {}).to, { cwd: ctx.query.cwd });
        return { ok: true, node, rev: this.fs.rev(actor) };
    }

    async copy (ctx) {
        const actor = ctx.require();
        const node = await this.fs.copy(actor, (ctx.body || {}).path, (ctx.body || {}).to, { cwd: ctx.query.cwd });
        return { ok: true, node, rev: this.fs.rev(actor) };
    }

    async trash (ctx) {
        const actor = ctx.require();
        const node = await this.fs.trash(actor, ctx.query.path || (ctx.body || {}).path, { cwd: ctx.query.cwd });
        return { ok: true, node, rev: this.fs.rev(actor) };
    }

    async emptyTrash (ctx) {
        const actor = ctx.require();
        return { ok: true, removed: await this.fs.emptyTrash(actor), rev: this.fs.rev(actor) };
    }

    async search (ctx) {
        const actor = ctx.require();
        return await this.fs.search(actor, {
            query: ctx.query.q || '', path: ctx.query.path || '/', limit: Number(ctx.query.limit || 200),
        });
    }

    usage (ctx) {
        const actor = ctx.require();
        return this.fs.usage(actor);
    }

    /* ---------------------------------- files ------------------------------ */

    /**
     * The bytes of one file.
     *
     * This is how a hosted site, a shared link, a WebDAV client and an `<img>`
     * tag read something: same permissions as the desktop, and the real bytes
     * rather than the JSON shape the mirror uses.
     */
    async raw (ctx) {
        const actor = ctx.require();
        const path = normalizePath('/' + (ctx.params.rest || ''), '/', '/');
        const { buffer, node } = await this.fs.readBuffer(actor, path);
        if (!buffer) throw notFound('no_entry', 'No such file.');
        return reply(buffer, {
            type: node.mime || mimeOf(node.name),
            headers: {
                'content-disposition': `inline; filename="${String(baseName(node.name)).replace(/"/g, '')}"`,
                etag: `"${node.uid}"`,
            },
        });
    }

    /**
     * Upload files into a directory.
     *
     * This is the one route that takes a browser's multipart body rather than
     * JSON, because dragging a folder of photographs into Files is a thing
     * people do and a base64 string in a JSON body is not how it arrives.
     */
    async upload (ctx) {
        const actor = ctx.require();
        const parts = await ctx.multipart();
        const target = normalizePath(ctx.query.path || (ctx.fields?.path) || '/home/mixt/Downloads', '/home/mixt', '/home/mixt');
        const written = [];
        for (const part of parts) {
            if (!part.filename) continue;
            const name = baseName(part.filename);
            const path = join(target, name);
            const node = await this.fs.writeBytes(actor, path, part.buffer, part.mime || mimeOf(name));
            written.push({ path, size: node.size, name });
        }
        return { ok: true, written, rev: this.fs.rev(actor) };
    }

    /** Upload by hand (a JSON body with base64 content) — used by the tests. */
    async putFile (ctx) {
        const actor = ctx.require();
        const { path, content, mime } = ctx.body || {};
        const node = await this.fs.write(actor, path, content ?? '', mime);
        return { ok: true, node, rev: this.fs.rev(actor) };
    }

    /* --------------------------------- shares ------------------------------ */

    shares (ctx) {
        const actor = ctx.require();
        const shares = this.stores.get('share');
        return {
            mine: shares.forOwner(actor.ownerId).map((s) => ({
                token: s.token, path: s.path, permission: s.permission,
                public: s.public, created: s.created,
            })),
        };
    }

    async share (ctx) {
        const actor = ctx.require();
        const { path, permission = 'read', public: isPublic = false, withUser = null } = ctx.body || {};
        const node = this.fs.resolve(actor, path, { mustExist: true });
        const shares = this.stores.get('share');
        const withUserRecord = withUser ? this.stores.get('user').byUsername(withUser) : null;
        if (withUser && !withUserRecord) throw notFound('no_user', `There is no account called ${withUser}.`);
        const share = shares.create({
            ownerUid: actor.ownerId,
            nodeUid: node.uid,
            path: this.fs.pathOf(actor, node),
            permission, public: isPublic, withUid: withUserRecord?.uid || null,
        });
        return { ok: true, token: share.token, url: `/api/fs/shared/${share.token}` };
    }

    unshare (ctx) {
        const actor = ctx.require();
        this.stores.get('share').revoke(ctx.params.token, actor.role === 'admin' ? null : actor.ownerId);
        return { ok: true };
    }

    /* --------------------------------- events ------------------------------ */

    /** The event stream: what changed on this machine while you were looking. */
    stream (ctx) {
        const actor = ctx.require();
        this.services.get('events').attach(ctx.req, ctx.res, actor, { since: Number(ctx.query.since || 0) });
        return handled();
    }

    /* Named `recent` rather than `events`: BaseService puts the event
       service on every controller as `this.events`, and an instance property
       named after a handler would quietly shadow the route that answers it. */
    recent (ctx) {
        const actor = ctx.require();
        return this.services.get('events').recent(actor, Number(ctx.query.since || 0), Number(ctx.query.limit || 100));
    }
}

export { forbidden };
