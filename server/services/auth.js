/**
 * Signing in.
 *
 * Three kinds of session come out of here and they are not variations on a
 * theme:
 *
 *   administrator   the account in ROOTPASS.md. It is the only one that can
 *                   create accounts, approve apps, look at other people's files
 *                   through /users, and be given a shell on the host itself.
 *   user            a whitelisted account. It has a home directory that is
 *                   really on disk, a mailbox at name@proper.com, and settings
 *                   that follow it to any browser on the network.
 *   guest           let in without an account. Nothing is kept: the session is
 *                   in memory and the filesystem behind it is thrown away when
 *                   they sign out (and at boot, if the server was stopped
 *                   before they could).
 *
 * ROOTPASS.md is the source of truth for the administrator's password — edit
 * the file, restart, and it has changed — so the stored hash is refreshed from
 * it on every boot rather than the other way round.
 */
import { BaseService } from '../lib/container.js';
import { badRequest, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { addressOf, mailboxKeyFor } from './mailaddr.js';

export class AuthService extends BaseService {
    static SERVICE_NAME = 'auth';
    static DEPENDENCIES = ['fs'];

    async _init () {
        this.users = this.stores.get('user');
        this.sessions = this.stores.get('session');
        this.kv = this.stores.get('kv');
        this.fs = this.services.get('fs');
        this.events = this.services.get('events');
        /* The root password lives in a file a person can edit, and it wins. */
        const admin = this.users.admins()[0];
        if (admin) {
            this.users.setPassword(admin, this.config.rootPassword);
            await this.fs.ensureAccount(admin);
        }
        this.guestLog = [];
    }

    /* -------------------------------- actors ------------------------------- */

    /**
     * The actor behind a request.
     *
     * Everything else in the server is written against this shape, so there is
     * one place where "who is doing this" is decided, and one place to look
     * when it is decided wrongly.
     */
    actorFor (session) {
        if (!session) return null;
        const user = session.userId ? this.users.byId(session.userId) : null;
        const guest = !!session.guest;
        /* The mailbox rules live in one file (services/mailaddr.js) so this
           session, the mail app and the webmail site cannot disagree. */
        const mailboxKey = mailboxKeyFor({ guest, username: session.username, user }, {
            guestMailbox: this.kv.get('system', 'guestMailbox', false) === true,
        });
        return {
            uid: user?.uid || null,
            sessionId: session.uid,
            token: session.token,
            username: session.username,
            displayName: session.displayName || session.username,
            role: session.role,
            guest,
            session,
            user,
            /* What their files are stored under — a guest's is their session. */
            ownerId: guest ? `guest:${session.uid}` : (user?.uid || null),
            /* Their mailbox, from the one place those rules live, so the mail
               app, the webmail site and this session cannot disagree. */
            mailboxKey,
            mailAddress: addressOf(mailboxKey),
            ip: session.ip || null,
            isAdmin: session.role === 'admin',
        };
    }

    /**
     * An actor for a request that proved who it is without opening a session —
     * Basic auth, which is what every WebDAV client speaks. Same shape, same
     * permissions, no session row to expire.
     */
    actorForUser (user) {
        if (!user) return null;
        return this.actorFor({
            uid: `basic:${user.uid}`,
            token: null,
            userId: user.uid,
            username: user.username,
            displayName: user.displayName || user.username,
            role: user.role,
            guest: false,
        });
    }

    /** Basic auth: a username and password instead of a token. */
    byCredentials (username, password) {
        const user = this.users.byUsername(username);
        if (!user || !this.users.checkPassword(user, password)) return null;
        return this.actorForUser(user);
    }

    byToken (tokenValue) {
        const session = this.sessions.byToken(tokenValue);
        if (!session) return null;
        this.sessions.touch(session);
        return this.actorFor(session);
    }

    require (tokenValue) {
        const actor = this.byToken(tokenValue);
        if (!actor) throw unauthorized('no_session', 'That session has ended. Sign in again.');
        return actor;
    }

    /** Guests may not save anything, and the whole server agrees on that here. */
    canPersist (actor) { return !!actor && !actor.guest; }

    /* --------------------------------- login ------------------------------- */

    async login ({ username, password, ip = null, userAgent = null }) {
        const user = this.users.byUsername(username);
        if (!user || !this.users.checkPassword(user, password)) {
            this.events?.publish?.('user.login_failed', { username: String(username || '').slice(0, 64), ip },
                { actor: String(username || 'anonymous'), scope: 'admins' });
            throw unauthorized('wrong_credentials', 'Wrong username or password.');
        }
        const session = this.sessions.create({ user, ip, userAgent });
        this.users.update(user, { lastLogin: Date.now() });
        const actor = this.actorFor(session);
        await this.fs.ensureAccount(user);
        this.events?.publish?.('user.login', { username: user.username, role: user.role, ip },
            { actor: user.username, scope: 'admins', audit: true });
        return { session, actor };
    }

    /**
     * Sign in as a guest.
     *
     * A guest still says who they are, so the administrator's console shows
     * who has been using the machine rather than an anonymous extra session —
     * but no account is created and nothing is kept.
     */
    async guest ({ username = null, name = null, password = null, ip = null, userAgent = null } = {}) {
        if (!this.config.allowGuests) {
            throw forbidden('no_guests', 'This computer is not accepting guest sessions.');
        }
        const session = this.sessions.create({
            user: null, guest: true,
            name: name || username || null,
            username: username || null,
            ip, userAgent,
        });
        const actor = this.actorFor(session);
        await this.fs.ensureGuest(actor);
        this.guestLog.push({ username: session.username, name: session.displayName, at: Date.now(), ip });
        if (this.guestLog.length > 200) this.guestLog.shift();
        this.events?.publish?.('user.guest', { username: session.username, name: session.displayName, ip },
            { actor: session.username, scope: 'admins', audit: true });
        return { session, actor };
    }

    async logout (actor) {
        if (!actor) return false;
        this.sessions.destroy(actor.token);
        /* A guest's files go with them — that is the whole promise. */
        await this.fs.discard(actor);
        this.events?.publish?.('user.logout', { username: actor.username, guest: actor.guest },
            { actor: actor.username, scope: 'admins', audit: true });
        return true;
    }

    /* -------------------------------- accounts ----------------------------- */

    /**
     * Create an account. Administrator only — this machine is for the people in
     * the building, and the whitelist is how that stays true.
     */
    async createUser (actor, { username, password, role = 'user', displayName = null, mailbox = true }) {
        if (!actor || actor.role !== 'admin') {
            throw forbidden('forbidden', 'Only the administrator can add an account.');
        }
        const user = this.users.create({ username, password, role, displayName, mailbox, actor });
        await this.fs.ensureAccount(user);
        this.events?.publish?.('user.created', { username: user.username, role, by: actor.username },
            { actor: actor.username, scope: 'admins', audit: true });
        return user;
    }

    async removeUser (actor, username) {
        if (!actor || actor.role !== 'admin') {
            throw forbidden('forbidden', 'Only the administrator can remove an account.');
        }
        const user = this.users.byUsername(username);
        if (!user) throw notFound('no_user', `There is no account called ${username}.`);
        this.users.remove(user, { actor: { uid: actor.uid, username: actor.username } });
        /* Their files and their sessions go too: an account that can no longer
           sign in should not still be holding a home directory and a mailbox. */
        const root = this.fs.entries.rootOf(user.uid);
        if (root) {
            for (const key of this.fs.entries.remove(root)) await this.fs.blobs.remove(key);
        }
        this.sessions.destroyUser(user.uid);
        this.kv.remove(user.uid, 'settings');
        this.kv.remove(user.uid, 'installed');
        this.events?.publish?.('user.removed', { username: user.username, by: actor.username },
            { actor: actor.username, scope: 'admins', audit: true });
        return true;
    }

    async setPassword (actor, username, password) {
        const target = this.users.byUsername(username);
        if (!target) throw notFound('no_user', `There is no account called ${username}.`);
        const own = actor && actor.uid === target.uid;
        if (!own && (!actor || actor.role !== 'admin')) {
            throw forbidden('forbidden', 'You can only change your own password.');
        }
        if (target.role === 'admin' && this.config.rootPassword) {
            /* The administrator's password is ROOTPASS.md. Changing it here
               would work until the next restart and then silently revert, which
               is worse than being told to edit the file. */
            throw badRequest('root_password_is_in_a_file',
                'The administrator password is the root password in ROOTPASS.md. Edit that file and restart.');
        }
        if (!password) throw badRequest('no_password', 'A password is needed.');
        this.users.setPassword(target, password);
        this.events?.publish?.('user.password', { username: target.username, by: actor?.username || null, self: own },
            { actor: actor?.username || null, scope: 'admins', audit: true });
        return true;
    }

    listUsers (actor) {
        if (!actor || actor.role !== 'admin') return null;
        return this.users.list().map((user) => ({
            ...this.users.toPublic(user),
            sessions: this.sessions.forUser(user.uid).length,
        }));
    }

    /* --------------------------------- state ------------------------------- */

    /** Who is signed in, for the console and the lock screen. */
    sessionsListing (actor) {
        if (!actor || actor.role !== 'admin') return null;
        return this.sessions.list().map((s) => this.sessions.toPublic(s));
    }

    guestLogins (actor) {
        if (!actor || actor.role !== 'admin') return null;
        return this.guestLog.slice(-100).reverse();
    }

    /**
     * The whole signed-in identity, in the shape the desktop asks for on boot.
     *
     * `groups` is the Unix flavour the settings panel shows; `canHostShell` is
     * whether this session may open a shell on the host itself, which is off
     * for everybody until an administrator turns it on in the configuration.
     */
    whoami (actor) {
        if (!actor) return null;
        return {
            username: actor.username,
            displayName: actor.displayName,
            role: actor.role,
            guest: actor.guest,
            groups: actor.role === 'admin'
                ? 'adm, sudo, audio, video, plugdev'
                : (actor.guest ? 'guest' : 'audio, video, plugdev'),
            home: this.fs.home(actor),
            uid: actor.uid,
            sessionId: actor.sessionId,
            created: actor.session?.created || null,
            canHostShell: actor.role === 'admin' && this.config.terminal.hostShell,
            mailbox: actor.mailboxKey || null,
            machine: { name: this.config.name, hostname: this.config.hostname },
        };
    }
}
