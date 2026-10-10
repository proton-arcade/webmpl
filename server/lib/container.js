/**
 * The service container.
 *
 * Puter's backend is five layers that are built in order — clients (things that
 * talk to the outside: the database, object storage), stores (tables), services
 * (the rules), controllers (HTTP routes) and drivers (interfaces an app can
 * call). Each layer can use the ones below it and none above, and every object
 * is created by the container rather than by its neighbours, so nothing reaches
 * for a global and nothing has to know how to build its dependencies.
 *
 * This is that, in one file. A `Layer` is registered with a list of names it
 * needs; `init()` builds them in dependency order and calls `_init()` on each,
 * so a service can do async work (create the administrator account, seed a
 * filesystem) before anything asks it a question.
 */

import { Mutex } from './util.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function makeLogger (name, { level = 'info', sink = console } = {}) {
    const threshold = LEVELS[level] ?? 20;
    const emit = (lvl, args) => {
        if (LEVELS[lvl] < threshold) return;
        const when = new Date().toISOString().slice(11, 19);
        const head = `${when} ${lvl.padEnd(5)} ${name}:`;
        if (lvl === 'error') sink.error(head, ...args);
        else if (lvl === 'warn') sink.warn(head, ...args);
        else sink.log(head, ...args);
    };
    return {
        debug: (...a) => emit('debug', a),
        info: (...a) => emit('info', a),
        warn: (...a) => emit('warn', a),
        error: (...a) => emit('error', a),
        child: (sub) => makeLogger(`${name}/${sub}`, { level, sink }),
    };
}

/* -------------------------------- the layer ------------------------------- */

export class Layer {
    /**
     * @param {string} name      'services', 'stores', …
     * @param {object} ctx       the world: config, the other layers, the logger
     */
    constructor (name, ctx) {
        this.name = name;
        this.ctx = ctx;
        this.defs = new Map();
        this.instances = new Map();
        this.order = [];
    }

    register (name, Klass) {
        this.defs.set(name, Klass);
        return this;
    }

    registerAll (map) {
        for (const [name, Klass] of Object.entries(map)) this.register(name, Klass);
        return this;
    }

    get (name) {
        const instance = this.instances.get(name);
        if (!instance) {
            throw new Error(`layer "${this.name}" has no "${name}" ` +
                `(has: ${[...this.instances.keys()].join(', ') || 'nothing'})`);
        }
        return instance;
    }

    tryGet (name) { return this.instances.get(name) || null; }

    has (name) { return this.instances.has(name); }

    /** Every built instance, for anything that wants to walk the layer. */
    all () { return Object.fromEntries(this.instances); }

    /**
     * Build everything, in dependency order, then let each one initialise.
     *
     * A cycle is a bug in the wiring rather than something to recover from, so
     * it is reported with the names involved instead of blowing the stack.
     */
    async init () {
        const building = new Set();
        const done = new Set();

        const build = async (name) => {
            if (done.has(name)) return;
            if (building.has(name)) {
                throw new Error(`dependency cycle in layer "${this.name}": ` +
                    `${[...building, name].join(' -> ')}`);
            }
            const Klass = this.defs.get(name);
            if (!Klass) throw new Error(`layer "${this.name}" has no "${name}"`);

            building.add(name);
            /* Dependencies are names *within this layer*. Cross-layer needs
               ("this service wants the fsentry store") are resolved lazily
               through `this.stores.get()`, which is safe because layers are
               built bottom-up: a store exists before any service asks for it. */
            for (const dep of Klass.DEPENDENCIES || []) {
                if (typeof dep === 'string') await build(dep);
                else if (dep.optional && !this.defs.has(dep.name)) continue;
                else await build(dep.name);
            }

            const instance = typeof Klass === 'function' && Klass.prototype
                ? new Klass(this.ctx)
                : Klass;
            instance.ctx = this.ctx;
            instance.config = this.ctx.config;
            instance.log = (this.ctx.log || console).child
                ? (this.ctx.log || console).child(name)
                : this.ctx.log;
            if (instance.constructor?.SERVICE_NAME === undefined) {
                instance.serviceName = name;
            }

            this.instances.set(name, instance);
            this.order.push(name);
            building.delete(name);
            done.add(name);
        };

        for (const name of this.defs.keys()) await build(name);

        for (const name of this.order) {
            const instance = this.instances.get(name);
            if (typeof instance._init === 'function') await instance._init();
        }
        return this;
    }

    /** Reverse-order shutdown, so a store is closed after its users. */
    async destroy () {
        for (const name of [...this.order].reverse()) {
            const instance = this.instances.get(name);
            try {
                if (typeof instance._destroy === 'function') await instance._destroy();
            } catch (e) {
                this.ctx.log?.warn?.(`${this.name}.${name} failed to stop: ${e.message}`);
            }
        }
    }
}

/**
 * The base class services extend.
 *
 * A service declares what it needs by name and receives the whole context; the
 * useful part is that `this.services.get('acl')` cannot be called before the
 * container has finished building, which removes an entire class of "worked on
 * my machine" startup ordering bugs.
 */
export class BaseService {
    static SERVICE_NAME = undefined;
    static DEPENDENCIES = [];

    constructor (ctx = {}) {
        this.ctx = ctx;
        this.config = ctx.config;
        this.log = ctx.log || makeLogger(this.constructor.name);
        this.services = ctx.services;
        this.stores = ctx.stores;
        this.clients = ctx.clients;
        this.controllers = ctx.controllers;
        this.drivers = ctx.drivers;
        /* Optional, and asked for with `tryGet`: the database client is itself
           built by this layer, so asking for it by name while the client layer
           is still being built would fail — and would fail for the one object
           that everything else depends on. */
        this.db = ctx.clients?.tryGet?.('database') || null;
        /* Only when the subclass has not got a method by that name — an
           instance property would shadow a handler, and the route that should
           have answered it would be missing from the table. */
        if (typeof this.events !== 'function') {
            this.events = ctx.services?.tryGet?.('events') || null;
        }
    }

    /** Override to do async setup. Called after every instance is built. */
    async _init () {}
    async _destroy () {}
}

export class BaseStore extends BaseService {}
export class BaseController extends BaseService {}
export class BaseClient extends BaseService {}

/* --------------------------------- boot ---------------------------------- */

/**
 * Build the world.
 *
 * Clients first (the database has to exist before a store asks for a table),
 * then stores, then services, then controllers and drivers.
 */
export async function boot (config, registry, { log } = {}) {
    const logger = log || makeLogger('mixt');
    const ctx = {
        config,
        log: logger,
        mutex: new Mutex(),
        startedAt: Date.now(),
    };

    for (const layerName of ['clients', 'stores', 'services', 'controllers', 'drivers']) {
        ctx[layerName] = new Layer(layerName, ctx);
        ctx[layerName].registerAll(registry[layerName] || {});
    }
    /* Every layer can see every other layer; that is the point of a context. */
    for (const layerName of ['clients', 'stores', 'services', 'controllers', 'drivers']) {
        ctx[layerName].ctx = ctx;
    }

    for (const layerName of ['clients', 'stores', 'services', 'controllers', 'drivers']) {
        await ctx[layerName].init();
    }

    return ctx;
}
