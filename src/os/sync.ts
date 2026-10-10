/**
 * The mirror.
 *
 * The desktop keeps a whole filesystem in memory, which is why every
 * application is instant: reading a file is a property lookup. What makes that
 * a *mirror* rather than a second, private filesystem is this module — every
 * change is streamed to the server as an operation, and every change anybody
 * else makes comes back and replaces the tree.
 *
 * Three rules keep it honest:
 *
 *  1. **Operations, not snapshots.** A rename is a rename on the server's disk;
 *     the bytes never move, and a 40 MB video does not get uploaded because its
 *     name changed.
 *  2. **Revisions, not hope.** Each batch carries the revision it was editing
 *     at. If the server has moved on, the batch is refused (409) and the tree
 *     is re-read — two people editing the same folder on the same machine is a
 *     real thing, and silently picking a winner loses one of their work.
 *  3. **Nothing is lost when the network is not there.** A failed batch stays
 *     in the queue and is retried, so closing a laptop lid mid-edit is an
 *     inconvenience and not a data loss.
 *
 * A guest has no mirror at all: nothing is sent, and nothing they do outlives
 * the session.
 */
import * as api from './api'
import { getSession } from './api'

export interface FsOp extends api.FsOp {}

/** Called when the server's tree replaces the one in memory. */
type AdoptListener = (root: unknown, rev: number) => void
/** Called when the connection state changes, so the panel can say so. */
type StatusListener = (status: MirrorStatus) => void

export interface MirrorStatus {
  online: boolean
  pending: number
  rev: number
  syncing: boolean
  lastError: string | null
}

let owner = ''
let ownerRev = 0
let queue: FsOp[] = []
let sending = false
let flushTimer: any = null
let adoptListener: AdoptListener | null = null
let statusListeners = new Set<StatusListener>()
let source: EventSource | null = null
let refetchTimer: any = null
let lastError: string | null = null
let lastSeq = 0

/* --------------------------------- plumbing -------------------------------- */

export function onAdopt (fn: AdoptListener | null) { adoptListener = fn }

/* Set by the desktop: "somebody else's files moved". An administrator's /users
   window is a view of those files, so it is the one thing that has to be read
   again when another account changes theirs. */
let otherListener: (() => void) | null = null
export function onOtherChange (fn: (() => void) | null) { otherListener = fn }

export function onStatus (fn: StatusListener): () => void {
  statusListeners.add(fn)
  fn(status())
  return () => statusListeners.delete(fn)
}

export function status (): MirrorStatus {
  return { online: !!getSession() && lastError === null, pending: queue.length, rev: ownerRev, syncing: sending, lastError }
}

function announce () {
  const current = status()
  for (const listener of [...statusListeners]) {
    try { listener(current) } catch { /* a listener must not break the mirror */ }
  }
}

/** Start mirroring for an account. Called when somebody signs in. */
export function configure (who: string, rev = 0) {
  owner = who || ''
  ownerRev = rev || 0
  queue = []
  lastSeq = 0
  lastError = null
  announce()
}

export function stop () {
  owner = ''
  ownerRev = 0
  queue = []
  closeStream()
  announce()
}

export const getRev = () => ownerRev
export const getOwner = () => owner

/* ---------------------------------- writes --------------------------------- */

/**
 * Record one change.
 *
 * The desktop has already applied it locally — that is what makes typing
 * instant — so this only has to make sure the server hears about it. Batches
 * are debounced because unpacking an archive is two hundred writes and should
 * be one request.
 */
export function enqueue (op: FsOp) {
  if (!owner) return
  queue.push(op)
  announce()
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => { flushTimer = null; void flush() }, 220)
}

/** Send the queue now. Used on sign-out, on the visibility change, and by tests. */
export function flushNow () {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  return flush()
}

export async function flush (): Promise<boolean> {
  if (!owner || sending || !queue.length) return false
  sending = true
  announce()
  const batch = queue
  queue = []
  try {
    const result = await api.fsOps(batch, ownerRev)
    if (result.ok && result.rev !== undefined) {
      ownerRev = result.rev
      lastError = null
      sending = false
      announce()
      /* Something else may have changed while this was in flight. */
      if (queue.length) void flush()
      return true
    }
    if (result.conflict) {
      /* Somebody else edited the tree. Take theirs, keep ours: the queued
         operations are re-applied locally by the caller that adopted the
         tree, and re-sent on the next flush. */
      queue = [...batch]
      await pull({ force: true, keepQueue: true })
      sending = false
      announce()
      return false
    }
    lastError = 'The server did not take that.'
    queue = [...batch, ...queue]
  } catch {
    lastError = 'Cannot reach the Mixt server.'
    queue = [...batch, ...queue]
  }
  sending = false
  announce()
  /* Retry, but not in a tight loop: a server that is down should not be
     hammered by twenty open windows. */
  setTimeout(() => { if (queue.length) void flush() }, 4000)
  return false
}

/* ---------------------------------- reads ---------------------------------- */

/**
 * Replace the in-memory tree with the server's.
 *
 * `keepQueue` leaves pending operations in place, which is what a conflict
 * wants: adopt their tree, then re-send what you were doing on top of it.
 */
export async function pull ({ force = false, keepQueue = false } = {}): Promise<boolean> {
  if (!owner) return false
  if (!keepQueue && (sending || queue.length)) {
    /* A local edit is in flight. Adopting now would throw it away, so wait
       for the flush and try again in a moment. */
    if (refetchTimer) clearTimeout(refetchTimer)
    refetchTimer = setTimeout(() => { refetchTimer = null; void pull({ force }) }, 250)
    return false
  }
  const tree = await api.fsTree()
  if (!tree) return false
  if (!force && tree.rev === ownerRev) return false
  ownerRev = tree.rev
  lastError = null
  try {
    adoptListener?.(tree.root, tree.rev)
  } catch {
    /* A broken adopt must not leave the mirror thinking it is up to date */
  }
  announce()
  return true
}

/** Throw the filesystem away and take the server's fresh one. */
export async function reset () {
  queue = []
  const ok = await api.fsReset()
  await pull({ force: true })
  return ok
}

/* ---------------------------------- stream ---------------------------------- */

/**
 * Listen for what everybody else is doing.
 *
 * Server-Sent Events, with the token in the query string because an
 * `EventSource` cannot set a header. The server filters by account, and this
 * filters again on the owner's name: an administrator is told about every
 * change on the machine and should only adopt their own tree.
 */
export function openStream () {
  closeStream()
  const session = getSession()
  if (!session || typeof EventSource === 'undefined') return null
  try {
    const url = `/api/events?token=${encodeURIComponent(session.token)}&since=${lastSeq}`
    source = new EventSource(url)
    for (const type of ['fs.changed', 'mail.arrived', 'notification', 'settings.changed']) {
      source.addEventListener(type, (event: any) => {
        let payload: any = {}
        try { payload = JSON.parse(event.data || '{}') } catch { /* ignore */ }
        lastSeq = Math.max(lastSeq, Number(payload.seq) || 0)
        if (type === 'fs.changed') {
          /* The administrator hears about every account; only your own tree
             should replace the one you are looking at. */
          if (payload.owner && session.username && payload.owner !== session.username) {
            otherListener?.()
            return
          }
          if (refetchTimer) clearTimeout(refetchTimer)
          refetchTimer = setTimeout(() => { refetchTimer = null; void pull({ force: true }) }, 300)
          return
        }
        window.dispatchEvent(new CustomEvent(`mixt:${type.replace('.', ':')}`, { detail: payload }))
      })
    }
    source.onerror = () => { /* EventSource reconnects on its own */ }
  } catch {
    source = null
  }
  return source
}

export function closeStream () {
  try { source?.close() } catch { /* already closed */ }
  source = null
}
