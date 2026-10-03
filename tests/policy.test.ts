import { describe, expect, test } from 'claude-code/testing'

import { isHostAutomount, isPersonalOrigin, resolveOutsideAutomounts, type DirEntry } from '../hooks/policy'

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
  // A small file system: directories map names to entries; links hold their target.
  type Node = { kind: 'file' | 'dir'; size?: number } | { link: string }
  const TREE: Record<string, Record<string, Node>> = {
    '/': { Users: { kind: 'dir' }, tmp: { link: 'private/tmp' }, private: { kind: 'dir' }, Volumes: { kind: 'dir' }, proc: { kind: 'dir' }, net: { kind: 'dir' } },
    '/Users': { me: { kind: 'dir' } },
    '/Users/me': { out: { kind: 'dir' }, repo: { kind: 'dir' } },
    '/Users/me/out': { 'chart.png': { kind: 'file', size: 10 }, 'café.png': { kind: 'file', size: 10 } },
    '/Users/me/repo': {
      'diagram.png': { link: '/net/attacker.example/x.png' },
      assets: { link: '../../../net/attacker.example' },
      loop: { link: 'loop' },
      'ok.png': { link: '../out/chart.png' },
    },
    '/private': { tmp: { kind: 'dir' } },
    '/private/tmp': { 'x.png': { kind: 'file', size: 10 } },
    '/Volumes': { 'Macintosh HD': { link: '/' } },
    '/proc': { self: { link: '42' }, '42': { kind: 'dir' } },
    '/proc/42': { root: { link: '/' } },
    '/net': {},
  }
  const walker = () => {
    const touched: string[] = []
    const list = async (dir: string): Promise<DirEntry[] | undefined> => {
      touched.push(dir)
      const names = TREE[dir]
      return names === undefined
        ? undefined
        : Object.entries(names).map(([name, node]) =>
            'link' in node
              ? { name, kind: 'other' as const, size: 0, mtimeMs: 0, isLink: true }
              : { name, kind: node.kind, size: node.size ?? 0, mtimeMs: 1, isLink: false },
          )
    }
    const readlink = async (link: string): Promise<string | undefined> => {
      touched.push(link)
      const cut = link.lastIndexOf('/')
      const node = TREE[link.slice(0, cut) || '/']?.[link.slice(cut + 1)]
      return node !== undefined && 'link' in node ? node.link : undefined
    }
    return { touched, walk: { list, readlink } }
  }

  test('resolves relative paths and follows links the way the kernel does', async () => {
    const { walk } = walker()
    expect((await resolveOutsideAutomounts('out/chart.png', '/Users/me', walk))?.realPath).toBe('/Users/me/out/chart.png')
    expect((await resolveOutsideAutomounts('/tmp/../tmp/x.png', '/', walk))?.realPath).toBe('/private/tmp/x.png')
    expect((await resolveOutsideAutomounts('/Volumes/Macintosh HD/Users/me/out/chart.png', '/', walk))?.realPath).toBe('/Users/me/out/chart.png')
    expect((await resolveOutsideAutomounts('repo/ok.png', '/Users/me', walk))?.realPath).toBe('/Users/me/out/chart.png')
    expect((await resolveOutsideAutomounts('out/cafe\u0301.png', '/Users/me', walk))?.realPath).toBe('/Users/me/out/café.png')
  })

  test('returns nothing for a missing file, a directory, a loop, or a path through a file', async () => {
    const { walk } = walker()
    for (const path of ['out/missing.png', 'out', 'repo/loop', 'out/chart.png/x.png']) {
      expect(await resolveOutsideAutomounts(path, '/Users/me', walk)).toBeUndefined()
    }
  })

  test('never lists or reads anything under /net or /Network, however it is reached', async () => {
    const attempts = [
      '/net/secret.attacker.example/x.png',
      '/NET/secret.attacker.example/x.png',
      '/Network/Servers/secret.attacker.example/x.png',
      '../../net/secret.attacker.example/x.png',
      '/Volumes/Macintosh HD/net/secret.attacker.example/x.png',
      '/proc/self/root/net/secret.attacker.example/x.png',
      'repo/diagram.png',
      'repo/assets/secret.png',
    ]
    for (const path of attempts) {
      const { touched, walk } = walker()
      expect(await resolveOutsideAutomounts(path, '/Users/me', walk)).toBeUndefined()
      expect(touched.filter(one => isHostAutomount(one))).toEqual([])
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
