#!/usr/bin/env node
/**
 * One-command verification for the workspace.
 *
 *   node scripts/verify.mjs
 *
 * Runs, in order: detector sync check, detector tests, plugin tests, and the
 * bundle-composition probe when the DSH runtime is available. Exits nonzero on
 * the first failure so CI can use it as-is.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const NODE = process.env.ADW_NODE ?? process.execPath

function run(label, command, args, options = {}) {
  process.stdout.write(`\n▸ ${label}\n`)
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options })
  if (result.status !== 0) {
    console.error(`\n✖ ${label} failed (exit ${result.status})`)
    process.exit(result.status ?? 1)
  }
  console.log(`✔ ${label}`)
}

run('detector copy is in sync', NODE, ['scripts/sync-detector.mjs', '--check'])
run('detector tests', NODE, ['--test', 'packages/detector/test/scan.test.js'])
run('plugin tests', NODE, ['--test', 'packages/plugin/test/smoke.test.js'])
run('client bundle tests', NODE, ['--test', 'packages/plugin/test/client.test.js'])
run('tool schema tests', NODE, ['--test', 'packages/plugin/test/tool-schema.test.js'])
run('integration tests', NODE, ['--test', 'packages/plugin/test/integration.test.js'])
run('package README exists', NODE, ['-e', "const {existsSync}=require('node:fs');if(!existsSync('packages/plugin/README.md'))throw new Error('missing README.md')"])
run('real registry mount', NODE, ['--test', 'packages/plugin/test/real-registry.test.js'])
run('real tool and command registry mount', NODE, ['--test', 'packages/plugin/test/real-tools.test.js'])
run('vendored upstream intact', NODE, ['scripts/sync-upstream.mjs', '--check'])

const dsh = process.env.DSH_BIN ?? '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'
if (existsSync(dsh)) {
  run('bundle composes into a scratch DSH profile', NODE, ['scripts/probe-profile.mjs'])
} else {
  console.log('\n• skipped DSH composition probe (no dsh binary)')
}

console.log('\nAll checks passed.')
