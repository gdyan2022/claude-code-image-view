import { describe, expect, test } from 'claude-code/testing'

import { absolutePath, isHostAutomount, isPersonalOrigin } from '../hooks/policy'

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

describe('absolutePath / isHostAutomount', () => {
  test('resolves relative paths and dot segments by spelling', async () => {
    expect(absolutePath('out/chart.png', '/work/project')).toBe('/work/project/out/chart.png')
    expect(absolutePath('./a/../b.png', '/work')).toBe('/work/b.png')
    expect(absolutePath('//tmp///x.png', '/work')).toBe('/tmp/x.png')
    expect(absolutePath('../../../../../../net/h/x.png', '/work/project')).toBe('/net/h/x.png')
  })

  test('refuses host-keyed automount paths in any spelling or case', async () => {
    for (const path of ['/net/secret.attacker.example/x.png', '/NET/h/x.png', '/Network/Servers/h/x.png', '/net']) {
      expect(isHostAutomount(path)).toBe(true)
    }
    for (const path of ['/network-share/x.png', '/home/me/net/x.png', '/netflix.png', '/Users/me/x.png']) {
      expect(isHostAutomount(path)).toBe(false)
    }
  })
})
