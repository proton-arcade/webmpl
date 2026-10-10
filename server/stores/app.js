/**
 * Applications and what each account has installed.
 *
 * An app here is a real thing with code behind it: a name, a manifest, and the
 * `main.js` that starts it. Publishing one puts it in a queue for the
 * administrator (unless the administrator publishes it, which goes straight
 * out), and installing one is per account — two people on the same machine do
 * not have to want the same programs.
 */
import { BaseStore } from '../lib/container.js';
import { notFound, badRequest } from '../lib/errors.js';
import { slug } from '../lib/util.js';

export class AppStore extends BaseStore {
    static SERVICE_NAME = 'app';

    async _init () {
        this.t = this.db.table('apps');
        this.installs = this.db.table('installs');
    }

    /* -------------------------------- catalogue ---------------------------- */

    list ({ status = null, approvedOnly = false } = {}) {
        return this.t.all()
            .filter((a) => (approvedOnly ? a.status === 'approved' : true))
            .filter((a) => (status ? a.status === status : true))
            .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }

    byId (id) { return this.t.findOne((a) => a.id === id); }
    byUid (uid) { return this.t.findOne((a) => a.uid === uid); }
    byName (name) {
        const n = String(name || '').toLowerCase();
        return this.t.findOne((a) => String(a.name).toLowerCase() === n);
    }

    /**
     * Publish an app.
     *
     * An app with no code is not an app — it is a name — so the code is
     * required, and it is what the desktop actually runs when the app is
     * launched from the menu.
     */
    create ({ name, code, manifest = {}, author = null, ownerUid = null, approved = false }) {
        const clean = String(name || '').trim();
        if (!clean) throw badRequest('no_name', 'An application needs a name.');
        if (!code || !String(code).trim()) {
            throw badRequest('no_code', 'An application needs its code — that is what runs.');
        }
        const id = this._freeId(clean);
        const record = this.t.insert({
            id,
            name: clean,
            code: String(code),
            manifest: typeof manifest === 'string' ? tryParse(manifest, {}) : manifest,
            author: author || 'unknown',
            ownerUid: ownerUid || null,
            status: approved ? 'approved' : 'pending',
            approvedBy: approved ? author : null,
            approvedAt: approved ? Date.now() : null,
        });
        return record;
    }

    _freeId (name) {
        const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app';
        let id = base;
        if (id.length > 32) id = id.slice(0, 32);
        while (this.byId(id)) id = `${base}-${slug(3)}`;
        return id;
    }

    approve (id, by) {
        const app = this.byId(id);
        if (!app) throw notFound('no_app', 'There is no such application.');
        this.t.update((a) => a.uid === app.uid, {
            status: 'approved', approvedBy: by || null, approvedAt: Date.now(),
        });
        return this.byId(id);
    }

    reject (id, by, reason = null) {
        const app = this.byId(id);
        if (!app) throw notFound('no_app', 'There is no such application.');
        this.t.update((a) => a.uid === app.uid, {
            status: 'rejected', approvedBy: by || null, approvedAt: Date.now(), rejectionReason: reason,
        });
        return this.byId(id);
    }

    remove (id) {
        const app = this.byId(id);
        if (!app) throw notFound('no_app', 'There is no such application.');
        this.t.remove((a) => a.uid === app.uid);
        /* An uninstalled app's installs would otherwise be orphaned rows that
           make the menu claim an app is installed when it is gone. */
        this.installs.remove((i) => i.appId === app.id);
        return true;
    }

    /* -------------------------------- installed ---------------------------- */

    installedFor (userId) {
        return this.installs.find((i) => i.userId === userId).map((i) => i.appId);
    }

    install (userId, appId) {
        const app = this.byId(appId);
        if (!app) throw notFound('no_app', 'There is no such application.');
        if (this.installs.findOne((i) => i.userId === userId && i.appId === appId)) return true;
        this.installs.insert({ userId, appId, installedAt: Date.now() });
        return true;
    }

    uninstall (userId, appId) {
        return this.installs.remove((i) => i.userId === userId && i.appId === appId) > 0;
    }

    countInstalls (appId) { return this.installs.count((i) => i.appId === appId); }

    /** What an API client is allowed to see. The code goes to the desktop that
        is about to run it, and to nobody else's listing. */
    toPublic (app, { withCode = false } = {}) {
        if (!app) return null;
        return {
            id: app.id,
            uid: app.uid,
            name: app.name,
            author: app.author,
            status: app.status,
            manifest: app.manifest || {},
            created: app.created,
            approvedAt: app.approvedAt || null,
            rejectionReason: app.rejectionReason || null,
            installs: this.countInstalls(app.id),
            ...(withCode ? { code: app.code } : {}),
        };
    }
}

function tryParse (text, fallback) {
    try { return JSON.parse(text); } catch { return fallback; }
}
