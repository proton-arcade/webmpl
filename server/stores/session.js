/**
 * Sessions.
 *
 * A session is a bearer token with a person behind it. It carries everything
 * the rest of the server needs to make a decision — who, what role, whether
 * this is a guest, where they signed in from — so a controller can answer "may
 * they?" without going back to the database on every request.
 *
 * Guests get a session like anybody else. The difference is what is kept: a
 * guest's filesystem lives in the session record and is thrown away when they
 * sign out, and nothing a guest does is written into the database.
 */
import { BaseStore } from '../lib/container.js';
import { token as newToken, slug } from '../lib/util.js';

export class SessionStore extends BaseStore {
    static SERVICE_NAME = 'session';

    async _init () {
        this.t = this.db.table('sessions');
        /* Sessions from a previous run are still in the file, but the process
           that issued them is gone: a token that outlived its server is a token
           nobody can vouch for. Guests are always dropped; real accounts are
           dropped unless the config says to keep them across restarts. */
        const keep = this.config.persistSessions === true;
        this.t.remove((s) => s.guest || !keep);
        this.db.dirty();
    }

    create ({ user = null, guest = false, name = null, ip = null, userAgent = null, hostShell = false }) {
        const record = this.t.insert({
            token: newToken(),
            userId: user?.uid || null,
            username: user ? user.username : (name || `guest-${slug(4)}`),
            displayName: user ? (user.displayName || user.username) : (name || 'Guest'),
            role: user ? user.role : 'guest',
            guest: !!guest,
            hostShell: !!hostShell,
            ip: ip || null,
            userAgent: userAgent ? String(userAgent).slice(0, 200) : null,
            created: Date.now(),
            lastSeen: Date.now(),
        });
        /* Only guests are always in the database for the sake of a uniform
           lookup; a real account's session is persisted too so a restart does
           not sign the whole house out — see `_init`. */
        this.db.dirty();
        return record;
    }

    byToken (tokenValue) {
        if (!tokenValue) return null;
        const session = this.t.findOne((s) => s.token === tokenValue);
        if (!session) return null;
        const ttl = this.config.limits.sessionTtlMs;
        if (ttl && Date.now() - session.lastSeen > ttl) {
            this.destroy(session.token);
            return null;
        }
        return session;
    }

    touch (session) {
        this.t.update((s) => s.token === session.token, { lastSeen: Date.now() });
    }

    list () { return this.t.all().sort((a, b) => b.created - a.created); }

    forUser (userId) { return this.t.find((s) => s.userId === userId); }

    destroy (tokenValue) {
        return this.t.remove((s) => s.token === tokenValue) > 0;
    }

    destroyUser (userId) {
        return this.t.remove((s) => s.userId === userId);
    }

    /** Called at boot and every few minutes: expired tokens cost memory and show
        as live sessions in the console if they are left behind. */
    prune () {
        const ttl = this.config.limits.sessionTtlMs;
        if (!ttl) return 0;
        const cutoff = Date.now() - ttl;
        return this.t.remove((s) => s.lastSeen < cutoff);
    }

    /* What the session menu and the console show. Never the token itself. */
    toPublic (s) {
        return {
            username: s.username,
            displayName: s.displayName,
            role: s.role,
            guest: !!s.guest,
            ip: s.ip,
            created: s.created,
            lastSeen: s.lastSeen,
        };
    }

    count () { return this.t.count(); }
}
