import { describe, expect, test } from 'claude-code/testing'

import { isHostAutomount, isPersonalOrigin, resolveOutsideAutomounts, type ResolvedStat } from '../hooks/policy'

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

describe('resolveOutsideAutomounts', () => {
  // A small file system with the links that reach the root on real systems.
  const dir = (realPath: string): ResolvedStat => ({ kind: 'dir', size: 0, mtimeMs: 0, realPath })
  const FILES: Record<string, ResolvedStat> = {
    '/Users': dir('/Users'),
    '/Users/me': dir('/Users/me'),
    '/Users/me/out': dir('/Users/me/out'),
    '/Users/me/out/chart.png': { kind: 'file', size: 10, mtimeMs: 1, realPath: '/Users/me/out/chart.png' },
    '/tmp': dir('/private/tmp'),
    '/private': dir('/private'),
    '/private/tmp': dir('/private/tmp'),
    '/private/tmp/x.png': { kind: 'file', size: 10, mtimeMs: 1, realPath: '/private/tmp/x.png' },
    '/Volumes': dir('/Volumes'),
    '/Volumes/Macintosh HD': dir('/'),
    '/proc': dir('/proc'),
    '/proc/self': dir('/proc/42'),
    '/proc/42': dir('/proc/42'),
    '/proc/42/root': dir('/'),
    '/net': dir('/net'),
  }
  const fakeStat = () => {
    const calls: string[] = []
    const stat = async (path: string): Promise<ResolvedStat | undefined> => {
      calls.push(path)
      return FILES[path]
    }
    return { calls, stat }
  }

  test('resolves relative paths and follows links the way the kernel does', async () => {
    const { stat } = fakeStat()
    expect((await resolveOutsideAutomounts('out/chart.png', '/Users/me', stat))?.realPath).toBe('/Users/me/out/chart.png')
    expect((await resolveOutsideAutomounts('/tmp/../tmp/x.png', '/', stat))?.realPath).toBe('/private/tmp/x.png')
    expect(await resolveOutsideAutomounts('/Users/me/missing.png', '/', stat)).toBeUndefined()
  })

  test('never touches a path under /net or /Network, however it is reached', async () => {
    const attempts = [
      '/net/secret.attacker.example/x.png',
      '/NET/secret.attacker.example/x.png',
      '/Network/Servers/secret.attacker.example/x.png',
      '../../net/secret.attacker.example/x.png',
      '/Volumes/Macintosh HD/net/secret.attacker.example/x.png',
      '/proc/self/root/net/secret.attacker.example/x.png',
      '/Volumes/Macintosh HD/proc/self/root/Volumes/Macintosh HD/net/h/x.png',
    ]
    for (const path of attempts) {
      const { calls, stat } = fakeStat()
      expect(await resolveOutsideAutomounts(path, '/Users/me', stat)).toBeUndefined()
      expect(calls.filter(call => isHostAutomount(call))).toEqual([])
    }
  })

  test('isHostAutomount matches the roots in any case, and nothing that only starts alike', async () => {
    for (const path of ['/net', '/NET/h', '/Network/Servers/h', '/Networ\u212A/h']) {
      expect(isHostAutomount(path)).toBe(true)
    }
    for (const path of ['/network-share/x.png', '/netflix.png', '/Users/me/net/x.png']) {
      expect(isHostAutomount(path)).toBe(false)
    }
  })
})
