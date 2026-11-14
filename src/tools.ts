/**
 * The selection tool: keep some of the catalog for the rest of this user turn.
 *
 * The catalog itself is not a tool call — it arrives in the runtime context on
 * the first step after each user message (see `ToolGate.promptText`), so the
 * model does not spend a step discovering tools. This tool only states which of
 * them the turn should keep.
 *
 * @module dsh-tool-gate/tools
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ToolGate } from './gate.ts'
import type { GateSettings } from './types.ts'

/** What the tool factory needs from the plugin. */
export interface GateToolset {
  /** The per-agent gate. */
  readonly gate: ToolGate
  /** Fully defaulted plugin settings. */
  readonly settings: GateSettings
}

/** Build the per-turn selection tool. */
export function selectToolsDefinition({ gate, settings }: GateToolset): ToolDefinition {
  return defineTool({
    name: settings.selectToolName,
    description: 'Keep the tools you need for the rest of this user turn. '
      + 'The runtime context lists every tool this session can offer, with a one-line description each; '
      + 'name the ones this task needs and they stay exposed for every later step of the same turn. '
      + 'The call replaces the turn\'s selection, the base tools stay available without asking, and a new user '
      + 'message starts a fresh selection window with a fresh catalog. '
      + 'Keep what the task needs, not everything.',
    parameters: {
      tools: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: 'Exact tool names to keep for this turn, as listed in the runtime-context catalog. '
          + 'Passing a new list replaces the previous one; base tools never need to be listed.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec, settings.selectToolName)
      const outcome = gate.select(agent, args.tools)
      const lifetime = settings.resetPerTurn ? 'this turn (the next user message resets it)' : 'the rest of this session'
      const lines: string[] = []
      lines.push(outcome.accepted.length === 0
        ? 'Nothing new was kept.'
        : `Kept for ${lifetime}: ${outcome.accepted.join(', ')}. Available from your next step.`)
      if (outcome.always.length > 0) lines.push(`Always available: ${outcome.always.join(', ')}.`)
      for (const rejection of outcome.rejected) {
        lines.push(`Rejected "${rejection.name}": ${rejection.reason}. Use the exact names from the runtime-context catalog.`)
      }
      lines.push(`Exposed now: ${outcome.exposed.join(', ')}.`)
      if (outcome.failure !== undefined) {
        lines.push(`Warning: the gate is inactive for this session (${outcome.failure}); every tool stays exposed.`)
      }
      return lines.join('\n')
    },
  })
}

/** The calling agent, or a failure that names the tool. */
function requireAgent(exec: ToolRunContext, toolName: string): Agent {
  const agent = exec.agent
  if (agent === undefined) throw new Error(`${toolName} requires a calling agent (exec.agent was undefined)`)
  return agent
}
