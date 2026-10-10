/**
 * Hosting, over HTTP.
 *
 * A directory in somebody's filesystem becomes a website at `/site/<name>/`,
 * served by this machine and reachable by anything on the same network. The
 * files are read through the filesystem service as their owner, which is the
 * point: publishing a folder is a decision to let people read it, and it does
 * not quietly hand out the rest of the account.
 */
import { BaseController } from '../lib/container.js';
import { notFound } from '../lib/errors.js';
import { reply } from '../lib/http.js';
import { mimeOf } from '../lib/util.js';

export class HostingController extends BaseController {
    static SERVICE_NAME = 'hosting';

    async _init () {
        this.hosting = this.services.get('hosting');
        this.fs = this.services.get('fs');
    }

    list (ctx) {
        void ctx;
        return this.hosting.list();
    }

    publish (ctx) {
        const actor = ctx.require();
        const { name, path } = ctx.body || {};
        return { ok: true, ...this.hosting.publish(actor, { name, path }) };
    }

    unpublish (ctx) {
        const actor = ctx.require();
        this.hosting.unpublish(actor, ctx.params.name);
        return { ok: true };
    }

    /**
     * Serve a published site.
     *
     * `/site/<name>/<anything>` reads from the folder that was published and
     * nowhere else: the name has to match a published site, `..` is stripped
     * before the path is looked up, and the read is done with the publisher's
     * permissions on their own files.
     */
    async serve (ctx) {
        if (!this.config.hosting.enabled) throw notFound('no_site', 'Nothing is hosted here.');
        const rest = String(ctx.params.rest || '');
        const slash = rest.indexOf('/');
        const name = (slash < 0 ? rest : rest.slice(0, slash)).toLowerCase();
        const inner = slash < 0 ? 'index.html' : rest.slice(slash + 1);
        const site = this.hosting.site(name);
        if (!site) throw notFound('no_site', `Nothing is published as "${name}" on this computer.`);

        let found = await this.hosting.resolveFile(site, inner);
        if (!found) {
            /* A directory URL (`/site/x/`) falls back to index.html inside it,
               and then to a listing of what the site holds. */
            found = await this.hosting.resolveFile(site, inner.replace(/\/$/, '') + '/index.html');
        }
        if (!found) {
            const asDirectory = inner.endsWith('/') ? inner : inner + '/';
            const listing = await this.listDirectory(site, asDirectory);
            if (!listing) throw notFound('no_file', 'There is no such file in that site.');
            return reply(listing, { type: 'text/html; charset=utf-8' });
        }
        const buffer = await this.fs.entries.readBytes(found.node);
        if (buffer === null) throw notFound('no_file', 'There is no such file in that site.');
        return reply(buffer, { type: found.node.mime || mimeOf(found.node.name) });
    }

    async listDirectory (site, relPath) {
        const clean = String(relPath || '').replace(/\.\./g, '');
        const node = this.fs.entries.resolve(site.ownerUid, clean === '/' || clean === '' ? site.path : site.path + clean.replace(/\/$/, ''));
        if (!node || node.type !== 'dir') return null;
        const children = this.fs.entries.children(node.uid);
        const rows = children.map((c) =>
            `<li><a href="${encodeURIComponent(c.name)}${c.type === 'dir' ? '/' : ''}">${c.name}${c.type === 'dir' ? '/' : ''}</a></li>`)
            .join('\n');
        return `<!doctype html><meta charset="utf-8"><title>${site.name ?? 'site'}</title>` +
            `<h1>/site/${site.name ?? ''}/</h1><ul>${rows || '<li>(empty)</li>'}</ul>` +
            `<p>Served by ${this.config.name} — a computer on this network.</p>`;
    }
}
