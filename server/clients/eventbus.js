/**
 * The event bus.
 *
 * One process, several browsers, one filesystem. When an account writes a file
 * on the laptop, the desktop on the phone should show it without being asked —
 * so every change that other sessions might care about is published here and
 * streamed to whoever is listening over `/api/events`.
 *
 * Events are also the audit trail: the last few hundred are kept in memory (and
 * written to `data/logs/audit.log`) because "who emptied the trash" is a
 * question somebody always asks afterwards.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { BaseClient } from '../lib/container.js';
import { ensureDir, slug } from '../lib/util.js';

const MAX_RECENT = 500;

export class EventBus extends BaseClient {
    static SERVICE_NAME = 'eventbus';

    async _init () {
        this.subs = new Set();
        this.recent = [];
        this.sequence = 0;
        this.logDir = this.config.logDir;
        this.auditPath = path.join(this.logDir, 'audit.log');
        this.auditQueue = Promise.resolve();
        if (this.config.logDir) await ensureDir(this.logDir);
        this.counts = {};
    }

    /**
     * Publish something that happened.
     *
     * @param {string} type      'fs.write', 'mail.arrived', 'user.login' …
     * @param {object} payload   whatever the listeners need
     * @param {object} options   { actor, audit }
     */
    emit (type, payload = {}, { actor = null, audit = false } = {}) {
        const event = {
            type,
            payload,
            actor: actor || null,
            at: Date.now(),
            seq: ++this.sequence,
        };
        this.counts[type] = (this.counts[type] || 0) + 1;
        this.recent.push(event);
        if (this.recent.length > MAX_RECENT) this.recent.splice(0, this.recent.length - MAX_RECENT);

        for (const sub of [...this.subs]) {
            try {
                if (sub.filter && !sub.filter(event)) continue;
                sub.send(event);
            } catch {
                this.subs.delete(sub);
            }
        }
        if (audit) this._audit(event);
        return event;
    }

    _audit (event) {
        if (!this.config.logDir) return;
        const line = JSON.stringify({
            at: new Date(event.at).toISOString(),
            type: event.type,
            actor: event.actor,
            ...event.payload,
        }) + '\n';
        /* Appends are serialised: two events in the same tick must not interleave
           into one line, which is how an audit log becomes unreadable. */
        this.auditQueue = this.auditQueue.then(async () => {
            try { await fsp.appendFile(this.auditPath, line); } catch { /* a full disk must not stop the machine */ }
        });
    }

    /**
     * Subscribe in-process. Returns an unsubscribe function.
     *
     * `send` is called with the event; a subscriber that throws is dropped
     * rather than being allowed to break the loop for everyone else.
     */
    subscribe (send, filter = null) {
        const sub = { send, filter };
        this.subs.add(sub);
        return () => this.subs.delete(sub);
    }

    /** Everything since a sequence number — how a reconnecting client catches up. */
    since (seq = 0) {
        return this.recent.filter((e) => e.seq > seq);
    }

    report () {
        return {
            subscribers: this.subs.size,
            events: this.sequence,
            recent: this.recent.slice(-20).reverse().map((e) => ({ at: e.at, type: e.type, actor: e.actor })),
            counts: this.counts,
        };
    }
}

export { slug };
