# dsh-tool-gate

[![npm](https://img.shields.io/npm/v/@belowthetree/dsh-tool-gate?label=npm)](https://www.npmjs.com/package/@belowthetree/dsh-tool-gate)

**English** | [简体中文](README.md)

Give the model a very small base toolset. **At session start the runtime context lists the remaining
tools with one-line descriptions**, and the model uses `select_tools` to keep what it needs — by default
**for the rest of the session** (`resetPerTurn: true` restores the old "reset on every user message" behavior).

The semantics are per-session:

- the first time the session assembles a prompt → the catalog is rendered (once, and never rewritten);
- the model calls `select_tools` → the selection **replaces** the set → those tools are exposed from the
  next step on, and stay for the rest of the session by default;
- with `resetPerTurn: true` → the next user message clears the selection (the cost of that is in "Cache"
  below).

No string matching and no keyword routing: the catalog is state, and selecting is a tool call. The plugin
only validates names and applies `agent.ctx.tools.restrict({ allow })`.

## Why "the next step" takes effect

DSH re-resolves the tool surface at the start of every step: `tools.resolve()` → `systemPrompt.assemble()`
→ `agent/pre-step` → model request. A restriction changed inside `select_tools` therefore enters the next
step's `resolve`; the agent loop also diffs it against the previous `request/header` and writes a
`developer/message` (`tool-addition`), so the same request carries both the tool result and the new tool
definitions. Not seeing new tools within the same step is structural — the request has already been sent.

The per-message reset (`resetPerTurn: true`) hangs off `agent/inbox/claimed`: it fires synchronously after
the user message is claimed and before that step's `tools.resolve()`, so the reset already applies to the
step that answers the message. The plugin only accepts `role: 'user'` with `source.kind === 'user'` —
runtime-context snapshots, child results and steering injections never trigger it. The reset is off by
default; see "Cache" for why.

## Cache: why the catalog is written once and selection is sticky

The model treats the whole prompt as a prefix cache: **change anything early and every token after it must
be prefilled again (billed as uncached input)**. Measurements from an archived session: an ordinary step
shows `input ≈ 3k / cacheRead ≈ 500k`, while the step after a tool-surface or catalog change shows
`input ≈ the whole context / cacheRead = 0`.

Three deliberate consequences:

| Design | Why |
| --- | --- |
| the catalog text is **rendered once per session** and then returned unchanged | rewriting runtime context replaces a message in the middle of the prompt, invalidating everything after it |
| selection is **sticky across turns** by default (`resetPerTurn: false`) | a per-turn reset flips the tool header back to the base set, re-reading an already large context at every turn start |
| tools registered later are announced with one **appended** `agent.inject()` message | appending only leaves the new tail uncached; rewriting the catalog would break the prefix again |
| `defaultSelection` (default `[pwsh]`) exposes the most common extra tool from step one | a single-turn task then has no second surface change, so no "explore first, select later" |

The `select_tools` result also warns that changing the selection makes the whole conversation be re-read,
which is why the policy asks for one complete selection.

## Tools

| Tool | When it appears | What it does |
| --- | --- | --- |
| `select_tools` | always | replaces the kept set with exact tool names (session-scoped by default); unknown names are reported, not thrown; base tools come back as `Always available` |
| `delegate` | when the composition has the `subagents` service | starts a child agent with an exact tool list chosen by the parent (reserved before the child's first request) |

The catalog is not a tool call: it is runtime context registered through `systemPrompt.context`
(`tool-gate:catalog`, `required: true`), **rendered once per session and then kept as-is**. Selection
results are reported only through the `select_tools` tool result; the catalog itself is never rewritten
(rewriting it would break the prefix cache).

**The catalog is dynamic, not hard-coded**: it comes from `ctx.tools.schemas(agent)` — every tool the agent
inherits from its composition (global layer, preset layer and its own scope), so tools contributed by third-party plugins, MCP servers or Agent Teams all show up. Names in `hiddenTools` are dropped at snapshot time;
when `catalogTools` is non-empty the catalog keeps only those names (base tools and gate tools always stay).
The snapshot is taken once at `agent/created`, and every user message (`agent/inbox/claimed`) takes another
one and **merges** newly registered tools (using a synchronous "lift the restriction → read → commit again"
window). Late tools do not rewrite the catalog text; they are announced with an appended
`agent.inject()` notice — appending only leaves the tail uncached. Removals are not mirrored: a name that
left the registry simply fails the restrictable filter in `commit`.

> Why `catalogTools` matters: with many bundles and MCP servers in a profile, a "standard" session can have
> 50+ tools. The gate only decides **which are exposed**; it will not shorten the catalog for you. Give a
> coding session an allowlist of roughly 15 entries and the catalog stays readable; otherwise the model
> faces the whole profile inventory.

```
Tool selection. Base tools are always exposed; the tools below can be kept for the rest of this session:
- ask_user_question: Ask the user a concise question when you need confirmation, a choice, or missing information…
- web_search: Search the web for current information…
…
Call `select_tools` once with the names you need; the call replaces the set, so list everything the task
may still need. Tools you already keep need not be listed again.
```

## The tool-count button in the composer

The plugin ships a browser half (`client.js`): it registers a pill in `conversation.composer.dock` that shows
**the number of tools the session's most recent model request could actually call**. Clicking it expands a
detail list above the button (tool name plus one-line description; base tools are tagged `base`).

The number comes from a Host-side session projection (key `toolGate`; `wire.view` folds only
`request/header` events). The browser reads it with `props.useProjection('toolGate')` and never replays
session events. So:

- with the gate on, the number changes with `select_tools` / `delegate` (every surface change writes a
  `request/header`);
- with the gate off (`enabled: false`) it still shows every tool in the composition — a read-only view;
- each child session shows its own count.

The button hot-loads after installation without a refresh; if the browser half does not appear, refresh the
page once.

## The preset and its settings

The bundle patch also declares an Agent preset **Tool Gate** (id `tool-gate`, order 20 in the roster): a
**lean coding composition** (fs / shell / jobs / skill / goal / plan / compaction / subagent / ask-user /
todo / web / present) that drops the catalog noise from office, workflow, subagent-fork, schedule,
plugin-manager and friends. A session started in it is gated.

By default **only sessions using that preset are gated**; every other preset (standard, …) is untouched, and
the plugin hides `select_tools` / `delegate` from those presets (globally registered tools must be denied
explicitly, otherwise they would appear everywhere).

**When the decision is made**: a session may still switch presets while blank, so `agent/created` is only
provisional; every user message (`agent/inbox/claimed`) re-evaluates the committed preset — switching from
standard to Tool Gate installs the gate, switching back removes it and restores the full surface.

The bundle's own settings card lives at **Plugins → dsh-tool-gate** in the `plugins.bundle.config` slot and
writes back to that row's Host config:

| Switch | Field | Effect |
| --- | --- | --- |
| Enable tool restriction | `enabled` | off leaves only the composer button |
| Apply to other presets | `applyToOtherPresets` | gates every Agent preset (new sessions) |
| Reset selection per user message | `resetPerTurn` | off by default; on rewrites the surface every turn and re-reads the context |
| Default selection | `defaultSelection` | `[pwsh]` by default: the shell is available from step one, so a single-turn task has no second surface change |

Settings are read and written through `settings.describe` / `settings.mutate`. Changing an ordinary field
restarts the plugin on the Host, so existing sessions keep their old surface and only new sessions use the
new value.

## Installation

From npm (once published):

```sh
pnpm dsh plugin --profile <profile> add @belowthetree/dsh-tool-gate
pnpm dsh --profile <profile> --dump-config  # confirms the row without starting the app
```

Local development (not published):

```sh
cd E:/Project/dsh-plugins/dsh-tool-gate
node scripts/build.mjs                      # emits lib/ and links the DSH packages into node_modules
pnpm dsh plugin --profile <profile> add E:/Project/dsh-plugins/dsh-tool-gate
```

A profile can only hold one source: remove the old one before switching between a local path and the npm
package.

`scripts/build.mjs` locates a DSH checkout (`DSH_CHECKOUT` first, then probes such as
`E:/Project/deepseek-harness`) and links the workspace packages the plugin imports into the plugin's own
`node_modules`. **An out-of-tree plugin cannot count on the profile providing `dsh-tools`**; it has to bring
its own. Linking is idempotent, so from the second build on no write permission is needed.

## Configuration

```yaml
- insert:
    - id: tool-gate
      name: '@belowthetree/dsh-tool-gate'
      config:
        enabled: true                                # false = keep only the tool-count button, restrict nothing
        baseTools: [read, write, edit, glob, grep]   # exposed from step one; names absent from the composition are ignored
        selectToolName: select_tools                # both tool names must match ^[a-z][a-z0-9_]*$ and differ
        delegateToolName: delegate
        delegateProvider: spawn                     # backend that hosts delegated children (subagent provider)
        delegateSealed: false                       # true = sealed by default, the child cannot select tools itself
        applyToSubagents: true                      # false = gate only root sessions; delegated reservations still apply
        presetId: tool-gate                         # the preset this bundle ships; only its sessions are gated
        applyToOtherPresets: false                  # true = gate every preset ("global")
        resetPerTurn: false                         # true = reset on every user message (breaks the prefix cache)
        defaultSelection: [pwsh]                    # exposed from step one without a selection call; empty = none
        hiddenTools: []                             # permanently hidden: no catalog, no selection, no delegation
        catalogTools: [pwsh, subagent, todo_write]  # catalog allowlist; empty = every inherited tool
        maxDescriptionChars: 160                    # truncation for each catalog description (>=24)
```

`pwsh` and `bash` appear in `defaultSelection` / `catalogTools` on purpose: a Windows composition only has
the former and a POSIX composition only the latter; both are filtered against the actual registrations at
install and snapshot time.

## Delegation: a parent picks the child's tools

`delegate({ description, prompt, tools, sealed?, cwd? })`: `tools` is the child's **complete tool surface**
(list only what it needs); with `sealed: true` even the gate tools are withheld. The implementation reserves
the child session id and list, then calls `subagents.startActivation()`; the gate claims the reservation at
`agent/created` (serial, before the child's first request) and installs `restrict({ allow: tools })`. A
failed start releases the reservation. **It is not a dynamic preset**: the child inherits the parent's
composition and only the tool surface differs; reserved ids are only supported by the local backend
(`spawn` by default).

## Boundaries (intentional)

- **Inheritance only**: `restrict` filters tools contributed globally and by the Agent preset; tools a plugin
  registers into its own `agent.ctx` are untouched.
- **Intersection**: another plugin restricting at the same time can only narrow the result further.
- **Fail open**: if `restrict` rejects a name, the plugin retries without it; if that fails too, it leaves the
  surface unrestricted and reports a warning in the tool result.
- **Children are gated by default**: every new agent gets the gate; with `applyToSubagents: false` only root
  sessions are gated, but `delegate` reservations still apply to their children.
- **Reserved children survive their prompt**: a child started by `delegate` keeps the parent's list; the
  delegation message (the child's first prompt) does not clear it. The child may still call `select_tools`
  itself (unless sealed).
- **`hiddenTools` / `catalogTools`**: both apply at snapshot time — `hiddenTools` is a blacklist,
  `catalogTools` an allowlist (empty = everything); names outside the allowlist are neither listed nor
  selectable nor delegable.
- **`delegate` registers late**: the `subagents` service may activate after this plugin, so the tool is
  registered when the service appears and its name is added to already-installed agents.
- **No revocation**: only "keep / replace", never "keep then take back immediately"; a reset only happens on
  the next user message with `resetPerTurn: true`.
- **The tool-count button is a read-only projection**: it folds `request/header` on the Host and never replays
  session events; with `enabled: false` nothing is restricted, only the button remains. If the browser half
  never received the projection (for example it registered after the session opened), refresh the page once.
- **Cache cost**: every selection writes a `request/header` change and a `developer/message`; routes that
  support `toolUpdate` do not start a new series because of it.
- **New sessions only**: a plugin hot-reload does not reach agents that already exist.

## Development

```sh
node scripts/build.mjs          # build lib/ (links the local DSH checkout)
node scripts/build.mjs --noEmit # typecheck only
npm install && npm run build:ci # build with the npm-published DSH packages (the CI path)
node tests/all.mjs              # 70 tests
node --check client.js          # the browser half is a hand-written module, no build step
```

Set `DSH_TOOL_GATE_DEBUG=1` when debugging; the plugin prints `install` / `reserve` / `select` / `commit`
decisions to stderr.

Tests use an in-memory tool registry that reproduces the restriction semantics
(`tests/support/fake-tools.mjs`). They cover: only base and gate tools after install, catalog contents,
replace semantics, unknown names, the user-message reset, non-user messages not resetting, `hiddenTools`,
`applyToSubagents`, delegation lists / `delegate` reservations / sealed children, config validation,
`enabled: false` registering only the projection, and the surface projection's fold and wire schema.

## Publishing

The repository ships `.github/workflows/publish.yml`: pushing a `v*` tag (or running it manually) installs
dependencies, runs the tests, builds, then runs `npm publish --access public --provenance`.

Prerequisites:

1. create or join the `@belowthetree` scope on npm and generate an Automation token with publish rights;
2. add `NPM_TOKEN` under GitHub Settings → Secrets and variables → Actions;
3. the workflow already declares `id-token: write` for npm provenance.

Release a version:

```sh
npm version patch --no-git-tag-version   # or edit package.json by hand
git add package.json && git commit -m "chore: release 0.3.3"
git tag v0.3.3
git push origin main --tags
```

The workflow first checks that `v<version>` matches `package.json`, and fails otherwise, so a mistyped tag
cannot publish the wrong version. For a local publish, run `npm login` and then
`npm install && npm run build:ci && npm publish`.

## Experiment: gated vs ungated

[tests/compare/](tests/compare/README.md) is a real-model A/B experiment (fixture: an isolated copy of
`dsh-channel-manager`; four arms: `control` / `gated` / `gated-root` / `delegate-only`).

**Note**: the earlier numbers in `RESULTS-SUMMARY.md` come from the old design (`list_tools` +
`enable_tools` + on-demand unlocking); the current design (per-session catalog + `select_tools`) is measured
in `RESULTS-catalog.*` / `RESULTS-catalog2.*`, and the summary explains how to read the two repetitions. For
fresh numbers:

```sh
node tests/compare/compare.mjs --tasks=all --arms=control,gated,gated-root,delegate-only --label=catalog3
node tests/compare/report.mjs catalog3
```
