#!/usr/bin/env node
/**
 * Sync the vendored upstream skill files from a pinned commit.
 *
 *   node scripts/sync-upstream.mjs           # verify + print what would change
 *   node scripts/sync-upstream.mjs --write   # fetch the pinned tarball and rewrite the vendored files
 *   node scripts/sync-upstream.mjs --check   # CI: exit 1 when the vendored bytes or hashes drift
 *
 * The pin lives in MANIFEST.json. Nothing ever follows `main`: upgrading the
 * pin is a reviewed change that also updates the manifest hashes.
 */
import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifestPath = join(root, 'packages/plugin/MANIFEST.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const mode = process.argv.includes('--write') ? 'write' : process.argv.includes('--check') ? 'check' : 'dry'

/** sha256 of a file's bytes. */
async function sha256(path) {
  const bytes = await readFile(path)
  return createHash('sha256').update(bytes).digest('hex')
}

/** Compare every manifest entry against disk. */
async function verify() {
  const problems = []
  for (const entry of manifest.files) {
    const target = join(root, 'packages/plugin', entry.path)
    let actual
    try {
      actual = await sha256(target)
    } catch {
      problems.push(`${entry.path}: missing`)
      continue
    }
    if (actual !== entry.sha256) problems.push(`${entry.path}: sha256 ${actual} != ${entry.sha256}`)
  }
  return problems
}

const problems = await verify()
if (mode === 'check') {
  if (problems.length > 0) {
    console.error('vendored upstream content drifted:')
    for (const problem of problems) console.error('  - ' + problem)
    process.exit(1)
  }
  console.log(`vendored upstream content is intact (${manifest.files.length} files at ${manifest.commit.slice(0, 12)})`)
  process.exit(0)
}

if (mode === 'dry') {
  if (problems.length === 0) {
    console.log(`vendored upstream content is intact (${manifest.files.length} files at ${manifest.commit.slice(0, 12)})`)
    process.exit(0)
  }
  console.error('drift detected (run with --write to re-fetch the pinned commit):')
  for (const problem of problems) console.error('  - ' + problem)
  process.exit(1)
}

// --write: fetch the pinned tarball, extract only the whitelisted files.
const url = `https://codeload.github.com/${manifest.upstream}/tar.gz/${manifest.commit}`
const work = join(tmpdir(), `adw-upstream-${Date.now()}`)
await mkdir(work, { recursive: true })
try {
  const archive = join(work, 'upstream.tar.gz')
  const response = await fetch(url)
  if (!response.ok) throw new Error(`fetch ${url} failed: ${response.status}`)
  await writeFile(archive, Buffer.from(await response.arrayBuffer()))
  execFileSync('tar', ['-xzf', archive, '-C', work, '--strip-components=1'], { stdio: 'inherit' })
  const files = [...manifest.files, { path: 'LICENSE', upstreamPath: 'LICENSE' }]
  for (const entry of files) {
    const source = join(work, entry.upstreamPath)
    const target = join(root, 'packages/plugin', entry.path === 'LICENSE' ? 'LICENSE.upstream' : entry.path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, await readFile(source))
    console.log('wrote', relative(root, target))
  }
  // Recompute hashes for the manifest.
  for (const entry of manifest.files) {
    entry.sha256 = await sha256(join(root, 'packages/plugin', entry.path))
  }
  manifest.retrieved = new Date().toISOString().slice(0, 10)
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log('manifest updated')
} finally {
  await rm(work, { recursive: true, force: true })
}
