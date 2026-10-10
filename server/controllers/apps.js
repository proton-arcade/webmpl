/**
 * The application catalogue, over HTTP.
 *
 * Publishing puts real code on this machine, so it goes into a queue for the
 * administrator: `/api/apps` accepts it, and it does not appear on anybody's
 * menu until `/api/apps/:id/approve` is called by an account that is allowed to
 * call it. The administrator's own publications skip the queue — the person who
 * can create accounts can publish an app.
 */
import { BaseController } from '../lib/container.js';

export class AppController extends BaseController {
    static SERVICE_NAME = 'apps';

    async _init () { this.apps = this.services.get('apps'); }

    list (ctx) {
        const actor = ctx.require();
        return this.apps.list(actor);
    }

    pending (ctx) {
        const actor = ctx.require();
        const queue = this.apps.pending(actor);
        if (!queue) return [];
        return queue;
    }

    publish (ctx) {
        const actor = ctx.require();
        const { name, code, manifest, approved } = ctx.body || {};
        const app = this.apps.publish(actor, { name, code, manifest, approved });
        return { ok: true, app };
    }

    approve (ctx) {
        const actor = ctx.require();
        return { ok: true, app: this.apps.approve(actor, ctx.params.id) };
    }

    reject (ctx) {
        const actor = ctx.require();
        const reason = (ctx.body || {}).reason || null;
        return { ok: true, app: this.apps.reject(actor, ctx.params.id, reason) };
    }

    remove (ctx) {
        const actor = ctx.require();
        this.apps.remove(actor, ctx.params.id);
        return { ok: true };
    }

    code (ctx) {
        const actor = ctx.require();
        return { ok: true, id: ctx.params.id, code: this.apps.codeFor(actor, ctx.params.id) };
    }

    install (ctx) {
        const actor = ctx.require();
        return { ok: true, installed: this.apps.install(actor, ctx.params.id) };
    }

    uninstall (ctx) {
        const actor = ctx.require();
        return { ok: true, installed: this.apps.uninstall(actor, ctx.params.id) };
    }
}
