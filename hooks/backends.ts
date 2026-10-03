// Command lines for the image tools each platform has, and format sniffing.
// Pure: no `$` here, so tests can check every argv.

/** `sips` ships with macOS; `magick` is ImageMagick 7; `convert` is ImageMagick 6. */
export type Backend = 'sips' | 'magick' | 'convert'

/** Tried in order; the first whose probe exits 0 is used for the session. */
export const BACKEND_PROBES: ReadonlyArray<readonly [Backend, readonly string[]]> = [
  ['sips', ['sips', '--help']],
  ['magick', ['magick', '-version']],
  ['convert', ['convert', '-version']],
]

/** The formats we hand to a converter, by the ImageMagick coder that reads them. */
export type Format = 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'tiff' | 'heic'

const ascii = (bytes: readonly number[], from: number, to: number): string =>
  String.fromCharCode(...bytes.slice(from, to))

/**
 * The image format from a file's first 16 bytes, or undefined for anything
 * else. Converters only ever see these formats: ImageMagick picks a coder by
 * content otherwise, and some of its coders (MVG, MSL, ...) are attack surface
 * for a file downloaded from a URL a reply named.
 */
export function sniffFormat(head: readonly number[]): Format | undefined {
  const starts = (...signature: number[]): boolean => signature.every((byte, at) => head[at] === byte)

  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'png'
  if (starts(0xff, 0xd8, 0xff)) return 'jpeg'
  if (ascii(head, 0, 4) === 'GIF8') return 'gif'
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return 'webp'
  if (starts(0x42, 0x4d)) return 'bmp'
  if (starts(0x49, 0x49, 0x2a, 0x00) || starts(0x4d, 0x4d, 0x00, 0x2a)) return 'tiff'
  if (ascii(head, 4, 8) === 'ftyp' && ['heic', 'heix', 'hevc', 'heim', 'mif1', 'msf1'].includes(ascii(head, 8, 12))) {
    return 'heic'
  }
  return undefined
}

/** Prints the file's first 16 bytes as base64 (`head` and `base64` exist on macOS and Linux). */
export function headArgv(file: string): string[] {
  return ['sh', '-c', 'head -c 16 "$1" | base64', 'sh', file]
}

/** Writes base64 from stdin to `file` as bytes (macOS and GNU base64 both take -d). */
export function decodeArgv(file: string): string[] {
  return ['sh', '-c', 'base64 -d > "$1"', 'sh', file]
}

/** ImageMagick input spec: an explicit coder, first frame only. */
const magickInput = (file: string, format: Format): string => `${format}:${file}[0]`

/** Prints the picture's width and height. */
export function probeArgv(backend: Backend, file: string, format: Format): string[] {
  switch (backend) {
    case 'sips':
      return ['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', file]
    case 'magick':
      return ['magick', 'identify', '-format', '%w %h\n', magickInput(file, format)]
    case 'convert':
      return ['identify', '-format', '%w %h\n', magickInput(file, format)]
  }
}

export function parseProbe(backend: Backend, stdout: string): { width: number; height: number } | undefined {
  const [width, height] =
    backend === 'sips'
      ? [/pixelWidth:\s*(\d+)/.exec(stdout)?.[1], /pixelHeight:\s*(\d+)/.exec(stdout)?.[1]]
      : (/^(\d+) (\d+)/m.exec(stdout)?.slice(1) ?? [])
  const size = { width: Number(width), height: Number(height) }

  return size.width > 0 && size.height > 0 ? size : undefined
}

/**
 * Re-encodes as PNG with the longest side at most `side`, never enlarging:
 * `sips -Z` also enlarges, so it is passed only to shrink; ImageMagick's `>`
 * flag shrinks only.
 */
export function convertArgv(
  backend: Backend,
  source: string,
  format: Format,
  out: string,
  side: number,
  longest: number,
): string[] {
  switch (backend) {
    case 'sips':
      return ['sips', '-s', 'format', 'png', ...(longest > side ? ['-Z', String(side)] : []), source, '--out', out]
    case 'magick':
    case 'convert':
      return [backend, magickInput(source, format), '-auto-orient', '-resize', `${side}x${side}>`, `png:${out}`]
  }
}

/**
 * Downloads one URL to `out`. `--globoff`: curl would otherwise expand `{a,b}`
 * and `[1-100000]` in the URL into many requests, to many hosts. Only http and
 * https, for the URL and for every redirect.
 */
export function fetchArgv(url: string, out: string): string[] {
  return [
    'curl', '--globoff', '--proto', '=http,https', '--proto-redir', '=http,https', '--max-redirs', '5',
    '-fsSL', '--max-time', '20', '--max-filesize', String(25 * 1024 * 1024), '-o', out, url,
  ]
}
