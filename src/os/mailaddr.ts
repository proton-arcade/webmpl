/**
 * The mail addresses on this machine.
 *
 * Every address the desktop shows is local: the server that carries the mail
 * runs on the same computer and never relays anything outward, and neither
 * domain resolves in real DNS — `.mpl` is not a top-level domain that exists.
 * So nothing here can reach the internet, and nothing needs to.
 *
 *   whitelisted accounts   name@proper.com
 *   guests                 NAME@Guest.MPL
 *
 * A guest's address is their own rather than one shared guest mailbox, so two
 * people using the same computer do not read each other's mail.
 */
import { getSession } from './api'

export const USER_DOMAIN = 'proper.com'
export const GUEST_DOMAIN = 'Guest.MPL'

/** the address the signed-in identity is reached at */
export function localAddress(username: string): string {
  const session = getSession()
  if (session?.role === 'guest') {
    const name = String(session.username || username || 'guest').trim() || 'guest'
    return `${name}@${GUEST_DOMAIN}`
  }
  return `${username}@${USER_DOMAIN}`
}

/** does this address belong to a guest mailbox? */
export function isGuestAddress(address: string): boolean {
  return /@guest\.mpl$/i.test(String(address || '').trim())
}

/** the local part of an address, whatever the domain */
export function localPart(address: string): string {
  const raw = String(address || '').trim()
  const at = raw.lastIndexOf('@')
  return at < 0 ? raw : raw.slice(0, at)
}
