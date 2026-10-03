// Turning a reference into PNG bytes a terminal Image can show, off the
// drawing path. Each picture is prepared once per key and kept in this
// module; when one settles, every drawing of this plugin is redrawn.
//
// The work runs in a queue that session.start starts, never inside a render
// hook: a host call belongs to the dispatch it was made in, and a render's
// dispatch ends as soon as a newer drawing of the same row replaces it (a reply
// is redrawn many times while it streams), aborting the calls still in flight.

import type { EngineInterface } from 'claude-code'

import {
  BACKEND_PROBES,
  convertArgv,
  decodeArgv,
  fetchArgv,
  headArgv,
  parseProbe,
  probeArgv,
  sniffFormat,
  type Backend,
} from './backends'
import { decodedLength, decodeHead, pngSize, type InlineImage } from './refs'

/**
 * The host calls this plugin makes. `$` may only be spelled `$.noun.method(...)`
 * at a call site and never passed to a helper, so session.start wraps these in
 * closures and hands them here.
 */
export type Io = {
  run: EngineInterface['process']['run']
  readBytes: (path: string) => Promise<string>
  /** A directory's entries as they stand: links are listed as links, never followed. */
  list: (dir: string) => ReturnType<EngineInterface['fs']['list']>
  redraw: () => void
  /**
   * Where converted and downloaded files go: under the user's own cache
   * directory, never a shared /tmp, where another local user could plant a
   * symlink at a predictable name and have curl or a converter write through it.
   */
  cacheRoot: string
}

/**
 * A picture ready to draw: its PNG bytes, and the same PNG as a file in the
 * private cache when one could be written. The engine refuses a tree whose
 * inline `{ png }` sources add up to more than 2 MiB, while a `{ file }`
 * source counts nothing, so a row with several pictures sends the rest by file.
 */
export type Picture = { png: string; file?: string; width: number; height: number }

export type Entry =
  | { status: 'pending' }
  | { status: 'ready'; picture: Picture }
  | { status: 'failed'; reason: string }

/** The most inline `{ png }` source one tree may hold, decoded: one picture must fit alone. */
const MAX_PNG_BYTES = 2 * 1024 * 1024
/** Longest side tried when a picture must be re-encoded, largest first. */
const SIDES = [1600, 1000]
/**
 * A cap rather than eviction: a redraw draws every hooked row, on screen or
 * not, so evicting a picture another row still shows would re-prepare it,
 * redraw, evict again, and never settle.
 */
const MAX_HELD_CHARS = 256 * 1024 * 1024

/** Aborted attempts per key before the failure is kept. */
const MAX_ABORTS = 3

type Job = { key: string; run: () => Promise<Picture> }

const entries = new Map<string, Entry>()
const aborts = new Map<string, number>()
const queue: Job[] = []
let wake: (() => void) | undefined
let isWorking = false
let heldChars = 0
let cacheDir: Promise<string> | undefined
let backend: Promise<Backend> | undefined

export function peek(key: string): Entry | undefined {
  return entries.get(key)
}

/**
 * The entry under `key`, queueing `job` the first time the key is asked for.
 * Makes no host call itself, so a render hook may call it.
 */
export function ensure(key: string, job: () => Promise<Picture>): Entry {
  const held = entries.get(key)
  if (held !== undefined) {
    return held
  }

  const pending: Entry = { status: 'pending' }
  entries.set(key, pending)
  queue.push({ key, run: job })
  wake?.()

  return pending
}

/**
 * Runs queued jobs for the rest of the module's life. Call it from session.start
 * without awaiting: the jobs' host calls then belong to that dispatch, which
 * outlives its hook, and not to the render that asked for them.
 */
export async function workQueue(io: Io): Promise<void> {
  if (isWorking) {
    return
  }
  isWorking = true

  for (;;) {
    const job = queue.shift()
    if (job === undefined) {
      await new Promise<void>(resolve => (wake = resolve))
      wake = undefined
      continue
    }
    void settle(io, job)
  }
}

async function settle(io: Io, job: Job): Promise<void> {
  const entry = await job.run().then(
    (picture): Entry => {
      if (heldChars + picture.png.length > MAX_HELD_CHARS) {
        return { status: 'failed', reason: 'the image cache for this session is full' }
      }
      heldChars += picture.png.length
      return { status: 'ready', picture }
    },
    (error: unknown): Entry => ({ status: 'failed', reason: reasonOf(error) }),
  )

  // An aborted call says nothing about the picture: forget it, and the next
  // drawing asks again, up to a few times so a lasting abort cannot loop.
  const tries = (aborts.get(job.key) ?? 0) + 1
  if (entry.status === 'failed' && /\baborted\b/.test(entry.reason) && tries < MAX_ABORTS) {
    aborts.set(job.key, tries)
    entries.delete(job.key)
  } else {
    entries.set(job.key, entry)
  }
  io.redraw()
}

function reasonOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.split('\n')[0]?.trim() || 'unknown error'
}

/** Runs once per key; a failure is not kept, so the next call tries again. */
function once<T>(held: Promise<T> | undefined, start: () => Promise<T>, forget: () => void): Promise<T> {
  return (
    held ??
    start().catch((error: unknown) => {
      forget()
      throw error
    })
  )
}

async function digest(text: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return Array.from(hash.slice(0, 12), byte => byte.toString(16).padStart(2, '0')).join('')
}

function ensureCacheDir(io: Io): Promise<string> {
  cacheDir = once(
    cacheDir,
    async () => {
      const dir = `${io.cacheRoot.replace(/\/+$/, '')}/cc-image-view`
      const made = await io.run(['mkdir', '-p', dir])
      const sealed = made.exitCode === 0 ? await io.run(['chmod', '700', dir]) : made
      if (sealed.exitCode !== 0) {
        throw new Error(`cannot create a private cache at ${dir}: ${sealed.stderr}`)
      }
      return dir
    },
    () => (cacheDir = undefined),
  )
  return cacheDir
}

function detectBackend(io: Io): Promise<Backend> {
  backend = once(
    backend,
    async () => {
      for (const [candidate, argv] of BACKEND_PROBES) {
        const probe = await io.run(argv).catch(() => undefined)
        if (probe?.exitCode === 0) {
          return candidate
        }
      }
      throw new Error('no image converter found: install ImageMagick (magick or convert/identify)')
    },
    () => (backend = undefined),
  )
  return backend
}

/** Any supported image file, re-encoded as a PNG small enough to send. */
async function convert(io: Io, source: string, name: string): Promise<Picture> {
  const head = await io.run(headArgv(source))
  const format = sniffFormat(decodeHead(head.stdout.trim(), 16))
  if (format === undefined) {
    throw new Error('not a supported image format (PNG, JPEG, GIF, WebP, BMP, TIFF, HEIC)')
  }

  const tool = await detectBackend(io)
  const probe = await io.run(probeArgv(tool, source, format))
  const size = parseProbe(tool, probe.stdout)
  if (probe.exitCode !== 0 || size === undefined) {
    throw new Error(probe.stderr || `${tool} could not read it`)
  }

  const dir = await ensureCacheDir(io)
  const longest = Math.max(size.width, size.height)
  for (const side of SIDES) {
    const out = `${dir}/${name}-${longest > side ? side : 'full'}.png`
    const made = await io.run(convertArgv(tool, source, format, out, side, longest))
    if (made.exitCode !== 0) {
      throw new Error(made.stderr || `${tool} could not convert it`)
    }

    const png = await io.readBytes(out).catch(() => undefined)
    const shown = png === undefined ? undefined : pngSize(png)
    if (png !== undefined && shown !== undefined && decodedLength(png) <= MAX_PNG_BYTES) {
      return { png, file: out, ...shown }
    }
  }

  throw new Error('still over 2 MiB after shrinking')
}

/**
 * A PNG sent as it is, with a copy written to the private cache for the rows
 * that need it by file. Never the original path: the terminal would open it
 * itself, following any link swapped in since the path was checked.
 */
async function asIs(io: Io, png: string, name: string): Promise<Picture | undefined> {
  const size = pngSize(png)
  if (size === undefined) {
    return undefined
  }

  const dir = await ensureCacheDir(io).catch(() => undefined)
  const file = `${dir}/${name}-as-is.png`
  const written = dir === undefined ? undefined : await io.run(decodeArgv(file), { stdin: png }).catch(() => undefined)
  return { png, ...(written?.exitCode === 0 ? { file } : {}), ...size }
}

export async function loadFile(io: Io, path: string, bytes: number, key: string): Promise<Picture> {
  if (/\.png$/i.test(path) && bytes <= MAX_PNG_BYTES) {
    const picture = await asIs(io, await io.readBytes(path), await digest(key))
    if (picture !== undefined) {
      return picture
    }
  }

  return convert(io, path, await digest(key))
}

export async function loadUrl(io: Io, url: string): Promise<Picture> {
  const dir = await ensureCacheDir(io)
  const name = await digest(url)
  const file = `${dir}/${name}.download`
  const fetched = await io.run(
    fetchArgv(url, file),
    { timeoutMs: 30_000 },
  )
  if (fetched.exitCode !== 0) {
    throw new Error(fetched.stderr || `curl exited with ${fetched.exitCode}`)
  }

  return convert(io, file, name)
}

export async function loadInline(io: Io, image: InlineImage, key: string): Promise<Picture> {
  const name = await digest(key)
  if (image.mime === 'image/png' && decodedLength(image.data) <= MAX_PNG_BYTES) {
    const picture = await asIs(io, image.data, name)
    if (picture !== undefined) {
      return picture
    }
  }

  const dir = await ensureCacheDir(io)
  const file = `${dir}/${name}.bin`
  const written = await io.run(decodeArgv(file), { stdin: image.data })
  if (written.exitCode !== 0) {
    throw new Error(written.stderr || 'could not decode the base64 image')
  }

  return convert(io, file, name)
}
