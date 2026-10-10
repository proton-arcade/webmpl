/**
 * WebDAV, over HTTP.
 *
 * The same filesystem as the desktop, mounted by an operating system instead of
 * a browser. Every method here calls the filesystem service with the signed-in
 * actor, so shares, permissions and quotas apply exactly as they do in Files —
 * this is another door into the same room, not a way around it.
 *
 * Basic auth carries the credentials because that is what every WebDAV client
 * speaks: use your account name and password, or a token as the password.
 */
import { BaseController } from '../lib/container.js';
import { notFound, unauthorized } from '../lib/errors.js';
import { reply } from '../lib/http.js';
import { baseName, mimeOf } from '../lib/util.js';

export class WebDAVController extends BaseController {
    static SERVICE_NAME = 'webdav';

    async _init () {
        this.dav = this.services.get('webdav');
        this.fs = this.services.get('fs');
    }

    options (ctx) {
        void ctx;
        return reply('', {
            status: 200,
            type: 'text/plain',
            headers: {
                dav: '1, 2',
                allow: 'OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, COPY, MOVE',
                'ms-author-via': 'DAV',
            },
        });
    }

    async propfind (ctx) {
        const actor = ctx.require();
        const path = this.dav._toPath(ctx.params.rest, this.config.webdav.mountPath);
        const depth = ctx.headers.depth === '0' ? 0 : 1;
        const xml = await this.dav.propfind(actor, path, { depth });
        return reply(xml, { status: 207, type: 'application/xml; charset=utf-8' });
    }

    async get (ctx) {
        const actor = ctx.require();
        const path = this.dav._toPath(ctx.params.rest, this.config.webdav.mountPath);
        const result = await this.dav.get(actor, path);
        if (result.directory) {
            return reply(this.dav.htmlListing(actor, path, result.listing), { type: 'text/html; charset=utf-8' });
        }
        return reply(result.buffer, { type: result.mime });
    }

    async head (ctx) {
        const actor = ctx.require();
        const path = this.dav._toPath(ctx.params.rest, this.config.webdav.mountPath);
        const result = await this.dav.get(actor, path);
        if (result.directory) return reply('', { type: 'text/html' });
        return reply('', { type: result.mime, headers: { etag: `"${result.node.uid}"` } });
    }

    async put (ctx) {
        const actor = ctx.require();
        const path = this.dav._toPath(ctx.params.rest, this.config.webdav.mountPath);
        /* The body is read here rather than by the dispatcher: a WebDAV client
           sends raw bytes, and parsing them into anything first would corrupt
           every upload that is not text. */
        const body = await ctx.buffer();
        const existing = this.fs.resolve(actor, path);
        const node = await this.dav.put(actor, path, body, ctx.headers['content-type'] || mimeOf(baseName(path)));
        return reply('', { status: existing ? 204 : 201, type: 'text/plain', headers: { etag: `"${node.uid}"` } });
    }

    async mkcol (ctx) {
        const actor = ctx.require();
        const path = this.dav._toPath(ctx.params.rest, this.config.webdav.mountPath);
        await this.dav.mkcol(actor, path);
        return reply('', { status: 201, type: 'text/plain' });
    }

    async delete (ctx) {
        const actor = ctx.require();
        const path = this.dav._toPath(ctx.params.rest, this.config.webdav.mountPath);
        const node = this.fs.resolve(actor, path);
        if (!node) throw notFound('no_entry', 'No such file or directory.');
        await this.dav.delete(actor, path);
        return reply('', { status: 204, type: 'text/plain' });
    }

    async move (ctx) {
        const actor = ctx.require();
        const path = this.dav._toPath(ctx.params.rest, this.config.webdav.mountPath);
        const destination = this._destination(ctx);
        if (!destination) throw notFound('no_destination', 'A Destination header is needed.');
        await this.dav.move(actor, path, destination);
        return reply('', { status: 201, type: 'text/plain' });
    }

    async copy (ctx) {
        const actor = ctx.require();
        const path = this.dav._toPath(ctx.params.rest, this.config.webdav.mountPath);
        const destination = this._destination(ctx);
        if (!destination) throw notFound('no_destination', 'A Destination header is needed.');
        await this.dav.copy(actor, path, destination);
        return reply('', { status: 201, type: 'text/plain' });
    }

    _destination (ctx) {
        const raw = ctx.headers.destination;
        if (!raw) return null;
        try {
            const url = new URL(raw);
            return this.dav._toPath(url.pathname, this.config.webdav.mountPath);
        } catch {
            return this.dav._toPath(String(raw), this.config.webdav.mountPath);
        }
    }
}

export { unauthorized };
