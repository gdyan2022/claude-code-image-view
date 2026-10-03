// The showImages switch: reading `/img on|off`, and finding the /config row
// that holds it so the command and the menu change one stored value.

export const SHOW_IMAGES_FIELD = 'showImages'

/** `true` for `on`, `false` for `off`; anything else is a path or URL. */
export function parseSwitch(arg: string): boolean | undefined {
  const word = arg.trim().toLowerCase()
  return word === 'on' ? true : word === 'off' ? false : undefined
}

/**
 * The key of this plugin's showImages row among the /config rows. A row is
 * `<plugin>.<field>`, and the plugin part may carry a suffix (`@inline` for a
 * --plugin-dir load), so the owner is checked as well as the name.
 */
export function showImagesKey(
  rows: readonly { key: string; provider: { plugin: string } }[],
  plugin: string,
): string | undefined {
  return rows.find(
    row =>
      row.provider.plugin === plugin &&
      row.key.endsWith(`.${SHOW_IMAGES_FIELD}`) &&
      (row.key.startsWith(`${plugin}.`) || row.key.startsWith(`${plugin}@`)),
  )?.key
}
