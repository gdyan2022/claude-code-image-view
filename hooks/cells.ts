// The shape of one terminal cell, measured from the terminal's pixel size.
//
// A picture is stretched to fill its box of cells, so the box must match the
// cell's real shape: a font's line height (Ghostty's adjust-cell-height, say)
// makes cells taller than the usual 2:1 and draws every picture too tall.
// Measured like the pictures are prepared, in session.start's dispatch and
// never in a render's; a render only notes the viewport width it was given.

import type { Io } from './prepare'
import { DEFAULT_CELL_ASPECT } from './refs'

/**
 * Prints `rows columns xpixel ypixel` for Claude Code's terminal. A child has
 * no controlling tty, so it walks up the parent processes to the first one
 * with a tty and asks that tty for its window size (TIOCGWINSZ).
 */
export const MEASURE_SCRIPT = `
import fcntl, os, struct, subprocess, termios
pid = os.getppid()
while pid > 1:
    tty, ppid = (subprocess.run(['ps', '-o', 'tty=,ppid=', '-p', str(pid)], capture_output=True, text=True).stdout.split() + ['?', '0'])[:2]
    if tty not in ('?', '??'):
        fd = os.open('/dev/' + tty, os.O_RDONLY | os.O_NOCTTY)
        print(*struct.unpack('HHHH', fcntl.ioctl(fd, termios.TIOCGWINSZ, bytes(8))))
        break
    pid = int(ppid)
`

export const MEASURE_ARGV: readonly string[] = ['python3', '-c', MEASURE_SCRIPT]

/**
 * A cell's height over its width from `rows columns xpixel ypixel`, or
 * undefined when the terminal reports no pixels (zeros) or a shape no
 * monospace font has, as some multiplexers and ssh sessions do.
 */
export function parseWinsize(stdout: string): number | undefined {
  const [rows = 0, columns = 0, width = 0, height = 0] = stdout.trim().split(/\s+/).map(Number)
  if (!(rows > 0 && columns > 0 && width > 0 && height > 0)) {
    return undefined
  }
  const aspect = height / rows / (width / columns)
  return aspect >= 1.25 && aspect <= 3.4 ? aspect : undefined
}

let aspect = DEFAULT_CELL_ASPECT
let measuredColumns: number | undefined
let isStale = true
let wake: (() => void) | undefined
let isWatching = false

export function cellAspect(): number {
  return aspect
}

/**
 * Notes the viewport width a render was given. A font zoom always changes the
 * column count, and fonts snap to whole pixels, so a new width asks for a new
 * measurement. Makes no host call itself, so a render hook may call it.
 */
export function noteColumns(columns: number | undefined): void {
  if (columns === undefined || columns === measuredColumns) {
    return
  }
  measuredColumns = columns
  isStale = true
  wake?.()
}

/**
 * Measures now and again whenever a render notes a new width, for the rest of
 * the module's life. Call it from session.start without awaiting. A changed
 * shape redraws every drawing of this plugin.
 */
export async function watchCells(io: Io): Promise<void> {
  if (isWatching) {
    return
  }
  isWatching = true

  for (;;) {
    if (!isStale) {
      await new Promise<void>(resolve => (wake = resolve))
      wake = undefined
      continue
    }
    isStale = false
    const run = await io.run([...MEASURE_ARGV], { timeoutMs: 5000 }).catch(() => undefined)
    const measured = run?.exitCode === 0 ? parseWinsize(run.stdout) : undefined
    if (measured !== undefined && Math.abs(measured - aspect) >= 0.01) {
      aspect = measured
      io.redraw()
    }
  }
}
