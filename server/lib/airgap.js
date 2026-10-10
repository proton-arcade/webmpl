/**
 * The air gap.
 *
 * This machine is a computer on a local network, not a computer on the
 * Internet. That is a promise about behaviour, and a promise that is only
 * written in a README is a promise nobody checks, so it is enforced here at
 * runtime: every outbound socket, every HTTP request and every name lookup in
 * this process goes through `isLocal()` first, and anything that resolves off
 * the LAN is refused before a packet is built.
 *
 * It is installed once, at boot, before anything else runs — including before
 * the services that might want to make a request. The block list is
 * permissive about *local* addresses (loopback, RFC1918, link-local, IPv6 ULA
 * and the machine's own names) and refuses everything else, so the failure
 * mode is "a plugin cannot phone home", not "the fileserver stops working".
 *
 * `server/lib/airgap.js` also keeps a record of what it refused, which the
 * Administration console shows: a machine that is trying to reach out is a
 * machine somebody should look at.
 */
import net from 'node:net';
import dns from 'node:dns';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import { airgapped } from './errors.js';

/* ------------------------------- addresses ------------------------------- */

const ipv4 = (s) => s.split('.').map(Number);

/** True for an address that cannot have been handed out on the Internet. */
export function isLocalIp (address) {
    const a = String(address || '').toLowerCase().trim();
    if (!a) return false;
    if (a === '::1' || a === '::' || a === '0.0.0.0') return true;
    if (a.startsWith('fe80:') || a.startsWith('fc') || a.startsWith('fd')) return true; // IPv6 link-local + ULA
    if (a.startsWith('::ffff:')) return isLocalIp(a.slice(7));
    if (!net.isIPv4(a)) return false;
    const [o1, o2] = ipv4(a);
    if (o1 === 127) return true;                       // loopback
    if (o1 === 10) return true;                        // RFC1918 /8
    if (o1 === 192 && o2 === 168) return true;         // RFC1918 /16
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true; // RFC1918 /12
    if (o1 === 169 && o2 === 254) return true;         // link-local
    if (o1 === 100 && o2 >= 64 && o2 <= 127) return true; // CGNAT
    if (o1 === 0) return true;
    return false;
}

/** Names that mean this machine or the network it is sitting on. */
const localNameSuffixes = ['.local', '.lan', '.home.arpa', '.internal', '.localdomain'];

export function isLocalName (host) {
    const h = String(host || '').toLowerCase().trim().replace(/\.$/, '');
    if (!h) return false;
    if (h === 'localhost') return true;
    if (localNameSuffixes.some((s) => h.endsWith(s))) return true;
    const me = os.hostname().toLowerCase();
    if (h === me || h.endsWith('.' + me)) return true;
    if (hostnameAllowlist.has(h)) return true;
    return false;
}

const hostnameAllowlist = new Set();

/** Anything else a deployment needs to reach (a NAS, a printer) can be named. */
export const allowHost = (host) => { hostnameAllowlist.add(String(host).toLowerCase()); };

export function isLocal (host) {
    const h = String(host || '').trim();
    if (!h) return false;
    if (net.isIP(h)) return isLocalIp(h);
    return isLocalName(h);
}

/* --------------------------------- record -------------------------------- */

const record = {
    installed: false,
    enabled: true,
    blocked: [],        // { at, kind, target }
    allowed: [],        // { at, kind, target } — local traffic, for diagnosis
    since: Date.now(),
};
const MAX_LOG = 200;

function note (kind, target, ok) {
    // DNS answers with several addresses for one name; collapse the repeats so
    // one stray fetch is one line in the log and not four.
    const last = record.blocked[record.blocked.length - 1];
    if (!ok && last && last.kind === kind && last.target === target && Date.now() - last.at < 1000) {
        last.count = (last.count || 1) + 1;
        last.at = Date.now();
        return;
    }
    const entry = { at: Date.now(), kind, target, count: 1 };
    const list = ok ? record.allowed : record.blocked;
    list.push(entry);
    if (list.length > MAX_LOG) list.splice(0, list.length - MAX_LOG);
}

export const airgapReport = () => ({
    enabled: record.enabled,
    installed: record.installed,
    since: record.since,
    blocked: record.blocked.slice(-50).reverse(),
    blockedCount: record.blocked.length,
    allowedCount: record.allowed.length,
    localAddresses: localAddresses(),
    hostname: os.hostname(),
});

/** Every address this machine answers on, which is what a LAN puts in a browser. */
export function localAddresses () {
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) {
        for (const iface of list || []) {
            if (!iface || iface.internal) continue;
            if (iface.family === 'IPv4' || iface.family === 4) out.push(iface.address);
        }
    }
    /* Loopback first is not what a LAN needs; the routable address is. Sorted
       so the printed boot banner lists the address a neighbour would type. */
    return out.sort();
}

/* ------------------------------- the guard ------------------------------- */

function hostOf (target) {
    if (typeof target === 'string') {
        if (/^[a-z]+:\/\//i.test(target)) {
            try { return new URL(target).hostname; } catch { return null; }
        }
        const [host] = target.split('/')[0].split(':');
        return host || null;
    }
    if (target instanceof URL) return target.hostname;
    if (target && typeof target === 'object') {
        if (target.hostname) return target.hostname;
        if (target.host) return String(target.host).split(':')[0];
        if (target.href || target.origin) {
            try { return new URL(target.href || target.origin).hostname; } catch { return null; }
        }
    }
    return null;
}

function guard (kind) {
    return (target) => {
        if (!record.enabled) return;
        const host = hostOf(target);
        if (host === null || host === undefined) return; // no outbound target at all
        if (isLocal(host)) { note(kind, host, true); return; }
        note(kind, host, false);
        throw airgapped(host);
    };
}

const guardRequest = guard('http');
const guardConnect = guard('connect');
const guardLookup = guard('dns');

/**
 * Install the air gap. Safe to call more than once; the second call is a no-op
 * so a test that boots two servers in one process does not stack the wrappers.
 */
export function installAirgap ({ enabled = true, allow = [] } = {}) {
    if (record.installed) return record;
    record.enabled = enabled !== false;
    for (const host of allow) allowHost(host);

    const wrap = (mod, name, check) => {
        const original = mod[name];
        const replacement = function (...args) {
            check(args[0]);
            return original.apply(mod, args);
        };
        // Preserve the shape callers inspect (http.get has a `.promises`, etc.)
        Object.defineProperty(replacement, 'name', { value: name });
        mod[name] = replacement;
        return original;
    };

    wrap(http, 'request', guardRequest);
    wrap(http, 'get', guardRequest);
    wrap(https, 'request', guardRequest);
    wrap(https, 'get', guardRequest);
    wrap(net, 'connect', guardConnect);
    wrap(net, 'createConnection', guardConnect);
    wrap(dns, 'lookup', guardLookup);

    /* `fetch` uses undici, which never touches http.request, so it needs its
       own wrapper — otherwise the one modern API in Node is the one hole in
       the wall. */
    if (typeof globalThis.fetch === 'function') {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = function (input, init) {
            const raw = typeof input === 'string' ? input
                : input instanceof URL ? input.href
                    : (input && input.url) || '';
            if (raw) guardRequest(raw);
            return originalFetch.call(globalThis, input, init);
        };
    }

    record.installed = true;
    return record;
}

/** Turn the guard off — used only by the tests that prove it is on. */
export function setAirgapEnabled (value) {
    record.enabled = !!value;
    return record.enabled;
}

export { record as airgapState };
