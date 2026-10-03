import { describe, expect, test } from 'claude-code/testing'

import { decodedLength, findImageRefs, fitCells, imagesInOutput, MAX_REFS, pngSize } from '../hooks/refs'

// The head of an 80×50 PNG (signature + IHDR): enough for pngSize.
const PNG_80x50 = 'iVBORw0KGgoAAAANSUhEUgAAAFAAAAAyCAYAAADLLVz8AAAABGdBTUEAALGPC/xhBQAAACBjSFJN'
const JPEG_HEAD = '/9j/4AAQSkZJRgABAQAAkACQAAD/4QCARXhpZgAA'

describe('findImageRefs', () => {
  test('finds markdown images, inline-code paths and bare paths', async () => {
    const text = [
      'The chart is here: ![sales](./out/chart.png)',
      'A copy is at `/Users/me/My Pics/a b.jpg`, and ~/Desktop/shot.webp.',
      'Remote https://example.com/x/diagram.png?v=2 works too.',
    ].join('\n')

    expect(findImageRefs(text)).toEqual([
      { kind: 'file', raw: './out/chart.png' },
      { kind: 'file', raw: '/Users/me/My Pics/a b.jpg' },
      { kind: 'file', raw: '~/Desktop/shot.webp' },
      { kind: 'url', raw: 'https://example.com/x/diagram.png?v=2' },
    ])
  })

  test('a markdown image needs no extension, a plain link does', async () => {
    const text = '![a](https://img.example.com/render?id=3) [docs](https://example.com/docs) [plot](plot.gif)'

    expect(findImageRefs(text)).toEqual([
      { kind: 'url', raw: 'https://img.example.com/render?id=3' },
      { kind: 'file', raw: 'plot.gif' },
    ])
  })

  test('skips fenced code and other schemes, strips emphasis and punctuation, drops repeats', async () => {
    const text = [
      '```',
      'ls\nlogo.png icon.png',
      '```',
      'See **chart.png**. Then chart.png and s3://bucket/a.png.',
    ].join('\n')

    expect(findImageRefs(text)).toEqual([{ kind: 'file', raw: 'chart.png' }])
  })

  test('returns nothing without references, and at most MAX_REFS', async () => {
    expect(findImageRefs('Changed src/index.ts, all tests pass.')).toEqual([])

    const many = Array.from({ length: MAX_REFS + 3 }, (_, at) => `p${at}.png`).join(' ')
    expect(findImageRefs(many).length).toBe(MAX_REFS)
  })
})

describe('pngSize / decodedLength', () => {
  test('reads a PNG size from its header, undefined for anything else', async () => {
    expect(pngSize(PNG_80x50)).toEqual({ width: 80, height: 50 })
    expect(pngSize(JPEG_HEAD)).toBeUndefined()
    expect(pngSize('')).toBeUndefined()
  })

  test('counts decoded bytes from the padding', async () => {
    expect(decodedLength('QUJD')).toBe(3)
    expect(decodedLength('QUI=')).toBe(2)
    expect(decodedLength('QQ==')).toBe(1)
  })
})

describe('fitCells', () => {
  test('keeps the aspect ratio: a 2:1 picture takes about a quarter as many rows as columns', async () => {
    expect(fitCells(720, 360, 80, 24)).toEqual({ columns: 80, rows: 20 })
  })

  test('a tall picture is capped by rows and narrowed to match', async () => {
    expect(fitCells(500, 2000, 80, 24)).toEqual({ columns: 12, rows: 24 })
  })

  test('a small picture is not stretched to the full width', async () => {
    expect(fitCells(90, 90, 80, 24)).toEqual({ columns: 10, rows: 5 })
  })
})

describe('imagesInOutput', () => {
  test('reads the Read tool image result', async () => {
    const output = { type: 'image', file: { base64: PNG_80x50, type: 'image/png', originalSize: 10 } }
    expect(imagesInOutput('Read', output)).toEqual([{ data: PNG_80x50, mime: 'image/png' }])
    expect(imagesInOutput('Read', { type: 'text', file: { content: 'hi' } })).toEqual([])
  })

  test('reads image blocks in MCP and Messages API form', async () => {
    const mcp = [
      { type: 'text', text: 'Took a screenshot' },
      { type: 'image', data: JPEG_HEAD, mimeType: 'image/jpeg' },
    ]
    const api = { content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_80x50 } }] }

    expect(imagesInOutput('mcp__chrome__take_screenshot', mcp)).toEqual([{ data: JPEG_HEAD, mime: 'image/jpeg' }])
    expect(imagesInOutput('mcp__x__y', api)).toEqual([{ data: PNG_80x50, mime: 'image/png' }])
    expect(imagesInOutput('Bash', { stdout: 'ok', stderr: '' })).toEqual([])
  })
})
