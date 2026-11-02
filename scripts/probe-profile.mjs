#!/usr/bin/env node
/**
 * Compose the plugin into a throwaway DSH profile and assert the loader row
 * appears. This is the cheapest end-to-end check that the bundle patch,
 * package manifest, and module entry are all valid.
 *
 * It writes only under a temp directory, never to the user's profiles.
 */
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dsh = process.env.DSH_BIN ?? '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'
const home = await mkdtemp(join(tmpdir(), 'dsh-adw-probe-'))
const profile = join(home, 'profiles', 'adwprobe')
const packageDir = join(profile, 'node_modules', 'dsh-anti-defensive-writing')

try {
  await mkdir(packageDir, { recursive: true })
  await cp(join(root, 'packages/plugin'), packageDir, {
    recursive: true,
    filter: (source) => !source.includes('node_modules'),
  })
  await writeFile(
    join(profile, 'package.json'),
    JSON.stringify(
      {
        name: 'dsh-profile-adwprobe',
        private: true,
        dependencies: { 'dsh-anti-defensive-writing': 'file:' + join(root, 'packages/plugin') },
        dsh: {
          profile: {
            bundles: [
              '@deepseek-ai/dsh-base',
              '@deepseek-ai/dsh-web-app',
              'dsh-anti-defensive-writing',
            ],
          },
        },
      },
      null,
      2,
    ),
  )
  await writeFile(join(profile, 'cordis.yml'), '[]\n')
  await writeFile(join(profile, 'cordis.patch.yml'), '[]\n')

  const result = spawnSync(dsh, ['--profile', 'adwprobe', '--dump-config'], {
    env: { ...process.env, DSH_HOME: home },
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout)
    throw new Error(`dump-config exited ${result.status}`)
  }
  const output = result.stdout
  if (!output.includes('anti-defensive-writing')) {
    throw new Error('composed tree does not contain the anti-defensive-writing row')
  }
  const row = output.split('\n').findLast((line) => line.includes('name: dsh-anti-defensive-writing'))
  if (row === undefined) throw new Error('loader row missing the package name')
  console.log('composed row:', row.trim())

  // The host half must import cleanly from the packed layout.
  const imported = await import(join(packageDir, 'lib/index.js'))
  if (typeof imported.apply !== 'function') throw new Error('host entry has no apply()')
  if (imported.name !== 'anti-defensive-writing') throw new Error('unexpected plugin name')
  console.log('host entry imports cleanly; name =', imported.name)
} finally {
  await rm(home, { recursive: true, force: true })
}
