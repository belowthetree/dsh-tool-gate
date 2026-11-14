#!/usr/bin/env node
/**
 * One (arm, task) run in its own process.
 *
 * Boots the shipped `headless` profile with the arm's overlay, sends the task
 * prompt to the standing root agent, waits for its turn to end, and prints one
 * `CMP-RUN {...}` JSON line describing what happened — every number comes from
 * the harness itself:
 *
 *   usage        the `usage` field on each `assistant/message` session event
 *                (provider-reported counts, never estimated).
 *   tool surface the `tools` array of each `request/header` event, so surface
 *                growth (and its byte cost) is measured, not guessed.
 *   gate work    `select_tools` calls with the names they kept, and
 *                `developer/message` tool-addition deltas the loop wrote.
 *   delegation   which delegation tool started a child, and each child session's
 *                own usage and first tool surface.
 *   completion   the deterministic grader in tasks.mjs over the final answer.
 *
 * A separate process per run is what keeps the arms comparable: a fresh Cordis
 * app, a fresh root agent with no conversation history, and a private
 * `DSH_HOME`/session store. Nothing reaches the real profile.
 *
 * Environment:
 *   DSH_ARM            arm name (selects overlay-<arm>.patch.yml)
 *   DSH_TASK           task id from tasks.mjs
 *   DSH_WORKSPACE      absolute path of this run's fixture copy (becomes cwd)
 *   DSH_CMP_ROOT       absolute path of this run's scratch root
 *   DSH_CMP_CREDENTIALS credential store for the LLM route
 *   DSH_TIMEOUT        per-run wall-clock limit in ms
 *   DSH_CHECKOUT       harness checkout (default E:/Project/deepseek-harness)
 *
 * @module dsh-tool-gate/tests/compare/run-one
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const arm = process.env.DSH_ARM ?? ''
const taskId = process.env.DSH_TASK ?? ''
const workspace = resolve(process.env.DSH_WORKSPACE ?? process.cwd())
const runRoot = resolve(process.env.DSH_CMP_ROOT ?? join(workspace, '..'))
const timeoutMs = Number(process.env.DSH_TIMEOUT ?? 300_000)
const checkout = resolve(process.env.DSH_CHECKOUT ?? 'E:/Project/deepseek-harness')
const here = import.meta.dirname

process.env.DSH_HOME = join(runRoot, '.dsh')
process.env.DSH_TELEMETRY_DISABLED = '1'
await mkdir(process.env.DSH_HOME, { recursive: true })
process.chdir(workspace)

const checkoutUrl = relative => pathToFileURL(join(checkout, relative)).href
const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms))
const clip = (value, max = 400) => (value.length <= max ? value : `${value.slice(0, max)}…`)
const sum = values => values.reduce((total, value) => total + value, 0)

/** The answer text of one assistant message, if it has any. */
function textOf(content) {
  if (!Array.isArray(content)) return undefined
  const parts = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.length === 0 ? undefined : parts.join('')
}

/** One session's captured facts. */
function emptyBucket() {
  return {
    steps: [],
    toolCalls: [],
    headers: [],
    additions: [],
    turnEnds: [],
    errors: [],
    runtimeContexts: 0,
    turns: 0,
    finalText: undefined,
    transcript: [],
  }
}

const buckets = new Map()
const ended = new Set()
const waiters = new Map()

function bucketOf(id) {
  let bucket = buckets.get(id)
  if (bucket === undefined) {
    bucket = emptyBucket()
    buckets.set(id, bucket)
  }
  return bucket
}

/** Resolve once a session's turn ends, or the timeout expires. */
function waitForTurn(id, ms) {
  if (ended.has(id)) return Promise.resolve(true)
  return new Promise(resolvePromise => {
    const timer = setTimeout(() => {
      waiters.delete(id)
      resolvePromise(false)
    }, ms)
    waiters.set(id, () => {
      clearTimeout(timer)
      waiters.delete(id)
      resolvePromise(true)
    })
  })
}

/** Provider-reported usage over one bucket's steps. */
function usageOf(bucket) {
  const usage = { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 }
  for (const step of bucket.steps) {
    usage.uncachedInput += step.usage.inputTokens ?? 0
    usage.cacheRead += step.usage.cacheReadTokens ?? 0
    usage.cacheWrite += step.usage.cacheWriteTokens ?? 0
    usage.output += step.usage.outputTokens ?? 0
    usage.reasoning += step.usage.reasoningTokens ?? 0
  }
  usage.billedInput = usage.uncachedInput + usage.cacheRead + usage.cacheWrite
  usage.total = usage.billedInput + usage.output
  return usage
}

/** The first request header of one bucket, as count and UTF-8 bytes. */
function surfaceOf(bucket) {
  const [first] = bucket.headers
  if (first === undefined) return undefined
  return { count: first.count, bytes: first.bytes, names: first.names }
}

/** Emit the final row and leave. */
function finish(row) {
  console.log(`CMP-RUN ${JSON.stringify(row)}`)
}

let ctx
try {
  const { taskById } = await import('./tasks.mjs')
  const task = taskById(taskId)
  const { bootProductionProfile } = await import(
    checkoutUrl('packages/test-support/loader-smoke/tests/fixtures/production-profile.ts')
  )
  const { createUserMessage } = await import(checkoutUrl('packages/llm/llm/lib/index.js'))
  const { provideCmdline } = await import(checkoutUrl('packages/boot/cmdline/lib/index.js'))

  ctx = await bootProductionProfile({
    binName: `tool-gate-compare-${arm}`,
    profile: 'headless',
    overlayPaths: [join(here, `overlay-${arm}.patch.yml`)],
    // The headless bundle expects a launcher-axed command line: `headless-startup`
    // injects `cmdlineArgs`, and `sandbox-policy` injects the startup service it
    // publishes. Programmatic boots have no launcher, so publish an empty
    // invocation here; the one-shot runner row is disabled and never reads a task.
    prepare(rootCtx) {
      provideCmdline(rootCtx, { args: [], exit: code => process.exit(code) })
    },
  })

  ctx.on('session/event', (session, raw) => {
    const event = raw ?? {}
    const data = event.data ?? event
    const bucket = bucketOf(String(session.id))
    switch (event.type) {
      case 'request/header': {
        const tools = data.header?.tools
        if (Array.isArray(tools)) {
          bucket.headers.push({
            count: tools.length,
            bytes: Buffer.byteLength(JSON.stringify(tools), 'utf8'),
            names: tools.map(tool => tool.name).sort(),
          })
        }
        break
      }
      case 'tool/call': {
        let args = data.arguments
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args)
          } catch {
            // Keep the raw string; a malformed call is still worth recording.
          }
        }
        bucket.toolCalls.push({ name: String(data.name ?? '?'), args })
        bucket.transcript.push({ role: 'call', callId: data.callId ?? data.id, name: String(data.name ?? '?'), args })
        break
      }
      case 'tool/result': {
        // `tool/result` carries the message under `data.message`.
        const message = data.message ?? {}
        const content = message.content
        const text = textOf(content) ?? (typeof content === 'string' ? content : JSON.stringify(content ?? ''))
        bucket.transcript.push({
          role: 'result',
          callId: message.callId ?? data.callId,
          error: message.isError === true || data.error !== undefined,
          text: clip(text, 2_000),
        })
        break
      }
      case 'developer/message': {
        const content = data.message?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === 'tool-addition') bucket.additions.push(String(block.toolName))
          }
          bucket.transcript.push({
            role: 'developer',
            text: content
              .filter(block => typeof block === 'object' && block !== null)
              .map(block => (block.type === 'text' ? block.text : block.type === 'tool-addition' ? `tool-addition: ${block.toolName}` : block.type))
              .join('\n'),
          })
        }
        break
      }
      case 'user/message': {
        // `user/message` stores the message as the event data itself.
        const sourceKind = data.source?.kind ?? data.message?.source?.kind
        if (sourceKind === 'runtime-context') bucket.runtimeContexts += 1
        const text = textOf(data.content ?? data.message?.content) ?? ''
        bucket.transcript.push({
          role: 'user',
          source: sourceKind ?? 'user',
          text: sourceKind === 'runtime-context' ? clip(text, 4_000) : clip(text, 4_000),
        })
        break
      }
      case 'assistant/message': {
        if (data.usage !== undefined && data.usage !== null) {
          bucket.steps.push({ turn: data.turn, step: data.step, usage: data.usage })
        }
        const text = textOf(data.message?.content)
        if (text !== undefined) {
          bucket.finalText = text
          bucket.transcript.push({ role: 'assistant', turn: data.turn, step: data.step, text: clip(text, 4_000) })
        }
        break
      }
      case 'turn/end': {
        bucket.turns += 1
        bucket.turnEnds.push(data.reason ?? null)
        ended.add(String(session.id))
        waiters.get(String(session.id))?.()
        break
      }
      case 'agent/error': {
        bucket.errors.push(`${data.error?.name ?? 'Error'}: ${data.error?.message ?? String(data.error)}`)
        break
      }
      default:
        break
    }
  })

  // The standing root agent is published by `agent-loop`; its creation may still
  // be in flight when boot returns. `subagents.rootOf()` distinguishes the root
  // from any child the runtime might have started.
  const rootOf = () => {
    const agents = ctx.agents.list()
    if (agents.length === 0) return undefined
    const subagents = ctx.get?.('subagents')
    if (typeof subagents?.rootOf === 'function') {
      const root = agents.find(agent => {
        try {
          return subagents.rootOf(agent) === agent
        } catch {
          return false
        }
      })
      if (root !== undefined) return root
    }
    return agents[0]
  }
  if (rootOf() === undefined) {
    await Promise.race([
      new Promise(resolvePromise => {
        const dispose = ctx.on('agent/created', () => {
          dispose()
          resolvePromise()
        })
      }),
      sleep(15_000),
    ])
  }
  const root = rootOf()
  if (root === undefined) throw new Error('no root agent published')
  const rootId = String(root.id)
  const startedAt = Date.now()

  root.followup(createUserMessage({ content: [{ type: 'text', text: task.prompt }], source: { kind: 'user' } }))
  const firstTurnEnded = await waitForTurn(rootId, timeoutMs)

  // A delegated child runs as its own agent and reports back through the
  // parent's inbox, so the root's first turn is not the end of the run: wait
  // until every agent has been idle for a quiet window (the parent wakes once
  // per delivered child result).
  const QUIET_MS = 8_000
  const settleDeadline = Date.now() + timeoutMs
  let quietSince
  while (Date.now() < settleDeadline) {
    const busy = ctx.agents.list().some(agent => agent.status !== 'idle')
    if (!busy) {
      quietSince ??= Date.now()
      if (Date.now() - quietSince >= QUIET_MS) break
    } else {
      quietSince = undefined
    }
    await sleep(500)
  }
  const settled = quietSince !== undefined && Date.now() - quietSince >= QUIET_MS
  const elapsedMs = Date.now() - startedAt

  const rootBucket = buckets.get(rootId) ?? emptyBucket()
  const childSessions = [...buckets.entries()]
    .filter(([id]) => id !== rootId)
    .map(([id, bucket]) => ({
      id,
      steps: bucket.steps.length,
      toolCalls: bucket.toolCalls.length,
      toolCallNames: bucket.toolCalls.map(call => call.name),
      headerCounts: bucket.headers.map(header => header.count),
      usage: usageOf(bucket),
      surface: surfaceOf(bucket),
      additions: bucket.additions,
      answer: clip((bucket.finalText ?? '').replaceAll('\n', ' '), 200),
    }))
  const childUsage = childSessions.map(child => child.usage)
  const rootUsage = usageOf(rootBucket)
  const usage = {
    billedInput: rootUsage.billedInput + sum(childUsage.map(item => item.billedInput)),
    uncachedInput: rootUsage.uncachedInput + sum(childUsage.map(item => item.uncachedInput)),
    cacheRead: rootUsage.cacheRead + sum(childUsage.map(item => item.cacheRead)),
    cacheWrite: rootUsage.cacheWrite + sum(childUsage.map(item => item.cacheWrite)),
    output: rootUsage.output + sum(childUsage.map(item => item.output)),
    reasoning: rootUsage.reasoning + sum(childUsage.map(item => item.reasoning)),
    total: rootUsage.total + sum(childUsage.map(item => item.total)),
  }

  const rootCallNames = rootBucket.toolCalls.map(call => call.name)
  const countOf = name => rootCallNames.filter(candidate => candidate === name).length
  const gateCalls = {
    select: countOf('select_tools'),
    delegate: countOf('delegate'),
    subagent: countOf('subagent'),
    subagentFork: countOf('subagent_fork'),
  }
  const selectRequests = rootBucket.toolCalls
    .filter(call => call.name === 'select_tools')
    .map(call => (Array.isArray(call.args?.tools) ? call.args.tools : []))
  const delegateRequests = rootBucket.toolCalls
    .filter(call => call.name === 'delegate')
    .map(call => ({
      tools: Array.isArray(call.args?.tools) ? call.args.tools : [],
      sealed: call.args?.sealed === true,
    }))

  const grade = await task.grade(rootBucket.finalText, { workspace })

  // A readable transcript next to the metrics, so a finished run can be read
  // without decoding the durable zstd session log under `.sessions/`.
  const rootSessionId = String(root.id)
  const sections = [...buckets.entries()].sort(([left], [right]) => (
    left === rootSessionId ? -1 : right === rootSessionId ? 1 : left.localeCompare(right)
  ))
  const transcriptLines = [
    `# Transcript — ${arm} / ${task.id}`,
    '',
    `- arm: ${arm}`,
    `- task: ${task.id}`,
    `- model: ${process.env.DSH_MODEL ?? 'opencode-go/deepseek-v4.1-flash'}`,
    `- session log: \`.sessions/\` (zstd JSONL, DSH 的持久日志)`,
    '',
  ]
  const transcriptRows = []
  for (const [id, bucket] of sections) {
    const role = id === rootSessionId ? 'root' : 'child'
    const nameByCall = new Map(bucket.transcript
      .filter(entry => entry.role === 'call' && entry.callId !== undefined)
      .map(entry => [entry.callId, entry.name]))
    transcriptLines.push(`## ${role} session — \`${id}\``, '')
    transcriptLines.push(`- steps: ${bucket.steps.length}`, `- tokens: ${usageOf(bucket).total}`, '')
    for (const entry of bucket.transcript) {
      transcriptRows.push({ session: id, role, ...entry })
      if (entry.role === 'user') {
        transcriptLines.push(`### user (${entry.source})`, '', entry.text, '')
      } else if (entry.role === 'assistant') {
        transcriptLines.push(`### assistant (turn ${entry.turn ?? '?'} step ${entry.step ?? '?'})`, '', entry.text, '')
      } else if (entry.role === 'call') {
        transcriptLines.push('### tool call: ' + entry.name, '', '```json', JSON.stringify(entry.args ?? {}, null, 2), '```', '')
      } else if (entry.role === 'result') {
        const name = entry.name ?? nameByCall.get(entry.callId)
        transcriptLines.push(`### tool result${entry.error ? ' (error)' : ''}${name ? `: ${name}` : ''}`, '', entry.text ?? '', '')
      } else if (entry.role === 'developer') {
        transcriptLines.push('### developer context', '', entry.text ?? '', '')
      }
    }
  }
  await writeFile(join(runRoot, 'transcript.md'), `${transcriptLines.join('\n')}\n`, 'utf8')
  await writeFile(
    join(runRoot, 'transcript.jsonl'),
    `${transcriptRows.map(row => JSON.stringify(row)).join('\n')}\n`,
    'utf8',
  )

  finish({
    ok: true,
    arm,
    task: task.id,
    finished: firstTurnEnded && settled,
    elapsedMs,
    gateCalls,
    selectRequests,
    delegateRequests,
    surfaceAdditions: rootBucket.additions,
    root: {
      steps: rootBucket.steps.length,
      turns: rootBucket.turns,
      toolCalls: rootCallNames,
      usage: rootUsage,
      firstSurface: surfaceOf(rootBucket),
      lastSurfaceCount: rootBucket.headers.at(-1)?.count ?? null,
      runtimeContexts: rootBucket.runtimeContexts,
      turnEnds: rootBucket.turnEnds,
      errors: rootBucket.errors,
    },
    children: {
      count: childSessions.length,
      steps: sum(childSessions.map(child => child.steps)),
      toolCalls: sum(childSessions.map(child => child.toolCalls)),
      sessions: childSessions,
    },
    usage,
    grade,
    answer: clip((rootBucket.finalText ?? '').replaceAll('\n', ' '), 400),
  })
} catch (error) {
  finish({
    ok: false,
    arm,
    task: taskId,
    error: `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`,
    stack: clip(String(error?.stack ?? ''), 1_500),
  })
} finally {
  await Promise.race([ctx?.fiber?.dispose?.() ?? Promise.resolve(), sleep(5_000)]).catch(() => {})
  console.log('CMP-DONE')
  process.exit(0)
}
