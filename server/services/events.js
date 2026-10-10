/**
 * Events, and who gets to see them.
 *
 * The bus publishes everything; this service decides which sessions hear what,
 * because a machine with several people on it is not one audience. A change to
 * your files is for you and for whoever you shared them with; a new account
 * being created is for the administrator; mail arriving is for the mailbox it
 * landed in.
 *
 * Sessions listen over Server-Sent Events at `/api/events`, which is the one
 * part of this machine that holds a connection open — and the reason two
 * browsers on the same network show the same desktop at the same time.
 */
import { BaseService } from '../lib/container.js';
import { openStream } from '../lib/http.js';

/** Events only the administrator is told about. */
const ADMIN_ONLY = new Set([
    'user.created', 'user.removed', 'user.login', 'user.logout', 'user.password',
    'app.published', 'app.approved', 'app.rejected', 'system.config', 'system.shutdown',
    'airgap.blocked', 'terminal.hostshell',
]);

export class EventService extends BaseService {
    static SERVICE_NAME = 'events';
    static DEPENDENCIES = [];

    async _init () {
        this.bus = this.clients.get('eventbus');
        this.streams = new Set();
    }

    /**
     * Publish something.
     *
     * `scope` says whose business it is:
     *   'private'  only sessions of that account (files, settings)
     *   'admins'   administrator sessions only
     *   'public'   everybody (the machine is going down)
     *   'mailbox'  the account whose mailbox it landed in
     */
    publish (type, payload = {}, { actor = null, scope = 'private', ownerId = null, mailbox = null, audit = false } = {}) {
        const event = this.bus.emit(type, payload, { actor, audit });
        event.scope = scope;
        event.ownerId = ownerId || (actor && actor.ownerId) || null;
        event.mailbox = mailbox || null;
        return event;
    }

    /** Is this session allowed to see this event? */
    visible (event, actor) {
        if (!actor) return event.scope === 'public';
        if (event.scope === 'public') return true;
        if (event.scope === 'admins') return actor.role === 'admin';
        if (event.scope === 'mailbox') return event.mailbox && event.mailbox === actor.mailboxKey;
        if (actor.role === 'admin') return true;
        return event.ownerId && event.ownerId === actor.ownerId;
    }

    /**
     * Attach a session's event stream.
     *
     * `since` replays what was missed: a browser that wakes from sleep has a
     * connection to re-establish, and the twenty things that happened while it
     * was asleep are exactly the things it wants.
     */
    attach (req, res, actor, { since = 0 } = {}) {
        const stream = openStream(req, res);
        const entry = { stream, actor, since: Number(since) || 0 };
        this.streams.add(entry);

        if (entry.since) {
            for (const event of this.bus.since(entry.since)) {
                if (this.visible(event, actor)) stream.send(event.type, this._shape(event));
            }
        }
        const unsubscribe = this.bus.subscribe((event) => {
            if (!stream.open) return;
            if (!this.visible(event, actor)) return;
            stream.send(event.type, this._shape(event));
        });
        stream.close = ((close) => () => {
            unsubscribe();
            this.streams.delete(entry);
            close();
        })(stream.close.bind(stream));
        return stream;
    }

    _shape (event) {
        return { ...event.payload, at: event.at, seq: event.seq, actor: event.actor };
    }

    /** What a session may see from the recent past — used by `GET /api/events`. */
    recent (actor, since = 0, limit = 100) {
        return this.bus.since(since)
            .filter((e) => this.visible(e, actor))
            .slice(-limit)
            .map((e) => ({ type: e.type, ...this._shape(e) }));
    }

    report () {
        return {
            ...this.bus.report(),
            streams: this.streams.size,
            adminEvents: [...ADMIN_ONLY],
        };
    }
}
