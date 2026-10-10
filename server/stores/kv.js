/**
 * Key-value storage, one namespace per account.
 *
 * This is where the desktop keeps what an OS remembers: the panel position,
 * the wallpaper, the theme, which apps are installed, the window geometry.
 * Puter calls the same idea a KV store and scopes it the same way — the key is
 * the account plus a namespace, so two people cannot overwrite each other's
 * settings by both being signed in.
 *
 * Guests are never given a row. A guest session is memory and nothing else, and
 * the services below refuse the write before it gets here rather than after.
 */
import { BaseStore } from '../lib/container.js';

export class KVStore extends BaseStore {
    static SERVICE_NAME = 'kv';

    async _init () { this.t = this.db.table('kv'); }

    _key (ownerUid, namespace) { return `${ownerUid || 'anon'}:${namespace}`; }

    get (ownerUid, namespace, fallback = null) {
        if (!ownerUid) return fallback;
        const row = this.t.findOne((r) => r.key === this._key(ownerUid, namespace));
        return row ? row.value : fallback;
    }

    set (ownerUid, namespace, value) {
        if (!ownerUid) return null;
        const key = this._key(ownerUid, namespace);
        const row = this.t.findOne((r) => r.key === key);
        if (row) this.t.update((r) => r.key === key, { value });
        else this.t.insert({ key: this._key(ownerUid, namespace), value, owner: ownerUid, namespace });
        this.db.dirty();
        return value;
    }

    remove (ownerUid, namespace) {
        return this.t.remove((r) => r.key === this._key(ownerUid, namespace)) > 0;
    }

    namespacesFor (ownerUid) {
        return this.t.find((r) => r.owner === ownerUid).map((r) => r.namespace);
    }

    count () { return this.t.count(); }

    /** Everything an account has saved, for the console's "what is being kept". */
    report (ownerUid) {
        return this.t.find((r) => r.owner === ownerUid)
            .map((r) => ({ namespace: r.namespace, bytes: JSON.stringify(r.value ?? null).length, updated: r.modified || r.created }));
    }
}
