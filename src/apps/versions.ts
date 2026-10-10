/* Package versions.
 *
 * Everything installs at INSTALLED_VERSION. The repository carries newer builds
 * for a few packages, and those — and only those — are updates. An application
 * you have never installed is an extra to install, not an update, which is the
 * difference the Updates tab used to get wrong.
 */
export const INSTALLED_VERSION = '1.0.0'

/** package id -> the version the repository is offering */
export const REPO_VERSIONS: Record<string, string> = {
  browser: '1.1.0',
  'system-monitor': '1.0.1',
  xed: '1.0.2',
  mediaplayer: '3.0.25',
}

/** The version currently on this computer. */
export function installedVersion(id: string, applied: Record<string, string> = {}): string {
  return applied[id] ?? INSTALLED_VERSION
}

/** The newest version the repository has, whether or not it is an update. */
export function repoVersion(id: string): string {
  return REPO_VERSIONS[id] ?? INSTALLED_VERSION
}

/** True when the repository has something newer than what is installed. */
export function hasUpdate(id: string, applied: Record<string, string> = {}): boolean {
  const latest = REPO_VERSIONS[id]
  return !!latest && latest !== installedVersion(id, applied)
}

/** "1.0.0 → 1.1.0", or just the version when there is nothing newer. */
export function versionLabel(id: string, applied: Record<string, string> = {}): string {
  const now = installedVersion(id, applied)
  const latest = repoVersion(id)
  return latest === now ? now : `${now} → ${latest}`
}
