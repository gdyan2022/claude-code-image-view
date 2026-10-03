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

/** One directory entry as it stands, links not followed: what `$.fs.list` answers. */
export type DirEntry = { name: string; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number; isLink: boolean }

/** How a path is walked: listing a directory and reading a link, neither following a link. */
export type Walker = {
  list: (dir: string) => Promise<readonly DirEntry[] | undefined>
  readlink: (link: string) => Promise<string | undefined>
}

export type ResolvedFile = { realPath: string; size: number; mtimeMs: number }

/** The kernel's own cap on links followed while resolving one path. */
const MAX_LINKS = 40

const join = (dir: string, name: string): string => (dir === '/' ? `/${name}` : `${dir}/${name}`)

/**
 * Resolves `path` (relative to `cwd`) to a regular file one component at a
 * time, the way the kernel does, without ever following a link it has not
 * checked first, and never lists, reads or stats anything under a host-keyed
 * automount root.
 *
 * A spelling check is not enough, since links to / exist on stock systems
 * (`/Volumes/Macintosh HD`, `/proc/self/root`); and a stat follows a link
 * before its target can be checked, so a link in a cloned repository
 * (`docs/diagram.png -> /net/<host>/x.png`) would reach the automounter. Each
 * component is looked up in its parent's listing, which shows a link as a
 * link; a link's target is read with readlink and walked component by
 * component the same way.
 *
 * @returns the file's real path, size and mtime, or undefined when a component
 *   is missing, a link loops, the path ends anywhere but a regular file, or it
 *   would reach an automount root
 */
export async function resolveOutsideAutomounts(path: string, cwd: string, walker: Walker): Promise<ResolvedFile | undefined> {
  const pending = (path.startsWith('/') ? path : `${cwd}/${path}`).split('/')
  let current = '/'
  let links = 0
  let file: DirEntry | undefined

  while (pending.length > 0) {
    const part = pending.shift() ?? ''
    if (part === '' || part === '.') {
      continue
    }
    if (file !== undefined) {
      return undefined
    }
    if (part === '..') {
      current = current.slice(0, current.lastIndexOf('/')) || '/'
      continue
    }

    if (isHostAutomount(join(current, part))) {
      return undefined
    }
    const entries = await walker.list(current)
    const wanted = part.normalize('NFC')
    const entry = entries?.find(one => one.name.normalize('NFC') === wanted)
    if (entry === undefined || isHostAutomount(join(current, entry.name))) {
      return undefined
    }

    if (entry.isLink) {
      links += 1
      const target = links > MAX_LINKS ? undefined : await walker.readlink(join(current, entry.name))
      if (target === undefined || target === '') {
        return undefined
      }
      if (target.startsWith('/')) {
        current = '/'
      }
      pending.unshift(...target.split('/'))
    } else if (entry.kind === 'dir') {
      current = join(current, entry.name)
    } else if (entry.kind === 'file') {
      current = join(current, entry.name)
      file = entry
    } else {
      return undefined
    }
  }

  return file === undefined ? undefined : { realPath: current, size: file.size, mtimeMs: file.mtimeMs }
}
