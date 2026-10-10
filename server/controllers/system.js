/**
 * The machine, over HTTP.
 *
 * `/api/system/info` is what Settings and `neofetch` show; `/api/system/airgap`
 * is the proof that the promise holds — it reports the blocked attempts
 * themselves, because "this machine cannot reach the Internet" is worth more
 * when you can see it being refused.
 */
import { BaseController } from '../lib/container.js';
import { airgapReport } from '../lib/airgap.js';

export class SystemController extends BaseController {
    static SERVICE_NAME = 'system';

    async _init () { this.system = this.services.get('system'); }

    info (ctx) {
        /* The desktop asks before it shows the sign-in gate, so this one is
           open: it says who the machine is, not who is signed in. */
        void ctx;
        return this.system.sysinfo();
    }

    airgap (ctx) {
        const actor = ctx.actor;
        const report = airgapReport();
        if (!actor || actor.role !== 'admin') {
            /* Everybody is told whether the machine is air-gapped. Only the
               administrator is shown the attempts — a list of what other
               people's programs tried to reach is their business. */
            return { enabled: report.enabled, hostname: report.hostname, blocked: null };
        }
        return report;
    }

    banner () { return this.system.banner(); }

    /** Everything the server is holding, for the console. */
    storage (ctx) {
        const actor = ctx.require();
        return this.system.storage(actor);
    }

    async logs (ctx) {
        const actor = ctx.require();
        return await this.system.audit(actor, { lines: Number(ctx.query.lines || 200) });
    }

    /** A driver-call style view of the machine, for apps and for the console. */
    capabilities () {
        return {
            ok: true,
            capabilities: {
                filesystem: true,
                terminal: true,
                apps: true,
                mail: true,
                hosting: this.config.hosting.enabled,
                webdav: this.config.webdav.enabled,
                shares: true,
                events: true,
                hostShell: this.config.terminal.hostShell,
                internet: false,
            },
            interfaces: ['puter-fs', 'puter-apps', 'puter-kv', 'puter-notifications', 'puter-whoami'],
        };
    }
}
