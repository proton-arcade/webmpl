/**
 * Object storage — the layer that holds the bytes.
 *
 * Puter puts file contents in S3 (or a local stand-in) and keeps only metadata
 * in the database, which is what lets a file be renamed without rewriting it.
 * Same split here: `stores/fsentry` knows names, parents and permissions, this
 * knows how to turn a uid into bytes. The backing store is a directory on disk,
 * sharded by the first two characters of the key the way an object store
 * shards by prefix, so one folder never holds a million files.
 */
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { BaseClient } from '../lib/container.js';
import { ensureDir } from '../lib/util.js';

export class BlobStore extends BaseClient {
    static SERVICE_NAME = 'blobstore';

    async _init () {
        this.dir = this.config.blobDir;
        await ensureDir(this.dir);
        this.stats = { puts: 0, gets: 0, deletes: 0, bytes: 0 };
    }

    pathFor (key) {
        const safe = String(key).replace(/[^A-Za-z0-9._-]/g, '');
        return path.join(this.dir, safe.slice(0, 2) || '__', safe);
    }

    async put (key, data) {
        const file = this.pathFor(key);
        await fsp.mkdir(path.dirname(file), { recursive: true });
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
        await fsp.writeFile(file, buffer);
        this.stats.puts++;
        this.stats.bytes += buffer.length;
        return { key, size: buffer.length, path: file };
    }

    async get (key) {
        try {
            this.stats.gets++;
            return await fsp.readFile(this.pathFor(key));
        } catch {
            return null;
        }
    }

    async remove (key) {
        try {
            await fsp.rm(this.pathFor(key), { force: true });
            this.stats.deletes++;
            return true;
        } catch {
            return false;
        }
    }

    async size (key) {
        try {
            const st = await fsp.stat(this.pathFor(key));
            return st.size;
        } catch {
            return null;
        }
    }

    exists (key) { return fs.existsSync(this.pathFor(key)); }

    /** Total bytes on disk, for the quota and for the Administration console. */
    usage () {
        let bytes = 0;
        let files = 0;
        const walk = (dir) => {
            let entries = [];
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else {
                    try { bytes += fs.statSync(full).size; files++; } catch { /* gone */ }
                }
            }
        };
        walk(this.dir);
        return { bytes, files };
    }

    report () { return { dir: this.dir, usage: this.usage(), ...this.stats }; }
}
