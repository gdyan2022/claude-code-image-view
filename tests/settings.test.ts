import { describe, expect, test } from 'claude-code/testing'

import { parseSwitch, showImagesKey } from '../hooks/settings'

describe('parseSwitch', () => {
  test('reads on and off in any case, and nothing else', async () => {
    expect(parseSwitch('on')).toBe(true)
    expect(parseSwitch(' OFF ')).toBe(false)
    expect(parseSwitch('./off')).toBeUndefined()
    expect(parseSwitch('photo.png')).toBeUndefined()
    expect(parseSwitch('')).toBeUndefined()
  })
})

describe('showImagesKey', () => {
  const row = (key: string, plugin: string) => ({ key, provider: { plugin } })

  test('finds the row by name, with or without an install suffix', async () => {
    expect(showImagesKey([row('theme', 'engine'), row('cc-image-view.showImages', 'cc-image-view')], 'cc-image-view')).toBe(
      'cc-image-view.showImages',
    )
    expect(showImagesKey([row('cc-image-view@inline.showImages', 'cc-image-view')], 'cc-image-view')).toBe(
      'cc-image-view@inline.showImages',
    )
  })

  test('ignores another plugin with the same field or a longer name', async () => {
    const rows = [
      row('other.showImages', 'other'),
      row('cc-image-view-pro.showImages', 'cc-image-view-pro'),
      row('cc-image-view.autoLoadRemoteImages', 'cc-image-view'),
    ]
    expect(showImagesKey(rows, 'cc-image-view')).toBeUndefined()
  })
})
