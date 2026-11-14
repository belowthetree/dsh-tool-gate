/**
 * The `delegate` tool: start a subagent whose tool list the parent chooses.
 *
 * The list travels as a reservation, not as a start-request field. This tool
 * reserves the child's session id, records the chosen names under it, and starts
 * the activation; the gate's `agent/created` listener claims that reservation
 * while creation is still being awaited, so the child's tool surface is settled
 * before its first request. That is the same mechanism `dsh-env-mask` uses to
 * bound a child's perception 鈥?the start request has no `toolFilter` any more
 * (0.2.1-rc.1 moved a child's tool plugins to Agent Presets), and a per-child
 * preset would be a whole composition for a three-tool wish.
 *
 * The child inherits the parent's composition: same preset revision, same
 * plugins. Only its visible tool list differs.
 *
 * @module dsh-tool-gate/delegate
 */

import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentActivation, SubagentActivationSpec, SubagentProvider } from '@deepseek-ai/dsh-subagent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ToolGate } from './gate.ts'
import type { GateSettings } from './types.ts'

/** The slice of the `subagents` service delegation drives. */
export interface DelegationRuntime {
  getProvider(name: string): SubagentProvider | undefined
  startActivation(spec: SubagentActivationSpec): Promise<SubagentActivation>
}

/** What the delegation tool needs from the plugin. */
export interface DelegateToolset {
  /** The per-agent gate that claims reservations. */
  readonly gate: ToolGate
  /** Fully defaulted plugin settings. */
  readonly settings: GateSettings
  /** The registered subagent backends. */
  readonly subagents: DelegationRuntime
}

/** Build the delegation tool. */
export function delegateDefinition({ gate, settings, subagents }: DelegateToolset): ToolDefinition {
  return defineTool({
    name: settings.delegateToolName,
    description: 'Start a delegated subagent with a tool list you choose. '
      + 'The child inherits this composition and runs the task you give it, but from its first step it sees only the tools named here '
      + `(plus the gate tools unless \`sealed\`). Use it instead of the ordinary subagent tool when the child must not be able to touch something, `
      + 'and name every tool it needs 鈥?this list is complete, so include read/write or the shell yourself when the task needs them.',
    parameters: {
      description: {
        type: 'string',
        required: true,
        description: 'Short task label for the child, retained in the subagent catalog.',
      },
      prompt: {
        type: 'string',
        required: true,
        description: 'The task for the child to perform.',
      },
      tools: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: 'Exact tool names the child may use, as listed in this session\'s runtime-context catalog. '
          + 'These are its complete tool surface; the child starts with no other tool.',
      },
      sealed: {
        type: 'boolean',
        description: 'Fix the child\'s tool set: it gets exactly `tools` and no gate tools, so it cannot unlock more. '
          + `Defaults to ${settings.delegateSealed ? 'true' : 'false'}.`,
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the child. Defaults to the directory it would otherwise inherit.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const parent = requireAgent(exec, settings.delegateToolName)
      const provider = subagents.getProvider(settings.delegateProvider)
      if (provider === undefined) {
        throw new Error(`${settings.delegateToolName}: subagent provider "${settings.delegateProvider}" is unavailable; `
          + 'configure delegateProvider or use the ordinary subagent tool')
      }
      const requested = uniqueNames(args.tools)
      if (requested.length === 0) {
        throw new Error(`${settings.delegateToolName}: name at least one tool for the child, `
          + 'or use the ordinary subagent tool when it should inherit yours')
      }
      const unknown = requested.filter(name => !gate.hasTool(parent, name))
      if (unknown.length > 0) {
        throw new Error(`${settings.delegateToolName}: unknown tool${unknown.length > 1 ? 's' : ''} `
          + `${unknown.map(name => `"${name}"`).join(', ')}; a child inherits this composition, `
          + `so use the exact names from this session's runtime-context catalog`)
      }
      const sealed = args.sealed ?? settings.delegateSealed
      const childId = SessionId(`tool-gate-${randomUUID()}`)
      gate.reserve(childId, { tools: requested, sealed })
      try {
        const started = await subagents.startActivation({
          provider: settings.delegateProvider,
          label: args.description,
          childId,
          prompt: [{ type: 'text', text: args.prompt }] as ContentBlock[],
          parent,
          ...args.cwd === undefined ? {} : { cwd: args.cwd },
          signal: exec.signal,
          delivery: 'parent',
        })
        return `Started subagent ${started.childId} with exactly: ${requested.join(', ')} `
          + `(${sealed ? 'sealed: it cannot unlock more tools' : 'it may unlock more tools itself'}).`
      } catch (error) {
        // A started child claims its reservation from the gate's `agent/created`
        // listener, which may run after this call resolves, so success must not
        // release it. Only a failed start drops the entry.
        gate.release(childId)
        throw error
      }
    },
  })
}

/** Trimmed, non-empty, de-duplicated names in the caller's order. */
function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const raw of names) {
    const name = raw.trim()
    if (name === '' || seen.has(name)) continue
    seen.add(name)
    unique.push(name)
  }
  return unique
}

/** The calling agent, or a failure that names the tool. */
function requireAgent(exec: ToolRunContext, toolName: string): Agent {
  const agent = exec.agent
  if (agent === undefined) throw new Error(`${toolName} requires a calling agent (exec.agent was undefined)`)
  return agent
}
