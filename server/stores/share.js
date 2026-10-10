/**
 * Shares.
 *
 * A share turns one node into something another account can open, by name or
 * by link. It is deliberately small: a share grants read or write on a subtree
 * and nothing else, and revoking it takes the access away everywhere at once
 * because the permission is looked up at the moment of the request rather than
 * copied onto the files.
 */
import { BaseStore } from '../lib/container.js';
import { notFound } from '../lib/errors.js';
import { slug } from '../lib/util.js';

export class ShareStore extends BaseStore {
    static SERVICE_NAME = 'share';

    async _init () { this.t = this.db.table('shares'); }

    create ({ ownerUid, nodeUid, path, permission = 'read', public: isPublic = false, withUid = null, expires = null }) {
        return this.t.insert({
            token: slug(12),
            ownerUid,
            nodeUid,
            path,
            permission: permission === 'write' ? 'write' : 'read',
            public: !!isPublic,
            /* A share is either for one account or for anybody who has the
               link. Both at once would make the permission impossible to
               reason about — and impossible to revoke for just one person. */
            withUid: isPublic ? null : (withUid || null),
            expires: expires || null,
            revoked: false,
        });
    }

    byToken (tokenValue) {
        if (!tokenValue) return null;
        const share = this.t.findOne((s) => s.token === tokenValue && !s.revoked);
        if (!share) return null;
        if (share.expires && Date.now() > share.expires) return null;
        return share;
    }

    forOwner (ownerUid) { return this.t.find((s) => s.ownerUid === ownerUid && !s.revoked); }

    /** Everything shared with anybody, which is what the sharing panel shows. */
    allActive () { return this.t.find((s) => !s.revoked); }

    revoke (tokenValue, ownerUid = null) {
        const share = this.t.findOne((s) => s.token === tokenValue);
        if (!share) throw notFound('no_share', 'There is no such share.');
        if (ownerUid && share.ownerUid !== ownerUid) {
            throw notFound('no_share', 'There is no such share.');
        }
        this.t.update((s) => s.token === tokenValue, { revoked: true });
        return true;
    }

    /** Shares that reach a path — used when a node moves, and by the ACL check. */
    covering (nodeUid) {
        return this.allActive().filter((s) => s.nodeUid === nodeUid);
    }
}
