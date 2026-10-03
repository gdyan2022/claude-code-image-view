// The image switch: reading `/img on|off`, and what the stored value means.
//
// It lives in the plugin's own store, not in userConfig: a plugin cannot
// change its own userConfig (only /plugin configure can; $.config.list holds
// no plugin rows for an installed plugin), so a command could not flip it.

/** The $.store key of the switch. */
export const SHOW_IMAGES_KEY = 'showImages'

/** `true` for `on`, `false` for `off`; anything else is a path or URL. */
export function parseSwitch(arg: string): boolean | undefined {
  const word = arg.trim().toLowerCase()
  return word === 'on' ? true : word === 'off' ? false : undefined
}

/** Images show unless the store holds an explicit `false`. */
export function isShownFrom(stored: unknown): boolean {
  return stored !== false
}
