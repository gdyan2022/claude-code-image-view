// Who may make this plugin fetch a URL. Pure, so tests pin it down.

/**
 * Origins that are the person's own gesture: Enter at the terminal, or their
 * message through the Remote Control bridge. Every other origin (another
 * session, a relayed channel, a scheduled task, a plugin, an unattested
 * socket) is someone or something else, and gets the Load button instead.
 */
const PERSONAL_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge'])

export function isPersonalOrigin(kind: string): boolean {
  return PERSONAL_ORIGINS.has(kind)
}
