/**
 * The per-agent tool gate.
 *
 * The gate keeps a small base toolset exposed and everything else selectable
 * through one selection tool. The lifecycle is per user message:
 *
 * - a new user message clears the turn's selection, so the next step starts from
 *   the base set plus a catalog of one-line tool descriptions in the runtime
 *   context;
 * - `select_tools` replaces that turn's selection, and the chosen tools stay
 *   exposed for every later step of the turn;
 * - the next user message starts a fresh selection window.
 *
 * A delegated child starts from a list its parent chose: the delegation tool
 * reserves the child's session id before activation, and this module claims that
 * reservation while `agent/created` is still being awaited — so the child's
 * surface exists before its first request.
 *
 * Three properties of `restrict()` shape the implementation:
 *
 * - it is only available on a scoped context, so a restriction is installed on
 *   the agent's own `ctx`, never here;
 * - restrictions intersect, so a wider list replaces the previous one instead
 *   of adding to it;
 * - it validates names against the inherited surface, so the catalog must be
 *   snapshotted *before* the first restriction and every later filter is built
 *   from that snapshot.
 *
 * @module dsh-tool-gate/gate
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import type { GateSettings } from './types.ts'

/** One tool the model may ask to keep. */
export interface CatalogEntry {
  /** The tool name as registered. */
  readonly name: string
  /** One-line description retained for the catalog. */
  readonly description: string
}

/** One rejected name, with the reason the model is told. */
export interface Rejection {
  /** The name the model asked for, as written. */
  readonly name: string
  /** Why the gate did not accept it. */
  readonly reason: string
}

/** What one selection call changed. */
export interface SelectionOutcome {
  /** Names this call kept for the turn. */
  readonly accepted: readonly string[]
  /** Names that are exposed regardless of the selection (base and gate tools). */
  readonly always: readonly string[]
  /** Names that were refused, with a reason each. */
  readonly rejected: readonly Rejection[]
  /** Everything the gate exposes after this call. */
  readonly exposed: readonly string[]
  /** Why the gate could not restrict this agent, when it failed open. */
  readonly failure?: string
}

/** A parent-chosen starting set reserved for a child that does not exist yet. */
export interface DelegationReservation {
  /** Exact tool names the child starts with; gate tools are added unless sealed. */
  readonly tools: readonly string[]
  /** Whether the child is barred from selecting more tools. */
  readonly sealed: boolean
}

/** Mutable state kept per gated agent. */
interface GateState {
  /** The pre-restriction surface: what this agent could see before the gate. */
  catalog: Map<string, CatalogEntry>
  /** Tools kept for the current user turn. */
  selected: Set<string>
  /** Base names this composition actually provides, in configuration order. */
  base: string[]
  /** Whether this agent's set came from a parent and cannot grow. */
  sealed: boolean
  /** Whether this agent's starting set came from a parent reservation. */
  reserved: boolean
  /**
   * The catalog text rendered for this session. Built once and reused: any
   * rewrite would replace a runtime-context message in the middle of the
   * prompt and invalidate the provider's prefix cache.
   */
  catalogText?: string
  /** Tools discovered after {@link catalogText} was built, pending one notice. */
  notices: string[]
  /** Disposer of the live restriction; absent while the gate is not applied. */
  lift?: () => void
  /** Why the last attempt to restrict failed, when it did. */
  failure?: string
}

/** Diagnostic trace, off unless DSH_TOOL_GATE_DEBUG=1. */
function debug(message: string): void {
  if (process.env['DSH_TOOL_GATE_DEBUG'] === '1') console.error(`[gate] ${message}`)
}

/** The per-agent gate: catalog snapshot, per-turn selection, and restriction. */
export class ToolGate {
  /** Gated agents; cleared when the plugin unloads. */
  private readonly states = new Map<Agent, GateState>()
  /** Parent-chosen sets waiting for their child agent, keyed by session id. */
  private readonly reservations = new Map<string, DelegationReservation>()
  /** Deny filters that keep the gate tools out of agents the gate does not apply to. */
  private readonly exclusions = new Map<Agent, () => void>()
  /** Names that are always exposed to a gated agent: the gate tools themselves. */
  private readonly gateToolNames: readonly string[]

  constructor(
    private readonly ctx: Context,
    private readonly settings: GateSettings,
    gateToolNames: readonly string[],
  ) {
    this.gateToolNames = gateToolNames
  }

  /**
   * Reserve a child's starting set before the child agent exists.
   * @param childId - the session id the delegation tool is about to activate.
   * @param reservation - tools and sealing the parent chose.
   */
  reserve(childId: string, reservation: DelegationReservation): void {
    this.reservations.set(childId, reservation)
    debug(`reserve child=${childId} tools=[${reservation.tools.join(',')}] sealed=${reservation.sealed}`)
  }

  /** Drop a reservation whose activation failed. */
  release(childId: string): void {
    this.reservations.delete(childId)
    debug(`release child=${childId}`)
  }

  /** Whether a child id already carries a parent-chosen surface. */
  hasReservation(childId: string): boolean {
    return this.reservations.has(childId)
  }

  /** Whether one name belongs to this agent's unrestricted surface. */
  hasTool(agent: Agent, name: string): boolean {
    return this.states.get(agent)?.catalog.has(name) === true
  }

  /**
   * Add one always-exposed gate tool after construction.
   *
   * The delegation tool is registered only once the `subagents` service is
   * available, which can be after a standing agent already exists; this adds the
   * tool to every installed agent's catalog and re-applies its restriction, so
   * the tool appears in the next step instead of being invisible forever.
   * @param name - the registered tool name.
   */
  addGateTool(name: string): void {
    if (!this.gateToolNames.includes(name)) (this.gateToolNames as string[]).push(name)
    const definition = this.ctx.tools.get(name)
    if (definition === undefined) return
    for (const [agent, state] of this.states) {
      if (!state.catalog.has(name)) {
        state.catalog.set(name, {
          name,
          description: summarize(definition.description, this.settings.maxDescriptionChars),
        })
      }
      this.commit(agent, state)
    }
  }

  /**
   * Gate one agent: snapshot its unrestricted surface, claim a parent
   * reservation when one exists, then install the restriction.
   *
   * The snapshot must precede the first restriction, which is why this runs
   * from `agent/created` (serial, awaited, before the first request) rather than
   * from a later hook. A repeat call for the same live agent only re-applies the
   * restriction, so a compaction announcement cannot shrink the catalog.
   * @param agent - the agent to gate.
   */
  install(agent: Agent): void {
    // A previous decision for another preset may have denied the gate tools;
    // the snapshot must see the full pre-restriction surface, so lift that first.
    this.allowGateTools(agent)
    let state = this.states.get(agent)
    if (state === undefined) {
      const catalog = this.snapshot(agent)
      const reservation = this.reservations.get(String(agent.id))
      this.reservations.delete(String(agent.id))
      state = reservation === undefined
        ? {
          catalog,
          selected: new Set<string>(),
          base: this.settings.baseTools.filter(name => catalog.has(name)),
          sealed: false,
          reserved: false,
          notices: [],
        }
        : {
          catalog,
          selected: new Set(reservation.tools.filter(name => catalog.has(name))),
          base: [],
          sealed: reservation.sealed,
          reserved: true,
          notices: [],
        }
      this.states.set(agent, state)
      debug(`install agent=${agent.id} catalog=${catalog.size} reserved=${reservation !== undefined} `
        + `base=[${state.base.join(',')}] selected=[${[...state.selected].join(',')}]`)
    }
    this.commit(agent, state)
  }

  /** Lift one agent's restriction, if this gate installed it. */
  dispose(agent: Agent): void {
    this.exclusions.get(agent)?.()
    this.exclusions.delete(agent)
    const state = this.states.get(agent)
    if (state === undefined) return
    state.lift?.()
    this.states.delete(agent)
  }

  /** Lift every restriction; used when the plugin unloads. */
  disposeAll(): void {
    for (const dispose of this.exclusions.values()) dispose()
    this.exclusions.clear()
    for (const [agent, state] of this.states) {
      state.lift?.()
      this.states.delete(agent)
    }
    this.reservations.clear()
  }

  /** Remove the deny filter that kept the gate tools out of an excluded agent. */
  allowGateTools(agent: Agent): void {
    const dispose = this.exclusions.get(agent)
    if (dispose === undefined) return
    dispose()
    this.exclusions.delete(agent)
  }

  /** Whether the gate currently restricts this agent. */
  isInstalled(agent: Agent): boolean {
    return this.states.has(agent)
  }

  /**
   * Hide the gate tools from an agent the gate does not apply to (a session in
   * another Agent preset). The tools are registered composition-wide, so without
   * this they would appear in every preset even when the gate is off there.
   * @param agent - the agent to keep clean.
   */
  excludeGateTools(agent: Agent): void {
    if (this.exclusions.has(agent)) return
    try {
      this.exclusions.set(agent, agent.ctx.tools.restrict({ deny: [...this.gateToolNames] }))
    } catch (error: unknown) {
      // A foreign registration cannot be denied; the agent simply keeps its tools.
      debug(`exclude failed agent=${agent.id}: ${messageOf(error)}`)
    }
  }

  /**
   * Prepare one user turn: discover tools registered since the snapshot, and
   * (when configured) start from the base surface again.
   *
   * The catalog text is never rewritten here — it is built once per session
   * because replacing it would invalidate the provider's prefix cache.
   * @param agent - the agent that received the message.
   */
  startTurn(agent: Agent): void {
    const state = this.states.get(agent)
    if (state === undefined) return
    this.refreshCatalog(agent, state)
    if (!this.settings.resetPerTurn) return
    // A delegated child's surface was chosen by its parent and must survive the
    // delegation prompt itself — which arrives as a user message.
    if (state.reserved || state.selected.size === 0) return
    state.selected.clear()
    debug(`startTurn agent=${agent.id}: selection cleared`)
    this.commit(agent, state)
  }

  /**
   * Merge tools that appeared after the creation snapshot into one agent's
   * catalog. Late discoveries are queued as a notice the caller appends to the
   * conversation, because editing the catalog text would break the cache.
   * Removal is deliberately ignored: a name that left the registry is dropped
   * by `commit`'s restrictable filter instead of rewriting a selection here.
   * @param agent - the gated agent.
   * @param state - its live gate state.
   */
  private refreshCatalog(agent: Agent, state: GateState): void {
    // `schemas(agent)` already honors this agent's restriction, so discovering
    // tools that appeared later needs the pre-restriction view: lift for one
    // synchronous read and re-install before anything can assemble a request.
    const lift = state.lift
    delete state.lift
    lift?.()
    try {
      for (const entry of this.snapshot(agent).values()) {
        if (state.catalog.has(entry.name)) continue
        state.catalog.set(entry.name, entry)
        state.notices.push(entry.name)
        debug(`catalog+ agent=${agent.id} ${entry.name}`)
      }
      if (!state.reserved) {
        for (const name of this.settings.baseTools) {
          if (state.catalog.has(name) && !state.base.includes(name)) state.base.push(name)
        }
      }
    } finally {
      this.commit(agent, state)
    }
  }

  /**
   * Tools discovered since the last call, as names the caller announces with an
   * appended message. Returns and clears the queue.
   * @param agent - the gated agent.
   */
  takeNotices(agent: Agent): string[] {
    const state = this.states.get(agent)
    if (state === undefined || state.notices.length === 0) return []
    const names = [...state.notices]
    state.notices.length = 0
    return names
  }

  /** Tools the catalog may offer: everything but the always-exposed names. */
  offerable(agent: Agent): CatalogEntry[] {
    const state = this.states.get(agent)
    if (state === undefined || state.sealed) return []
    const entries: CatalogEntry[] = []
    for (const entry of state.catalog.values()) {
      if (this.isAlways(entry.name, state)) continue
      entries.push(entry)
    }
    return entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  }

  /**
   * Catalog entries the model may keep but does not yet, sorted by name.
   * The rendered text keeps listing kept tools on purpose (see `promptText`);
   * this method stays for callers that need the difference.
   */
  catalogFor(agent: Agent): CatalogEntry[] {
    const state = this.states.get(agent)
    if (state === undefined || state.sealed) return []
    return this.offerable(agent).filter(entry => !state.selected.has(entry.name))
  }

  /** Everything the gate currently exposes for one agent, sorted by name. */
  exposed(agent: Agent): string[] {
    const state = this.states.get(agent)
    return state === undefined ? [] : allowOf(state, this.alwaysOf(state))
  }

  /** Why the gate failed open for one agent, when it did. */
  failure(agent: Agent): string | undefined {
    return this.states.get(agent)?.failure
  }

  /** Whether one agent's tool set was fixed by its parent. */
  sealed(agent: Agent): boolean {
    return this.states.get(agent)?.sealed === true
  }

  /**
   * Keep a batch of tools for the rest of the current turn.
   *
   * The call replaces the turn's selection: the model states what it needs, and
   * anything it leaves out stops being exposed on the next step. Unknown names
   * are reported back instead of failing the call, so a model that guessed gets
   * a rejection and keeps working.
   * @param agent - the calling agent.
   * @param names - requested tool names.
   * @returns accepted, always-available, and rejected names.
   */
  select(agent: Agent, names: readonly string[]): SelectionOutcome {
    const state = this.states.get(agent)
    if (state === undefined) throw new Error('dsh-tool-gate: the calling agent was never gated')
    if (state.sealed) {
      return {
        accepted: [],
        always: [],
        rejected: names.map(name => ({ name, reason: 'this subagent\'s tool set was fixed by its parent' })),
        exposed: allowOf(state, []),
        ...state.failure === undefined ? {} : { failure: state.failure },
      }
    }
    const accepted: string[] = []
    const always: string[] = []
    const rejected: Rejection[] = []
    for (const raw of names) {
      const name = raw.trim()
      if (name === '') {
        rejected.push({ name: raw, reason: 'empty tool name' })
        continue
      }
      if (this.isAlways(name, state)) {
        always.push(name)
        continue
      }
      if (!state.catalog.has(name)) {
        rejected.push({ name, reason: 'not a tool this session can keep' })
        continue
      }
      accepted.push(name)
    }
    state.selected = new Set(accepted)
    debug(`select agent=${agent.id} requested=[${names.join(',')}] accepted=[${accepted.join(',')}] `
      + `rejected=[${rejected.map(item => item.name).join(',')}] catalog=${state.catalog.size}`)
    this.commit(agent, state)
    return {
      accepted,
      always,
      rejected,
      exposed: allowOf(state, this.alwaysOf(state)),
      ...state.failure === undefined ? {} : { failure: state.failure },
    }
  }

  /**
   * The runtime-context text for one agent: the catalog while nothing is
   * selected, then a compact summary of what the turn keeps plus the names still
   * available.
   * @param agent - the agent whose context is being assembled.
   * @returns Context prose, or an empty string when the gate has no state.
   */
  promptText(agent: Agent): string {
    const state = this.states.get(agent)
    if (state === undefined || state.sealed) return ''
    if (state.catalogText !== undefined) return state.catalogText
    const available = this.offerable(agent)
    if (available.length === 0) {
      state.catalogText = 'No further tools are selectable in this session; the base tools are already exposed.'
      return state.catalogText
    }
    const lifetime = this.settings.resetPerTurn
      ? 'for the rest of this turn (the next user message resets it)'
      : 'for the rest of this session'
    const lines = [
      `Tool selection. Base tools are always exposed; the tools below can be kept ${lifetime}:`,
    ]
    for (const entry of available) lines.push(`- ${entry.name}: ${entry.description}`)
    lines.push(
      `Call \`${this.settings.selectToolName}\` once with the names you need; the call replaces the set, `
      + 'so list everything the task may still need. Tools you already keep need not be listed again.',
    )
    state.catalogText = lines.join('\n')
    return state.catalogText
  }

  /** The pre-restriction surface the agent would see without the gate. */
  private snapshot(agent: Agent): Map<string, CatalogEntry> {
    const catalog = new Map<string, CatalogEntry>()
    const hidden = new Set(this.settings.hiddenTools)
    // A non-empty allowlist is the whole catalog: it keeps a profile's extra
    // bundles out of a focused session. Always-exposed names stay regardless.
    const allowed = this.settings.catalogTools.length === 0
      ? undefined
      : new Set(this.settings.catalogTools)
    const always = new Set([...this.settings.baseTools, ...this.gateToolNames])
    for (const schema of this.ctx.tools.schemas(agent)) {
      // A hidden tool never enters the catalog, so it can be neither exposed by
      // the base set nor selected later — and a delegation cannot name it.
      if (hidden.has(schema.name)) continue
      if (allowed !== undefined && !allowed.has(schema.name) && !always.has(schema.name)) continue
      catalog.set(schema.name, {
        name: schema.name,
        description: summarize(schema.description, this.settings.maxDescriptionChars),
      })
    }
    return catalog
  }

  /** The gate tools exposed to this agent: none when a parent sealed it. */
  private alwaysOf(state: GateState): readonly string[] {
    return state.sealed ? [] : this.gateToolNames
  }

  /** Whether a name is exposed without any selection. */
  private isAlways(name: string, state: GateState): boolean {
    return this.alwaysOf(state).includes(name) || state.base.includes(name)
  }

  /**
   * Replace the agent's restriction with the current exposure.
   *
   * A filter that names a tool the scope chain will not restrict (a plugin's own
   * `agent.ctx` registration) rejects the whole call. Those names are dropped
   * and the filter retried once, so one foreign registration cannot disable the
   * gate; a second failure fails open and is reported to the model.
   */
  private commit(agent: Agent, state: GateState): void {
    state.lift?.()
    delete state.lift
    const allow = allowOf(state, this.alwaysOf(state))
    // A sealed child with no surviving name is a deliberately empty surface; a
    // non-sealed agent with nothing to expose means the install itself is moot.
    if (allow.length === 0 && !state.sealed) return
    try {
      state.lift = agent.ctx.tools.restrict({ allow })
      delete state.failure
      debug(`commit agent=${agent.id} allow=[${allow.join(',')}]`)
      return
    } catch (error: unknown) {
      const restrictable = allow.filter(name => isRestrictable(agent, name))
      if (restrictable.length === 0 || restrictable.length === allow.length) {
        state.failure = messageOf(error)
        debug(`commit failed agent=${agent.id}: ${state.failure}`)
        return
      }
      try {
        state.lift = agent.ctx.tools.restrict({ allow: restrictable })
        delete state.failure
        debug(`commit retried agent=${agent.id} allow=[${restrictable.join(',')}]`)
      } catch (retryError: unknown) {
        state.failure = messageOf(retryError)
        debug(`commit retry failed agent=${agent.id}: ${state.failure}`)
      }
    }
  }
}

/**
 * The names one restriction exposes: the base set, the gate tools, and the
 * turn's kept tools — limited to what the catalog actually contains, because a
 * restriction naming an absent tool fails at install time.
 */
function allowOf(state: GateState, always: readonly string[]): string[] {
  const allow = new Set<string>(state.base)
  for (const name of always) allow.add(name)
  for (const name of state.selected) allow.add(name)
  return [...allow].filter(name => state.catalog.has(name)).sort()
}

/** Whether one name can be restricted in this agent's scope. */
function isRestrictable(agent: Agent, name: string): boolean {
  try {
    agent.ctx.tools.restrict({ allow: [name] })()
    return true
  } catch {
    return false
  }
}

/** One line of prose: collapsed whitespace, truncated to `max` characters. */
function summarize(text: string, max: number): string {
  const flat = text.replace(/\s+/gu, ' ').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, max - 1).trimEnd()}…`
}

/** A compact message for a caught value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
