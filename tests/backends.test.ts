import { describe, expect, test } from 'claude-code/testing'

import { convertArgv, decodeArgv, fetchArgv, headArgv, parseProbe, probeArgv, sniffFormat } from '../hooks/backends'

const bytesOf = (text: string): number[] => Array.from(text, char => char.charCodeAt(0))

describe('sniffFormat', () => {
  test('knows each supported format by its signature', async () => {
    expect(sniffFormat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).toBe('png')
    expect(sniffFormat([0xff, 0xd8, 0xff, 0xe0])).toBe('jpeg')
    expect(sniffFormat(bytesOf('GIF89a'))).toBe('gif')
    expect(sniffFormat(bytesOf('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))).toBe('webp')
    expect(sniffFormat(bytesOf('BM'))).toBe('bmp')
    expect(sniffFormat([0x49, 0x49, 0x2a, 0x00])).toBe('tiff')
    expect(sniffFormat([0x4d, 0x4d, 0x00, 0x2a])).toBe('tiff')
    expect(sniffFormat(bytesOf('\u0000\u0000\u0000\u0018ftypheic'))).toBe('heic')
  })

  test('refuses anything else, so ImageMagick never picks a coder by content', async () => {
    expect(sniffFormat(bytesOf('<!DOCTYPE html>'))).toBeUndefined()
    expect(sniffFormat(bytesOf('push graphic-context'))).toBeUndefined()
    expect(sniffFormat(bytesOf('<svg xmlns='))).toBeUndefined()
    expect(sniffFormat([])).toBeUndefined()
  })
})

describe('parseProbe', () => {
  test('reads sips and identify output', async () => {
    const sips = '/tmp/a.jpg\n  pixelWidth: 640\n  pixelHeight: 480\n'
    expect(parseProbe('sips', sips)).toEqual({ width: 640, height: 480 })
    expect(parseProbe('magick', '1280 720\n')).toEqual({ width: 1280, height: 720 })
    expect(parseProbe('convert', '1280 720\n')).toEqual({ width: 1280, height: 720 })
  })

  test('is undefined when a size is missing', async () => {
    expect(parseProbe('sips', '/tmp/a.png\n  pixelWidth: <nil>\n')).toBeUndefined()
    expect(parseProbe('magick', '')).toBeUndefined()
  })
})

describe('command lines', () => {
  test('sips shrinks only when the picture is larger than the side', async () => {
    expect(convertArgv('sips', '/i.jpg', 'jpeg', '/o.png', 1600, 4000)).toEqual([
      'sips', '-s', 'format', 'png', '-Z', '1600', '/i.jpg', '--out', '/o.png',
    ])
    expect(convertArgv('sips', '/i.jpg', 'jpeg', '/o.png', 1600, 800)).toEqual([
      'sips', '-s', 'format', 'png', '/i.jpg', '--out', '/o.png',
    ])
  })

  test('ImageMagick reads with an explicit coder and the first frame, and only shrinks', async () => {
    expect(convertArgv('magick', '/i.gif', 'gif', '/o.png', 1000, 4000)).toEqual([
      'magick', 'gif:/i.gif[0]', '-auto-orient', '-resize', '1000x1000>', 'png:/o.png',
    ])
    expect(convertArgv('convert', '/i.gif', 'gif', '/o.png', 1000, 400)[0]).toBe('convert')
    expect(probeArgv('magick', '/i.webp', 'webp')).toEqual(['magick', 'identify', '-format', '%w %h\n', 'webp:/i.webp[0]'])
    expect(probeArgv('convert', '/i.webp', 'webp')[0]).toBe('identify')
  })

  test('file names reach sh as an argument, never as script text', async () => {
    const tricky = '/tmp/a"; rm -rf ~; ".png'
    expect(headArgv(tricky)).toEqual(['sh', '-c', 'head -c 16 "$1" | base64', 'sh', tricky])
    expect(decodeArgv(tricky)).toEqual(['sh', '-c', 'base64 -d > "$1"', 'sh', tricky])
  })
})

describe('fetchArgv', () => {
  test('turns off URL globbing and keeps the request and every redirect on http(s)', async () => {
    const argv = fetchArgv('https://example.com/[1-100000].png', '/cache/x.download')
    expect(argv[0]).toBe('curl')
    expect(argv).toContain('--globoff')
    expect(argv.slice(argv.indexOf('--proto'), argv.indexOf('--proto') + 2)).toEqual(['--proto', '=http,https'])
    expect(argv.slice(argv.indexOf('--proto-redir'), argv.indexOf('--proto-redir') + 2)).toEqual(['--proto-redir', '=http,https'])
    expect(argv.slice(-3)).toEqual(['-o', '/cache/x.download', 'https://example.com/[1-100000].png'])
  })
})
