/**
 * Serving the desktop itself.
 *
 * The site is the same folder a static host would serve — `index.html`, the
 * bundle, the stylesheet, the wallpapers — so the machine works whether it is
 * started here or dropped on a web server. What this adds is the header a
 * static host cannot: a Content-Security-Policy that pins every request to this
 * origin, which is the browser's half of "this machine has no Internet".
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { BaseController } from '../lib/container.js';
import { notFound } from '../lib/errors.js';
import { reply } from '../lib/http.js';

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.ogg': 'audio/ogg',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
};

/**
 * Nothing here may leave the page's own folder.
 *
 * A request target is attacker-controlled: `../../etc/passwd`, `//etc/passwd`,
 * `%2e%2e/` and friends all arrive here sooner or later. The rule is the same
 * one the filesystem service uses — resolve first, then check it is still
 * inside the root, and only then read.
 */
function inside (root, wanted) {
    const resolved = path.resolve(root, '.' + path.posix.normalize(wanted));
    if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
    return resolved;
}

export class StaticController extends BaseController {
    static SERVICE_NAME = 'static';

    async _init () {
        this.root = this.config.staticDir;
        this.csp = [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "media-src 'self' data: blob:",
            "font-src 'self' data:",
            /* 'self' and nothing else: an app on this desktop cannot open a
               socket to a machine that is not this one. */
            "connect-src 'self' ws: wss:",
            "frame-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
        ].join('; ');
    }

    /** The page. */
    async index (ctx) {
        return await this._file(ctx, '/index.html');
    }

    /** Anything in the site root, plus `converter/` and `dist/`. */
    async file (ctx) {
        return await this._file(ctx, '/' + (ctx.params.rest || ''));
    }

    async _file (ctx, wanted) {
        /* A request target is attacker-controlled and arrives percent-encoded:
           `%2e%2e%2f` means `../` to anybody who reads it after decoding. So it
           is decoded first, normalised second, and only then checked to still
           be inside the site — in that order, because the other way round the
           check passes and the file escapes. */
        try { wanted = decodeURIComponent(String(wanted)); } catch { /* leave it */ }
        if (wanted === '/' || wanted === '') wanted = '/index.html';
        if (wanted === '/favicon.ico') wanted = '/logo.svg';

        const candidates = [
            inside(this.root, wanted),
            /* The built copy, when `npm run build` has been run. */
            inside(path.join(this.root, 'dist'), wanted),
        ].filter(Boolean);

        for (const file of candidates) {
            try {
                const stat = await fsp.stat(file);
                if (stat.isDirectory()) continue;
                const body = await fsp.readFile(file);
                return reply(body, {
                    type: MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
                    /* The bundle is served from disk on every start, so it is
                       revalidated rather than cached: a rebuilt bundle appears
                       on the next reload instead of the next month. */
                    headers: {
                        'cache-control': 'no-cache',
                        'content-security-policy': this.csp,
                        'x-content-type-options': 'nosniff',
                        'referrer-policy': 'same-origin',
                    },
                });
            } catch {
                /* try the next candidate */
            }
        }

        /* An unknown path with an extension is a missing file; anything else is
           a route the desktop owns, and gets the page so a reload works. */
        if (path.extname(wanted)) throw notFound('no_file', `${wanted}: no such file.`);
        return this._file(ctx, '/index.html');
    }

    /** `HEAD` — browsers and uptime checks ask. */
    async head (ctx) {
        const result = await this._file(ctx, '/' + (ctx.params.rest || '/index.html'));
        if (result && result.buffer !== undefined) return reply(null, { status: 200, type: result.type });
        return null;
    }

    /** The logo, without depending on where the page is being served from. */
    async logo (ctx) {
        return this._file(ctx, '/logo.svg');
    }

    existsInRoot (wanted) {
        return fs.existsSync(path.join(this.root, wanted));
    }
}
