/**
 * The plugin surface: name, injected registries, Config, and the two prompt
 * contributions (policy section and per-turn catalog context).
 *
 * @module dsh-tool-gate/tests/plugin
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import * as plugin from '../lib/index.js'
import { Config, apply, inject, name } from '../lib/index.js'
import { createHarness, createProjections, createSubagents } from './support/fake-tools.mjs'

/** A harness with a small surface and no header. */
function harness(subagents, projections) {
  return createHarness({
    tools: [
      { name: 'read', description: 'Read a file.' },
      { name: 'pwsh', description: 'Run a shell command.' },
      { name: 'web_search', description: 'Search the web.' },
    ],
    subagents,
    projections,
  })
}

describe('plugin surface', () => {
  it('is a named function plugin with no default export', () => {
    assert.equal(name, '@belowthetree/dsh-tool-gate')
    assert.equal(typeof apply, 'function')
    assert.equal('default' in plugin, false)
  })

  it('declares the registries it writes to', () => {
    assert.deepEqual([...inject].sort(), ['systemPrompt', 'tools'])
  })
})

describe('Config', () => {
  it('fills every deployment-varying choice', () => {
    const resolved = Config({})
    assert.deepEqual(resolved.baseTools, ['read', 'write', 'edit', 'glob', 'grep'])
    assert.equal(resolved.selectToolName, 'select_tools')
    assert.equal(resolved.delegateToolName, 'delegate')
    assert.equal(resolved.delegateProvider, 'spawn')
    assert.equal(resolved.delegateSealed, false)
    assert.equal(resolved.applyToSubagents, true)
    assert.equal(resolved.presetId, 'tool-gate')
    assert.equal(resolved.applyToOtherPresets, false)
    assert.equal(resolved.resetPerTurn, false)
    assert.deepEqual(resolved.hiddenTools, [])
    assert.deepEqual(resolved.catalogTools, [])
    assert.equal(resolved.maxDescriptionChars, 160)
  })

  it('keeps what the deployment overrides', () => {
    const resolved = Config({ baseTools: ['read', 'pwsh'], selectToolName: 'keep_tools' })
    assert.deepEqual(resolved.baseTools, ['read', 'pwsh'])
    assert.equal(resolved.selectToolName, 'keep_tools')
  })
})

describe('apply', () => {
  it('registers the selection tool when no subagent backend is composed', () => {
    const ctx = harness()
    apply(ctx.ctx, Config({}))
    assert.deepEqual(ctx.registered.map(definition => definition.name), ['select_tools'])
  })

  it('adds the delegation tool when the subagents service exists', () => {
    const ctx = harness(createSubagents())
    apply(ctx.ctx, Config({}))
    assert.deepEqual(ctx.registered.map(definition => definition.name).sort(), ['delegate', 'select_tools'])
    const text = ctx.sections[0].text()
    assert.match(text, /delegate/)
  })

  it('contributes one policy section and one required catalog context', () => {
    const ctx = harness()
    apply(ctx.ctx, Config({}))
    assert.equal(ctx.sections.length, 1)
    const [section] = ctx.sections
    assert.equal(section.name, 'tool-gate:policy')
    assert.equal(section.order, 450)
    const text = typeof section.text === 'function' ? section.text() : section.text
    assert.match(text, /select_tools/)
    assert.match(text, /gated/)
    assert.doesNotMatch(text, /enable_tools/)

    assert.equal(ctx.contexts.length, 1)
    const [catalog] = ctx.contexts
    assert.equal(catalog.name, 'tool-gate:catalog')
    assert.equal(catalog.required, true)
    ctx.emit('agent/created', { agent: ctx.agent })
    assert.match(catalog.text({ agent: ctx.agent }), /- web_search:/)
  })

  it('registers the tool-surface projection the composer badge reads', async () => {
    const projections = createProjections()
    const ctx = harness(undefined, projections)
    apply(ctx.ctx, Config({}))
    await Promise.resolve()
    assert.equal(projections.definitions.length, 1)
    const [definition] = projections.definitions
    assert.equal(definition.key, 'toolGate')
    assert.equal(definition.wire.summary, false)
  })

  it('badge-only mode keeps the projection but registers no gate surface', async () => {
    const projections = createProjections()
    const ctx = harness(createSubagents(), projections)
    apply(ctx.ctx, Config({ enabled: false }))
    await Promise.resolve()
    assert.deepEqual(ctx.registered, [])
    assert.equal(ctx.sections.length, 0)
    assert.equal(ctx.contexts.length, 0)
    assert.equal(projections.definitions.length, 1)
    ctx.emit('agent/created', { agent: ctx.createAgent('child-1') })
    assert.equal(ctx.filtersFor('child-1').length, 0)
  })

  it('refuses a tool name that is not a model-facing name', () => {
    assert.throws(() => apply(harness().ctx, Config({ selectToolName: 'Select Tools' })), /selectToolName/)
  })

  it('refuses the same name for both gate tools', () => {
    assert.throws(() => apply(harness().ctx, Config({ delegateToolName: 'select_tools' })), /must differ/)
  })

  it('refuses a description budget below the minimum', () => {
    assert.throws(() => apply(harness().ctx, Config({ maxDescriptionChars: 10 })), /maxDescriptionChars/)
  })

  it('refuses a base list that names a gate tool', () => {
    assert.throws(() => apply(harness().ctx, Config({ baseTools: ['read', 'select_tools'] })), /baseTools/)
  })

  it('refuses an empty base name', () => {
    assert.throws(() => apply(harness().ctx, Config({ baseTools: ['read', ''] })), /empty name/)
  })

  it('refuses hiding a gate tool', () => {
    assert.throws(() => apply(harness().ctx, Config({ hiddenTools: ['select_tools'] })), /hiddenTools/)
  })
})
