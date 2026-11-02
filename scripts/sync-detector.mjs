#!/usr/bin/env node
/**
 * Copy the standalone detector package into the plugin package.
 *
 * `packages/detector` is the source of truth and is developed/tested on its
 * own. `packages/plugin/lib/detector/` is a generated copy so the plugin can
 * be packed and installed without a workspace. Run this after any detector
 * change; `--check` fails when the copy is stale (CI uses it).
 */
import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const from = join(root, 'packages/detector/lib')
const to = join(root, 'packages/plugin/lib/detector')
const check = process.argv.includes('--check')

async function hashDir(dir) {
  const names = (await readdir(dir)).sort()
  const parts = []
  for (const name of names) {
    if (!name.endsWith('.js')) continue
    const bytes = await readFile(join(dir, name))
    parts.push(`${name}:${createHash('sha256').update(bytes).digest('hex')}`)
  }
  return parts.join('\n')
}

const sourceHash = await hashDir(from)
let targetHash = ''
try {
  targetHash = await hashDir(to)
} catch {
  targetHash = '<missing>'
}

if (check) {
  if (sourceHash !== targetHash) {
    console.error('detector copy is stale: run `node scripts/sync-detector.mjs`')
    process.exit(1)
  }
  console.log('detector copy is up to date')
  process.exit(0)
}

await rm(to, { recursive: true, force: true })
await mkdir(to, { recursive: true })
await cp(from, to, { recursive: true })
console.log(`copied ${from} -> ${to}`)
