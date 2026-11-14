/**
 * The selection tool's own contract: naming, rendering, custom names.
 *
 * @module dsh-tool-gate/tests/tools
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Config, apply } from '../lib/index.js'
import { createHarness } from './support/fake-tools.mjs'

const TOOLS = [
  { name: 'read', description: 'Read a file.' },
  { name: 'write', description: 'Write a file.' },
  { name: 'pwsh', description: 'Run a shell command.' },
  { name: 'web_search', description: 'Search the web for pages.' },
  { name: 'office_render', description: 'Render an office document.' },
]

/** Apply the plugin to a fresh harness and gate its agent. */
function gated(config = {}) {
  const harness = createHarness({ tools: TOOLS })
  apply(harness.ctx, Config(config))
  harness.emit('agent/created', { agent: harness.agent })
  return harness
}

/** One registered definition. */
function definitionOf(harness, name) {
  const found = harness.registered.find(candidate => candidate.name === name)
  assert.ok(found, `expected the plugin to register "${name}"`)
  return found
}

/** A minimal `ToolRunContext`. */
function exec(agent) {
  return { agent, signal: new AbortController().signal }
}

describe('select_tools', () => {
  it('renders one text block', async () => {
    const harness = gated()
    const select = definitionOf(harness, 'select_tools')
    const value = await select.execute({ tools: ['web_search'] }, exec(harness.agent))
    assert.deepEqual(select.output.render({ tools: ['web_search'] }, value), [{ type: 'text', text: value }])
  })

  it('reports the exposure after the selection', async () => {
    const harness = gated()
    const select = definitionOf(harness, 'select_tools')
    const result = await select.execute({ tools: ['office_render'] }, exec(harness.agent))
    assert.match(result, /Kept for this turn: office_render/)
    assert.match(result, /Exposed now: [^\n]*office_render/)
  })

  it('requires a calling agent', async () => {
    const harness = gated()
    const select = definitionOf(harness, 'select_tools')
    await assert.rejects(() => select.execute({ tools: [] }, { signal: new AbortController().signal }),
      /requires a calling agent/)
  })
})

describe('custom names', () => {
  it('honours a configured selection tool name', async () => {
    const harness = gated({ selectToolName: 'keep_tools' })
    assert.deepEqual(harness.registered.map(definition => definition.name), ['keep_tools'])
    assert.deepEqual(harness.visibleNames().sort(), [
      'keep_tools', 'read', 'write',
    ])
  })
})
