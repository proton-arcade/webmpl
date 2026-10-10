/**
 * Configuration.
 *
 * Puter reads a config file and layers environment variables over it; so does
 * this, minus the eleven services it needs one for. The defaults are the
 * self-hosted ones: bind to every interface so the machine is reachable from
 * the rest of the LAN, keep all state in `data/` next to the code, and talk to
 * nothing off the network.
 *
 *   MIXT_PORT         port to listen on                 (default 8080)
 *   MIXT_HOST         address to bind                   (default 0.0.0.0)
 *   MIXT_DATA         where accounts and files live     (default ./data)
 *   MIXT_ROOT_PASSWORD  overrides ROOTPASS.md
 *   MIXT_NAME         the name this computer answers by (default hostname)
 *   MIXT_ALLOW_HOST   comma-separated extra local hosts the air gap permits
 *   MIXT_HOST_SHELL   '1' lets an administrator open a shell on the host
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { readJsonFile } from './util.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The repository root: server/ lives directly inside it. */
export const ROOT = path.resolve(here, '..', '..');

/**
 * The root password lives in ROOTPASS.md, in the repository root, where a person
 * can read it and change it with an editor. The line looks like:
 *
 *   Current root password: `mixt-root`
 */
export function readRootPassword (root = ROOT) {
    if (process.env.MIXT_ROOT_PASSWORD) return process.env.MIXT_ROOT_PASSWORD;
    try {
        const text = fs.readFileSync(path.join(root, 'ROOTPASS.md'), 'utf8');
        const line = text.split('\n').find((l) => l.includes('Current root password'));
        const m = /`([^`]+)`/.exec(line || '');
        return m ? m[1] : 'mixt-root';
    } catch {
        return 'mixt-root';
    }
}

export function loadConfig (overrides = {}) {
    const file = readJsonFile(path.join(ROOT, 'server.config.json'), {}) || {};
    const env = process.env;

    /* Overrides are folded in before anything is derived from them. Doing it the
       other way round — building the paths first and spreading the overrides
       last — leaves `dataDir` pointing one way and the database, the blobs and
       the files another, which is how a test with a throwaway directory quietly
       writes into the real one. */
    const dataDir = path.resolve(ROOT, overrides.dataDir || env.MIXT_DATA || file.dataDir || 'data');
    const cfg = {
        /* ---- identity ---- */
        name: env.MIXT_NAME || file.name || 'Mixt',
        hostname: (env.MIXT_HOSTNAME || file.hostname || os.hostname()).toLowerCase(),
        domain: env.MIXT_DOMAIN || file.domain || 'local',
        version: '2.0.0',

        /* ---- network ---- */
        host: env.MIXT_HOST || file.host || '0.0.0.0',
        port: Number(env.MIXT_PORT || file.port || 8080),
        /* Every URL the server hands out is built from the address a browser
           used to get here, so the machine works on whatever the LAN calls it
           without a hostname setting anybody has to guess. */
        publicOrigin: env.MIXT_ORIGIN || file.publicOrigin || null,

        /* ---- storage ---- */
        dataDir,
        dbFile: path.join(dataDir, 'db.json'),
        blobDir: path.join(dataDir, 'blobs'),
        /* A user's files, as real files on real disk, under their own folder.
           `defaultfs/` in the repository is the seed: what a brand-new account
           finds already in their home. */
        fsDir: path.join(dataDir, 'fs'),
        seedDir: path.join(ROOT, 'defaultfs'),
        /* The backgrounds, and the file that says what order they come in. One
           list, read by the desktop and by the server alike, so `wallpaper 2`
           means the same thing in the terminal as it does in Settings. */
        wallpaperDir: path.join(ROOT, 'wallpapers'),
        staticDir: ROOT,
        logDir: path.join(dataDir, 'logs'),

        /* ---- accounts ---- */
        rootUser: env.MIXT_ROOT_USER || file.rootUser || 'Mixt_MPL',
        rootPassword: readRootPassword(),
        /* Guests are let in without an account. Nothing of theirs is kept: the
           session is in memory and their home is discarded when they leave. */
        allowGuests: file.allowGuests !== false,
        allowSignup: file.allowSignup === true,
        /* Standard accounts are whitelisted: only an administrator may add one.
           Every account gets a mailbox at <name>@proper.com, and a guest gets
           <name>@Guest.MPL when the administrator switches guest mail on. */
        mailDomain: file.mailDomain || 'proper.com',
        guestMailDomain: file.guestMailDomain || 'Guest.MPL',

        /* ---- limits ---- */
        limits: {
            maxUploadBytes: 64 * 1024 * 1024,
            maxFileBytes: 32 * 1024 * 1024,
            quotaBytes: Number(env.MIXT_QUOTA || file.quotaBytes || 2 * 1024 * 1024 * 1024),
            maxNodes: 200000,
            sessionTtlMs: 12 * 60 * 60 * 1000,
            ...(file.limits || {}),
        },

        /* ---- the air gap ---- */
        airgap: {
            enabled: file.airgap?.enabled !== false && env.MIXT_AIRGAP !== '0',
            allow: (env.MIXT_ALLOW_HOST || file.airgap?.allow || '')
                .split(',').map((s) => s.trim()).filter(Boolean),
        },

        /* ---- terminal ----
           A standard account's shell is a jailed one: it can only reach that
           account's own files, through the filesystem service. An
           administrator may be given a shell on the host itself, and that is
           off until somebody turns it on, because it is the one setting here
           with teeth. */
        terminal: {
            hostShell: env.MIXT_HOST_SHELL === '1' || file.terminal?.hostShell === true,
            hostShellRoot: path.resolve(ROOT, file.terminal?.hostShellRoot || dataDir),
            hostShellCommand: file.terminal?.hostShellCommand ||
                (process.platform === 'win32' ? 'powershell.exe' : '/bin/sh'),
            maxOutputBytes: 256 * 1024,
            historySize: 200,
            ...(file.terminal || {}),
        },

        /* ---- hosting ----
           A directory in an account can be published as a website, served from
           this machine at /site/<name>/. Nothing leaves the LAN. */
        hosting: { enabled: file.hosting?.enabled !== false, ...(file.hosting || {}) },

        /* ---- webdav ---- */
        webdav: { enabled: file.webdav?.enabled !== false, mountPath: '/webdav', ...(file.webdav || {}) },

        ...overrides,
    };

    cfg.url = cfg.publicOrigin || `http://${cfg.hostname}.${cfg.domain}:${cfg.port}`;
    return cfg;
}
