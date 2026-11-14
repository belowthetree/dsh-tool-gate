#!/usr/bin/env node
/**
 * Compile with the package's own devDependencies, for CI and published builds.
 *
 * The development build (`scripts/build.mjs`) links the plugin against a local
 * DeepSeek Harness checkout, which a CI runner does not have. There the DSH
 * packages come from npm as devDependencies, so a plain `tsc -p` is enough.
 *
 * Usage:
 *   npm install && node scripts/build-ci.mjs
 *
 * @module dsh-tool-gate/scripts/build-ci
 */

import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const pluginName = typeof manifest.name === 'string' ? manifest.name : 'dsh-tool-gate'
const cli = join(root, 'node_modules', 'typescript', 'bin', 'tsc')

if (!existsSync(cli)) {
  console.error(`${pluginName}: node_modules/typescript is missing; run npm install first`)
  process.exit(1)
}

const result = spawnSync(process.execPath, [cli, '-p', join(root, 'tsconfig.json')], {
  stdio: 'inherit',
  cwd: root,
})
process.exit(result.status ?? 1)
