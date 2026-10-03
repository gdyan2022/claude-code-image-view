import { describe, expect, test } from 'claude-code/testing'

import { isPersonalOrigin } from '../hooks/policy'

describe('isPersonalOrigin', () => {
  test('only the person at the terminal or on the bridge may make /img fetch a URL', async () => {
    expect(isPersonalOrigin('composer')).toBe(true)
    expect(isPersonalOrigin('bridge')).toBe(true)

    const others = [
      'sdk', 'task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay',
      'channel', 'coordinator', 'observer', 'observer-activity', 'auto-continuation', 'unclassified',
      'slack-ping', 'plugin',
    ]
    for (const kind of others) {
      expect(isPersonalOrigin(kind)).toBe(false)
    }
  })
})
