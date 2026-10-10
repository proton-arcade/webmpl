/**
 * HTTP plumbing: a router, a request context, and the response helpers.
 *
 * Controllers never touch `req`/`res` directly. They receive a context with the
 * pieces already parsed (query, JSON body, the signed-in actor) and return a
 * value or throw an ApiError; the layer below turns that into bytes. That is
 * the same split Puter makes, and it is what keeps "read the JSON body" from
 * being repeated in forty handlers — including the ones that would otherwise
 * forget the size limit.
 */
import { ApiError, isApiError } from './errors.js';
import { clip } from './util.js';

/* --------------------------------- router -------------------------------- */

export class Router {
    constructor () { this.routes = []; }

    /**
     * `pattern` understands `:name` (one segment) and `*name` (the rest of the
     * path, including slashes) — a file path in a URL is not one segment.
     */
    add (method, pattern, handler, meta = {}) {
        const keys = [];
        const source = String(pattern)
            .replace(/\/:([A-Za-z0-9_]+)/g, (_, k) => { keys.push({ name: k, star: false }); return '/([^/]+)'; })
            .replace(/\*([A-Za-z0-9_]+)/g, (_, k) => { keys.push({ name: k, star: true }); return '(.*)'; });
        this.routes.push({
            method: String(method).toUpperCase(),
            pattern,
            regex: new RegExp('^' + source + '$'),
            keys,
            handler,
            meta,
        });
        return this;
    }

    get (p, h, m) { return this.add('GET', p, h, m); }
    post (p, h, m) { return this.add('POST', p, h, m); }
    put (p, h, m) { return this.add('PUT', p, h, m); }
    patch (p, h, m) { return this.add('PATCH', p, h, m); }
    del (p, h, m) { return this.add('DELETE', p, h, m); }

    match (method, pathname) {
        const m = String(method).toUpperCase();
        for (const route of this.routes) {
            if (route.method !== m) continue;
            const hit = route.regex.exec(pathname);
            if (!hit) continue;
            const params = {};
            route.keys.forEach((k, i) => {
                const raw = hit[i + 1] ?? '';
                params[k.name] = k.star ? raw : safeDecode(raw);
            });
            return { route, params };
        }
        /* A path that exists under a different verb is a 405, not a 404: with
           WebDAV and the REST API sharing a server the distinction matters. */
        const otherVerb = this.routes.find((r) => r.regex.test(pathname));
        return otherVerb ? { methodNotAllowed: otherVerb.method } : null;
    }

    get size () { return this.routes.length; }
}

const safeDecode = (s) => {
    try { return decodeURIComponent(s); } catch { return s; }
};

/* --------------------------------- bodies -------------------------------- */

export function readBody (req, { limit = 128 * 1024 * 1024 } = {}) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let settled = false;
        const fail = (err) => {
            if (settled) return;
            settled = true;
            reject(err);
            req.destroy();
        };
        req.on('data', (c) => {
            size += c.length;
            if (size > limit) return fail(new ApiError(413, 'too_large', 'That is too big to send here.'));
            chunks.push(c);
        });
        req.on('end', () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks)); } });
        req.on('error', fail);
        req.on('aborted', () => fail(new ApiError(499, 'aborted', 'The request went away.')));
    });
}

export async function jsonBody (req, opts) {
    const buf = await readBody(req, opts);
    if (!buf.length) return {};
    try {
        return JSON.parse(buf.toString('utf8'));
    } catch {
        throw new ApiError(400, 'bad_json', 'That is not JSON.');
    }
}

/**
 * multipart/form-data.
 *
 * Enough of RFC 7578 for an upload from a browser: boundaries, headers, binary
 * parts, no nested multiparts. Written out rather than pulled in because a
 * dependency that parses uploads is a dependency that has to be kept patched.
 */
export async function multipartBody (req, { limit = 128 * 1024 * 1024 } = {}) {
    const type = req.headers['content-type'] || '';
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
    if (!m) throw new ApiError(400, 'bad_multipart', 'No boundary in the upload.');
    const boundary = Buffer.from('\r\n--' + (m[1] || m[2]).trim());
    const buf = await readBody(req, { limit });

    const parts = [];
    let at = buf.indexOf(boundary);
    if (at < 0) throw new ApiError(400, 'bad_multipart', 'The upload is malformed.');
    at += boundary.length;
    for (;;) {
        const next = buf.indexOf(boundary, at);
        if (next < 0) break;
        const chunk = buf.subarray(at, next);
        at = next + boundary.length;
        /* The CRLF before a boundary belongs to the boundary, not the part. */
        const split = chunk.indexOf('\r\n\r\n');
        if (split < 0) continue;
        const head = chunk.subarray(0, split).toString('utf8');
        const body = chunk.subarray(split + 4, chunk.length - 2);
        const disp = /content-disposition:\s*([^;]+)(.*)?/is.exec(head) || [];
        const attrs = {};
        for (const kv of (disp[2] || '').split(';')) {
            const eq = kv.indexOf('=');
            if (eq > 0) attrs[kv.slice(0, eq).trim().toLowerCase()] =
                kv.slice(eq + 1).trim().replace(/^"|"$/g, '');
        }
        const ctype = (/content-type:\s*([^\r\n]+)/i.exec(head) || [])[1];
        parts.push({
            name: attrs.name || 'file',
            filename: attrs.filename,
            mime: (ctype || 'application/octet-stream').trim(),
            buffer: body,
        });
        if (buf.subarray(at, at + 2).toString() === '--') break;
    }
    return parts;
}

/* -------------------------------- responses ------------------------------ */

export function sendJson (res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
        'cache-control': 'no-store',
    });
    res.end(payload);
}

export function sendText (res, status, text, type = 'text/plain; charset=utf-8') {
    const payload = Buffer.from(text);
    res.writeHead(status, {
        'content-type': type,
        'content-length': payload.length,
        'cache-control': 'no-store',
    });
    res.end(payload);
}

export function sendBuffer (res, status, buffer, type = 'application/octet-stream', extra = {}) {
    res.writeHead(status, {
        'content-type': type,
        'content-length': buffer.length,
        'cache-control': 'no-store',
        ...extra,
    });
    res.end(buffer);
}

export function sendEmpty (res, status = 204, headers = {}) {
    res.writeHead(status, headers);
    res.end();
}

export function redirect (res, to, status = 302) {
    res.writeHead(status, { location: to, 'cache-control': 'no-store' });
    res.end();
}

/**
 * Server-sent events. This is how the desktop finds out that somebody else on
 * the network wrote to a file, or that mail arrived, without polling.
 */
export function openStream (req, res, { keepAliveMs = 25000 } = {}) {
    res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');
    let open = true;
    const timer = setInterval(() => {
        if (open) { try { res.write(': ping\n\n'); } catch { /* gone */ } }
    }, keepAliveMs);
    const close = () => {
        if (!open) return;
        open = false;
        clearInterval(timer);
        try { res.end(); } catch { /* already closed */ }
    };
    req.on('close', close);
    req.on('error', close);
    return {
        get open () { return open; },
        send (event, data) {
            if (!open) return false;
            try {
                res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? null)}\n\n`);
                return true;
            } catch {
                close();
                return false;
            }
        },
        close,
    };
}

/* ------------------------------ handler output ----------------------------- */

/**
 * A handler answers with a value, and the router turns it into a response.
 *
 *   return { a: 1 }                      → 200, application/json
 *   return reply(text, { type })         → 200, whatever type is needed
 *   return reply(buffer, { type })       → 200, bytes (a file, a picture)
 *   return reply(null, { status: 204 })  → no body
 *   return handled()                     → the handler wrote the response itself
 *                                          (a stream, or a file being piped)
 *
 * That is the whole vocabulary, which is why a controller reads as a list of
 * answers rather than a list of `res.writeHead` calls.
 */
export function reply (payload, { status = 200, type = null, headers = {}, buffer = null } = {}) {
    return { __reply: true, payload, status, type, headers, buffer };
}

export const ok = (payload = {}, extra = {}) => reply({ ok: true, ...payload }, extra);
export const noContent = () => reply(null, { status: 204 });
export const handled = () => ({ __handled: true });
export const isReply = (value) => !!value && value.__reply === true;
export const isHandled = (value) => !!value && value.__handled === true;

export async function sendReply (res, result) {
    /* A handler that forgot to await something still answers correctly: an
       unawaited promise here would otherwise serialise as `{}`, and a route
       would look like it succeeded while returning nothing. */
    if (result && typeof result.then === 'function') result = await result;
    if (isHandled(result)) return;
    if (isReply(result)) {
        const { payload, status, type, headers, buffer } = result;
        if (buffer) return sendBuffer(res, status, buffer, type || 'application/octet-stream', headers);
        if (type && typeof payload === 'string') return sendText(res, status, payload, type);
        if (type) return sendBuffer(res, status, Buffer.from(String(payload ?? '')), type, headers);
        if (payload === null || payload === undefined) return sendEmpty(res, status === 200 ? 204 : status, headers);
        if (typeof payload === 'string' || Buffer.isBuffer(payload)) return sendText(res, status, String(payload), type || 'text/plain; charset=utf-8');
        /* A plain object or array answers as JSON — including a bare `false`,
           which is what several of the client's calls are written against. */
        return sendJson(res, status, payload);
    }
    return sendJson(res, 200, result === undefined ? { ok: true } : result);
}

/* ------------------------------ error output ------------------------------ */

export function sendError (res, err, { log } = {}) {
    if (isApiError(err)) {
        if (err.status >= 500) log?.error?.(`${err.status} ${err.code}: ${err.message}`);
        return sendJson(res, err.status, err.toJSON());
    }
    /* Anything not raised on purpose is a bug. It is logged with its stack and
       reported as one opaque sentence: a stack trace is for the person running
       the machine, not for whoever is using the desktop. */
    log?.error?.(`unhandled: ${err?.stack || err}`);
    return sendJson(res, 500, {
        ok: false,
        code: 'internal_error',
        error: 'The server hit an error. It has been written to the log.',
    });
}

export { clip };
