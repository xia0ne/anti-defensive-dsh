/**
 * Single import point for the detector inside the plugin package.
 *
 * `packages/detector` is the source of truth (zero dependencies, tested on its
 * own). `lib/detector/` is a generated copy produced by
 * `node scripts/sync-detector.mjs`, so an installed plugin does not need the
 * workspace layout. `scripts/sync-detector.mjs --check` fails CI when the copy
 * drifts.
 *
 * @module dsh-anti-defensive-writing/detector
 */

export {
  scan,
  scoreOf,
  RULES,
  RULES_BY_ID,
  CN,
  EN,
  DETECTOR_VERSION,
} from './detector/scan.js'
