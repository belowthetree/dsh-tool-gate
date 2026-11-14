/**
 * The gate contract: per-turn catalog, selection window, reset on a new message.
 *
 * @module dsh-tool-gate/tests/gate
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Config, apply } from '../lib/index.js'
import { createHarness, createSubagents } from './support/fake-tools.mjs'

/** The surface a gated composition is meant to start from. */
const TOOLS = [
  { name: 'read', description: 'Read a file.' },
  { name: 'write', description: 'Write a file.' },
  { name: 'edit', description: 'Edit a file.' },
  { name: 'pwsh', description: 'Run a shell command.' },
  { name: 'web_search', description: 'Search the web.' },
  { name: 'web_fetch', description: 'Fetch one URL.' },
  { name: 'subagent', description: 'Delegate a task to a child agent.' },
]

/** Apply the plugin to a fresh harness and gate its agent. */
function gated(options = {}, config = {}) {
  const harness = createHarness({ tools: TOOLS, ...options })
  apply(harness.ctx, Config(config))
  harness.emit('agent/created', { agent: harness.agent })
  return harness
}

/** The definition of one registered gate tool. */
function definitionOf(harness, name) {
  const found = harness.registered.find(candidate => candidate.name === name)
  assert.ok(found, `expected the plugin to register "${name}"`)
  return found
}

/** The catalog context of a gated harness. */
function catalogOf(harness) {
  const entry = harness.contexts.find(candidate => candidate.name === 'tool-gate:catalog')
  assert.ok(entry, 'expected a tool-gate:catalog context')
  return entry
}

/** A minimal `ToolRunContext`. */
function exec(agent) {
  return { agent, signal: new AbortController().signal }
}

/** A message that looks like genuine user input. */
const userMessage = { role: 'user', source: { kind: 'user' } }

describe('installation', () => {
  it('exposes the base tools and the selection tool, and nothing else', () => {
    const harness = gated()
    assert.deepEqual(harness.visibleNames().sort(), [
      'edit', 'read', 'select_tools', 'write',
    ])
  })

  it('installs one restriction and replaces it rather than stacking', async () => {
    const harness = gated()
    assert.equal(harness.filters.length, 1)
    const select = definitionOf(harness, 'select_tools')
    await select.execute({ tools: ['web_search'] }, exec(harness.agent))
    assert.equal(harness.filters.length, 1)
  })

  it('drops a base tool the composition does not provide', () => {
    const harness = createHarness({ tools: TOOLS.filter(tool => tool.name !== 'pwsh') })
    apply(harness.ctx, Config({ baseTools: ['read', 'pwsh', 'bash'] }))
    harness.emit('agent/created', { agent: harness.agent })
    assert.deepEqual(harness.visibleNames().sort(), ['read', 'select_tools'])
  })

  it('lifts the restriction when the agent is disposed', () => {
    const harness = gated()
    harness.emit('agent/disposed', { agent: harness.agent })
    assert.equal(harness.filters.length, 0)
  })
})

describe('catalog context', () => {
  it('is one required runtime-context entry', () => {
    const harness = gated()
    const entry = catalogOf(harness)
    assert.equal(entry.required, true)
    assert.equal(typeof entry.text, 'function')
  })

  it('lists every unlockable tool once and hides the already-exposed ones', () => {
    const harness = gated()
    const text = catalogOf(harness).text({ agent: harness.agent })
    for (const tool of ['web_search', 'web_fetch', 'subagent']) assert.match(text, new RegExp(`- ${tool}:`))
    assert.doesNotMatch(text, /- read:/)
    assert.match(text, /select_tools/)
  })

  it('switches to a compact summary after the turn selects tools', async () => {
    const harness = gated()
    const select = definitionOf(harness, 'select_tools')
    await select.execute({ tools: ['web_search'] }, exec(harness.agent))
    const text = catalogOf(harness).text({ agent: harness.agent })
    assert.match(text, /Kept for this turn: web_search/)
    assert.doesNotMatch(text, /- web_search:/)
  })
})

describe('selection', () => {
  it('keeps a requested tool', async () => {
    const harness = gated()
    const select = definitionOf(harness, 'select_tools')
    const result = await select.execute({ tools: ['web_search'] }, exec(harness.agent))
    assert.match(result, /Kept for this turn: web_search/)
    assert.ok(harness.visibleNames().includes('web_search'))
  })

  it('replaces the previous selection', async () => {
    const harness = gated()
    const select = definitionOf(harness, 'select_tools')
    await select.execute({ tools: ['web_search'] }, exec(harness.agent))
    await select.execute({ tools: ['subagent'] }, exec(harness.agent))
    assert.ok(!harness.visibleNames().includes('web_search'))
    assert.ok(harness.visibleNames().includes('subagent'))
  })

  it('reports names that are always available instead of failing', async () => {
    const harness = gated()
    const select = definitionOf(harness, 'select_tools')
    const result = await select.execute({ tools: ['read', 'select_tools'] }, exec(harness.agent))
    assert.match(result, /Always available: read, select_tools/)
    assert.match(result, /Nothing new was kept/)
  })

  it('rejects an unknown name without throwing or dropping the batch', async () => {
    const harness = gated()
    const select = definitionOf(harness, 'select_tools')
    const result = await select.execute({ tools: ['web_search', 'no_such_tool'] }, exec(harness.agent))
    assert.match(result, /Kept for this turn: web_search/)
    assert.match(result, /Rejected "no_such_tool"/)
  })

  it('requires a calling agent', async () => {
    const harness = gated()
    const select = definitionOf(harness, 'select_tools')
    await assert.rejects(() => select.execute({ tools: ['read'] }, { signal: new AbortController().signal }),
      /requires a calling agent/)
  })
})

describe('turn window', () => {
  it('drops the selection when a user message arrives', async () => {
    const harness = gated()
    const select = definitionOf(harness, 'select_tools')
    await select.execute({ tools: ['web_search', 'subagent'] }, exec(harness.agent))
    assert.ok(harness.visibleNames().includes('web_search'))

    harness.claim(harness.agent, userMessage)
    assert.deepEqual(harness.visibleNames().sort(), ['edit', 'read', 'select_tools', 'write'])
  })

  it('shows the catalog again after the reset', async () => {
    const harness = gated()
    const select = definitionOf(harness, 'select_tools')
    await select.execute({ tools: ['web_search'] }, exec(harness.agent))
    harness.claim(harness.agent, userMessage)
    const text = catalogOf(harness).text({ agent: harness.agent })
    assert.match(text, /- web_search:/)
    assert.doesNotMatch(text, /Kept for this turn:/)
  })

  it('ignores messages that are not user input', async () => {
    const harness = gated()
    const select = definitionOf(harness, 'select_tools')
    await select.execute({ tools: ['web_search'] }, exec(harness.agent))
    harness.claim(harness.agent, { role: 'user', source: { kind: 'runtime-context' } })
    assert.ok(harness.visibleNames().includes('web_search'))
  })

})

describe('presets', () => {
  it('leaves another preset ungated and hides the gate tools', () => {
    const harness = createHarness({
      tools: TOOLS,
      presets: { presetForSession: () => 'standard' },
    })
    apply(harness.ctx, Config({}))
    harness.emit('agent/created', { agent: harness.agent })
    assert.deepEqual(harness.visibleNames().sort(), ['edit', 'pwsh', 'read', 'subagent', 'web_fetch', 'web_search', 'write'])
    assert.equal(harness.filters.length, 1)
  })

  it('gates every preset when applyToOtherPresets is on', () => {
    const harness = createHarness({
      tools: TOOLS,
      presets: { presetForSession: () => 'standard' },
    })
    apply(harness.ctx, Config({ applyToOtherPresets: true }))
    harness.emit('agent/created', { agent: harness.agent })
    assert.deepEqual(harness.visibleNames().sort(), ['edit', 'read', 'select_tools', 'write'])
  })

  it('gates the shipped preset', () => {
    const harness = createHarness({ tools: TOOLS })
    apply(harness.ctx, Config({}))
    harness.emit('agent/created', { agent: harness.agent })
    assert.ok(harness.visibleNames().includes('select_tools'))
  })

  it('offers a tool registered after the agent started on the next turn', async () => {
    const harness = gated()
    harness.addTool('late_tool')
    // The creation snapshot cannot know it; the next user turn refreshes.
    assert.doesNotMatch(catalogOf(harness).text({ agent: harness.agent }), /late_tool/)
    harness.claim(harness.agent, userMessage)
    const select = definitionOf(harness, 'select_tools')
    const result = await select.execute({ tools: ['late_tool'] }, exec(harness.agent))
    assert.match(result, /Kept for this turn: late_tool/)
    assert.ok(harness.visibleNames().includes('late_tool'))
  })
})

describe('configuration', () => {
  it('never exposes or offers a hidden tool', async () => {
    const harness = gated({}, { hiddenTools: ['web_search'] })
    assert.ok(!harness.visibleNames().includes('web_search'))
    const select = definitionOf(harness, 'select_tools')
    const result = await select.execute({ tools: ['web_search'] }, exec(harness.agent))
    assert.match(result, /Rejected "web_search": not a tool this session can keep/)
    assert.ok(!harness.visibleNames().includes('web_search'))
  })

  it('leaves delegated children ungated when applyToSubagents is false', () => {
    const harness = gated({ subagents: createSubagents() }, { applyToSubagents: false })
    assert.deepEqual(harness.visibleNames().sort(), [
      'delegate', 'edit', 'read', 'select_tools', 'write',
    ])
    const child = harness.createAgent('child-1')
    harness.emit('agent/created', { agent: child })
    assert.equal(harness.filtersFor('child-1').length, 0)
    assert.ok(harness.visibleNames('child-1').includes('subagent'))
  })
})
