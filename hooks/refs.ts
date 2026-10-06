// Pure helpers with no `$`: finding image references in a reply's markdown,
// pulling image blocks out of tool results, reading a PNG's size from its
// header, and fitting a picture into terminal cells. Tests import them directly.

export type ImageRef = { kind: 'file' | 'url'; raw: string }

export type InlineImage = { data: string; mime: string }

export const MAX_REFS = 6

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|bmp|tiff?|heic)$/i
const FENCED_BLOCK = /^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[ \t]*$/gm
// A line of fenced code that is one path or URL and nothing else: one token, or a
// path from /, ~/ or ./ (spaces allowed). ls output, commands and code that merely
// name a file have other words on the line.
const WHOLE_LINE_PATH = /^(?:\S+|(?:~|\.{1,2})?\/.*)$/
const MARKDOWN_TARGET = /!?\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g
const CODE_SPAN = /`([^`\n]+)`/g
const TOKEN_BREAK = /[\s`'"()<>[\]{}|,;，。；：！？、（）【】「」『』《》“”‘’]+/
// A leading ~ is stripped only as strikethrough: `~/` is the home directory.
const EDGE_MARKS = /^(?:[*_@]|~(?!\/))+|[*_~.:!?]+$/g
const OTHER_SCHEME = /^(?!https?:|file:)[a-z][a-z0-9+.-]*:\/\//i

/**
 * Image references in one block of markdown, in order and without repeats:
 * markdown image and link targets, whole inline-code paths (spaces allowed),
 * bare tokens ending in an image extension, and lines of fenced code that are
 * a path on their own. Other fenced lines are skipped, so the file names in
 * pasted command output or code are not all shown as pictures.
 */
export function findImageRefs(markdown: string): ImageRef[] {
  const refs: ImageRef[] = []
  const seen = new Set<string>()

  const add = (candidate: string, isExplicitImage: boolean): void => {
    const raw = candidate.trim().replace(EDGE_MARKS, '')
    const hasImageExt = IMAGE_EXT.test(raw.replace(/[?#].*$/, ''))
    const isUsable =
      raw !== '' && !seen.has(raw) && !OTHER_SCHEME.test(raw) && (isExplicitImage || hasImageExt)

    if (!isUsable || refs.length >= MAX_REFS) {
      return
    }

    seen.add(raw)
    refs.push({ kind: /^https?:\/\//i.test(raw) ? 'url' : 'file', raw })
  }

  const prose = markdown
    .replace(FENCED_BLOCK, (block: string) => {
      for (const line of block.split('\n').slice(1, -1)) {
        if (WHOLE_LINE_PATH.test(line.trim())) {
          add(line, false)
        }
      }
      return ' '
    })
    .replace(MARKDOWN_TARGET, (whole: string, target: string) => {
      add(target, whole.startsWith('!'))
      return ' '
    })
    .replace(CODE_SPAN, (whole: string, inner: string) => {
      if (IMAGE_EXT.test(inner.trim())) {
        add(inner, false)
        return ' '
      }
      return ` ${inner} `
    })

  for (const token of prose.split(TOKEN_BREAK)) {
    add(token, false)
  }

  return refs
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * The images a tool's stored result carries: Read's `{ type: 'image', file }`,
 * or image blocks in MCP (`data`, `mimeType`) or Messages API (`source`) form.
 */
export function imagesInOutput(tool: string, output: unknown): InlineImage[] {
  if (tool === 'Read') {
    const file = isRecord(output) && output.type === 'image' && isRecord(output.file) ? output.file : undefined
    return typeof file?.base64 === 'string'
      ? [{ data: file.base64, mime: typeof file.type === 'string' ? file.type : 'image/png' }]
      : []
  }

  const blocks: unknown[] = Array.isArray(output)
    ? output
    : isRecord(output) && Array.isArray(output.content)
      ? output.content
      : []

  return blocks
    .flatMap((block): InlineImage[] => {
      if (!isRecord(block) || block.type !== 'image') {
        return []
      }
      if (typeof block.data === 'string') {
        return [{ data: block.data, mime: typeof block.mimeType === 'string' ? block.mimeType : 'image/png' }]
      }
      const source = isRecord(block.source) ? block.source : undefined
      if (typeof source?.data === 'string') {
        return [{ data: source.data, mime: typeof source.media_type === 'string' ? source.media_type : 'image/png' }]
      }
      return []
    })
    .slice(0, MAX_REFS)
}

const BASE64_DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** The first `count` bytes a base64 string decodes to (fewer if it is shorter). */
export function decodeHead(base64: string, count: number): number[] {
  const bytes: number[] = []
  let buffer = 0
  let bits = 0

  for (const digit of base64) {
    if (bytes.length >= count || digit === '=') {
      break
    }
    const value = BASE64_DIGITS.indexOf(digit)
    if (value < 0) {
      continue
    }
    buffer = ((buffer << 6) | value) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }

  return bytes
}

/** Width and height from a base64 PNG's IHDR chunk; undefined if it is no PNG. */
export function pngSize(base64: string): { width: number; height: number } | undefined {
  const head = decodeHead(base64, 24)
  if (head.length < 24 || PNG_SIGNATURE.some((byte, at) => head[at] !== byte)) {
    return undefined
  }

  const word = (at: number): number =>
    (((head[at] ?? 0) << 24) | ((head[at + 1] ?? 0) << 16) | ((head[at + 2] ?? 0) << 8) | (head[at + 3] ?? 0)) >>> 0
  const width = word(16)
  const height = word(20)

  return width > 0 && height > 0 ? { width, height } : undefined
}

/** How many bytes a base64 string decodes to. */
export function decodedLength(base64: string): number {
  const trimmed = base64.trimEnd()
  const padding = trimmed.endsWith('==') ? 2 : trimmed.endsWith('=') ? 1 : 0
  return Math.floor((trimmed.length * 3) / 4) - padding
}

/** A cell's height over its width when the terminal does not say: about twice as tall as wide. */
export const DEFAULT_CELL_ASPECT = 2
/** Roughly how many source pixels one column shows: a small picture is not stretched wider than this. */
const PIXELS_PER_COLUMN = 9

/**
 * The box of cells a picture fills, keeping its aspect ratio within both caps.
 * `cellAspect` is a cell's height over its width: the picture is stretched to
 * fill its box, so a wrong one draws it too tall or too flat.
 */
export function fitCells(
  width: number,
  height: number,
  maxColumns: number,
  maxRows: number,
  cellAspect: number = DEFAULT_CELL_ASPECT,
): { columns: number; rows: number } {
  const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))
  const rowsPerColumn = height / width / cellAspect
  let columns = clamp(Math.round(width / PIXELS_PER_COLUMN), 2, maxColumns)
  let rows = Math.max(1, Math.round(columns * rowsPerColumn))

  if (rows > maxRows) {
    rows = maxRows
    columns = Math.max(1, Math.round(rows / rowsPerColumn))
  }

  return { columns: clamp(columns, 1, 255), rows: clamp(rows, 1, 255) }
}
