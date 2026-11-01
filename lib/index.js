/**
 * dsh-quote-reply — host half.
 *
 * The whole feature lives in the browser half (`./client`). This module only
 * has to exist so the bundle row resolves: a bundle patch inserts one row whose
 * `name` is this package, the host loads this file as a plain Cordis plugin, and
 * the `dsh.client` declaration in package.json makes the web app load
 * `./client` for the page.
 */
export const name = 'dsh-quote-reply'

/** No host services are required; the plugin is purely a client-side surface. */
export const inject = []

/** Nothing to install on the host side. */
export function apply() {}
