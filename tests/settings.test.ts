import { describe, expect, test } from 'claude-code/testing'

import { isShownNow, parseSwitch } from '../hooks/settings'

describe('parseSwitch', () => {
  test('reads on and off in any case, and nothing else', async () => {
    expect(parseSwitch('on')).toBe(true)
    expect(parseSwitch(' OFF ')).toBe(false)
    expect(parseSwitch('./off')).toBeUndefined()
    expect(parseSwitch('photo.png')).toBeUndefined()
    expect(parseSwitch('')).toBeUndefined()
  })
})

describe('isShownNow', () => {
  test('without an override, the option decides and is on unless false', async () => {
    expect(isShownNow(undefined, undefined)).toBe(true)
    expect(isShownNow(true, undefined)).toBe(true)
    expect(isShownNow(false, undefined)).toBe(false)
  })

  test("this session's override wins over the option either way", async () => {
    expect(isShownNow(false, true)).toBe(true)
    expect(isShownNow(true, false)).toBe(false)
  })
})
