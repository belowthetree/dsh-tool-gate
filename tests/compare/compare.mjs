#!/usr/bin/env node
/**
 * Gate experiment — one task set, two arms, one real model.
 *
 * Arm `control` boots the shipped `headless` profile as-is: the root agent sees
 * every tool the composition provides. Arm `gated` boots the same profile plus
 * `dsh-tool-gate`: the root agent sees only the base tools plus the gate tools,
 * and must unlock what it needs before delegating.
 *
 * Both arms run the same prompts, in a fresh copy of the same fixture repository
 * (`E:/Project/dsh-plugins/dsh-channel-manager`), on the same provider/model, each
 * in its own process with a private `DSH_HOME` and session store. So a difference
 * between the arms is a difference in the tool surface, never in the task.
 *
 * Products next to this file: `RESULTS.json` (per-run raw rows) and `RESULTS.md`
 * (Chinese tables + readings). `node report.mjs` re-renders the report from
 * `RESULTS.json` without another model run. Every run keeps its own directory
 * under `<root>/runs/<label>/<arm>-<task>/` with `run.log`, `transcript.md`,
 * `transcript.jsonl`, the modified `project/`, an isolated `.dsh/`, and the
 * durable session log under `.sessions/`.
 *
 * Usage:
 *   node compare.mjs [--tasks=all|id,id] [--arms=control,gated]
 *                    [--timeout=300000] [--root=<dir>] [--label=<name>]
 *                    [--fixture=<path>] [--sequential] [--fresh]
 *
 * `--fresh` wipes the scratch root first; without it earlier runs are kept, so
 * sessions stay inspectable. Re-running the same (label, arm, task) replaces
 * that one directory.
 *
 * Environment:
 *   DSH_CHECKOUT         harness checkout (default E:/Project/deepseek-harness)
 *   DSH_CMP_ROOT         scratch root (default <this dir>/.compare-run)
 *   DSH_CMP_CREDENTIALS  credential store for the LLM route
 *                        (default C:/Users/ZGG/.dsh/.credentials.yaml)
 *
 * @module dsh-tool-gate/tests/compare/compare
 */

import { spawn } from 'node:child_process'
import { access, cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { writeReport } from './report.mjs'
import { selectTasks } from './tasks.mjs'

const flags = new Map()
for (const arg of process.argv.slice(2)) {
  const match = /^--([^=]+)(?:=(.*))?$/u.exec(arg)
  if (match !== null) flags.set(match[1], match[2] ?? 'true')
}

const here = import.meta.dirname
const checkout = resolve(process.env.DSH_CHECKOUT ?? 'E:/Project/deepseek-harness')
const root = resolve(flags.get('root') ?? process.env.DSH_CMP_ROOT ?? join(here, '.compare-run'))
const credentialPath = resolve(process.env.DSH_CMP_CREDENTIALS ?? 'C:/Users/ZGG/.dsh/.credentials.yaml')
const fixture = resolve(flags.get('fixture') ?? 'E:/Project/dsh-plugins/dsh-channel-manager')
const arms = (flags.get('arms') ?? 'control,gated').split(',').map(part => part.trim()).filter(Boolean)
const tasks = selectTasks(flags.get('tasks'))
const timeoutMs = Number(flags.get('timeout') ?? 300_000)
const label = flags.get('label') ?? 'compare'
const sequential = flags.has('sequential')
const model = 'opencode-go/deepseek-v4.1-flash'
const clip = (value, max = 1_200) => (value.length <= max ? value : `${value.slice(0, max)}…`)

// Any arm named after an existing overlay is runnable, so adding an arm is one
// file. The known set today is: control, gated, gated-root, delegate-only.
for (const arm of arms) {
  const overlay = join(here, `overlay-${arm}.patch.yml`)
  const readable = await access(overlay).then(() => true, () => false)
  if (!readable) throw new Error(`unknown arm "${arm}" (no ${overlay})`)
}

/** Copy the fixture into one run's project directory. */
async function seedWorkspace(workspace) {
  await rm(workspace, { recursive: true, force: true })
  await mkdir(workspace, { recursive: true })
  await cp(fixture, workspace, { recursive: true, verbatimSymlinks: true })
}

/** One (arm, task) child process; resolves the run's CMP-RUN row. */
async function runOne({ arm, task }) {
  const runDir = join(root, 'runs', label, `${arm}-${task.id}`)
  const workspace = join(runDir, 'project')
  await mkdir(runDir, { recursive: true })
  await seedWorkspace(workspace)
  console.log(`CMP-START arm=${arm} task=${task.id}`)
  const env = {
    ...process.env,
    DSH_ARM: arm,
    DSH_TASK: task.id,
    DSH_WORKSPACE: workspace,
    DSH_CMP_ROOT: runDir,
    DSH_HOME: join(runDir, '.dsh'),
    DSH_CMP_CREDENTIALS: credentialPath,
    DSH_CHECKOUT: checkout,
    DSH_TIMEOUT: String(timeoutMs),
    DSH_TELEMETRY_DISABLED: '1',
  }
  const child = spawn(process.execPath, [join(here, 'run-one.mjs')], {
    cwd: workspace,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => {
    stdout += chunk
  })
  child.stderr.on('data', chunk => {
    stderr += chunk
  })
  const killTimer = setTimeout(() => child.kill('SIGKILL'), timeoutMs + 180_000)
  const exitCode = await new Promise(resolvePromise => {
    child.on('close', code => resolvePromise(code))
  })
  clearTimeout(killTimer)
  await writeFile(join(runDir, 'run.log'), `${stdout}\n--- stderr ---\n${stderr}\n`, 'utf8')
  const line = stdout.split(/\r?\n/).find(candidate => candidate.startsWith('CMP-RUN '))
  let row
  if (line === undefined) {
    row = {
      ok: false,
      arm,
      task: task.id,
      error: `no CMP-RUN line (exit ${exitCode}): ${clip(stderr.replaceAll('\n', ' '), 500)}`,
    }
  } else {
    try {
      row = JSON.parse(line.slice('CMP-RUN '.length))
    } catch (error) {
      row = { ok: false, arm, task: task.id, error: `unparsable CMP-RUN line: ${error.message}` }
    }
  }
  row.label = label
  row.runDir = runDir
  console.log(`CMP-ROW ${JSON.stringify({
    arm: row.arm,
    task: row.task,
    ok: row.ok,
    completed: row.grade?.completed ?? null,
    tokens: row.usage?.total ?? null,
    error: row.error ?? null,
  })}`)
  return row
}

const credentialReadable = await access(credentialPath).then(() => true, () => false)
if (!credentialReadable) throw new Error(`credential store not readable: ${credentialPath}`)

if (flags.has('fresh')) await rm(root, { recursive: true, force: true })
await mkdir(root, { recursive: true })
console.log(`CMP-BOOT root=${root} fixture=${fixture} arms=${arms.join('+')} tasks=${tasks.length} model=${model}`)

const rows = []
for (const task of tasks) {
  if (sequential) {
    for (const arm of arms) rows.push(await runOne({ arm, task }))
  } else {
    rows.push(...await Promise.all(arms.map(arm => runOne({ arm, task }))))
  }
}

const payload = {
  label,
  generatedAt: new Date().toISOString(),
  model,
  fixture,
  arms,
  tasks: tasks.map(task => task.id),
  rows,
}
await writeFile(join(here, `RESULTS-${label}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
await writeFile(join(here, 'RESULTS.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
const armStats = await writeReport(payload, here, `RESULTS-${label}`)
await writeReport(payload, here, 'RESULTS')

console.log('')
console.log('--- summary ---')
for (const arm of arms) {
  const stat = armStats[arm]
  console.log(`${arm.padEnd(8)} completed=${stat.completed}/${stat.runs} total=${stat.usage.total} `
    + `uncached=${stat.usage.uncachedInput} cacheRead=${stat.usage.cacheRead} output=${stat.usage.output} `
    + `surface=${Math.round(stat.surfaceCount)}tools/${Math.round(stat.surfaceBytes)}B elapsed=${Math.round(stat.meanElapsedMs)}ms`)
}
console.log(`results: ${join(here, 'RESULTS.md')}`)
