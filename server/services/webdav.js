/**
 * WebDAV.
 *
 * The filesystem, mounted by the operating system instead of by a browser: a
 * laptop on the same network can open `http://<machine>:8080/webdav/` and see
 * the account's files in its own file manager. Every call goes through the same
 * filesystem service as the desktop, so permissions, shares and quotas apply
 * exactly as they do in Files — this is a second door into the same room, not a
 * way around it.
 */
import { BaseService } from '../lib/container.js';
import { badRequest, notFound } from '../lib/errors.js';
import { baseName, join, mimeOf, parentPath } from '../lib/util.js';

const DAV_NS = 'DAV:';

const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** RFC 1123, which is what a WebDAV client expects in a date property. */
const httpDate = (t) => new Date(t || Date.now()).toUTCString();

export class WebDAVService extends BaseService {
    static SERVICE_NAME = 'webdav';
    static DEPENDENCIES = ['fs'];

    async _init () {
        this.fs = this.services.get('fs');
        this.entries = this.stores.get('fsentry');
    }

    /** Normalise a WebDAV path (`/webdav/home/mixt/a.txt`) to a filesystem path. */
    _toPath (href, mount = '/webdav') {
        let p = String(href || '/');
        try { p = decodeURIComponent(p); } catch { /* leave it as it came */ }
        if (p.startsWith(mount)) p = p.slice(mount.length);
        if (!p.startsWith('/')) p = '/' + p;
        p = p.replace(/\/{2,}/g, '/');
        if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
        return p === '' ? '/' : p;
    }

    /* -------------------------------- methods ------------------------------ */

    async propfind (actor, path, { depth = 1 } = {}) {
        const node = this.fs.resolve(actor, path, { mustExist: true });
        const target = depth === 0 ? [node] : [node, ...this.entries.children(node.uid)];
        const readable = target.filter((n) => this.fs.acl.canRead(actor, n));
        if (!readable.length) throw notFound('no_entry', 'There is nothing there you may read.');
        return this._multistatus(actor, readable);
    }

    async get (actor, path) {
        const node = this.fs.resolve(actor, path, { mustExist: true });
        if (node.type === 'dir') {
            return { directory: true, listing: this.entries.children(node.uid).map((c) => ({
                name: c.name, type: c.type, size: c.size || 0, modified: c.modified,
            })) };
        }
        const buffer = await this.entries.readBytes(node);
        return { buffer: buffer || Buffer.alloc(0), mime: node.mime || mimeOf(node.name), node };
    }

    async put (actor, path, buffer, mime) {
        /* Real bytes, not a base64 string: a file put here has to be readable
           by the hosted site, by `cat`, and by the desktop, all of which expect
           the bytes the client sent. */
        return this.fs.writeBytes(actor, path, buffer,
            mime || mimeOf(baseName(path), 'application/octet-stream'), { createParents: true });
    }

    async mkcol (actor, path) {
        const existing = this.fs.resolve(actor, path);
        if (existing) throw badRequest('already_exists', 'That is already there.');
        return this.fs.mkdir(actor, path);
    }

    async delete (actor, path) {
        return this.fs.remove(actor, path, { recursive: true });
    }

    async move (actor, from, to) {
        return this.fs.move(actor, from, to);
    }

    async copy (actor, from, to) {
        return this.fs.copy(actor, from, to);
    }

    /* ---------------------------------- xml -------------------------------- */

    _multistatus (actor, nodes) {
        const parts = nodes.map((node) => {
            const nodePath = this.entries.pathOf(node);
            const isDir = node.type === 'dir';
            return '<d:response>' +
                `<d:href>${esc(this._href(nodePath))}</d:href>` +
                '<d:propstat><d:prop>' +
                (isDir ? '<d:resourcetype><d:collection/></d:resourcetype>' : '<d:resourcetype/>') +
                `<d:getcontentlength>${isDir ? 0 : (node.size || 0)}</d:getcontentlength>` +
                `<d:getcontenttype>${esc(isDir ? 'httpd/unix-directory' : (node.mime || mimeOf(node.name)))}</d:getcontenttype>` +
                `<d:getlastmodified>${httpDate(node.modified)}</d:getlastmodified>` +
                `<d:displayname>${esc(node.name || '/')}</d:displayname>` +
                `<d:getetag>"${esc(node.uid)}"</d:getetag>` +
                '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>' +
                '</d:response>';
        });
        return '<?xml version="1.0" encoding="utf-8"?>\n' +
            `<d:multistatus xmlns:d="${DAV_NS}">${parts.join('')}</d:multistatus>`;
    }

    _href (nodePath) {
        const mount = this.config.webdav.mountPath;
        return nodePath === '/' ? mount + '/' : mount + nodePath;
    }

    /** A directory listing, for a plain GET on a folder (browsers do this). */
    htmlListing (actor, path, listing) {
        const rows = listing.map((e) => `<li><a href="${esc(encodeURIComponent(e.name))}${e.type === 'dir' ? '/' : ''}">` +
            `${esc(e.name)}${e.type === 'dir' ? '/' : ''}</a> <span>${e.type === 'dir' ? '' : e.size}</span></li>`).join('\n');
        return `<!doctype html><meta charset="utf-8"><title>${esc(path)}</title>` +
            `<h1>${esc(path)}</h1><ul>${rows}</ul>` +
            `<p>Served from ${esc(this.config.name)} — a computer on this network.</p>`;
    }
}
