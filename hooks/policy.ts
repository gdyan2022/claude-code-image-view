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

/** `path` made absolute against `cwd`, with `.` and `..` resolved by spelling alone. */
export function absolutePath(path: string, cwd: string): string {
  const parts: string[] = []
  for (const part of (path.startsWith('/') ? path : `${cwd}/${path}`).split('/')) {
    if (part === '..') {
      parts.pop()
    } else if (part !== '' && part !== '.') {
      parts.push(part)
    }
  }
  return `/${parts.join('/')}`
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
