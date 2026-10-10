/**
 * Applications: the catalogue, the queue, and what each account has installed.
 *
 * Publishing an app puts real code on this machine, which is why it goes into a
 * queue for the administrator rather than straight onto everybody's menu. The
 * administrator's own publications are trusted immediately — the person who can
 * create accounts can publish an app — and everybody else's wait in the
 * console until somebody approves them.
 */
import { BaseService } from '../lib/container.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';

export class AppService extends BaseService {
    static SERVICE_NAME = 'apps';
    static DEPENDENCIES = [];

    async _init () {
        this.apps = this.stores.get('app');
        this.kv = this.stores.get('kv');
        this.users = this.stores.get('user');
        this.events = this.services.get('events');
    }

    /* -------------------------------- catalogue ---------------------------- */

    /** What an account may see: approved apps, plus their own in the queue. */
    list (actor) {
        if (!actor) return [];
        const approved = this.apps.list({ approvedOnly: true }).map((a) => this.apps.toPublic(a));
        if (actor.role === 'admin') {
            const pending = this.apps.list({ status: 'pending' }).map((a) => this.apps.toPublic(a));
            return [...approved, ...pending];
        }
        const mine = this.apps.list()
            .filter((a) => a.author === actor.username)
            .map((a) => this.apps.toPublic(a));
        const seen = new Set(approved.map((a) => a.id));
        return [...approved, ...mine.filter((a) => !seen.has(a.id))];
    }

    /** The queue, for the console. Administrator only. */
    pending (actor) {
        if (!actor || actor.role !== 'admin') return null;
        return this.apps.list({ status: 'pending' }).map((a) => this.apps.toPublic(a, { withCode: true }));
    }

    /**
     * Publish an app.
     *
     * An app with no code is not an app, and an app that cannot be started is
     * a menu entry that lies, so the code is required and it is what runs.
     */
    publish (actor, { name, code, manifest = {}, approved = null }) {
        if (!actor) throw forbidden('forbidden', 'Sign in first.');
        if (actor.guest) throw forbidden('forbidden', 'A guest cannot publish to this computer.');
        const auto = approved === true && actor.role === 'admin';
        const app = this.apps.create({
            name, code, manifest,
            author: actor.username,
            ownerUid: actor.uid,
            approved: auto,
        });
        this.events?.publish?.('app.published', {
            id: app.id, name: app.name, author: app.author, status: app.status,
        }, { actor: actor.username, scope: 'admins', audit: true });
        return this.apps.toPublic(app);
    }

    approve (actor, id) {
        this._requireAdmin(actor);
        const app = this.apps.approve(id, actor.username);
        this.events?.publish?.('app.approved', { id, name: app.name, by: actor.username },
            { actor: actor.username, scope: 'admins', audit: true });
        return this.apps.toPublic(app);
    }

    reject (actor, id, reason = null) {
        this._requireAdmin(actor);
        const app = this.apps.reject(id, actor.username, reason);
        this.events?.publish?.('app.rejected', { id, name: app.name, by: actor.username, reason },
            { actor: actor.username, scope: 'admins', audit: true });
        return this.apps.toPublic(app);
    }

    remove (actor, id) {
        this._requireAdmin(actor);
        const app = this.apps.byId(id);
        if (!app) throw notFound('no_app', 'There is no such application.');
        this.apps.remove(id);
        return true;
    }

    /** The code, for the desktop that is about to run it. */
    codeFor (actor, id) {
        const app = this.apps.byId(id);
        if (!app) throw notFound('no_app', 'There is no such application.');
        if (app.status !== 'approved' && actor?.role !== 'admin' && app.author !== actor?.username) {
            throw forbidden('forbidden', 'That application is not published yet.');
        }
        return app.code;
    }

    /* -------------------------------- installed ---------------------------- */

    /**
     * What this account has installed.
     *
     * Kept per account rather than per machine: two people on the same computer
     * do not have to want the same programs, and an account's settings should
     * follow it to whichever browser it signs in from.
     */
    installed (actor) {
        if (!actor || actor.guest) return [];
        return this.apps.installedFor(actor.uid);
    }

    install (actor, id) {
        if (!actor) throw forbidden('forbidden', 'Sign in first.');
        if (actor.guest) throw badRequest('guest', 'A guest cannot install applications.');
        const app = this.apps.byId(id);
        if (!app) throw notFound('no_app', 'There is no such application.');
        if (app.status !== 'approved') throw forbidden('not_published', 'That application is waiting for approval.');
        this.apps.install(actor.uid, id);
        return this.installed(actor);
    }

    uninstall (actor, id) {
        if (!actor) return [];
        this.apps.uninstall(actor.uid, id);
        return this.installed(actor);
    }

    _requireAdmin (actor) {
        if (!actor || actor.role !== 'admin') {
            throw forbidden('forbidden', 'Only the administrator can do that.');
        }
    }
}
