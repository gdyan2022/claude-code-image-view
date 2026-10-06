import { describe, expect, test } from 'claude-code/testing'

import { MEASURE_ARGV, parseWinsize } from '../hooks/cells'

describe('parseWinsize', () => {
  test('reads a cell height over width from rows, columns and pixels', async () => {
    // Ghostty at 160×46 cells over 2560×1702 px, with adjust-cell-height = 10%
    expect(parseWinsize('46 160 2560 1702\n')).toBe(2.3125)
    expect(parseWinsize('40 100 800 800')).toBe(2.5)
  })

  test('is undefined when the terminal reports no pixels or a shape no font has', async () => {
    expect(parseWinsize('46 160 0 0')).toBeUndefined()
    expect(parseWinsize('')).toBeUndefined()
    expect(parseWinsize('not a size')).toBeUndefined()
    expect(parseWinsize('10 10 100 500')).toBeUndefined()
  })
})

describe('MEASURE_ARGV', () => {
  test('runs the script with python3 and no shell', async () => {
    expect(MEASURE_ARGV.slice(0, 2)).toEqual(['python3', '-c'])
  })
})
