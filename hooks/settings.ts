// The image switch. Show images in /plugin configure is the lasting default;
// /img off|on overrides it for the current session only.
//
// A plugin cannot change its own userConfig (only /plugin configure can;
// $.config.list holds no plugin rows for an installed plugin), so the command
// keeps its override in memory. Changing the option reloads the module, which
// drops the override: the newest change always wins and the menu never shows
// a value that is not the default.

/** `true` for `on`, `false` for `off`; anything else is a path or URL. */
export function parseSwitch(arg: string): boolean | undefined {
  const word = arg.trim().toLowerCase()
  return word === 'on' ? true : word === 'off' ? false : undefined
}

/** Whether images show: this session's override if any, else the option (on unless `false`). */
export function isShownNow(option: unknown, override: boolean | undefined): boolean {
  return override ?? option !== false
}
