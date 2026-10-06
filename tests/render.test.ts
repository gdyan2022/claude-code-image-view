import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// A whole 2×1 PNG: small enough to be sent as it is, with no conversion.
const PNG_2x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAqADAAQAAAABAAAAAQAAAACquMZ6AAAAD0lEQVQIHWOMlo348f8fAAoFA8ftgDE4AAAAAElFTkSuQmCC'
// The same PNG padded to just over 1 MiB (a length divisible by 4 keeps it padded
// base64): any two of them overrun one tree's 2 MiB of inline source.
const PNG_1MiB = PNG_2x1 + 'A'.repeat(1398104 - PNG_2x1.length)

type Entry = { name: string; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number; isLink: boolean }
const dir = (name: string): Entry => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })
const file = (name: string, size: number): Entry => ({ name, kind: 'file', size, mtimeMs: 1, isLink: false })

const TREE: Record<string, Entry[]> = {
  '/': [dir('Users')],
  '/Users': [dir('me')],
  '/Users/me': [dir('pics')],
  '/Users/me/pics': [file('a.png', 220), file('big1.png', 1048576), file('big2.png', 1048576), file('big3.png', 1048576)],
}

const RAN = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

/**
 * The engine's side of what the plugin calls: a small file system, and commands
 * that succeed. `winsize` is what the terminal reports for the cell measurement.
 */
function standIn(on: On, winsize = ''): void {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  // What the engine draws itself for the row, under which the plugin adds its pictures.
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  on('fs.list', (_$, e) => ({ value: TREE[e.path] ?? [] }))
  on('fs.read', (_$, e) => ({ value: { base64: e.path.includes('/big') ? PNG_1MiB : PNG_2x1 } }))
  on('process.run', (_$, e) => ({ value: { ...RAN, stdout: e.argv[0] === 'python3' ? winsize : '' } }))
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/Users/me' : undefined }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.invalidate', () => ({ value: undefined }))
}

describe('drawing', () => {
  test('a path printed in a reply draws its picture under the reply', async ($, on) => {
    standIn(on)
    await $.session.start({ cwd: '/Users/me', surface: 'terminal', isInteractive: true })

    const target = {
      plugin: 'cc-image-view',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: { text: '```\n/Users/me/pics/a.png\n```', isFirstOfReply: true },
    } as const
    // The first drawing starts loading; the picture is ready by a later one.
    let image
    for (let attempt = 0; attempt < 20 && image === undefined; attempt += 1) {
      const ui = await $.ui.mount(target)
      image = await ui.find({ type: 'Image' })
      await ui.unmount()
    }

    expect(image).toBeDefined()
  })

  test('several large pictures in one reply stay within the tree budget', async ($, on) => {
    standIn(on)
    await $.session.start({ cwd: '/Users/me', surface: 'terminal', isInteractive: true })

    const target = {
      plugin: 'cc-image-view',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: { text: '/Users/me/pics/big1.png\n/Users/me/pics/big2.png\n/Users/me/pics/big3.png', isFirstOfReply: true },
    } as const
    let kinds: string[] = []
    for (let attempt = 0; attempt < 20 && kinds.length < 3; attempt += 1) {
      const ui = await $.ui.mount(target)
      const images = await ui.findAll({ type: 'Image' })
      kinds = images.map(image => Object.keys(image.props.source as object).sort().join(','))
      await ui.unmount()
    }

    // The first two together pass 2 MiB, so only the first goes inline.
    expect(kinds).toEqual(['png', 'file,format', 'file,format'])
  })

  test('an image a Read returned draws under its result', async ($, on) => {
    standIn(on)
    await $.session.start({ cwd: '/Users/me', surface: 'terminal', isInteractive: true })

    const target = {
      plugin: 'cc-image-view',
      surface: 'terminal',
      component: 'ToolResult',
      props: {
        tool_use_id: 'toolu_1',
        tool: 'Read',
        isErrored: false,
        output: { type: 'image', file: { base64: PNG_2x1, type: 'image/png', originalSize: 220 } },
      },
    } as const
    let image
    for (let attempt = 0; attempt < 20 && image === undefined; attempt += 1) {
      const ui = await $.ui.mount(target)
      image = await ui.find({ type: 'Image' })
      await ui.unmount()
    }

    expect(image).toBeDefined()
  })
})

describe('cell shape', () => {
  // A whole black 720×360 PNG.
  const PNG_720x360 =
    'iVBORw0KGgoAAAANSUhEUgAAAtAAAAFoCAIAAADxRFtOAAADCUlEQVR42u3BMQEAAADCoPVPbQo/oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAICXAd+NAAFdscwBAAAAAElFTkSuQmCC'

  test('a picture is sized for the cells the terminal reports', async ($, on) => {
    // 40 rows × 100 columns over 800×800 px: 8×20 px cells, 2.5 times taller than wide.
    standIn(on, '40 100 800 800\n')
    await $.session.start({ cwd: '/Users/me', surface: 'terminal', isInteractive: true })

    const target = {
      plugin: 'cc-image-view',
      surface: 'terminal',
      component: 'ToolResult',
      props: {
        tool_use_id: 'toolu_2',
        tool: 'Read',
        isErrored: false,
        output: { type: 'image', file: { base64: PNG_720x360, type: 'image/png', originalSize: 834 } },
      },
    } as const
    // 73 columns wide (80 less the result's indent and margin). At the default
    // 2:1 cell that is 18 rows; at 2.5:1, 15.
    let rows
    for (let attempt = 0; attempt < 20 && rows !== 15; attempt += 1) {
      const ui = await $.ui.mount(target)
      rows = (await ui.find({ type: 'Image' }))?.props.rows
      await ui.unmount()
    }

    expect(rows).toBe(15)
  })
})
