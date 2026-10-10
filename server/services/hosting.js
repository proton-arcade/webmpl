/**
 * Hosting.
 *
 * A folder in somebody's filesystem can be published as a website and served
 * from this machine at `/site/<name>/`. It is the same idea as Puter's static
 * hosting — a directory is a site — with the part that matters for a machine on
 * a LAN: the site is served by this computer and reaches exactly as far as this
 * computer does.
 *
 * The default account ships `/srv/www`, which is why there is something to
 * publish the moment you look.
 */
import { BaseService } from '../lib/container.js';
import { badRequest, exists as existsErr, forbidden, notFound } from '../lib/errors.js';
import { join, normalizePath } from '../lib/util.js';

const NS = 'hosting';

export class HostingService extends BaseService {
    static SERVICE_NAME = 'hosting';
    static DEPENDENCIES = ['fs'];

    async _init () {
        this.kv = this.stores.get('kv');
        this.fs = this.services.get('fs');
        this.users = this.stores.get('user');
        this.events = this.services.get('events');
    }

    _all () { return this.kv.get('system', NS, {}) || {}; }

    _save (all) { this.kv.set('system', NS, all); }

    list () {
        return Object.entries(this._all()).map(([name, site]) => ({
            name, path: site.path, owner: site.owner, created: site.created,
            url: `/site/${name}/`,
        }));
    }

    /**
     * Publish a directory.
     *
     * The name is checked against the sites already published by *anybody*,
     * because two sites that answer to the same address is a machine that
     * cannot be browsed.
     */
    publish (actor, { name, path: dir }) {
        if (!actor || actor.guest) throw forbidden('forbidden', 'A guest cannot publish on this computer.');
        const clean = String(name || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
        if (!clean) throw badRequest('bad_name', 'A site needs a name made of letters, digits and dashes.');
        const all = this._all();
        if (all[clean]) throw existsErr('already_published', `${clean} is already published on this computer.`);
        const dirPath = normalizePath(dir || '/srv/www', '/home/mixt', '/home/mixt');
        const node = this.fs.resolve(actor, dirPath, { mustExist: true });
        if (node.type !== 'dir') throw badRequest('not_a_directory', 'Only a directory can be published.');
        all[clean] = { path: dirPath, owner: actor.username, ownerUid: actor.uid, created: Date.now() };
        this._save(all);
        this.events?.publish?.('hosting.published', { name: clean, path: dirPath, owner: actor.username },
            { actor: actor.username, scope: 'admins', audit: true });
        return { name: clean, path: dirPath, url: `/site/${clean}/` };
    }

    unpublish (actor, name) {
        const all = this._all();
        const site = all[name];
        if (!site) throw notFound('no_site', `Nothing is published as ${name}.`);
        if (actor?.role !== 'admin' && site.owner !== actor?.username) {
            throw forbidden('forbidden', 'That site belongs to somebody else.');
        }
        delete all[name];
        this._save(all);
        return true;
    }

    /** The site that answers for a name, if there is one. */
    site (name) { return this._all()[name] || null; }

    /**
     * Resolve a path inside a published site to a file the server may read.
     *
     * The site belongs to whoever published it, so the read is done as an
     * administrator-shaped actor — the file is theirs, and the point of
     * publishing it is that other people can read it. Traversal upwards is
     * refused before anything is looked up.
     */
    async resolveFile (site, relPath) {
        const ownerUid = site.ownerUid;
        const clean = String(relPath || '').replace(/\.\./g, '');
        const full = join(site.path, clean === '' ? 'index.html' : clean);
        const node = this.fs.entries.resolve(ownerUid, full);
        if (!node || node.type !== 'file') return null;
        return { node, ownerUid, path: full };
    }
}
