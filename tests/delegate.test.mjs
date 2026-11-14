/**
 * The delegation tool: a parent-chosen tool list for a child agent.
 *
 * @module dsh-tool-gate/tests/delegate
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Config, apply } from '../lib/index.js'
import { createHarness, createSubagents } from './support/fake-tools.mjs'

const TOOLS = [
  { name: 'read', description: 'Read a file.' },
  { name: 'write', description: 'Write a file.' },
  { name: 'glob', description: 'List files.' },
  { name: 'web_search', description: 'Search the web.' },
  { name: 'subagent', description: 'Delegate a task.' },
]

/** Apply the plugin to a fresh harness and gate its root agent. */
function gated({ subagents, config = {} } = {}) {
  const harness = createHarness({ tools: TOOLS, subagents })
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

describe('registration', () => {
  it('registers delegate only when a subagent backend service exists', () => {
    const withBackends = gated({ subagents: createSubagents() })
    assert.deepEqual(withBackends.registered.map(definition => definition.name).sort(), [
      'delegate', 'select_tools',
    ])
    const withoutBackends = gated()
    assert.deepEqual(withoutBackends.registered.map(definition => definition.name).sort(), ['select_tools'])
  })

  it('exposes delegate to the root agent like the other gate tools', () => {
    const harness = gated({ subagents: createSubagents() })
    assert.deepEqual(harness.visibleNames().sort(), [
      'delegate', 'glob', 'read', 'select_tools', 'write',
    ])
  })
})

describe('delegation', () => {
  it('starts a child whose surface is exactly the chosen tools plus the gate tools', async () => {
    const subagents = createSubagents()
    const harness = gated({ subagents })
    const delegate = definitionOf(harness, 'delegate')
    const result = await delegate.execute({
      description: 'read-only review',
      prompt: 'Review the README.',
      tools: ['read', 'glob'],
    }, exec(harness.agent))
    assert.match(result, /Started subagent/)
    assert.equal(subagents.started.length, 1)
    const spec = subagents.started[0]
    assert.equal(spec.provider, 'spawn')
    assert.equal(spec.label, 'read-only review')
    assert.equal(spec.parent, harness.agent)
    assert.deepEqual(spec.prompt, [{ type: 'text', text: 'Review the README.' }])

    const child = harness.createAgent(spec.childId)
    harness.emit('agent/created', { agent: child })
    assert.deepEqual(harness.visibleNames(spec.childId).sort(), [
      'delegate', 'glob', 'read', 'select_tools',
    ])
  })

  it('does not leak the parent’s other tools into the child', async () => {
    const subagents = createSubagents()
    const harness = gated({ subagents })
    const delegate = definitionOf(harness, 'delegate')
    await delegate.execute({ description: 'd', prompt: 'p', tools: ['web_search'] }, exec(harness.agent))
    const childId = subagents.started[0].childId
    harness.emit('agent/created', { agent: harness.createAgent(childId) })
    const childNames = harness.visibleNames(childId)
    assert.ok(childNames.includes('web_search'))
    assert.ok(!childNames.includes('subagent'))
    assert.ok(!childNames.includes('write'))
  })

  it('seals the child when asked: exactly the list, no gate tools', async () => {
    const subagents = createSubagents()
    const harness = gated({ subagents })
    const delegate = definitionOf(harness, 'delegate')
    await delegate.execute({
      description: 'pinned', prompt: 'p', tools: ['read'], sealed: true,
    }, exec(harness.agent))
    const childId = subagents.started[0].childId
    harness.emit('agent/created', { agent: harness.createAgent(childId) })
    assert.deepEqual(harness.visibleNames(childId), ['read'])
  })

  it('seals by default when the deployment configures it', async () => {
    const subagents = createSubagents()
    const harness = gated({ subagents, config: { delegateSealed: true } })
    const delegate = definitionOf(harness, 'delegate')
    await delegate.execute({ description: 'pinned', prompt: 'p', tools: ['read'] }, exec(harness.agent))
    const childId = subagents.started[0].childId
    harness.emit('agent/created', { agent: harness.createAgent(childId) })
    assert.deepEqual(harness.visibleNames(childId), ['read'])
  })

  it('lets an unsealed child keep more tools itself', async () => {
    const subagents = createSubagents()
    const harness = gated({ subagents })
    const delegate = definitionOf(harness, 'delegate')
    await delegate.execute({ description: 'd', prompt: 'p', tools: ['read'] }, exec(harness.agent))
    const childId = subagents.started[0].childId
    const child = harness.createAgent(childId)
    harness.emit('agent/created', { agent: child })
    const select = definitionOf(harness, 'select_tools')
    await select.execute({ tools: ['web_search'] }, exec(child))
    assert.ok(harness.visibleNames(childId).includes('web_search'))
  })

  it('refuses to widen a sealed child', async () => {
    const subagents = createSubagents()
    const harness = gated({ subagents })
    const delegate = definitionOf(harness, 'delegate')
    await delegate.execute({ description: 'd', prompt: 'p', tools: ['read'], sealed: true }, exec(harness.agent))
    const childId = subagents.started[0].childId
    const child = harness.createAgent(childId)
    harness.emit('agent/created', { agent: child })
    const select = definitionOf(harness, 'select_tools')
    const result = await select.execute({ tools: ['web_search'] }, exec(child))
    assert.match(result, /fixed by its parent/)
    assert.deepEqual(harness.visibleNames(childId), ['read'])
  })

  it('gates a delegated child even when subagents are otherwise ungated', async () => {
    const subagents = createSubagents()
    const harness = gated({ subagents, config: { applyToSubagents: false } })
    const delegate = definitionOf(harness, 'delegate')
    await delegate.execute({ description: 'd', prompt: 'p', tools: ['read'] }, exec(harness.agent))
    const childId = subagents.started[0].childId
    harness.emit('agent/created', { agent: harness.createAgent(childId) })
    assert.deepEqual(harness.visibleNames(childId).sort(), ['delegate', 'read', 'select_tools'])
  })

  it('refuses to name a hidden tool for the child', async () => {
    const subagents = createSubagents()
    const harness = gated({ subagents, config: { hiddenTools: ['web_search'] } })
    const delegate = definitionOf(harness, 'delegate')
    await assert.rejects(
      () => delegate.execute({ description: 'd', prompt: 'p', tools: ['web_search'] }, exec(harness.agent)),
      /unknown tool "web_search"/,
    )
    assert.equal(subagents.started.length, 0)
  })

  it('keeps the parent list when the delegation prompt arrives as a user message', async () => {
    const subagents = createSubagents()
    const harness = gated({ subagents })
    const delegate = definitionOf(harness, 'delegate')
    await delegate.execute({ description: 'd', prompt: 'p', tools: ['read', 'glob'] }, exec(harness.agent))
    const childId = subagents.started[0].childId
    const child = harness.createAgent(childId)
    harness.emit('agent/created', { agent: child })
    // The child's first claimed message is the delegation prompt itself.
    harness.claim(child, { role: 'user', source: { kind: 'user' } })
    assert.deepEqual(harness.visibleNames(childId).sort(), [
      'delegate', 'glob', 'read', 'select_tools',
    ])
  })

  it('leaves the parent surface untouched', async () => {
    const subagents = createSubagents()
    const harness = gated({ subagents })
    const before = harness.visibleNames().sort()
    const delegate = definitionOf(harness, 'delegate')
    await delegate.execute({ description: 'd', prompt: 'p', tools: ['web_search'] }, exec(harness.agent))
    assert.deepEqual(harness.visibleNames().sort(), before)
  })
})

describe('refusals', () => {
  it('refuses an unknown tool name before starting anything', async () => {
    const subagents = createSubagents()
    const harness = gated({ subagents })
    const delegate = definitionOf(harness, 'delegate')
    await assert.rejects(
      () => delegate.execute({ description: 'd', prompt: 'p', tools: ['read', 'nope'] }, exec(harness.agent)),
      /unknown tool "nope"/,
    )
    assert.equal(subagents.started.length, 0)
  })

  it('refuses an empty tool list', async () => {
    const subagents = createSubagents()
    const harness = gated({ subagents })
    const delegate = definitionOf(harness, 'delegate')
    await assert.rejects(
      () => delegate.execute({ description: 'd', prompt: 'p', tools: [] }, exec(harness.agent)),
      /at least one tool/,
    )
  })

  it('refuses when the configured backend is not registered', async () => {
    const subagents = createSubagents({ providers: [] })
    const harness = gated({ subagents })
    const delegate = definitionOf(harness, 'delegate')
    await assert.rejects(
      () => delegate.execute({ description: 'd', prompt: 'p', tools: ['read'] }, exec(harness.agent)),
      /unavailable/,
    )
  })

  it('drops the reservation when the backend refuses to start', async () => {
    const subagents = createSubagents({ failStart: true })
    const harness = gated({ subagents })
    const delegate = definitionOf(harness, 'delegate')
    await assert.rejects(
      () => delegate.execute({ description: 'd', prompt: 'p', tools: ['read'] }, exec(harness.agent)),
      /refused to start/,
    )
    const childId = subagents.started[0].childId
    harness.emit('agent/created', { agent: harness.createAgent(childId) })
    // The base set, not the failed reservation's list (which would omit write).
    assert.ok(harness.visibleNames(childId).includes('write'))
  })
})
