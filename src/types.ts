/**
 * Deployment settings for `dsh-tool-gate`, plus the defaults the Config schema
 * fills before `apply` runs.
 *
 * @module dsh-tool-gate/types
 */

/**
 * Tools exposed from the first step of every gated session. The list is a
 * request, not a guarantee: a name this composition does not provide is
 * dropped while the gate is installed, which is what lets one default list cover
 * Windows (`pwsh`) and POSIX (`bash`) deployments.
 */
export const DEFAULT_BASE_TOOLS: readonly string[] = ['read', 'write', 'edit', 'glob', 'grep']

/** Model-facing name of the per-turn selection tool. */
export const DEFAULT_SELECT_TOOL_NAME = 'select_tools'

/** Model-facing name of the delegation tool. */
export const DEFAULT_DELEGATE_TOOL_NAME = 'delegate'

/** Subagent backend that hosts delegated children. */
export const DEFAULT_DELEGATE_PROVIDER = 'spawn'

/**
 * Whether a delegated child is sealed by default. A sealed child gets exactly
 * the tools its parent named and no gate tools, so it cannot widen its own
 * surface; an unsealed child starts from that list and may still select more.
 */
export const DEFAULT_DELEGATE_SEALED = false

/**
 * Whether a gate applies to agents that are not roots (delegated children).
 * `true` gives every child the same base surface and its own selection window;
 * `false` leaves children with the composition's full surface, so only the root
 * session is gated (a child that a parent started through `delegate` is still
 * gated, because its surface is the point of that tool).
 */
export const DEFAULT_APPLY_TO_SUBAGENTS = true

/** Agent preset this bundle ships; sessions in it are gated by default. */
export const DEFAULT_PRESET_ID = 'tool-gate'

/**
 * Whether the gate also applies to sessions using another Agent preset.
 * `false` keeps the shipped preset the only gated composition, and hides the
 * gate tools from every other preset.
 */
export const DEFAULT_APPLY_TO_OTHER_PRESETS = false

/**
 * Whether a kept selection resets at the next user message. `false` (the
 * default) keeps it for the session: a reset rewrites the tool surface, and any
 * surface change makes the provider re-read the whole prompt uncached.
 */
export const DEFAULT_RESET_PER_TURN = false

/** Longest catalog description retained per tool. */
export const DEFAULT_MAX_DESCRIPTION_CHARS = 160

/**
 * Optional allowlist for the per-turn catalog. Empty means every inherited tool
 * is offered; a non-empty list keeps a profile's extra bundles out of a focused
 * preset, while the base tools and the gate tools stay exposed regardless.
 */
export const DEFAULT_CATALOG_TOOLS: readonly string[] = []

/**
 * Tools exposed from the first step without the model asking. Kept out of the
 * catalog and out of the selection step, so the tool surface is stable before
 * the first request and no later change re-reads the prompt.
 */
export const DEFAULT_DEFAULT_SELECTION: readonly string[] = []

/** Fully defaulted settings, frozen once at load. */
export interface GateSettings {
  /** Base tools requested by the deployment, in configuration order. */
  readonly baseTools: readonly string[]
  /** Model-facing name of the per-turn selection tool. */
  readonly selectToolName: string
  /** Model-facing name of the delegation tool. */
  readonly delegateToolName: string
  /** Subagent backend that hosts delegated children. */
  readonly delegateProvider: string
  /** Whether delegation seals the child's tool set by default. */
  readonly delegateSealed: boolean
  /** Whether a non-root agent is gated too. */
  readonly applyToSubagents: boolean
  /** Agent preset this gate belongs to. */
  readonly presetId: string
  /** Whether the gate applies to sessions using another Agent preset. */
  readonly applyToOtherPresets: boolean
  /** Whether a kept selection resets at the next user message. */
  readonly resetPerTurn: boolean
  /** Tools this gate hides from every gated agent and never offers to select. */
  readonly hiddenTools: readonly string[]
  /** Tools the catalog may offer; empty offers every inherited tool. */
  readonly catalogTools: readonly string[]
  /** Tools exposed from the first step without a selection call. */
  readonly defaultSelection: readonly string[]
  /** Longest catalog description retained per tool, in characters. */
  readonly maxDescriptionChars: number
}
