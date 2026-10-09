/* Where the Mail app keeps its offline copy of a mailbox.
 *
 * One file per account, not one shared file: two people using the same browser
 * share localStorage, so a single messages.json would show the next person to
 * sign in everything the last one read. The server holds the real mailbox; this
 * is only the local cache that makes the app work with no backend at all. */
import { vfs } from '../os/vfs'

export interface CachedMessage {
  id: string
  folder: string
  [key: string]: unknown
}

export const mailStorePath = (user: string) => `/home/mixt/.config/mixtmail/${user}.json`

export function readMailCache(user: string): CachedMessage[] {
  try {
    const raw = vfs.read(mailStorePath(user))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as CachedMessage[]) : []
  } catch {
    return []
  }
}

export function writeMailCache(user: string, messages: unknown[]): void {
  try {
    vfs.mkdirp('/home/mixt/.config/mixtmail')
    vfs.write(mailStorePath(user), JSON.stringify(messages, null, 2), 'application/json')
  } catch {
    /* a blocked or full store must not cost the user their session */
  }
}
