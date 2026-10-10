/**
 * Accounts.
 *
 * Puter separates the *user* (who somebody is) from their *drive* (what they
 * own) and from their *session* (where they are signed in). Same here: a row in
 * this table is a person, `rootUid` points at the root of the filesystem tree
 * that is theirs, and nothing else in the server keeps its own copy of a name.
 *
 * Standard accounts are whitelisted — only an administrator may add one — and
 * the administrator account itself is gated by the root password in ROOTPASS.md.
 * Passwords are scrypt-hashed with the parameters stored alongside the hash, so
 * raising the cost later does not invalidate every password on the machine.
 */
import { BaseStore } from '../lib/container.js';
import { forbidden, exists as existsErr, badRequest, notFound } from '../lib/errors.js';
import { hashPassword, uid as newUid, verifyPassword } from '../lib/util.js';

const USERNAME = /^[A-Za-z0-9][A-Za-z0-9._-]{1,23}$/;

const RESERVED = new Set(['root', 'admin', 'administrator', 'guest', 'system',
    'nobody', 'daemon', 'mixt', 'puter', 'support', 'abuse', 'postmaster']);

export class UserStore extends BaseStore {
    static SERVICE_NAME = 'user';

    async _init () {
        this.t = this.db.table('users');
        /* The administrator account, seeded from the root password. Without it a
           fresh machine has no way to make the first account, and the console
           that creates accounts is the one thing only an administrator sees. */
        const root = this.t.findOne((u) => u.username === this.config.rootUser);
        if (!root) {
            const created = this.t.insert({
                username: this.config.rootUser,
                displayName: this.config.rootUser,
                role: 'admin',
                hash: hashPassword(this.config.rootPassword),
                mailbox: true,
                rootUid: null,
            });
            this.rootUid = created.uid;
            this.t.update((u) => u.uid === created.uid, {});
            this.db.dirty();
        }
        /* The root password in ROOTPASS.md is the account's password, not a
           one-time seed: editing the file and restarting changes it. */
        const admin = this.t.findOne((u) => u.role === 'admin');
        if (admin) {
            this.t.update((u) => u.uid === admin.uid, { rootPasswordSource: true });
        }
    }

    /* ------------------------------- reading ------------------------------- */

    byUsername (username) {
        const name = String(username || '').trim().toLowerCase();
        return this.t.findOne((u) => String(u.username).toLowerCase() === name);
    }

    byId (id) { return this.t.findOne((u) => u.uid === id); }

    list () { return this.t.all().sort((a, b) => String(a.username).localeCompare(String(b.username))); }

    admins () { return this.t.find((u) => u.role === 'admin'); }

    count () { return this.t.count(); }

    /** What the desktop and the console may see. Never the hash. */
    toPublic (user) {
        if (!user) return null;
        return {
            username: user.username,
            displayName: user.displayName || user.username,
            role: user.role,
            mailbox: user.mailbox !== false,
            created: user.created,
            lastLogin: user.lastLogin || null,
            uid: user.uid,
            rootUid: user.rootUid,
            disabled: !!user.disabled,
        };
    }

    /* ------------------------------- writing ------------------------------- */

    validateUsername (username) {
        const name = String(username || '').trim();
        if (!USERNAME.test(name)) {
            throw badRequest('bad username',
                'Usernames are 2-24 letters, digits, dot, dash or underscore, and start with a letter or a digit.');
        }
        if (RESERVED.has(name.toLowerCase())) {
            throw badRequest('bad username', `${name} is a reserved name on this computer.`);
        }
        return name;
    }

    /**
     * Create an account. Only an administrator may, unless signup is switched
     * on in server.config.json — this machine is a computer for the people in
     * the building, not a website with a registration form.
     */
    create ({ username, password, role = 'user', displayName, mailbox = true, actor = null }) {
        const name = this.validateUsername(username);
        if (this.byUsername(name)) throw existsErr('exists', 'That username already exists.');
        if (role === 'admin' && actor && actor.role !== 'admin') {
            throw forbidden('forbidden', 'Only an administrator may make another administrator.');
        }
        if (!actor && !this.config.allowSignup && role !== 'admin') {
            throw forbidden('no_signup',
                'This computer is not taking new accounts. Ask the administrator to add you.');
        }
        if (!password && role !== 'admin') {
            throw badRequest('no_password', 'An account needs a password.');
        }
        const record = this.t.insert({
            username: name,
            displayName: displayName || name,
            role,
            hash: hashPassword(password || this.config.rootPassword),
            mailbox,
            rootUid: null,
            createdBy: actor?.username || null,
        });
        this.db.dirty();
        return record;
    }

    checkPassword (user, password) {
        if (!user) return false;
        if (user.disabled) return false;
        return verifyPassword(password, user.hash);
    }

    setPassword (user, password) {
        this.t.update((u) => u.uid === user.uid, { hash: hashPassword(password) });
        return true;
    }

    update (user, patch) {
        this.t.update((u) => u.uid === user.uid, patch);
        return this.byId(user.uid);
    }

    /** Attach the account's filesystem root. Done once, by the filesystem service. */
    attachRoot (user, rootUid) {
        this.t.update((u) => u.uid === user.uid, { rootUid });
        return rootUid;
    }

    /**
     * Delete an account.
     *
     * Refuses to remove the last administrator (a machine with nobody in charge
     * is a machine nobody can fix) and refuses to let somebody delete the
     * account they are using — that is a lockout, not a logout.
     */
    remove (user, { actor = null } = {}) {
        if (!user) throw notFound('no_user', 'There is no such account.');
        if (actor && actor.uid === user.uid) {
            throw badRequest('you cannot remove your own account', 'You cannot remove your own account.');
        }
        if (user.role === 'admin' && this.admins().length <= 1) {
            throw badRequest('that is the only administrator', 'That is the only administrator account.');
        }
        this.t.remove((u) => u.uid === user.uid);
        return true;
    }
}

export { newUid };
