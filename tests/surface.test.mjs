/**
 * The tool-surface projection: one fold over `request/header`, a wire view the
 * composer dock can render, and schema validation on the way out.
 *
 * @module dsh-tool-gate/tests/surface
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createToolSurfaceProjection } from '../lib/surface.js'

/** A `request/header` event carrying the given tool declarations. */
function headerEvent(tools) {
  return {
    type: 'request/header',
    seq: 7,
    time: 0,
    data: { header: { tools }, reason: 'initial' },
  }
}

/** A tool schema as the loop records it. */
function tool(name, description = `${name} does things.`) {
  return { name, description, parameters: {} }
}

/** Fold a sequence of events from the empty state. */
function fold(events) {
  const definition = createToolSurfaceProjection(['read', 'select_tools'])
  let state = definition.init({}, 0)
  for (const event of events) state = definition.apply(state, event)
  return { definition, state }
}

describe('fold', () => {
  it('starts empty', () => {
    const definition = createToolSurfaceProjection(['read'])
    assert.deepEqual(definition.init({}, 0), { count: 0, base: [], tools: [] })
  })

  it('counts the tools of the latest request and marks the always-exposed ones', () => {
    const { state } = fold([
      headerEvent([tool('read'), tool('write'), tool('select_tools')]),
    ])
    assert.equal(state.count, 3)
    assert.deepEqual(state.tools.map(entry => entry.name), ['read', 'select_tools', 'write'])
    assert.deepEqual(state.base, ['read', 'select_tools'])
  })

  it('replaces the surface when a later request changes it', () => {
    const { state } = fold([
      headerEvent([tool('read')]),
      headerEvent([tool('read'), tool('web_search'), tool('delegate')]),
    ])
    assert.equal(state.count, 3)
    assert.ok(state.tools.some(entry => entry.name === 'web_search'))
  })

  it('returns the same reference for unrelated events', () => {
    const definition = createToolSurfaceProjection(['read'])
    const state = definition.init({}, 0)
    const next = definition.apply(state, {
      type: 'tool/result', seq: 8, time: 0, data: {},
    })
    assert.equal(next, state)
  })

  it('collapses whitespace and clips descriptions', () => {
    const definition = createToolSurfaceProjection([])
    const long = `${'word '.repeat(60)}end`
    const state = definition.apply(definition.init({}, 0), headerEvent([tool('big', long)]))
    assert.ok(!state.tools[0].description.includes('\n'))
    assert.ok(state.tools[0].description.length <= 120)
    assert.ok(state.tools[0].description.endsWith('…'))
  })
})

describe('wire', () => {
  it('keeps the summary out of the session list', () => {
    const definition = createToolSurfaceProjection([])
    assert.equal(definition.wire.summary, false)
  })

  it('views the folded state as the wire value and validates it', () => {
    const { definition, state } = fold([headerEvent([tool('read'), tool('write')])])
    assert.equal(definition.wire.view(state), state)
    assert.deepEqual(definition.wire.viewSchema.parse(JSON.parse(JSON.stringify(state))), state)
  })

  it('rejects a malformed value', () => {
    const definition = createToolSurfaceProjection([])
    assert.throws(() => definition.wire.viewSchema.parse({ count: -1 }), /count/)
    assert.throws(() => definition.wire.viewSchema.parse({ count: 1, base: ['read'], tools: [{}] }), /name/)
    assert.throws(() => definition.stateSchema.parse(null), /object/)
  })
})
