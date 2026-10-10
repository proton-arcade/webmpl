/**
 * The database client.
 *
 * Puter talks to SQLite or Postgres through a client layer so the stores above
 * it never see SQL. This machine talks to one JSON file for the same reason the
 * rest of it is dependency-free: `node server/index.js` has to work on a laptop
 * that has never heard of npm, and a personal computer on a LAN does not need a
 * database server to tell it what is in your Documents folder.
 *
 * What the client gives the stores is the same either way: tables of plain
 * objects, with insert/update/delete and a query predicate. Writes are queued
 * and flushed atomically (temp file, then rename), so a power cut mid-write
 * costs the last few seconds rather than the whole machine.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { BaseClient } from '../lib/container.js';
import { atomicWriteFile, debounce, uid } from '../lib/util.js';

export class Table {
    constructor (db, name) {
        this.db = db;
        this.name = name;
    }

    get rows () { return this.db.data[this.name] || (this.db.data[this.name] = []); }

    all () { return this.rows.slice(); }

    find (predicate) { return this.rows.filter(predicate); }

    findOne (predicate) {
        for (const row of this.rows) if (predicate(row)) return row;
        return null;
    }

    /** Rows are copied on the way in and out: a caller mutating what it got
        back must not be able to change the database by accident. */
    insert (row) {
        const record = { ...row, uid: row.uid || uid(), created: row.created || Date.now() };
        this.rows.push(record);
        this.db.dirty();
        return { ...record };
    }

    update (predicate, patch) {
        let n = 0;
        for (const row of this.rows) {
            if (!predicate(row)) continue;
            const next = typeof patch === 'function' ? patch(row) : patch;
            Object.assign(row, next, { modified: Date.now() });
            n++;
        }
        if (n) this.db.dirty();
        return n;
    }

    remove (predicate) {
        const before = this.rows.length;
        const kept = this.rows.filter((r) => !predicate(r));
        if (kept.length !== before) {
            this.db.data[this.name] = kept;
            this.db.dirty();
        }
        return before - kept.length;
    }

    count (predicate) { return predicate ? this.find(predicate).length : this.rows.length; }

    clear () {
        const n = this.rows.length;
        this.db.data[this.name] = [];
        if (n) this.db.dirty();
        return n;
    }
}

export class DatabaseClient extends BaseClient {
    static SERVICE_NAME = 'database';

    async _init () {
        this.file = this.config.dbFile;
        this.log = this.ctx.log.child('db');
        await fsp.mkdir(path.dirname(this.file), { recursive: true });
        this.data = await this._load();
        this.writeQueue = Promise.resolve();
        this.flushing = false;
        /* Debounced so a burst of writes (unpacking an archive) is one flush,
           with a hard bound so a write is never more than a moment from disk. */
        this.scheduleFlush = debounce(() => { this.writeQueue = this.writeQueue.then(() => this._flush()); }, 250);
        this.stats = { reads: 0, writes: 0, flushes: 0, lastFlush: null };
    }

    async _load () {
        this.stats && this.stats.reads++;
        try {
            const raw = await fsp.readFile(this.file, 'utf8');
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
            /* Every table is an array, whatever the file on disk happens to
               hold: a hand-edited data file should not crash the machine. */
            const out = {};
            for (const [k, v] of Object.entries(parsed)) {
                if (k.startsWith('_')) { out[k] = v; continue; }
                out[k] = Array.isArray(v) ? v : [];
            }
            return out;
        } catch (e) {
            if (fs.existsSync(this.file)) {
                /* A damaged file is renamed, not deleted: whatever was in it is
                   still there for the person who needs it. */
                const broken = `${this.file}.broken-${Date.now()}`;
                try { await fsp.rename(this.file, broken); } catch { /* best effort */ }
                this.log?.warn?.(`could not read ${this.file} (${e.message}); ` +
                    `kept as ${path.basename(broken)} and starting empty`);
            }
            return {};
        }
    }

    table (name) {
        if (!this.data[name]) this.data[name] = [];
        return new Table(this, name);
    }

    dirty () {
        this.stats.writes++;
        this.scheduleFlush();
    }

    async _flush () {
        if (this.flushing) return;
        this.flushing = true;
        try {
            const payload = JSON.stringify(this.data, null, 1);
            await atomicWriteFile(this.file, payload);
            this.stats.flushes++;
            this.stats.lastFlush = Date.now();
        } catch (e) {
            this.log?.error?.(`could not save the database: ${e.message}`);
        } finally {
            this.flushing = false;
        }
    }

    /** Write now — used on shutdown and after anything that must survive a crash. */
    async flush () {
        this.scheduleFlush.flush?.();
        this.writeQueue = this.writeQueue.then(() => this._flush());
        return this.writeQueue;
    }

    async _destroy () { await this.flush(); }

    report () {
        const tables = {};
        for (const [name, rows] of Object.entries(this.data)) {
            if (Array.isArray(rows)) tables[name] = rows.length;
        }
        return { file: this.file, tables, ...this.stats, bytes: this._bytes() };
    }

    _bytes () {
        try { return fs.statSync(this.file).size; } catch { return 0; }
    }
}
