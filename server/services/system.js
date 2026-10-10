/**
 * The machine, reporting on itself.
 *
 * Health for a boot that has to prove it came up, statistics for the
 * administrator's console, and the system information the Settings panel and
 * `neofetch` show. Everything here is read off this computer with the standard
 * library — there is nothing to phone and nobody to ask.
 */
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BaseService } from '../lib/container.js';
import { forbidden } from '../lib/errors.js';
import { airgapReport, localAddresses } from '../lib/airgap.js';
import { humanSize } from '../lib/util.js';

export class SystemService extends BaseService {
    static SERVICE_NAME = 'system';
    static DEPENDENCIES = [];

    async _init () {
        this.users = this.stores.get('user');
        this.sessions = this.stores.get('session');
        this.apps = this.stores.get('app');
        this.kv = this.stores.get('kv');
        this.mail = this.services.get('mail');
        this.startedAt = Date.now();
    }

    /* -------------------------------- health ------------------------------- */

    health () {
        return {
            ok: true,
            service: 'mixt',
            name: this.config.name,
            hostname: this.config.hostname,
            version: this.config.version,
            uptime: Math.round((Date.now() - this.startedAt) / 1000),
            accounts: this.users.count(),
            sessions: this.sessions.count(),
            /* `online: true` is what the desktop asks for before it shows the
               sign-in gate. It means "the server is here", not "the Internet
               is here" — this machine does not have the Internet. */
            online: true,
            internet: false,
            airgapped: airgapReport().enabled,
            network: 'local',
        };
    }

    /* ------------------------------- statistics ---------------------------- */

    /** What the console shows. Administrator only, because it is a list of
        everybody on the machine and what they have. */
    stats (actor) {
        if (!actor || actor.role !== 'admin') return null;
        const users = this.users.list();
        return {
            users: users.length,
            admins: users.filter((u) => u.role === 'admin').length,
            sessions: this.sessions.count(),
            appsApproved: this.apps.list({ approvedOnly: true }).length,
            appsPending: this.apps.list({ status: 'pending' }).length,
            mailboxes: this.mail ? this.mail.report().mailboxes.length : 0,
            savedSettings: users.filter((u) => this.kv.get(u.uid, 'settings', null) !== null).length,
            guestMailbox: this.mail ? this.mail.guestMailbox : false,
            guestLogins: this.services.get('auth')?.guestLog?.length || 0,
            airgapped: airgapReport().enabled,
            blocked: airgapReport().blockedCount,
        };
    }

    /* --------------------------------- info -------------------------------- */

    sysinfo () {
        const cpus = os.cpus();
        const mem = { total: os.totalmem(), free: os.freemem() };
        let disk = null;
        try {
            const st = fs.statfsSync(this.config.dataDir);
            disk = {
                total: st.blocks * st.bsize,
                free: st.bfree * st.bsize,
                available: st.bavail * st.bsize,
            };
        } catch { /* a filesystem that cannot be measured is not an error */ }
        return {
            machine: {
                name: this.config.name,
                hostname: this.config.hostname,
                domain: this.config.domain,
                url: this.config.url,
                version: this.config.version,
            },
            os: {
                platform: process.platform,
                type: os.type(),
                release: os.release(),
                arch: os.arch(),
                uptime: Math.round(os.uptime()),
            },
            cpu: {
                model: cpus[0]?.model || 'unknown',
                cores: cpus.length,
                speed: cpus[0]?.speed || 0,
                load: os.loadavg(),
            },
            memory: {
                total: mem.total,
                free: mem.free,
                used: mem.total - mem.free,
                human: `${humanSize(mem.total - mem.free)} / ${humanSize(mem.total)}`,
            },
            disk: disk ? {
                total: disk.total, free: disk.free,
                human: `${humanSize(disk.total - disk.free)} / ${humanSize(disk.total)}`,
            } : null,
            network: {
                interfaces: localAddresses(),
                hostname: os.hostname(),
                airgapped: airgapReport().enabled,
            },
            process: {
                node: process.version,
                pid: process.pid,
                uptime: Math.round((Date.now() - this.startedAt) / 1000),
                rss: process.memoryUsage().rss,
            },
            storage: {
                dataDir: this.config.dataDir,
                blobs: this.clients.get('blobstore').usage(),
                nodes: this.stores.get('fsentry').countAll(),
                database: this.db.report(),
            },
        };
    }

    /** The administration console's "what is the server holding". */
    storage (actor) {
        if (!actor || actor.role !== 'admin') throw forbidden('forbidden', 'Only the administrator can do that.');
        const db = this.db.report();
        return {
            database: db,
            blobs: this.clients.get('blobstore').usage(),
            nodes: this.stores.get('fsentry').countAll(),
            events: this.clients.get('eventbus').report(),
            files: {
                db: db.bytes,
                data: this.clients.get('blobstore').usage().bytes,
            },
        };
    }

    /* --------------------------------- logs -------------------------------- */

    /**
     * The tail of the audit log. Administrator only.
     *
     * Called `audit` rather than `log`: every service is handed a logger as
     * `this.log`, and an instance property would shadow this method — the route
     * would then be answered by a logger, which is a confusing way to fail.
     */
    async audit (actor, { lines = 200 } = {}) {
        if (!actor || actor.role !== 'admin') throw forbidden('forbidden', 'Only the administrator can do that.');
        const file = path.join(this.config.logDir, 'audit.log');
        try {
            const text = await fsp.readFile(file, 'utf8');
            const all = text.split('\n').filter(Boolean);
            return all.slice(-Math.max(1, Math.min(2000, lines)))
                .map((line) => { try { return JSON.parse(line); } catch { return { raw: line }; } });
        } catch {
            return [];
        }
    }

    /** Boot banner: where to point a browser, and what this machine will not do. */
    banner () {
        return {
            addresses: localAddresses(),
            port: this.config.port,
            urls: [this.config.url, ...localAddresses().map((a) => `http://${a}:${this.config.port}`)],
            airgap: airgapReport(),
        };
    }
}
