/**
 * Mail, on this machine.
 *
 * There is no relay here and no socket is ever opened to deliver anything.
 * Mail is a table of messages between mailboxes that exist only on this
 * computer, at two invented domains that do not resolve in DNS:
 *
 *   a whitelisted account   name@proper.com
 *   a guest                 NAME@Guest.MPL
 *
 * That is the point rather than a limitation — the machine is a local network,
 * and the mail a local network carries is mail that never leaves it.
 */
import { BaseStore } from '../lib/container.js';
import { notFound } from '../lib/errors.js';
import { slug } from '../lib/util.js';

const FOLDERS = ['Inbox', 'Sent', 'Drafts', 'Archive', 'Trash'];

export class MailStore extends BaseStore {
    static SERVICE_NAME = 'mail';

    async _init () {
        this.t = this.db.table('mail');
        this.folders = FOLDERS;
    }

    /** Every message in a mailbox. `key` is the account's username, or
        `guest:<name>` for a guest with a mailbox. */
    box (key, { folder = null } = {}) {
        return this.t.find((m) => m.mailbox === key && (folder ? m.folder === folder : true))
            .sort((a, b) => b.date - a.date);
    }

    byId (key, id) {
        return this.t.findOne((m) => m.mailbox === key && m.id === id);
    }

    /**
     * Deliver one message into one mailbox.
     *
     * Returns the stored message. A delivery is not "sent" in any sense a mail
     * server would use the word: the row is written and the recipient's
     * desktop is told, and nothing goes anywhere.
     */
    deliver ({ mailbox, from, fromName, to, subject, body, folder = 'Inbox', labels = [] }) {
        const message = this.t.insert({
            id: slug(10),
            mailbox,
            from,
            fromName: fromName || from,
            to,
            subject: subject || '(no subject)',
            body: body || '',
            folder: FOLDERS.includes(folder) ? folder : 'Inbox',
            read: false,
            starred: false,
            labels: Array.isArray(labels) ? labels : [],
            date: Date.now(),
        });
        return message;
    }

    update (key, id, patch) {
        const message = this.byId(key, id);
        if (!message) throw notFound('no_message', 'There is no such message.');
        const allowed = {};
        for (const field of ['folder', 'read', 'starred', 'labels', 'subject', 'body']) {
            if (patch[field] !== undefined) allowed[field] = patch[field];
        }
        if (allowed.folder && !FOLDERS.includes(allowed.folder)) delete allowed.folder;
        this.t.update((m) => m.mailbox === key && m.id === id, allowed);
        return this.byId(key, id);
    }

    remove (key, id) {
        return this.t.remove((m) => m.mailbox === key && m.id === id) > 0;
    }

    empty (key, folder) {
        return this.t.remove((m) => m.mailbox === key && (folder ? m.folder === folder : true));
    }

    unread (key) { return this.t.count((m) => m.mailbox === key && m.folder === 'Inbox' && !m.read); }

    count () { return this.t.count(); }

    /** Every mailbox with something in it, for the console. */
    mailboxes () {
        const keys = new Set(this.t.all().map((m) => m.mailbox));
        return [...keys].map((k) => ({ key: k, messages: this.t.count((m) => m.mailbox === k), unread: this.unread(k) }));
    }
}
