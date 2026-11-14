/**
 * dsh-tool-gate — a base toolset up front, a per-turn catalog in context, and a
 * selection tool that keeps the relevant tools until the next user message.
 *
 * A gated session starts with the configured base tools plus the gate tools.
 * Every other tool the composition provides is hidden behind one agent-scoped
 * `tools.restrict()` allow list. Instead of spending a step discovering them,
 * the model receives a catalog of one-line descriptions in the runtime context on
 * the first step after each user message; `select_tools` then replaces the
 * turn's selection, and the chosen tools stay exposed for every later step of
 * that turn. The next user message opens a fresh window and a fresh catalog.
 *
 * Delegation is a second way in: `delegate` names the tools a child may use, and
 * the child starts from exactly that list — a reservation claimed before its
 * first request, not a preset switch (a preset would replace the child's whole
 * composition; a child inherits this one).
 *
 * The gate is deliberately made of existing mechanisms, not a new one:
 *
 * - `agent.ctx.tools.restrict()` — per-agent, live, intersection semantics;
 * - the loop's own `developer/message` tool-addition delta, which tells the model
 *   that its surface changed;
 * - `systemPrompt.context()` for the per-turn catalog and selection summary.
 *
 * The plugin never matches user text: the catalog is state, the selection is a
 * tool call, so the model decides what it needs.
 *
 * @module dsh-tool-gate
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { delegateDefinition } from './delegate.ts'
import type { DelegationRuntime } from './delegate.ts'
import { ToolGate } from './gate.ts'
import { createToolSurfaceProjection } from './surface.ts'
import { selectToolsDefinition } from './tools.ts'
import {
  DEFAULT_APPLY_TO_SUBAGENTS,
  DEFAULT_APPLY_TO_OTHER_PRESETS,
  DEFAULT_BASE_TOOLS,
  DEFAULT_DELEGATE_PROVIDER,
  DEFAULT_DELEGATE_SEALED,
  DEFAULT_DELEGATE_TOOL_NAME,
  DEFAULT_MAX_DESCRIPTION_CHARS,
  DEFAULT_PRESET_ID,
  DEFAULT_SELECT_TOOL_NAME,
} from './types.ts'
import type { GateSettings } from './types.ts'

/** Plugin name used by the cordis loader. */
export const name = 'dsh-tool-gate'

/** The registries the gate writes to. */
export const inject = ['tools', 'systemPrompt']

/** Deployment-varying choices; every field is defaulted and validated at load. */
export interface Config {
  /**
   * Whether tools are actually restricted. `false` keeps the session projection
   * and the composer-dock badge but leaves every tool exposed — useful to adopt
   * the read-out before the gate.
   */
  enabled?: boolean
  /**
   * Tools exposed from the first step. Names this composition does not provide
   * are ignored, so the default covers Windows and POSIX deployments alike.
   */
  baseTools?: string[]
  /** Model-facing name of the per-turn selection tool. */
  selectToolName?: string
  /** Model-facing name of the delegation tool; it is only registered when the `subagents` service exists. */
  delegateToolName?: string
  /** Registered subagent backend that hosts delegated children. */
  delegateProvider?: string
  /** Whether a delegated child is sealed (gets exactly its list, cannot select more) by default. */
  delegateSealed?: boolean
  /** Whether non-root agents are gated too; `false` leaves delegated children with the full surface. */
  applyToSubagents?: boolean
  /** Agent preset this gate belongs to; sessions in another preset are left untouched unless `applyToOtherPresets`. */
  presetId?: string
  /** Whether the gate also applies to sessions using another Agent preset. */
  applyToOtherPresets?: boolean
  /** Tools this gate always hides: never in the base set, never selectable, never selectable for a child. */
  hiddenTools?: string[]
  /** Longest catalog description retained per tool. */
  maxDescriptionChars?: number
}

/** Schema for {@link Config}; the loader fills every default before `apply`. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  baseTools: z.array(z.string()).default([...DEFAULT_BASE_TOOLS]),
  selectToolName: z.string().default(DEFAULT_SELECT_TOOL_NAME),
  delegateToolName: z.string().default(DEFAULT_DELEGATE_TOOL_NAME),
  delegateProvider: z.string().default(DEFAULT_DELEGATE_PROVIDER),
  delegateSealed: z.boolean().default(DEFAULT_DELEGATE_SEALED),
  applyToSubagents: z.boolean().default(DEFAULT_APPLY_TO_SUBAGENTS),
  presetId: z.string().default(DEFAULT_PRESET_ID),
  applyToOtherPresets: z.boolean().default(DEFAULT_APPLY_TO_OTHER_PRESETS),
  hiddenTools: z.array(z.string()).default([]),
  maxDescriptionChars: z.number().default(DEFAULT_MAX_DESCRIPTION_CHARS),
})

/** Register the selection tool, the runtime catalog, and the per-agent installation. */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as Required<Config>
  assertToolName('selectToolName', resolved.selectToolName)
  assertToolName('delegateToolName', resolved.delegateToolName)
  if (resolved.selectToolName === resolved.delegateToolName) {
    throw new Error('dsh-tool-gate: selectToolName and delegateToolName must differ')
  }
  if (!Number.isInteger(resolved.maxDescriptionChars) || resolved.maxDescriptionChars < 24) {
    throw new Error('dsh-tool-gate: maxDescriptionChars must be an integer of at least 24')
  }
  const gateNames = [resolved.selectToolName, resolved.delegateToolName]
  for (const baseTool of resolved.baseTools) {
    if (gateNames.includes(baseTool)) {
      throw new Error(`dsh-tool-gate: baseTools must not list the gate tool "${baseTool}"`)
    }
  }
  if (resolved.baseTools.includes('')) throw new Error('dsh-tool-gate: baseTools must not contain an empty name')
  for (const hidden of resolved.hiddenTools) {
    if (hidden === '') throw new Error('dsh-tool-gate: hiddenTools must not contain an empty name')
    if (gateNames.includes(hidden)) {
      throw new Error(`dsh-tool-gate: hiddenTools must not hide the gate tool "${hidden}"`)
    }
  }

  const settings: GateSettings = {
    baseTools: [...resolved.baseTools],
    selectToolName: resolved.selectToolName,
    delegateToolName: resolved.delegateToolName,
    delegateProvider: resolved.delegateProvider,
    delegateSealed: resolved.delegateSealed,
    applyToSubagents: resolved.applyToSubagents,
    presetId: resolved.presetId,
    applyToOtherPresets: resolved.applyToOtherPresets,
    hiddenTools: [...resolved.hiddenTools],
    maxDescriptionChars: resolved.maxDescriptionChars,
  }

  // The composer-dock badge reads this projection: the tool surface of the
  // session's latest model request, folded on the Host so the browser never
  // replays events. It stays available even in badge-only mode, and the service
  // is optional because not every profile composes projections.
  ctx.inject(['sessionProjections'], (scoped: Context) => {
    const projection = createToolSurfaceProjection([
      ...settings.baseTools,
      settings.selectToolName,
      settings.delegateToolName,
    ])
    void scoped.sessionProjections.register(projection).catch((error: unknown) => {
      // A missing projection only costs the badge; the gate itself must load.
      console.error('dsh-tool-gate: session projection unavailable:', error)
    })
  })

  // `enabled: false` keeps the projection and the badge but never restricts a
  // tool: the read-out without the gate, for a profile being migrated.
  if (!resolved.enabled) return

  // Delegation needs a backend. The `subagents` service may not be active when
  // this plugin applies (loader activation order is dependency-driven, not row
  // order), so the tool is contributed from an injected scope and added to the
  // gate's always-exposed set when it appears. The gate itself works without it.
  let roots: SubagentRoots | undefined
  let delegateRegistered = false
  const gate = new ToolGate(ctx, settings, [settings.selectToolName])

  /** The Agent preset a live agent records, or null when it records none. */
  const presetOf = (agent: Agent): string | null => {
    const presets = ctx.get('agentPresets') as { presetForSession?: (session: unknown) => string | null } | undefined
    if (typeof presets?.presetForSession !== 'function') return null
    const session = (agent as unknown as { session?: unknown }).session
    if (session === undefined) return null
    try {
      return presets.presetForSession(session)
    } catch {
      return null
    }
  }

  /** Whether this agent belongs to the gated preset (or the gate is profile-wide). */
  const appliesTo = (agent: Agent): boolean => settings.applyToOtherPresets
    || (settings.presetId !== '' && presetOf(agent) === settings.presetId)

  ctx.tools.register(selectToolsDefinition({ gate, settings }))
  ctx.inject(['subagents'], (scoped: Context) => {
    if (settings.delegateProvider.trim() === '') {
      throw new Error('dsh-tool-gate: delegateProvider must not be blank')
    }
    const subagents = scoped.get('subagents') as unknown as DelegationRuntime
    roots = subagents as unknown as SubagentRoots
    delegateRegistered = true
    scoped.tools.register(delegateDefinition({ gate, settings, subagents }))
    gate.addGateTool(settings.delegateToolName)
  })

  // The catalog is runtime context, not a tool call: it is rendered while the turn
  // has no selection and superseded by the compact summary once the turn selects.
  ctx.systemPrompt.context({
    name: 'tool-gate:catalog',
    order: 500,
    required: true,
    text: assembleContext => {
      const agent = assembleContext.agent
      return agent === undefined ? '' : gate.promptText(agent)
    },
  })

  // The one instruction that keeps a gated model from under-reporting.
  ctx.systemPrompt.section({
    name: 'tool-gate:policy',
    order: ctx.systemPrompt.getSectionOrder('PLAN_POLICY') - 50,
    text: () => policyText(settings, delegateRegistered),
  })

  // A genuine user message opens a fresh selection window. The claim event is
  // emitted synchronously before this step's tool surface is resolved, so the
  // reset is already in force for the step that answers the user. Runtime-context
  // and child-result messages carry their own source kinds and do not reset.
  ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    if (message.role !== 'user' || message.source?.kind !== 'user') return
    gate.startTurn(agent)
  })
  // Serial listeners are awaited before creation resolves, so the restriction is
  // in place before the agent's first request sees a tool list. A parent-gated
  // child (`delegate`) is always installed even when `applyToSubagents` is off:
  // its surface is the reservation, not the composition.
  ctx.on('agent/created', ({ agent }) => {
    // A session in another Agent preset keeps the full surface; only the gate
    // tools are hidden, so those presets never offer a tool they cannot use.
    if (!appliesTo(agent)) {
      gate.excludeGateTools(agent)
      return
    }
    if (!settings.applyToSubagents && !gate.hasReservation(String(agent.id)) && !isRootAgent(roots, agent)) return
    gate.install(agent)
  })
  ctx.on('agent/disposed', ({ agent }) => {
    gate.dispose(agent)
  })
  // Restrictions live on the agent's own context, outside this plugin's effect
  // scope; lift them explicitly when the plugin unloads.
  ctx.effect(() => () => {
    gate.disposeAll()
  })
}

/** The `subagents` service slice that tells a root agent from a delegated one. */
interface SubagentRoots {
  rootOf(agent: Agent): Agent
}

/** Whether this agent is its own delegation root; unknown means "treat as root". */
function isRootAgent(roots: SubagentRoots | undefined, agent: Agent): boolean {
  if (roots === undefined || typeof roots.rootOf !== 'function') return true
  try {
    return roots.rootOf(agent) === agent
  } catch {
    return true
  }
}

/** The instruction that keeps a gated model from under-reporting its abilities. */
function policyText(settings: GateSettings, delegate: boolean): string {
  const lines = [
    'Tool access in this session is gated.',
    `Exposed from the first step: ${settings.baseTools.join(', ')} and the gate tools \`${settings.selectToolName}\``
      + `${delegate ? ` and \`${settings.delegateToolName}\`` : ''}.`,
    'The runtime context lists the remaining tools with one-line descriptions at the start of every user turn.',
    `Call \`${settings.selectToolName}\` with the names this task needs; they stay exposed for the rest of the current turn and reset at the next user message. `
      + 'The call replaces the turn\'s selection, so list everything the turn still needs.',
    `Check that catalog before telling the user that a capability is unavailable, and keep only what the task needs.`,
  ]
  if (delegate) {
    lines.push(
      `To hand work to a subagent with a narrower tool set, call \`${settings.delegateToolName}\` and name the exact tools the child may use; `
      + 'the child inherits this composition but starts from that list only.',
    )
  }
  return lines.join('\n')
}

/** A model-facing tool name: lowercase letters, digits, and underscores. */
function assertToolName(field: string, value: string): void {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) {
    throw new Error(`dsh-tool-gate: ${field} must match ^[a-z][a-z0-9_]*$ (got ${JSON.stringify(value)})`)
  }
}
