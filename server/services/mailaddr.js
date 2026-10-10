/**
 * Mail addresses, in one place.
 *
 * Two domains, both invented, neither of them resolvable in DNS, and no socket
 * is ever opened to deliver anything:
 *
 *   a whitelisted account   name@proper.com
 *   a guest                 NAME@Guest.MPL
 *
 * The client has the same file (src/os/mailaddr.ts) and the same two rules, so
 * the mail app, the webmail site and the Administration console cannot disagree
 * about what somebody's address is.
 */

export const GUEST_DOMAIN = 'Guest.MPL';
export const USER_DOMAIN = 'proper.com';

/**
 * The mailbox a session reads and writes, or null when it has none.
 *
 * A guest gets one each, keyed by the name they signed in with, so two people
 * sharing a machine cannot read each other's mail the way one shared guest
 * mailbox made them. Whether guests get mail at all is the administrator's
 * switch in the console.
 */
export function mailboxKeyFor (actor, { guestMailbox = false } = {}) {
    if (!actor) return null;
    if (actor.guest) {
        if (!guestMailbox) return null;
        const name = String(actor.username || '').trim() || 'guest';
        return `guest:${name.toLowerCase()}`;
    }
    if (actor.user && actor.user.mailbox === false) return null;
    return String(actor.username || '').toLowerCase() || null;
}

/** The address a mailbox is reached at. */
export function addressOf (key) {
    if (!key) return null;
    if (String(key).startsWith('guest:')) return `${key.slice(6)}@${GUEST_DOMAIN}`;
    return `${key}@${USER_DOMAIN}`;
}

/**
 * Turn an address somebody typed into a mailbox key.
 *
 * Returns `{ key }`, or `{ status, error }` when it cannot be delivered to.
 * The two failures are deliberately different answers: 404 is "there is nobody
 * by that name on this computer", 403 is "that person is here but their mailbox
 * is switched off". Collapsing them into one would tell somebody their
 * colleague does not exist.
 */
export function resolveAddress (to, { users = null, guestMailbox = false } = {}) {
    const raw = String(to || '').trim();
    if (!raw) return { status: 400, error: 'no recipient' };
    const at = raw.lastIndexOf('@');
    const local = (at < 0 ? raw : raw.slice(0, at)).toLowerCase();
    const domain = at < 0 ? '' : raw.slice(at + 1).toLowerCase();
    if (!local) return { status: 400, error: 'no recipient' };

    if (domain === GUEST_DOMAIN.toLowerCase()) {
        if (!guestMailbox) {
            return { status: 404, error: `no mailbox for ${local} on this computer` };
        }
        return { key: `guest:${local}` };
    }
    if (domain && domain !== USER_DOMAIN.toLowerCase()) {
        return { status: 404, error: `no mailbox for ${local} on this computer` };
    }
    if (!users) return { status: 404, error: `no mailbox for ${local} on this computer` };
    const user = users.byUsername(local);
    if (!user) return { status: 404, error: `no mailbox for ${local} on this computer` };
    if (user.mailbox === false) return { status: 403, error: `${user.username} has no mailbox` };
    return { key: String(user.username).toLowerCase() };
}
