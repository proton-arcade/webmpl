/**
 * Permissions.
 *
 * One rule, applied everywhere: a request names an actor and a node, and the
 * answer is what that actor may do to that node. Nothing else in the server
 * decides who is allowed to open a file, so there is exactly one place to look
 * when the answer is wrong.
 *
 *   owner    the account the node belongs to
 *   admin    the administrator, who can reach anything on this computer —
 *            which is what an administrator is for, and why the account is
 *            behind the root password in ROOTPASS.md
 *   write    through a share that grants write
 *   read     through a share that grants read
 *   null     nothing
 *
 * A share covers everything underneath the node it was made on, and is looked
 * up at the moment of the request rather than copied onto the files, so
 * revoking one takes the access away everywhere at once.
 */
import { BaseService } from '../lib/container.js';
import { forbidden, notFound } from '../lib/errors.js';

const RANK = { read: 1, write: 2, owner: 3, admin: 4 };

export class ACLService extends BaseService {
    static SERVICE_NAME = 'acl';
    static DEPENDENCIES = [];

    async _init () {
        this.shares = this.stores.get('share');
        this.entries = this.stores.get('fsentry');
    }

    /** What an actor holds on a node: 'admin' | 'owner' | 'write' | 'read' | null. */
    grant (actor, node) {
        if (!actor) return null;
        if (actor.role === 'admin') return 'admin';
        if (!node) return null;
        if (node.owner && actor.ownerId && node.owner === actor.ownerId) return 'owner';
        return this._shareGrant(actor, node);
    }

    _shareGrant (actor, node) {
        if (!node || !this.shares) return null;
        let best = null;
        for (const share of this.shares.allActive()) {
            if (share.ownerUid && share.ownerUid === actor.ownerId) continue; // it's yours already
            if (!share.public && share.withUid !== actor.uid) continue;
            if (!this._covers(share.nodeUid, node.uid)) continue;
            if (!best || RANK[share.permission] > RANK[best]) best = share.permission;
        }
        return best;
    }

    /** True when `nodeUid` is `ancestorUid` or somewhere beneath it. */
    _covers (ancestorUid, nodeUid) {
        if (ancestorUid === nodeUid) return true;
        let cur = this.entries.node(nodeUid);
        let guard = 0;
        while (cur && cur.parent !== null && guard++ < 256) {
            if (cur.parent === ancestorUid) return true;
            cur = this.entries.node(cur.parent);
        }
        return false;
    }

    canRead (actor, node) { return !!this.grant(actor, node); }
    canWrite (actor, node) {
        const grant = this.grant(actor, node);
        return grant === 'owner' || grant === 'admin' || grant === 'write';
    }
    canDelete (actor, node) {
        const grant = this.grant(actor, node);
        return grant === 'owner' || grant === 'admin';
    }

    assertRead (actor, node, path) {
        if (!node) throw notFound('no_entry', `${path || 'that'}: no such file or directory.`);
        if (!this.canRead(actor, node)) {
            throw forbidden('forbidden', `${path || 'That'} is not yours to read.`);
        }
        return node;
    }

    assertWrite (actor, node, path) {
        if (!node) throw notFound('no_entry', `${path || 'that'}: no such file or directory.`);
        if (!this.canWrite(actor, node)) {
            throw forbidden('read_only', `${path || 'That'} is read-only for you.`);
        }
        return node;
    }

    /** Directories can only be created by somebody who owns the place. */
    assertOwner (actor, node, path) {
        const grant = this.grant(actor, node);
        if (grant !== 'owner' && grant !== 'admin') {
            throw forbidden('forbidden', `${path || 'That'} is not yours to change.`);
        }
        return node;
    }
}
