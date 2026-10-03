// Who may make this plugin fetch a URL. Pure, so tests pin it down.

/**
 * Origins that are the person's own gesture: Enter at the terminal, or their
 * message through the Remote Control bridge. Every other origin (another
 * session, a relayed channel, a scheduled task, a plugin, an unattested
 * socket) is someone or something else, and gets the Load button instead.
 */
const PERSONAL_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge'])

export function isPersonalOrigin(kind: string): boolean {
  return PERSONAL_ORIGINS.has(kind)
}

/**
 * Automount roots keyed by host name (macOS `/net` and `/Network`, the Linux
 * autofs `-hosts` map at `/net`). A bare stat of `/net/<host>/...` makes the
 * machine look up and contact that host, so a path in a reply could carry
 * data out in a DNS name without anyone pressing Load.
 */
const HOST_AUTOMOUNTS = ['/net', '/network']

/** Compared without case: macOS file systems are case-insensitive by default, so `/NET` is `/net`. */
export function isHostAutomount(absolute: string): boolean {
  const lower = absolute.toLowerCase()
  return HOST_AUTOMOUNTS.some(root => lower === root || lower.startsWith(`${root}/`))
}

/** What `resolveOutsideAutomounts` needs from a stat: the engine's `$.fs.stat` with `resolve: true`. */
export type ResolvedStat = { kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number; realPath?: string }

/**
 * Resolves `path` (relative to `cwd`) one component at a time, the way the
 * kernel does, and never stats a path under a host-keyed automount root.
 *
 * Checking the spelling alone is not enough: existing links reach the root
 * from elsewhere (`/Volumes/Macintosh HD` on macOS, `/proc/self/root` on
 * Linux), so `/Volumes/Macintosh HD/net/<host>/x.png` lands in `/net`. Each
 * component is checked against its parent's real path before it is touched,
 * then its own real path (links followed) becomes the next parent.
 *
 * @returns the final component's stat with its real path, or undefined when
 *   any component is missing or would land under an automount root
 */
export async function resolveOutsideAutomounts(
  path: string,
  cwd: string,
  stat: (path: string) => Promise<ResolvedStat | undefined>,
): Promise<(ResolvedStat & { realPath: string }) | undefined> {
  const full = path.startsWith('/') ? path : `${cwd}/${path}`
  let current = '/'
  let last: ResolvedStat | undefined

  for (const part of full.split('/')) {
    if (part === '' || part === '.') {
      continue
    }
    if (part === '..') {
      current = current.slice(0, current.lastIndexOf('/')) || '/'
      last = undefined
      continue
    }

    const candidate = current === '/' ? `/${part}` : `${current}/${part}`
    if (isHostAutomount(candidate)) {
      return undefined
    }
    const found = await stat(candidate)
    if (found?.realPath === undefined || isHostAutomount(found.realPath)) {
      return undefined
    }
    current = found.realPath
    last = found
  }

  return last?.realPath === undefined ? undefined : { ...last, realPath: last.realPath }
}
