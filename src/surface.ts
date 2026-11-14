/**
 * The session projection behind the composer-dock badge.
 *
 * The badge shows how many tools the model can call in the current session, so
 * the number must be the *last request's* tool declaration, not a count of
 * registered tools: after `select_tools` or `delegate` the surface changes, and
 * the loop records each change as a `request/header` event. Folding that event
 * is therefore the whole unit — one event type, no session rescan, and a state
 * reference reused for every other event so the client store sees no churn.
 *
 * The view is what the client renders: a count plus one line per tool. The
 * client never folds session events, so this is the only place the fold exists.
 *
 * @module dsh-tool-gate/surface
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection/types'

/** One tool as the current request declares it. */
export interface ToolSurfaceEntry {
  /** Registered tool name. */
  readonly name: string
  /** One-line description, shortened for the wire. */
  readonly description: string
}

/** What the composer-dock badge renders for one session. */
export interface ToolSurfaceView {
  /** Number of tools the model could call on the last request. */
  readonly count: number
  /** Names from the last request that are always exposed (base set and gate tools). */
  readonly base: readonly string[]
  /** Every tool of the last request, sorted by name. */
  readonly tools: readonly ToolSurfaceEntry[]
}

/** A projection whose wire view is declared, as `register`'s first overload requires. */
type WireProjection<K extends string, S> = Omit<ProjectionDefinition<K, S>, 'wire'> & {
  wire: NonNullable<ProjectionDefinition<K, S>['wire']>
}

/** Longest tool description kept in the view, in characters. */
const DESCRIPTION_CHARS = 120

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Tool surface of the session's latest model request; the dock badge reads it. */
    toolGate: ToolSurfaceView
  }
}

/** The empty surface: a session that has not made a request yet. */
const EMPTY: ToolSurfaceView = { count: 0, base: [], tools: [] }

/**
 * Build the projection unit.
 *
 * `always` marks the names that stay exposed without the model asking (the
 * configured base set plus the gate tools); the badge draws them differently so
 * a user can tell the fixed surface from the turn's kept tools.
 * @param always - tool names that are exposed regardless of the turn's selection.
 * @returns the projection definition to register on `sessionProjections`.
 */
export function createToolSurfaceProjection(always: readonly string[]): WireProjection<'toolGate', ToolSurfaceView> {
  const alwaysSet = new Set(always)
  const definition = {
    key: 'toolGate',
    stateVersion: 1,
    stateSchema: {
      parse(value: unknown): ToolSurfaceView {
        return parseView(value)
      },
    } as never,
    init: (): ToolSurfaceView => EMPTY,
    apply(state: ToolSurfaceView, event: SessionEvent): ToolSurfaceView {
      if (event.type !== 'request/header') return state
      const tools = event.data.header.tools
      if (!Array.isArray(tools) || tools.length === 0) return state
      const entries = tools
        .map(tool => ({
          name: tool.name,
          description: shorten(tool.description, DESCRIPTION_CHARS),
        }))
        .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
      const base = entries.filter(entry => alwaysSet.has(entry.name)).map(entry => entry.name)
      return { count: entries.length, base, tools: entries }
    },
    wire: {
      summary: false,
      viewSchema: {
        parse(value: unknown): ToolSurfaceView {
          return parseView(value)
        },
      } as never,
      view: (state: ToolSurfaceView): ToolSurfaceView => state,
    },
  }
  return definition as unknown as WireProjection<'toolGate', ToolSurfaceView>
}

/** Validate one wire value; the projection framework only requires `parse`. */
function parseView(value: unknown): ToolSurfaceView {
  if (typeof value !== 'object' || value === null) throw new Error('toolGate: expected an object')
  const record = value as Record<string, unknown>
  const count = record.count
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
    throw new Error('toolGate: count must be a non-negative integer')
  }
  if (!Array.isArray(record.base) || !record.base.every(item => typeof item === 'string')) {
    throw new Error('toolGate: base must be a string array')
  }
  if (!Array.isArray(record.tools)) throw new Error('toolGate: tools must be an array')
  const tools = record.tools.map((entry: unknown): ToolSurfaceEntry => {
    if (typeof entry !== 'object' || entry === null) throw new Error('toolGate: tool entries must be objects')
    const fields = entry as Record<string, unknown>
    if (typeof fields.name !== 'string' || typeof fields.description !== 'string') {
      throw new Error('toolGate: tool entries carry name and description strings')
    }
    return { name: fields.name, description: fields.description }
  })
  return { count, base: record.base as string[], tools }
}

/** Collapse whitespace and cut one description to a wire-friendly line. */
function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/gu, ' ').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, max - 1).trimEnd()}…`
}
