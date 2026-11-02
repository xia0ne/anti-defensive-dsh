/**
 * Comptime constants mirrored from DSH packages, kept in one place so a host
 * upgrade only needs one file checked.
 *
 * `BUNDLED_SKILL_RANK` is exported by `@deepseek-ai/dsh-skill` (0.2.1-rc.5) and
 * equals 600. It is mirrored here instead of imported because the detector and
 * the plugin package are also exercised outside a DSH install (CI, unit tests,
 * editor integrations) where `@deepseek-ai/*` is not on disk. The value is
 * asserted against the real package in `test/compat.test.js` whenever the host
 * packages are resolvable.
 *
 * @module dsh-anti-defensive-writing/compat
 */

/** Standard precedence rank for packaged skill providers and bundled roots. */
export const BUNDLED_SKILL_RANK = 600

/** Session-projection plain-JSON rule: these are the only value types allowed. */
export const JSON_VALUE_TYPES = Object.freeze(['string', 'number', 'boolean', 'object', 'array', 'null'])
