import { describe, expect, test } from 'claude-code/testing'

import { isShownFrom, parseSwitch } from '../hooks/settings'

describe('parseSwitch', () => {
  test('reads on and off in any case, and nothing else', async () => {
    expect(parseSwitch('on')).toBe(true)
    expect(parseSwitch(' OFF ')).toBe(false)
    expect(parseSwitch('./off')).toBeUndefined()
    expect(parseSwitch('photo.png')).toBeUndefined()
    expect(parseSwitch('')).toBeUndefined()
  })
})

describe('isShownFrom', () => {
  test('images show until the store holds an explicit false', async () => {
    expect(isShownFrom(undefined)).toBe(true)
    expect(isShownFrom(true)).toBe(true)
    expect(isShownFrom(false)).toBe(false)
    expect(isShownFrom('false')).toBe(true)
  })
})
