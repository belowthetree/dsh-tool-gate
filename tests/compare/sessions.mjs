#!/usr/bin/env node
/**
 * Read the session records of a compare run without decoding the durable
 * zstd session log.
 *
 * Every run writes `transcript.md` (readable, in order) and `transcript.jsonl`
 * (one JSON row per message/tool call) next to its `run.log`, `project/`, and
 * isolated `.dsh/`. This command lists those runs and prints a transcript.
 *
 * Usage:
 *   node sessions.mjs list [--root=<dir>] [--label=<name>]
 *   node sessions.mjs show <label> <arm> <task> [--json]
 *   node sessions.mjs open <label> <arm> <task>   (print the run directory)
 *
 * Environment:
 *   DSH_CMP_ROOT  scratch root (default <this dir>/.compare-run)
 *
 * @module dsh-tool-gate/tests/compare/sessions
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const flags = new Map()
const positional = []
for (const arg of process.argv.slice(2)) {
  const match = /^--([^=]+)(?:=(.*))?$/u.exec(arg)
  if (match !== null) flags.set(match[1], match[2] ?? 'true')
  else positional.push(arg)
}

const here = import.meta.dirname
const root = resolve(flags.get('root') ?? process.env.DSH_CMP_ROOT ?? join(here, '.compare-run'))
const runsRoot = join(root, 'runs')

/** Directory entries that exist, tolerating a missing root. */
async function entriesOf(directory) {
  try {
    return (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isDirectory())
  } catch {
    return []
  }
}

/** Arm names, from the overlay files that define them, longest first. */
async function armNames() {
  try {
    return (await readdir(here))
      .filter(name => name.startsWith('overlay-') && name.endsWith('.patch.yml'))
      .map(name => name.slice('overlay-'.length, -'.patch.yml'.length))
      .sort((left, right) => right.length - left.length)
  } catch {
    return []
  }
}

/** Every run directory as `{ label, arm, task, dir }`. */
async function listRuns() {
  const runs = []
  const arms = await armNames()
  const filters = flags.get('label') === undefined ? undefined : new Set(flags.get('label').split(','))
  for (const labelEntry of await entriesOf(runsRoot)) {
    if (filters !== undefined && !filters.has(labelEntry.name)) continue
    for (const runEntry of await entriesOf(join(runsRoot, labelEntry.name))) {
      // Longest arm name first, so `delegate-only-rows` is not read as arm
      // `delegate` + task `only-rows`.
      const arm = arms.find(candidate => runEntry.name.startsWith(`${candidate}-`))
      if (arm === undefined) {
        runs.push({ label: labelEntry.name, arm: runEntry.name, task: '?', dir: join(runsRoot, labelEntry.name, runEntry.name) })
        continue
      }
      runs.push({
        label: labelEntry.name,
        arm,
        task: runEntry.name.slice(arm.length + 1),
        dir: join(runsRoot, labelEntry.name, runEntry.name),
      })
    }
  }
  return runs
}

/** ISO time of the newest file in a directory, for "when did this run". */
async function newestTime(directory) {
  try {
    return (await stat(join(directory, 'transcript.md'))).mtime.toISOString().replace('T', ' ').slice(0, 19)
  } catch {
    return '（无 transcript）'
  }
}

if (positional[0] === 'list' || positional.length === 0) {
  const runs = await listRuns()
  if (runs.length === 0) {
    console.log(`no runs under ${runsRoot}`)
    console.log('run one with: node compare.mjs --tasks=rows --arms=gated --label=demo')
    process.exit(0)
  }
  console.log(`runs under ${runsRoot}\n`)
  console.log('label'.padEnd(14) + 'arm'.padEnd(16) + 'task'.padEnd(18) + 'transcript'.padEnd(14) + 'dir')
  for (const run of runs) {
    console.log(run.label.padEnd(14) + run.arm.padEnd(16) + run.task.padEnd(18) + 'transcript.md'.padEnd(14) + run.dir)
  }
  console.log(`\nread one with: node sessions.mjs show <label> <arm> <task>`)
  process.exit(0)
}

const [command, label, arm, task] = positional
const run = (await listRuns()).find(candidate => (
  candidate.label === label && candidate.arm === arm && candidate.task === task
))
if (run === undefined) {
  console.error(`no run for ${label} / ${arm} / ${task} — try: node sessions.mjs list`)
  process.exit(1)
}

if (command === 'open') {
  console.log(run.dir)
  process.exit(0)
}

const file = flags.get('json') === 'true' ? 'transcript.jsonl' : 'transcript.md'
try {
  const text = await readFile(join(run.dir, file), 'utf8')
  process.stdout.write(text)
} catch {
  console.error(`${run.dir} has no ${file}`)
  console.error('(old runs predate transcript export; the durable log is under .sessions/, '
    + 'and the metrics are in the label\'s RESULTS-<label>.json)')
  process.exit(1)
}
