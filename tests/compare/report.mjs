/**
 * Turn one experiment's raw rows into `RESULTS.md`.
 *
 * Kept separate from `compare.mjs` so a finished `RESULTS.json` can be re-rendered
 * without paying for another model run: `node report.mjs`.
 *
 * The tables keep cached and uncached input apart on purpose. A gated session
 * re-sends a much smaller tool prefix on every step, which shows up mostly as
 * fewer *cache-read* tokens; first-time (uncached) input barely moves, so a
 * single "total tokens" number would overstate what the gate saves.
 *
 * @module dsh-tool-gate/tests/compare/report
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const sum = values => values.reduce((total, value) => total + value, 0)
const mean = values => (values.length === 0 ? 0 : sum(values) / values.length)
const ratio = (left, right) => (right === 0 ? null : Math.round((left / right) * 100) / 100)

/** Provider-reported usage split for one aggregate. */
function usageOf(rows) {
  const uncachedInput = sum(rows.map(row => row.usage.uncachedInput))
  const cacheRead = sum(rows.map(row => row.usage.cacheRead))
  const cacheWrite = sum(rows.map(row => row.usage.cacheWrite))
  return {
    uncachedInput,
    cacheRead,
    cacheWrite,
    billedInput: uncachedInput + cacheRead + cacheWrite,
    output: sum(rows.map(row => row.usage.output)),
    total: sum(rows.map(row => row.usage.total)),
  }
}

/** Markdown table renderer bound to one output buffer. */
function makeTable(lines) {
  return (header, body) => {
    lines.push(`| ${header.join(' | ')} |`)
    lines.push(`| ${header.map(() => '---').join(' | ')} |`)
    for (const cells of body) lines.push(`| ${cells.join(' | ')} |`)
    lines.push('')
  }
}

/**
 * Aggregate rows per arm and write `<name>.md` next to `RESULTS.json`.
 * @param {object} payload - `{ label, generatedAt, model, fixture, arms, tasks, rows }`.
 * @param {string} dir - Directory holding the report.
 * @param {string} [name] - Report base name without extension (default `RESULTS`).
 * @returns {Promise<Record<string, object>>} Per-arm aggregates.
 */
export async function writeReport(payload, dir, name = 'RESULTS') {
  const okRows = payload.rows.filter(row => row.ok === true)
  const armStats = {}
  for (const arm of payload.arms) {
    const list = okRows.filter(row => row.arm === arm)
    const childSessions = list.flatMap(row => row.children.sessions)
    armStats[arm] = {
      runs: list.length,
      completed: list.filter(row => row.grade?.completed === true).length,
      usage: usageOf(list),
      rootUsage: usageOf(list.map(row => ({ usage: row.root.usage }))),
      childUsage: usageOf(childSessions.map(session => ({ usage: session.usage }))),
      meanRootSteps: mean(list.map(row => row.root.steps)),
      meanRootToolCalls: mean(list.map(row => row.root.toolCalls.length)),
      meanChildSteps: mean(childSessions.map(session => session.steps)),
      meanElapsedMs: mean(list.map(row => row.elapsedMs)),
      surfaceCount: mean(list.map(row => row.root.firstSurface?.count ?? 0)),
      surfaceBytes: mean(list.map(row => row.root.firstSurface?.bytes ?? 0)),
      gate: {
        select: sum(list.map(row => row.gateCalls?.select ?? 0)),
        delegate: sum(list.map(row => row.gateCalls?.delegate ?? 0)),
        subagent: sum(list.map(row => row.gateCalls?.subagent ?? 0)),
        subagentFork: sum(list.map(row => row.gateCalls?.subagentFork ?? 0)),
      },
      children: childSessions.length,
    }
  }

  const lines = []
  const table = makeTable(lines)

  lines.push('# 工具门控 A/B：开启 dsh-tool-gate vs 不开启', '')
  lines.push(`- 生成时间：${payload.generatedAt}`)
  lines.push(`- 模型：\`${payload.model}\`（reasoningEffort: max）`)
  lines.push(`- 实验体：\`${payload.fixture}\` 的独立副本，每次运行重建；两臂 prompt 完全相同`)
  lines.push(`- 任务：${payload.tasks.join('、')}；臂：${payload.arms.join(' / ')}；`
    + '每个 (任务, 臂) 一次独立进程、独立 DSH_HOME 与会话库', '')

  const control = armStats.control
  if (control !== undefined) {
    lines.push('## 结论摘要', '')
    lines.push(`- 完成：${payload.arms.map(arm => `${arm} ${armStats[arm].completed}/${armStats[arm].runs}`).join('，')}`)
    for (const arm of payload.arms) {
      if (arm === 'control') continue
      const stat = armStats[arm]
      lines.push(`- **${arm}**（对 control 的比值）：合计 token ${ratio(stat.usage.total, control.usage.total)}×`
        + `（${stat.usage.total}），未命中缓存输入 ${ratio(stat.usage.uncachedInput, control.usage.uncachedInput)}×`
        + `（${stat.usage.uncachedInput}），缓存读 ${ratio(stat.usage.cacheRead, control.usage.cacheRead)}×`
        + `（${stat.usage.cacheRead}），首请求工具面 ${Math.round(stat.surfaceCount)} 个 / ${Math.round(stat.surfaceBytes)} B`
        + `，平均耗时 ${Math.round(stat.meanElapsedMs)} ms`
        + `，select_tools ${stat.gate.select} 次，delegate ${stat.gate.delegate} 次，subagent ${stat.gate.subagent} 次`
        + `，子代理 ${stat.children} 个`)
    }
    lines.push('')
  }

  lines.push('## 汇总', '')
  table(
    ['臂', '完成/总数', '合计 token', '未命中缓存输入', '缓存读', '输出', '根代理 token', '子代理 token',
      '平均根步数', '平均根工具调用', '平均子代理步数', '平均耗时 ms', '首请求工具面', '工具面字节', '子代理数'],
    payload.arms.map((arm) => {
      const stat = armStats[arm]
      return [
        arm,
        `${stat.completed}/${stat.runs}`,
        stat.usage.total,
        stat.usage.uncachedInput,
        stat.usage.cacheRead,
        stat.usage.output,
        stat.rootUsage.total,
        stat.childUsage.total,
        stat.meanRootSteps.toFixed(1),
        stat.meanRootToolCalls.toFixed(1),
        stat.meanChildSteps.toFixed(1),
        Math.round(stat.meanElapsedMs),
        Math.round(stat.surfaceCount),
        Math.round(stat.surfaceBytes),
        stat.children,
      ]
    }),
  )

  lines.push('## 逐任务', '')
  table(
    ['任务', '臂', '完成', '根步数', '根工具调用', '子代理数', '子代理步数', '合计 token',
      '未命中输入', '缓存读', '输出', '耗时 ms', '派发方式', '答案摘要'],
    payload.rows.map((row) => {
      if (row.ok !== true) {
        return [row.task, row.arm, 'ERROR', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', row.error]
      }
      const delegation = []
      if (row.gateCalls?.delegate > 0) delegation.push('delegate')
      if (row.gateCalls?.subagent > 0) delegation.push('subagent')
      if (row.gateCalls?.subagentFork > 0) delegation.push('subagent_fork')
      return [
        row.task,
        row.arm,
        row.grade?.completed === true ? '✅' : '❌',
        row.root.steps,
        row.root.toolCalls.length,
        row.children.count,
        row.children.steps,
        row.usage.total,
        row.usage.uncachedInput,
        row.usage.cacheRead,
        row.usage.output,
        row.elapsedMs,
        delegation.join('+') || '（未派发）',
        row.answer,
      ]
    }),
  )

  lines.push('## 门控与委派行为（非 control 臂）', '')
  table(
    ['任务', '臂', 'select_tools', '本轮保留的工具', 'delegate 调用（工具清单 / sealed）',
      '目录快照数', '工具面增量', '首请求工具数', '末请求工具数', '子代理首工具数'],
    payload.rows.filter(row => row.arm !== 'control' && row.ok === true).map(row => [
      row.task,
      row.arm,
      row.gateCalls.select,
      (row.selectRequests ?? []).length === 0 ? '—' : row.selectRequests.map(names => names.join(',')).join(' ; '),
      (row.delegateRequests ?? []).length === 0
        ? '—'
        : row.delegateRequests.map(call => `[${call.tools.join(',')}]${call.sealed ? ' sealed' : ''}`).join(' ; '),
      row.root.runtimeContexts ?? 0,
      row.surfaceAdditions.length === 0 ? '—' : row.surfaceAdditions.join(','),
      row.root.firstSurface?.count ?? '?',
      row.root.lastSurfaceCount ?? '?',
      row.children.sessions.map(session => session.surface?.count ?? '?').join('/') || '—',
    ]),
  )

  lines.push('## 读数说明', '')
  lines.push('- 所有 token 数字来自 provider 在 `assistant/message.usage` 回报的计数，不是估算；'
    + '`未命中缓存输入`、`缓存读`、`缓存写` 三者相加 = 计费输入，再加 `输出` = 合计 token。')
  lines.push('- **为什么把缓存读单列**：工具 schema 在每一步都作为前缀重发，命中缓存后按缓存价计'
    + '（各家折扣不同）。门控省下的是"重复上下文体积"，看 `未命中缓存输入` 才知道首次处理量的真实变化。')
  lines.push('- `首请求工具面` 取自根代理第一次 `request/header` 事件的 `tools` 数组（工具数与 UTF-8 字节数）；'
    + '每步都会重发这个固定前缀，所以工具面差会随步数放大。')
  lines.push('- `工具面增量` 是会话里 `developer/message` 的 `tool-addition` 块：模型解锁工具后，'
    + 'agent loop 自动写下的"你的工具变了"的增量声明。')
  lines.push('- 完成度：简单任务看根代理最终回答文本是否包含必须出现的事实；`toolkit-notes` / `arch-split` 这类'
    + '复杂任务直接读运行后的工作区（产物文件是否存在、关键事实是否齐全、原文件是否被正确改动），不看模型自述。')
  lines.push('- 两臂都不挂 shell（`tool-pwsh` / `tool-bash` 已禁用）：任务是文件读写，且本机 pwsh 自身报 '
    + 'Win32 ACL 失败，留着会让两臂因环境缺陷而非门控差异失分。')
  lines.push('- `gated` / `delegate-only` 臂的子代理同样被门控；`gated-root` 臂只门控根代理（子代理拿完整工具面），'
    + '三个臂放在一起就能把"父代理更克制"和"子代理上下文更小"两个因素拆开。')
  lines.push('- 每个 (任务, 臂) 只跑一次；模型有采样噪声，差 10% 以内不要当成结论。')
  lines.push('- 逐次原始数据在 `RESULTS.json`，每次运行的完整 stdout/stderr 在该次 `runDir/run.log`。')

  await writeFile(join(dir, `${name}.md`), `${lines.join('\n')}\n`, 'utf8')
  return armStats
}

// `node report.mjs [label]` re-renders the finished run without calling the model.
if (process.argv[1] !== undefined && process.argv[1] === import.meta.filename) {
  const here = import.meta.dirname
  const label = process.argv[2]
  const jsonName = label === undefined ? 'RESULTS.json' : `RESULTS-${label}.json`
  const payload = JSON.parse(await readFile(join(here, jsonName), 'utf8'))
  const stats = await writeReport(payload, here, label === undefined ? 'RESULTS' : `RESULTS-${label}`)
  for (const [arm, stat] of Object.entries(stats)) {
    console.log(`${arm.padEnd(12)} completed=${stat.completed}/${stat.runs} total=${stat.usage.total} `
      + `uncached=${stat.usage.uncachedInput} cacheRead=${stat.usage.cacheRead}`)
  }
  console.log(`report: ${join(here, label === undefined ? 'RESULTS.md' : `RESULTS-${label}.md`)}`)
}
