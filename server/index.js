#!/usr/bin/env node
/**
 * Mixt Web OS — the server.
 *
 *   node server/index.js          http://localhost:8080
 *   MIXT_PORT=9000 node server/index.js
 *
 * A computer for a local network. It holds the accounts, the files, the mail,
 * the applications and the terminal on this machine, serves the desktop to any
 * browser that can reach it, and — through the air gap installed before
 * anything else starts — cannot reach anything off it. Puter's backend is five
 * layers (clients, stores, services, controllers, drivers) built by a
 * container; this is that shape, in one process, with no database server, no
 * object store and no build step.
 *
 * There is no npm install here and nothing to configure: the data directory is
 * created next to the code, the administrator password is in ROOTPASS.md, and
 * the machine is reachable at every address it has.
 */
import http from 'node:http';
import path from 'node:path';

import { installAirgap, airgapReport } from './lib/airgap.js';
import { boot, makeLogger } from './lib/container.js';
import { loadConfig } from './lib/config.js';
import { ApiError, isApiError, unauthorized } from './lib/errors.js';
import { Router, jsonBody, multipartBody, readBody, sendError, sendReply } from './lib/http.js';
import { ROUTES } from './routes.js';

import { DatabaseClient } from './clients/database.js';
import { BlobStore } from './clients/blobstore.js';
import { EventBus } from './clients/eventbus.js';

import { UserStore } from './stores/user.js';
import { SessionStore } from './stores/session.js';
import { FSEntryStore } from './stores/fsentry.js';
import { AppStore } from './stores/app.js';
import { ShareStore } from './stores/share.js';
import { KVStore } from './stores/kv.js';
import { MailStore } from './stores/mail.js';

import { EventService } from './services/events.js';
import { ACLService } from './services/acl.js';
import { FileSystemService } from './services/fs.js';
import { AuthService } from './services/auth.js';
import { MailService } from './services/mail.js';
import { AppService } from './services/apps.js';
import { HostingService } from './services/hosting.js';
import { SystemService } from './services/system.js';
import { WebDAVService } from './services/webdav.js';
import { TerminalService } from './services/terminal.js';

import { AuthController } from './controllers/auth.js';
import { FSController } from './controllers/fs.js';
import { AppController } from './controllers/apps.js';
import { MailController } from './controllers/mail.js';
import { TerminalController } from './controllers/terminal.js';
import { SystemController } from './controllers/system.js';
import { HostingController } from './controllers/hosting.js';
import { WebDAVController } from './controllers/webdav.js';
import { StaticController } from './controllers/static.js';
import { DriverController } from './controllers/drivers.js';

/** The five layers, in the order they are built. */
const REGISTRY = {
    clients: { database: DatabaseClient, blobstore: BlobStore, eventbus: EventBus },
    stores: {
        user: UserStore, session: SessionStore, fsentry: FSEntryStore,
        app: AppStore, share: ShareStore, kv: KVStore, mail: MailStore,
    },
    services: {
        events: EventService, acl: ACLService, fs: FileSystemService, auth: AuthService,
        mail: MailService, apps: AppService, hosting: HostingService,
        terminal: TerminalService, system: SystemService, webdav: WebDAVService,
    },
    controllers: {
        auth: AuthController, fs: FSController, apps: AppController, mail: MailController,
        terminal: TerminalController, system: SystemController, hosting: HostingController,
        webdav: WebDAVController, static: StaticController, drivers: DriverController,
    },
    drivers: {},
};

/* --------------------------------- context -------------------------------- */

/**
 * The request context a handler receives.
 *
 * Everything a handler needs is parsed once here, so a controller is a list of
 * answers rather than a list of `JSON.parse` calls — and so the one place that
 * decides who is asking (`ctx.require()`) is easy to find.
 */
function makeContext ({ req, res, url, params, meta, ctx, log }) {
    const query = {};
    for (const [key, value] of url.searchParams) query[key] = value;

    const context = {
        req, res, url, params, meta,
        method: req.method,
        path: url.pathname,
        query,
        headers: req.headers,
        ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
            req.socket?.remoteAddress?.replace('::ffff:', '') || null,
        services: ctx.services,
        stores: ctx.stores,
        clients: ctx.clients,
        config: ctx.config,
        log,
        actor: null,
        token: null,

        /** The signed-in session, or throw 401. */
        require () {
            if (context.actor) return context.actor;
            if (meta?.public) return null;
            throw unauthorized('no_session', 'Sign in first.');
        },
        /** Parse the body as JSON when a handler asks for it explicitly. */
        async json () {
            if (context._body === undefined) {
                context._body = await jsonBody(req, { limit: ctx.config.limits.maxUploadBytes });
            }
            return context._body;
        },
        async multipart () {
            if (!context._parts) {
                context._fields = {};
                const parts = await multipartBody(req, { limit: ctx.config.limits.maxUploadBytes });
                for (const part of parts) {
                    if (part.filename) continue;
                    context._fields[part.name] = part.buffer.toString('utf8');
                }
                context._parts = parts.filter((p) => p.filename);
            }
            context.fields = context._fields;
            return context._parts;
        },
        async buffer () {
            if (context._raw === undefined) {
                context._raw = await readBody(req, { limit: ctx.config.limits.maxUploadBytes });
            }
            context.rawBuffer = context._raw;
            return context._raw;
        },
    };
    /* `ctx.body` is a property, not a method: the dispatcher parses a JSON body
       before the handler runs, so a handler reads `ctx.body.username` instead of
       awaiting. (`ctx.json()` is there for a handler that wants to be sure.) */
    Object.defineProperty(context, 'body', { get: () => context._body ?? {}, configurable: true });
    return context;
}

/**
 * What a client proved its identity with.
 *
 * A bearer token in a header, a `?token=` parameter (an `<img>` cannot set a
 * header), a cookie, or Basic auth — which is how every WebDAV client speaks,
 * so a username and password are accepted there too.
 */
function credentialsOf (req, url) {
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) return { token: header.slice(7).trim() };
    if (header.startsWith('Basic ')) {
        try {
            const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
            const at = decoded.indexOf(':');
            const username = decoded.slice(0, at);
            const password = decoded.slice(at + 1);
            return { token: password.trim(), basic: { username, password } };
        } catch { return { token: null }; }
    }
    if (url.searchParams.get('token')) return { token: url.searchParams.get('token') };
    if (req.headers.cookie) {
        const hit = /mixt_token=([^;]+)/.exec(req.headers.cookie);
        if (hit) return { token: hit[1] };
    }
    return { token: null };
}

/* --------------------------------- server --------------------------------- */

export async function createServer (overrides = {}) {
    const config = loadConfig(overrides);
    /* Before anything else: a machine that is not allowed to reach the Internet
       should be unable to, not merely advised against it. */
    installAirgap({ enabled: config.airgap.enabled, allow: config.airgap.allow });

    const log = makeLogger('mixt', { level: process.env.MIXT_LOG_LEVEL || 'info' });
    const world = await boot(config, REGISTRY, { log });
    const router = new Router();
    const controllers = world.controllers;

    for (const [method, pattern, controllerName, handlerName, meta = {}] of ROUTES) {
        const controller = controllers.get(controllerName);
        const handler = controller?.[handlerName];
        if (typeof handler !== 'function') {
            throw new Error(`route ${method} ${pattern} → ${controllerName}.${handlerName}: no such handler`);
        }
        router.add(method, pattern, handler.bind(controller), { ...meta, controllerName, handlerName });
    }

    /* `handle` catches everything it can, and this catches whatever it cannot:
       an unhandled rejection in a request handler is an uncaught exception in
       Node, which takes the whole machine — every session, every unsaved file
       — down with one bad request. Answering 500 and carrying on is the right
       trade for a computer other people are using. */
    const server = http.createServer((req, res) => {
        handle(req, res).catch((error) => {
            if (res.headersSent) { try { res.end(); } catch { /* gone */ } return; }
            sendError(res, error, { log });
        });
    });

    async function handle (req, res) {
        let url;
        try {
            /* A request target does not have to be a URL: `GET http://`, `GET ///`
               and friends make `new URL` throw, and throwing here is an uncaught
               exception that takes every session down with it. */
            url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        } catch {
            return sendError(res, new ApiError(400, 'bad_request', 'That is not a request this server understands.'), { log });
        }

        const matched = router.match(req.method, url.pathname);
        if (matched?.methodNotAllowed) {
            return sendError(res, new ApiError(405, 'method_not_allowed',
                `${req.method} is not allowed here.`), { log });
        }
        if (!matched) {
            return sendError(res, new ApiError(404, 'no_route', `${url.pathname}: nothing here.`), { log });
        }

        const { route, params } = matched;
        const context = makeContext({ req, res, url, params, meta: route.meta, ctx: world, log });
        const credentials = credentialsOf(req, url);
        if (credentials.token || credentials.basic) {
            const auth = world.services.get('auth');
            /* A bearer token, and then — for Basic auth — a password that is a
               token somebody pasted, and only then a real username and
               password. The order matters: a WebDAV client that was given a
               token as its password must not end up creating a second session
               every time it lists a folder. */
            let actor = credentials.token ? auth.byToken(credentials.token) : null;
            if (!actor && credentials.basic) {
                actor = auth.byCredentials(credentials.basic.username, credentials.basic.password);
            }
            /* An unknown token is not an error on a public route (the page,
               /api/health) — but on a route that needs a session it is. */
            if (actor) {
                context.actor = actor;
                context.token = credentials.token || null;
            } else if (!route.meta.public) {
                return sendError(res, unauthorized('bad_session', 'That session has ended. Sign in again.'), { log });
            }
        }

        try {
            /* A JSON body is only parsed if a handler asks for it, so a large
               upload never has to become an object first. */
            if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers['content-type']?.includes('json')) {
                await context.json();
            }
            const result = await route.handler(context);
            if (res.writableEnded || res.headersSent && route.meta.public === true && result?.__handled) return;
            await sendReply(res, result);
        } catch (error) {
            if (res.headersSent) { try { res.end(); } catch { /* gone */ } return; }
            if (!isApiError(error) && error?.name === 'AbortError') return;
            sendError(res, error, { log });
        }
    }

    /* Sessions that have gone quiet, dropped every few minutes. */
    const prune = setInterval(() => {
        try {
            const n = world.stores.get('session').prune();
            if (n) log.debug(`pruned ${n} expired sessions`);
        } catch { /* housekeeping must never take the machine down */ }
    }, 5 * 60 * 1000);
    prune.unref?.();

    return { server, world, router, config, log, ROUTES };
}

/* ---------------------------------- boot ---------------------------------- */

const isMain = process.argv[1] && (
    import.meta.url === `file://${process.argv[1]}` ||
    path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
);

if (isMain) {
    const { server, world, config, log } = await createServer();

    const shutdown = async (signal) => {
        log.info(`${signal} — stopping`);
        clearInterval(pruneTimer);
        server.close();
        try {
            await world.stores.get('session').t.remove(() => true);
            await world.clients.get('database').flush();
        } catch { /* going down is not the time to fail loudly */ }
        for (const layerName of ['drivers', 'controllers', 'services', 'stores', 'clients']) {
            await world[layerName].destroy().catch(() => {});
        }
        process.exit(0);
    };
    const pruneTimer = setInterval(() => {}, 1 << 30);

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    /* An uncaught exception is logged and swallowed rather than killing the
       machine: a desktop that vanishes mid-sentence is worse than one that
       keeps working with one bad request behind it. */
    process.on('uncaughtException', (error) => log.error(`uncaught: ${error?.stack || error}`));
    process.on('unhandledRejection', (reason) => log.error(`unhandled rejection: ${reason?.stack || reason}`));

    server.listen(config.port, config.host, () => {
        const report = airgapReport();
        const urls = [config.url, ...report.localAddresses.map((a) => `http://${a}:${config.port}`)];
        log.info(`${config.name} ${config.version} — a computer on this network`);
        for (const address of urls) log.info(`  ${address}`);
        log.info(`  accounts: ${world.stores.get('user').count()}   ` +
            `sessions: ${world.stores.get('session').count()}   ` +
            `files: ${world.stores.get('fsentry').countAll()}`);
        log.info(`  data: ${config.dataDir}`);
        log.info(`  administrator: ${config.rootUser} (ROOTPASS.md)`);
        log.info(`  air gap: ${report.enabled ? 'on — this machine cannot reach the Internet' : 'OFF'}`);
        log.info(`  terminal: jailed per account` +
            `${config.terminal.hostShell ? '; the administrator may also open a shell on the host' : ''}`);
    });
}
