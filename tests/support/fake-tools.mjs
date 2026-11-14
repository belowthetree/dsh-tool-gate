/**
 * A fake tool registry with the restriction semantics the gate relies on, plus a
 * fake subagent backend and a way to materialize child agents.
 *
 * The gate only needs four registry operations — `register`, `schemas`,
 * `definitions`, and an agent-scoped `restrict` — plus the two prompt registries
 * and the lifecycle events. This harness implements exactly those: registrations
 * land in one shared table (as global registrations do), restrictions are
 * tracked per agent, and a restriction naming an unknown tool throws the way the
 * real service does.
 *
 * @module dsh-tool-gate/tests/support/fake-tools
 */

/**
 * Build one plugin context, one root agent, and the shared registry.
 * @param {object} [options]
 * @param {Array<{ name: string, description: string }>} [options.tools] Registry contents.
 * @param {string[]} [options.header] Tool names the root session's last request offered.
 * @param {object} [options.subagents] Fake `subagents` service, or undefined to compose without one.
 * @returns The harness.
 */
export function createHarness({ tools = [], header, subagents, projections, presets = { presetForSession: () => 'tool-gate' } } = {}) {
  const all = new Map(tools.map(tool => [tool.name, tool]))
  const filtersByAgent = new Map()
  const registered = []
  const sections = []
  const contexts = []
  const listeners = new Map()

  const filtersOf = id => filtersByAgent.get(id) ?? []
  const admits = (id, name) => filtersOf(id).every(filter =>
    (filter.allow === undefined || filter.allow.has(name))
    && (filter.deny === undefined || !filter.deny.has(name)))
  const visibleNames = (id = 'agent-1') => [...all.keys()].filter(name => admits(id, name))

  /**
   * Materialize one agent: its own restriction list and its own last header.
   * @param {string} [id] Session id.
   * @param {string[]} [headerTools] Tools its last request offered.
   */
  function createAgent(id = 'agent-1', headerTools = header) {
    if (!filtersByAgent.has(id)) filtersByAgent.set(id, [])
    return {
      id,
      session: {
        requestHeader: () => (headerTools === undefined ? undefined : { tools: headerTools.map(name => ({ name })) }),
      },
      ctx: {
        tools: {
          restrict(filter) {
            const allow = filter.allow === undefined ? undefined : new Set(filter.allow)
            const deny = filter.deny === undefined ? undefined : new Set(filter.deny)
            if (allow === undefined && deny === undefined) throw new Error('tools.restrict({}) is a no-op')
            for (const name of [...allow ?? [], ...deny ?? []]) {
              if (!all.has(name)) throw new Error(`tools.restrict() names unknown global tool "${name}"`)
            }
            const entry = { allow, deny }
            const list = filtersByAgent.get(id)
            list.push(entry)
            let live = true
            return () => {
              if (!live) return
              live = false
              const index = list.indexOf(entry)
              if (index >= 0) list.splice(index, 1)
            }
          },
        },
      },
    }
  }

  const pluginTools = {
    register(definition) {
      registered.push(definition)
      all.set(definition.name, { name: definition.name, description: definition.description })
      return () => {
        all.delete(definition.name)
      }
    },
    schemas: scope => [...all.values()]
      .filter(tool => admits(scope?.id, tool.name))
      .map(tool => ({ name: tool.name, description: tool.description, parameters: {} })),
    definitions: scope => [...all.values()].filter(tool => admits(scope?.id, tool.name)),
    get: (name, scope) => (admits(scope?.id, name) ? all.get(name) : undefined),
  }

  const agent = createAgent('agent-1')

  const ctx = {
    tools: pluginTools,
    systemPrompt: {
      getSectionOrder: sectionName => (sectionName === 'PLAN_POLICY' ? 500 : 0),
      getContextOrder: contextName => (contextName === 'SUBAGENT_DELEGATION' ? 500 : 0),
      section(section) {
        sections.push(section)
        return () => {}
      },
      context(entry) {
        contexts.push(entry)
        return () => {}
      },
    },
    get: name => (name === 'subagents' ? subagents : name === 'sessionProjections' ? projections : name === 'agentPresets' ? presets : undefined),
    agentPresets: presets,
    // A scoped context exposes injected services as properties.
    sessionProjections: projections,
    on(event, listener) {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    },
    // Cordis runs an injected callback once its services exist; the fake models
    // that by checking the same names against its own service lookup.
    inject(names, callback) {
      if (names.every(name => ctx.get(name) !== undefined)) callback(ctx)
      return () => {}
    },
    effect(callback) {
      const dispose = callback()
      return typeof dispose === 'function' ? dispose : () => {}
    },
  }

  return {
    ctx,
    agent,
    projections,
    createAgent,
    /** The root agent's live restriction list. */
    filters: filtersOf('agent-1'),
    /** Restrictions recorded for one agent id. */
    filtersFor: id => filtersOf(id),
    registered,
    sections,
    contexts,
    visibleNames,
    /** Dispatch one captured lifecycle event. */
    emit: (event, payload) => listeners.get(event)?.(payload),
    /** Dispatch the waterfall `agent/pre-step` and resolve its decision. */
    emitStep: (payload) => {
      const listener = listeners.get('agent/pre-step')
      if (listener === undefined) return Promise.resolve(undefined)
      return listener(payload, () => Promise.resolve({ kind: 'enter', messages: [] }))
    },
    /** Deliver one claimed inbox message to the plugin. */
    claim: (agentRef, message) => listeners.get('agent/inbox/claimed')?.({ agent: agentRef, message, turn: 1 }),
  }
}

/**
 * A fake `subagents` service that records the activation specs it receives.
 * @param {object} [options]
 * @param {string[]} [options.providers] Registered backend names.
 * @param {boolean} [options.failStart] Make every activation reject.
 * @param {string} [options.rootId] Session id that counts as the delegation root.
 */
export function createSubagents({ providers = ['spawn'], failStart = false, rootId = 'agent-1' } = {}) {
  const started = []
  return {
    started,
    getProvider: name => (providers.includes(name) ? { name, capabilities: {} } : undefined),
    rootOf: agent => (agent?.id === rootId ? agent : { id: 'delegation-root' }),
    async startActivation(spec) {
      started.push(spec)
      if (failStart) throw new Error('backend refused to start')
      return { childId: spec.childId }
    },
  }
}

/**
 * A fake `sessionProjections` service that records what the plugin registers.
 * @returns the fake service, with the definitions it collected.
 */
export function createProjections() {
  const definitions = []
  return {
    definitions,
    async register(definition) {
      definitions.push(definition)
      return {
        stateOf: () => undefined,
        readerFor: () => () => undefined,
        async dispose() {},
      }
    },
  }
}
