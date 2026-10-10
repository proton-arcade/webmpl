/**
 * Signing in and out, accounts, and what an account has saved.
 *
 * These are the routes the desktop's `src/os/api.ts` already spoke, kept in the
 * same shapes: the same answers, now coming from a real accounts table, a real
 * session store and real per-account storage instead of one JSON file. The
 * scripts that check the shipped bundle against a backend (`npm run session`,
 * `npm run mail`) run against these routes unmodified.
 */
import { BaseController } from '../lib/container.js';
import { forbidden, notFound, unauthorized } from '../lib/errors.js';
import { ok } from '../lib/http.js';

export class AuthController extends BaseController {
    static SERVICE_NAME = 'auth';

    async _init () {
        this.auth = this.services.get('auth');
        this.mail = this.services.get('mail');
        this.kv = this.stores.get('kv');
        this.apps = this.services.get('apps');
    }

    /* --------------------------------- health ------------------------------ */

    health () {
        /* `online: true` means the server is here. It does not mean the
           Internet is here — this machine does not have the Internet, and the
           desktop is told so in the same answer. */
        return this.services.get('system').health();
    }

    /* -------------------------------- sessions ----------------------------- */

    async login (ctx) {
        const { username, password } = ctx.body || {};
        if (!username && !password) return this.guest(ctx);
        const { session, actor } = await this.auth.login({
            username, password, ip: ctx.ip, userAgent: ctx.headers['user-agent'],
        });
        return {
            ok: true,
            token: session.token,
            role: actor.role,
            username: actor.username,
            displayName: actor.displayName,
            guest: false,
        };
    }

    async guest (ctx) {
        const { username, name, password } = ctx.body || {};
        const { session, actor } = await this.auth.guest({
            username, name, password, ip: ctx.ip, userAgent: ctx.headers['user-agent'],
        });
        return {
            ok: true,
            token: session.token,
            role: 'guest',
            username: actor.username,
            name: actor.displayName,
            guest: true,
        };
    }

    async logout (ctx) {
        const actor = ctx.require();
        await this.auth.logout(actor);
        this.services.get('terminal').close(actor);
        return { ok: true, username: actor.username };
    }

    whoami (ctx) {
        const actor = ctx.require();
        return { ok: true, ...this.auth.whoami(actor) };
    }

    /** Who is signed in. Administrator only. */
    sessions (ctx) {
        const actor = ctx.require();
        const list = this.auth.sessionsListing(actor);
        if (!list) throw forbidden('forbidden', 'Only the administrator can see who is signed in.');
        return list;
    }

    /** Who has signed in as a guest. Administrator only. */
    guestLog (ctx) {
        const actor = ctx.require();
        const log = this.auth.guestLogins(actor);
        if (!log) throw forbidden('forbidden', 'Only the administrator can see the guest log.');
        return log;
    }

    /* -------------------------------- accounts ----------------------------- */

    users (ctx) {
        const actor = ctx.require();
        const list = this.auth.listUsers(actor);
        if (!list) throw forbidden('forbidden', 'Only the administrator can list the accounts.');
        return list;
    }

    async createUser (ctx) {
        const actor = ctx.require();
        const { username, password, role } = ctx.body || {};
        const user = await this.auth.createUser(actor, {
            username, password, role: role === 'admin' ? 'admin' : 'user',
        });
        return { ok: true, username: user.username, role: user.role };
    }

    async removeUser (ctx) {
        const actor = ctx.require();
        await this.auth.removeUser(actor, ctx.params.username);
        return { ok: true };
    }

    async setPassword (ctx) {
        const actor = ctx.require();
        await this.auth.setPassword(actor, ctx.params.username, (ctx.body || {}).password);
        return { ok: true };
    }

    setMailbox (ctx) {
        const actor = ctx.require();
        const on = (ctx.body || {}).on !== false;
        this.mail.setMailbox(actor, ctx.params.username, on);
        return { ok: true, mailbox: on };
    }

    /* -------------------------------- settings ----------------------------- */

    /**
     * What the desktop remembers for an account: the theme, the panel, the
     * wallpaper, the window sizes. Puter keeps the same idea in a KV store
     * scoped to the user, for the same reason — two people on one machine
     * should not be able to move each other's panel.
     */
    getSettings (ctx) {
        const actor = ctx.require();
        if (actor.guest) return {};
        return this.kv.get(actor.uid, 'settings', {}) ?? {};
    }

    putSettings (ctx) {
        const actor = ctx.require();
        /* A guest is never saved: the session is memory and that is the whole
           promise made when they were let in. */
        if (actor.guest) return { ok: true, saved: false };
        const value = ctx.body ?? {};
        this.kv.set(actor.uid, 'settings', value);
        this.services.get('events').publish('settings.changed', {}, {
            actor: actor.username, scope: 'private', ownerId: actor.ownerId,
        });
        return { ok: true, saved: true };
    }

    /* -------------------------------- installed ---------------------------- */

    installed (ctx) {
        const actor = ctx.require();
        return this.apps.installed(actor);
    }

    install (ctx) {
        const actor = ctx.require();
        return this.apps.install(actor, (ctx.body || {}).id || ctx.params.id);
    }

    uninstall (ctx) {
        const actor = ctx.require();
        return this.apps.uninstall(actor, (ctx.body || {}).id || ctx.params.id);
    }

    /* ------------------------------- statistics ---------------------------- */

    stats (ctx) {
        const actor = ctx.require();
        const stats = this.services.get('system').stats(actor);
        if (!stats) throw forbidden('forbidden', 'Only the administrator can see the machine statistics.');
        return stats;
    }

    storage (ctx) {
        const actor = ctx.require();
        return this.services.get('system').storage(actor);
    }

    async logs (ctx) {
        const actor = ctx.require();
        return await this.services.get('system').audit(actor, { lines: Number(ctx.query.lines || 200) });
    }
}

export { ok, notFound, unauthorized };
