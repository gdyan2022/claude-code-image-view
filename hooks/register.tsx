import type { Elements, Register } from 'claude-code'

import { ensure, loadFile, loadInline, loadUrl, peek, type Entry, type Io } from './prepare'
import { isPersonalOrigin, resolveOutsideAutomounts } from './policy'
import { findImageRefs, fitCells, imagesInOutput, type ImageRef } from './refs'
import { parseSwitch, showImagesKey } from './settings'

const MAX_COLUMNS = 80
const MAX_ROWS = 24
/** Indent of a reply's text (lined up with the text after ⏺). */
const REPLY_INDENT = 2
/** Indent of a tool result (lined up with the text after ⎿). */
const RESULT_INDENT = 5

type RemoteView = { key: string; label: string; remoteUrl: string }
type View = { key: string; label: string; entry: Entry } | RemoteView

type Found = { path: string; size: number; version: string }

/**
 * The file a path in a reply names, if it exists. A missing file shows nothing:
 * replies often name files not written yet, or only hypothetical ones.
 */
async function locate(io: Io, raw: string, home: string, cwd: string): Promise<Found | undefined> {
  let path = raw.replace(/^file:\/\//i, '')
  try {
    path = decodeURIComponent(path)
  } catch {
    // Not valid percent-encoding: use it as written.
  }
  if (path.startsWith('~/') && home !== '') {
    path = home + path.slice(1)
  }
  // Walked afresh every time: nothing is cached, so a directory swapped for a
  // link since the last look is seen as the link it now is.
  const file = await resolveOutsideAutomounts(path, cwd, {
    list: dir => io.list(dir).catch(() => undefined),
    readlink: async link => {
      const read = await io.run(['readlink', link]).catch(() => undefined)
      return read?.exitCode === 0 ? read.stdout.replace(/\n$/, '') : undefined
    },
  })
  if (file === undefined) {
    return undefined
  }

  return { path: file.realPath, size: file.size, version: `${file.mtimeMs}-${file.size}` }
}

function shortPath(path: string, home: string): string {
  return home !== '' && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

function toolLabel(tool: string, input: unknown): string {
  const filePath = typeof input === 'object' && input !== null ? (input as { file_path?: unknown }).file_path : undefined
  if (typeof filePath === 'string') {
    return filePath.split('/').pop() ?? filePath
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  return mcp ? `image from ${mcp[1]}/${mcp[2]}` : `image from ${tool}`
}

function drawViews(
  ui: Elements['terminal'],
  views: View[],
  indent: number,
  maxColumns: number,
  onLoad: (view: RemoteView) => void,
) {
  const { Box, Button, Image, Text } = ui

  return views.map(view => {
    if ('remoteUrl' in view) {
      return (
        <Box paddingLeft={indent} gap={1}>
          <Text dimColor>↗ remote image not loaded: {view.label}</Text>
          <Button key={`load:${view.key}`} label="Load" onPress={() => onLoad(view)} />
        </Box>
      )
    }

    const { entry } = view
    if (entry.status === 'pending') {
      return (
        <Box paddingLeft={indent}>
          <Text dimColor>⋯ loading image {view.label}</Text>
        </Box>
      )
    }
    if (entry.status === 'failed') {
      return (
        <Box paddingLeft={indent}>
          <Text dimColor>
            ✗ cannot show image {view.label}: {entry.reason}
          </Text>
        </Box>
      )
    }

    const { picture } = entry
    const cells = fitCells(picture.width, picture.height, maxColumns, MAX_ROWS)
    return (
      <Box flexDirection="column" paddingLeft={indent} marginTop={1}>
        <Image source={{ png: picture.png }} columns={cells.columns} rows={cells.rows} alt={view.label} />
        <Text dimColor>
          {view.label} · {picture.width}×{picture.height}
        </Text>
      </Box>
    )
  })
}

export const register: Register = (on, options) => {
  const isRemoteAutoLoaded = options.autoLoadRemoteImages === true
  // Off: replies and tool results draw as the engine draws them; /img <path> still shows one.
  const isShown = options.showImages !== false
  // No io before session.start: until then the engine draws everything itself.
  let io: Io | undefined
  let home = ''
  let cwd = '/'
  /**
   * URLs the person asked for with /img themselves. A /img run can also come
   * from another session, a relayed channel, a scheduled task or a plugin;
   * fetching for those would let anyone who can send one carry data out in
   * the URL, so they get the Load button like a URL in a reply.
   */
  const requestedUrls = new Set<string>()

  const viewOfRef = async (host: Io, ref: ImageRef, isFetchAllowed: boolean): Promise<View | undefined> => {
    if (ref.kind === 'url') {
      const key = `url:${ref.raw}`
      const held = peek(key)
      if (held === undefined && !isFetchAllowed) {
        return { key, label: ref.raw, remoteUrl: ref.raw }
      }
      return { key, label: ref.raw, entry: held ?? ensure(host, key, () => loadUrl(host, ref.raw)) }
    }

    const found = await locate(host, ref.raw, home, cwd)
    if (found === undefined) {
      return undefined
    }
    const key = `file:${found.path}:${found.version}`
    return {
      key,
      label: shortPath(found.path, home),
      entry: ensure(host, key, () => loadFile(host, found.path, found.size, key)),
    }
  }

  const viewsOfOutput = (host: Io, id: string, tool: string, input: unknown, output: unknown): View[] =>
    imagesInOutput(tool, output).map((image, at) => {
      const key = `tool:${id}:${at}`
      return { key, label: toolLabel(tool, input), entry: ensure(host, key, () => loadInline(host, image, key)) }
    })

  const loadRemote =
    (host: Io) =>
    (view: RemoteView): void => {
      ensure(host, view.key, () => loadUrl(host, view.remoteUrl))
      host.redraw()
    }

  const columnsFor = (viewportColumns: number | undefined, indent: number): number =>
    Math.max(8, Math.min(MAX_COLUMNS, (viewportColumns ?? 80) - indent - 2))

  on('session.start', async ($, e, next) => {
    home = (await $.env.get('HOME')) ?? ''
    cwd = e.cwd
    io = {
      run: (argv, init) => $.process.run(argv, init),
      readBytes: async path => (await $.fs.read(path, { as: 'bytes' })).base64,
      list: dir => $.fs.list(dir),
      redraw: () => $.ui.invalidate('ui.render'),
      cacheRoot: (await $.env.get('XDG_CACHE_HOME')) || `${home}/.cache`,
    }
    await $.command.register({
      name: 'img',
      description: 'Show an image in the terminal: /img <path or http(s) URL>; /img off|on turns inline images off or on',
    })
    // A change of showImages reloads this module; redraw the rows the last one drew.
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('command.run', { command: 'img' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === '') {
      return {
        text: `Usage: /img <image path or http(s) URL>, or /img off|on. Inline images are ${isShown ? 'on' : 'off'}.`,
      }
    }

    // The same stored value as the Show images row in /config, so either place switches it.
    const isTurnedOn = parseSwitch(arg)
    if (isTurnedOn !== undefined) {
      const key = showImagesKey(await $.config.list(), $.plugin.name)
      if (key === undefined) {
        return { text: 'Cannot find the Show images row in /config.' }
      }
      const set = await $.config.set({ key, value: isTurnedOn })
      if (set.deny !== undefined) {
        return { text: `Could not turn inline images ${arg}: ${set.deny}` }
      }
      return {
        text: isTurnedOn
          ? 'Inline images are on.'
          : 'Inline images are off. /img <path> still shows one; /img on turns them back on.',
      }
    }
    if (/^https?:\/\//i.test(arg)) {
      if (isPersonalOrigin(e.origin.kind)) {
        requestedUrls.add(arg)
      }
      return { text: `Image: ${arg}` }
    }

    const found = io === undefined ? undefined : await locate(io, arg, home, cwd)
    return { text: found === undefined ? `No image file at ${arg}` : `Image: ${found.path}` }
  })

  on('ui.render', { component: 'CommandOutput', props: { command: 'img' } }, async ($, e, next) => {
    const arg = e.props.args.trim()
    const isSwitch = parseSwitch(arg) !== undefined
    if (io === undefined || e.surface !== 'terminal' || e.props.isErrored || arg === '' || isSwitch) {
      return next(e)
    }

    const ref: ImageRef = { kind: /^https?:\/\//i.test(arg) ? 'url' : 'file', raw: arg }
    const view = await viewOfRef(io, ref, ref.kind === 'file' || isRemoteAutoLoaded || requestedUrls.has(arg))
    if (view === undefined) {
      return next(e)
    }

    const ui = $.ui.resolve(e)
    const { Box } = ui
    return (
      <Box flexDirection="column">
        {await next(e)}
        {drawViews(ui, [view], RESULT_INDENT, columnsFor(e.viewport?.columns, RESULT_INDENT), loadRemote(io))}
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!isShown || io === undefined || e.surface !== 'terminal') {
      return next(e)
    }
    const refs = findImageRefs(e.props.text)
    if (refs.length === 0) {
      return next(e)
    }

    const host = io
    const found = await Promise.all(refs.map(ref => viewOfRef(host, ref, isRemoteAutoLoaded)))
    const views = found.filter((view): view is View => view !== undefined)
    if (views.length === 0) {
      return next(e)
    }

    const ui = $.ui.resolve(e)
    const { Box } = ui
    return (
      <Box flexDirection="column">
        {await next(e)}
        {drawViews(ui, views, REPLY_INDENT, columnsFor(e.viewport?.columns, REPLY_INDENT), loadRemote(host))}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!isShown || io === undefined || e.surface !== 'terminal' || e.props.isErrored) {
      return next(e)
    }
    const views = viewsOfOutput(io, e.props.tool_use_id, e.props.tool, undefined, e.props.output)
    if (views.length === 0) {
      return next(e)
    }

    const ui = $.ui.resolve(e)
    const { Box } = ui
    return (
      <Box flexDirection="column">
        {await next(e)}
        {drawViews(ui, views, RESULT_INDENT, columnsFor(e.viewport?.columns, RESULT_INDENT), loadRemote(io))}
      </Box>
    )
  })

  // Consecutive Read calls fold into one row ("Read 3 files") with no ToolResult of
  // their own, so their images hang under the group.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (!isShown || io === undefined || e.surface !== 'terminal') {
      return next(e)
    }
    const host = io
    const views = e.props.calls.flatMap((call, at) =>
      call.isErrored
        ? []
        : viewsOfOutput(host, call.tool_use_id ?? `${e.requestId}:${at}`, call.tool, call.input, call.output),
    )
    if (views.length === 0) {
      return next(e)
    }

    const ui = $.ui.resolve(e)
    const { Box } = ui
    return (
      <Box flexDirection="column">
        {await next(e)}
        {drawViews(ui, views, RESULT_INDENT, columnsFor(e.viewport?.columns, RESULT_INDENT), loadRemote(host))}
      </Box>
    )
  })
}
