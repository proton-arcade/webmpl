/**
 * Mail, over HTTP.
 *
 * Every route here is local. A message is a row in a table on this machine, at
 * one of two invented domains, and no socket is opened to deliver it — the mail
 * a local network carries is mail that stays on it.
 */
import { BaseController } from '../lib/container.js';
import { addressOf } from '../services/mailaddr.js';

export class MailController extends BaseController {
    static SERVICE_NAME = 'mail';

    async _init () { this.mail = this.services.get('mail'); }

    /** This session's mailbox. Empty (not an error) when it has none. */
    list (ctx) {
        const actor = ctx.require();
        return this.mail.list(actor, { folder: ctx.query.folder || null }) ?? [];
    }

    address (ctx) {
        const actor = ctx.require();
        const key = this.mail.mailboxFor(actor);
        return { ok: true, address: key ? addressOf(key) : null, mailbox: key };
    }

    unread (ctx) {
        const actor = ctx.require();
        return { ok: true, unread: this.mail.unread(actor) };
    }

    send (ctx) {
        const actor = ctx.require();
        const { to, subject, body } = ctx.body || {};
        const sent = this.mail.send(actor, { to, subject, body });
        return { ok: true, id: sent.id, to: sent.to };
    }

    update (ctx) {
        const actor = ctx.require();
        return { ok: true, message: this.mail.update(actor, ctx.params.id, ctx.body || {}) };
    }

    remove (ctx) {
        const actor = ctx.require();
        this.mail.remove(actor, ctx.params.id);
        return { ok: true };
    }

    empty (ctx) {
        const actor = ctx.require();
        return { ok: true, removed: this.mail.empty(actor, (ctx.body || {}).folder || ctx.query.folder || null) };
    }

    /** Every mailbox on the machine. Administrator only. */
    mailboxes (ctx) {
        const actor = ctx.require();
        return this.mail.adminMailboxes(actor) ?? [];
    }
}
