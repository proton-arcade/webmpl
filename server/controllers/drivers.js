/**
 * The driver-call interface.
 *
 * Puter lets an application call a named interface through one route —
 * `/drivers/call/:interface/:method` — so an app can use the filesystem, the
 * key-value store or notifications without knowing a URL for each one. Same
 * route, same idea, and the same guarantee the whole machine makes: every
 * interface here is local. There is no driver that can reach the network,
 * because there is no network to reach.
 */
import { BaseController } from '../lib/container.js';
import { badRequest, notFound } from '../lib/errors.js';
import { baseName } from '../lib/util.js';

export class DriverController extends BaseController {
    static SERVICE_NAME = 'drivers';

    async _init () {
        this.fs = this.services.get('fs');
        this.apps = this.services.get('apps');
        this.kv = this.stores.get('kv');
        this.interfaces = {
            'puter-fs': {
                read: async (actor, args) => await this.fs.read(actor, args.path, { cwd: args.cwd }),
                write: async (actor, args) => !!await this.fs.write(actor, args.path, args.content ?? '', args.mime),
                list: async (actor, args) => await this.fs.readdir(actor, args.path || '/', { cwd: args.cwd }),
                stat: async (actor, args) => await this.fs.stat(actor, args.path, { cwd: args.cwd }),
                mkdir: async (actor, args) => !!await this.fs.mkdir(actor, args.path, { cwd: args.cwd }),
                delete: async (actor, args) => await this.fs.remove(actor, args.path, { recursive: true }),
                move: async (actor, args) => !!await this.fs.move(actor, args.path, args.to),
                copy: async (actor, args) => !!await this.fs.copy(actor, args.path, args.to),
                exists: async (actor, args) => !!this.fs.resolve(actor, args.path, { cwd: args.cwd }),
                usage: async (actor) => this.fs.usage(actor),
            },
            'puter-apps': {
                list: async (actor) => this.apps.list(actor),
                installed: async (actor) => this.apps.installed(actor),
                install: async (actor, args) => this.apps.install(actor, args.id),
                uninstall: async (actor, args) => this.apps.uninstall(actor, args.id),
                publish: async (actor, args) => this.apps.publish(actor, args),
            },
            'puter-kv': {
                get: async (actor, args) => this.kv.get(actor.uid, args.namespace || 'app', args.fallback ?? null),
                set: async (actor, args) => this.kv.set(actor.uid, args.namespace || 'app', args.value),
                del: async (actor, args) => this.kv.remove(actor.uid, args.namespace || 'app'),
            },
            'puter-notifications': {
                push: async (actor, args) => {
                    this.services.get('events').publish('notification', {
                        title: args.title || 'Notification', body: args.body || '', appId: args.appId || null,
                    }, { actor: actor.username, scope: 'private', ownerId: actor.ownerId });
                    return true;
                },
            },
            'puter-whoami': {
                whoami: async (actor) => this.services.get('auth').whoami(actor),
            },
            'puter-shell': {
                run: async (actor, args) => await this.services.get('terminal').run(actor, args.command || ''),
            },
            'puter-hosting': {
                list: async () => this.services.get('hosting').list(),
                publish: async (actor, args) => this.services.get('hosting').publish(actor, args),
            },
        };
    }

    /** Which interfaces exist, so an app can ask before it calls. */
    list () {
        return {
            ok: true,
            interfaces: Object.fromEntries(Object.entries(this.interfaces)
                .map(([name, methods]) => [name, Object.keys(methods)])),
        };
    }

    /**
     * Call one method.
     *
     * The actor is the signed-in session, never an argument: an app cannot ask
     * the filesystem driver to act as somebody else, which is the only thing
     * that makes it safe to give apps a filesystem at all.
     */
    async call (ctx) {
        const actor = ctx.require();
        const iface = this.interfaces[ctx.params.interface];
        if (!iface) throw notFound('no_interface', `${ctx.params.interface}: no such interface.`);
        const method = iface[ctx.params.method];
        if (!method) throw notFound('no_method', `${ctx.params.interface}.${ctx.params.method}: no such method.`);
        const args = (ctx.body && typeof ctx.body === 'object') ? ctx.body : {};
        if (typeof args.path === 'string' && args.path.includes('\0')) {
            throw badRequest('bad_path', 'That is not a path.');
        }
        const result = await method(actor, args);
        return { ok: true, result: result === undefined ? null : result };
    }

    /** Alias without the leading `puter-`, which is how apps usually say it. */
    async callShort (ctx) {
        ctx.params.interface = `puter-${ctx.params.interface}`;
        return this.call(ctx);
    }
}

export { baseName };
