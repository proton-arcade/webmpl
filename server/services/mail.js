/**
 * Mail.
 *
 * A mailbox per account, and one per guest when the administrator switches
 * guest mail on. Sending writes a row into the recipient's mailbox and tells
 * their desktop; nothing is relayed, nothing is resolved, and no connection is
 * made to another machine — the mail a local network carries is mail that
 * stays on it.
 */
import { BaseService } from '../lib/container.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { addressOf, mailboxKeyFor, resolveAddress } from './mailaddr.js';

export class MailService extends BaseService {
    static SERVICE_NAME = 'mail';
    static DEPENDENCIES = [];

    async _init () {
        this.m = this.stores.get('mail');
        this.users = this.stores.get('user');
        this.kv = this.stores.get('kv');
        this.events = this.services.get('events');
    }

    /* -------------------------------- flags -------------------------------- */

    get guestMailbox () { return this.kv.get('system', 'guestMailbox', false) === true; }

    setGuestMailbox (actor, on) {
        if (!actor || actor.role !== 'admin') throw forbidden('forbidden', 'Only the administrator can do that.');
        this.kv.set('system', 'guestMailbox', !!on);
        return this.guestMailbox;
    }

    /* ------------------------------- addresses ----------------------------- */

    /** The mailbox this session uses, or null when it has none. */
    mailboxFor (actor) { return mailboxKeyFor(actor, { guestMailbox: this.guestMailbox }); }

    addressFor (actor) {
        const key = this.mailboxFor(actor);
        return key ? addressOf(key) : null;
    }

    /** Attach the mailbox to the actor so everything downstream agrees. */
    bind (actor) {
        if (!actor) return actor;
        actor.mailboxKey = this.mailboxFor(actor);
        actor.mailAddress = actor.mailboxKey ? addressOf(actor.mailboxKey) : null;
        return actor;
    }

    /* -------------------------------- reading ------------------------------ */

    list (actor, { folder = null } = {}) {
        const key = this.mailboxFor(actor);
        if (!key) return null; // no mailbox: not an error, just nothing to show
        return this.m.box(key, { folder });
    }

    unread (actor) {
        const key = this.mailboxFor(actor);
        return key ? this.m.unread(key) : 0;
    }

    /* -------------------------------- sending ------------------------------ */

    /**
     * Send a message to another account on this machine.
     *
     * The sender's own copy goes to their Sent folder, which is what makes a
     * reply possible later: mail that only exists on the receiving end is mail
     * you cannot look back at.
     */
    send (actor, { to, subject, body, toName = null }) {
        const fromKey = this.mailboxFor(actor);
        if (!fromKey) throw forbidden('no_mailbox', 'This session has no mailbox on this computer.');
        const resolved = resolveAddress(to, { users: this.users, guestMailbox: this.guestMailbox });
        if (!resolved.key) {
            /* 403 is "here, but their mailbox is switched off"; 404 is "there is
               nobody by that name". Kept apart on purpose — see mailaddr.js. */
            throw resolved.status === 403
                ? forbidden('no_mailbox', resolved.error)
                : notFound('no_recipient', resolved.error);
        }
        if (resolved.key === fromKey && !toName) {
            throw badRequest('to_yourself', 'That is your own mailbox.');
        }
        const message = {
            from: addressOf(fromKey),
            fromName: actor.displayName || actor.username,
            to: addressOf(resolved.key),
            subject: String(subject || '').slice(0, 300) || '(no subject)',
            body: String(body || ''),
        };
        const delivered = this.m.deliver({ ...message, mailbox: resolved.key, folder: 'Inbox' });
        const copy = this.m.deliver({ ...message, mailbox: fromKey, folder: 'Sent', read: true });
        this.events?.publish?.('mail.arrived', {
            id: delivered.id,
            mailbox: resolved.key,
            from: message.from,
            fromName: message.fromName,
            subject: message.subject,
            preview: String(message.body).slice(0, 120),
        }, {
            actor: actor.username,
            scope: 'mailbox',
            mailbox: resolved.key,
            audit: false,
        });
        return { id: delivered.id, to: message.to, sentId: copy.id };
    }

    /* ------------------------------- updating ------------------------------ */

    _message (actor, id) {
        const key = this.mailboxFor(actor);
        if (!key) throw notFound('no_message', 'There is no such message.');
        const message = this.m.byId(key, id);
        if (!message) throw notFound('no_message', 'There is no such message.');
        return { key, message };
    }

    update (actor, id, patch) {
        const { key } = this._message(actor, id);
        return this.m.update(key, id, patch);
    }

    remove (actor, id) {
        const { key } = this._message(actor, id);
        return this.m.remove(key, id);
    }

    empty (actor, folder) {
        const key = this.mailboxFor(actor);
        if (!key) return 0;
        return this.m.empty(key, folder);
    }

    /* ------------------------------ administration ------------------------- */

    setMailbox (actor, username, on) {
        if (!actor || actor.role !== 'admin') throw forbidden('forbidden', 'Only the administrator can do that.');
        if (String(username).toLowerCase() === 'guest') return this.setGuestMailbox(actor, on);
        const user = this.users.byUsername(username);
        if (!user) throw notFound('no_user', `There is no account called ${username}.`);
        this.users.update(user, { mailbox: !!on });
        return !!on;
    }

    adminMailboxes (actor) {
        if (!actor || actor.role !== 'admin') return null;
        return this.m.mailboxes().map((box) => ({ ...box, address: addressOf(box.key) }));
    }

    report () {
        return { mailboxes: this.m.mailboxes(), messages: this.m.count(), guestMailbox: this.guestMailbox };
    }
}
