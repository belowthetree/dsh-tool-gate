#!/usr/bin/env node
/**
 * Link this plugin against a DeepSeek Harness checkout, then build it.
 *
 * The plugin is developed out of tree, so it keeps no dependency install of its
 * own. This script registers the harness packages it imports as directory
 * junctions in the plugin's `node_modules`, resolved from a checkout. That one
 * step is what both the compiler and the loader need: `lib/index.js` imports
 * `@deepseek-ai/dsh-tools` and friends, and Node resolves them by walking up
 * from the plugin directory — so the same `node_modules` that makes the build
 * resolve also makes the installed bundle load.
 *
 * A specifier that already resolves (a nested checkout, or a staging directory
 * inside another plugin) is left alone.
 *
 * Usage:
 *   node scripts/build.mjs              # typecheck, then emit lib/
 *   node scripts/build.mjs --noEmit     # typecheck only
 *
 * Checkout: $DSH_CHECKOUT, else the first probe that looks like a checkout.
 *
 * @module dsh-tool-gate/scripts/build
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'))
const pluginName = typeof manifest.name === 'string' ? manifest.name : 'dsh-tool-gate'
const emit = !process.argv.includes('--noEmit')
const windows = process.platform === 'win32'

/** Places that hold a harness checkout, in preference order. */
const CHECKOUT_PROBES = [
  'E:/Project/deepseek-harness',
  join(homedir(), 'deepseek-harness'),
  join(homedir(), 'dsh-harness'),
  join(homedir(), 'dsh'),
  join(homedir(), '.dsh', 'dsh-harness'),
]

/** Vendored cores, linked under every spelling the harness uses. */
const VENDORED = new Map([
  ['cordis', ['cordis', '@deepseek-ai/cordis']],
  ['cosmokit', ['cosmokit', '@deepseek-ai/cosmokit']],
  ['schemastery', ['schemastery', '@deepseek-ai/schemastery']],
  ['loader', ['@deepseek-ai/cordis-plugin-loader']],
])

/** Find the checkout the plugin links against. */
function findCheckout() {
  const explicit = process.env.DSH_CHECKOUT
  const candidates = explicit === undefined || explicit.trim() === ''
    ? CHECKOUT_PROBES
    : [explicit, ...CHECKOUT_PROBES]
  for (const candidate of candidates) {
    const root = resolve(candidate)
    if (existsSync(join(root, 'packages')) && existsSync(join(root, 'vendor', 'cordis'))) return root
  }
  throw new Error(`${pluginName}: no DeepSeek Harness checkout found; set DSH_CHECKOUT to one`)
}

/** Every workspace package name reachable from a checkout, mapped to its directory. */
function workspacePackages(checkout) {
  const found = new Map()
  const groups = join(checkout, 'packages')
  for (const group of readdirSync(groups, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    const groupDir = join(groups, group.name)
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const packageManifest = join(groupDir, entry.name, 'package.json')
      if (!existsSync(packageManifest)) continue
      const parsed = JSON.parse(readFileSync(packageManifest, 'utf8'))
      if (typeof parsed.name === 'string') found.set(parsed.name, join(groupDir, entry.name))
    }
  }
  return found
}

/** Bare specifiers the plugin's own sources import. */
function importedPackages() {
  const names = new Set()
  const srcDir = join(pluginRoot, 'src')
  for (const file of readdirSync(srcDir)) {
    if (!file.endsWith('.ts')) continue
    const text = readFileSync(join(srcDir, file), 'utf8')
    for (const match of text.matchAll(/(?:from|import)\s+'([^']+)'/gu)) {
      const specifier = match[1]
      if (specifier === undefined) continue
      if (specifier.startsWith('.') || specifier.startsWith('node:')) continue
      names.add(specifier)
    }
  }
  return names
}

/** True when Node can already resolve this bare specifier from the build script. */
function alreadyResolvable(specifier) {
  try {
    import.meta.resolve(specifier)
    return true
  } catch {
    return false
  }
}

/** True when an ancestor `node_modules` already holds this path (types-only packages). */
function resolvesUpTree(...segments) {
  let directory = pluginRoot
  while (true) {
    if (existsSync(join(directory, 'node_modules', ...segments))) return true
    const parent = dirname(directory)
    if (parent === directory) return false
    directory = parent
  }
}

/**
 * True when `linkPath` already serves `resolvedTarget`: either an ordinary
 * directory of that name, or a link that points at the target.
 */
function linkIsCurrent(linkPath, resolvedTarget) {
  try {
    if (!lstatSync(linkPath).isSymbolicLink()) return true
    return resolve(dirname(linkPath), readlinkSync(linkPath)) === resolvedTarget
  } catch {
    return false
  }
}

/**
 * Replace `linkPath` with a directory junction to `target`, unless it is already
 * current. Linking is idempotent on purpose: creating a link needs a privilege
 * the harness workspace does not always grant, so one privileged run seeds the
 * tree and every later typecheck is a plain read. A link this shell may not
 * create is reported, not fatal: resolution may already succeed through an
 * ancestor `node_modules`, and the compiler below is the real judge.
 */
function link(linkPath, target) {
  const resolvedTarget = resolve(target)
  if (linkIsCurrent(linkPath, resolvedTarget)) return true
  mkdirSync(dirname(linkPath), { recursive: true })
  rmSync(linkPath, { recursive: true, force: true })
  try {
    symlinkSync(resolvedTarget, linkPath, windows ? 'junction' : 'dir')
    return true
  } catch (error) {
    console.warn(`${pluginName}: could not link ${linkPath} -> ${resolvedTarget} (${error.code ?? error.message})`)
    return false
  }
}

/** The TypeScript compiler shipped with the checkout. */
function typescriptCli(checkout) {
  const candidates = [
    join(checkout, 'node_modules', 'typescript', 'bin', 'tsc'),
    join(checkout, 'node_modules', '.bin', windows ? 'tsc.cmd' : 'tsc'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`${pluginName}: the checkout has no TypeScript compiler; install its devDependencies first`)
}

const checkout = findCheckout()
const packages = workspacePackages(checkout)

const specifiers = importedPackages()
if (!specifiers.has('@deepseek-ai/cordis')) specifiers.add('@deepseek-ai/cordis')

const linked = []
const skipped = []
const unresolved = []
// The vendored cores are linked below from `vendor/`, not from `packages/`.
const vendoredSpellings = new Set([...VENDORED.values()].flat())
for (const specifier of specifiers) {
  if (vendoredSpellings.has(specifier)) continue
  const target = packages.get(specifier)
  if (target === undefined) {
    unresolved.push(specifier)
    continue
  }
  if (alreadyResolvable(specifier)) {
    skipped.push(specifier)
    continue
  }
  link(join(pluginRoot, 'node_modules', ...specifier.split('/')), target)
  linked.push(specifier)
}
if (unresolved.length > 0) {
  throw new Error(`${pluginName}: no workspace package in ${checkout} provides: ${unresolved.join(', ')}`)
}

for (const [directory, spellings] of VENDORED) {
  for (const spelling of spellings) {
    if (alreadyResolvable(spelling)) continue
    link(join(pluginRoot, 'node_modules', ...spelling.split('/')), join(checkout, 'vendor', directory))
  }
}

// `tsconfig.json` asks for the Node types, so they must resolve from here too.
// A types-only package has no `exports` entry for `import.meta.resolve`, so the
// ancestor walk is what proves it is reachable.
const nodeTypes = join(checkout, 'node_modules', '@types', 'node')
if (existsSync(nodeTypes) && !resolvesUpTree('@types', 'node')) {
  link(join(pluginRoot, 'node_modules', '@types', 'node'), nodeTypes)
}

console.log(`${pluginName}: linked ${linked.length} packages from ${checkout}`
  + (skipped.length > 0 ? `, ${skipped.length} already resolvable` : ''))

const cli = typescriptCli(checkout)
const args = [cli, '-p', join(pluginRoot, 'tsconfig.json')]
if (!emit) args.push('--noEmit')
const result = windows && cli.endsWith('.cmd')
  ? spawnSync(cli, args.slice(1), { stdio: 'inherit', cwd: pluginRoot, shell: true })
  : spawnSync(process.execPath, args, { stdio: 'inherit', cwd: pluginRoot })
if (result.status !== 0) process.exit(result.status ?? 1)
console.log(emit ? `${pluginName}: built lib/` : `${pluginName}: typecheck passed`)
