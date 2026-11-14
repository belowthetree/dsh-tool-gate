/**
 * Browser half of dsh-tool-gate.
 *
 * Two contributions, both plain React registered through the Slot system:
 *
 * - `conversation.composer.dock` — the tool count badge, a thin reader of the
 *   Host projection `toolGate` (the Host folds each `request/header`; the
 *   browser renders a finished value and never replays session events).
 * - `plugins.bundle.config` — the bundle's own settings on its Plugins page:
 *   whether the gate also applies to sessions using another Agent preset.
 *   It reads and writes the row's Host config through the `settings` Remote,
 *   the same document the row's configure page edits.
 *
 * Loaded by the Client module loader as a lazy factory whose id equals the
 * package name; React comes from the browser module table.
 */
window.__ModuleLoader__.load({
  id: 'dsh-tool-gate',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const COLOR = {
      primary: 'var(--dsw-alias-label-primary)',
      secondary: 'var(--dsw-alias-label-secondary)',
      border: 'var(--dsw-alias-border-l1)',
      base: 'var(--dsw-alias-bg-base)',
      overlay: 'var(--dsw-alias-bg-overlay)',
      brand: 'var(--dsw-alias-brand-primary)',
      idle: 'var(--dsw-alias-state-idle-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
    }

    const STYLE = {
      root: {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        padding: '2px 4px 6px',
      },
      button: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 24,
        padding: '0 9px',
        border: `1px solid ${COLOR.border}`,
        borderRadius: 999,
        background: 'transparent',
        color: COLOR.secondary,
        font: 'inherit',
        fontSize: 12,
        lineHeight: '22px',
        cursor: 'pointer',
      },
      dot: {
        width: 6,
        height: 6,
        borderRadius: 999,
        background: COLOR.brand,
        flex: '0 0 auto',
      },
      count: {
        color: COLOR.primary,
        fontVariantNumeric: 'tabular-nums',
      },
      panel: {
        position: 'absolute',
        left: 0,
        bottom: 'calc(100% + 6px)',
        width: 340,
        maxHeight: 320,
        overflow: 'auto',
        padding: '10px 12px 12px',
        border: `1px solid ${COLOR.border}`,
        borderRadius: 10,
        background: COLOR.overlay,
        color: COLOR.primary,
        fontSize: 12,
        lineHeight: 1.45,
        zIndex: 30,
      },
      header: {
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
        paddingBottom: 6,
      },
      title: {
        fontWeight: 600,
      },
      meta: {
        color: COLOR.secondary,
        fontVariantNumeric: 'tabular-nums',
      },
      row: {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        columnGap: 8,
        padding: '4px 0',
        borderTop: `1px solid ${COLOR.border}`,
      },
      name: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 12,
        overflowWrap: 'anywhere',
      },
      tag: {
        color: COLOR.brand,
        fontSize: 11,
        whiteSpace: 'nowrap',
      },
      description: {
        gridColumn: '1 / -1',
        marginTop: 2,
        color: COLOR.secondary,
        fontSize: 11,
        overflow: 'hidden',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
      },
      empty: {
        color: COLOR.secondary,
        fontSize: 11,
        paddingTop: 4,
      },
      settings: {
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '12px 0 4px',
        color: COLOR.primary,
        fontSize: 13,
      },
      settingRow: {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        alignItems: 'center',
        columnGap: 12,
      },
      settingHint: {
        color: COLOR.secondary,
        fontSize: 11,
        marginTop: 2,
      },
      toggle: {
        position: 'relative',
        width: 34,
        height: 20,
        borderRadius: 999,
        border: `1px solid ${COLOR.border}`,
        background: COLOR.base,
        cursor: 'pointer',
        padding: 0,
      },
      knob: {
        position: 'absolute',
        top: 2,
        left: 2,
        width: 14,
        height: 14,
        borderRadius: 999,
        background: COLOR.idle,
        transition: 'transform 120ms ease',
      },
      knobOn: {
        transform: 'translateX(14px)',
        background: COLOR.brand,
      },
      error: {
        color: COLOR.error,
        fontSize: 11,
      },
    }

    const LABELS = {
      en: {
        button: count => `${count} tools`,
        title: 'Tool surface',
        meta: count => `${count} exposed`,
        base: 'base',
        note: 'Tools the model could call on this session’s latest request.',
        settingsTitle: 'Tool gating',
        enabled: 'Restrict tools',
        enabledHint: 'Off keeps the badge and leaves every tool exposed.',
        applyOther: 'Apply to other presets',
        applyOtherHint: 'Off gates only the Tool Gate preset; on gates every Agent preset (new sessions).',
        saving: 'Saving…',
        saveFailed: 'Not saved: the Host refused the change.',
        unavailable: 'This profile does not expose the row settings.',
      },
      zh: {
        button: count => `${count} 个工具`,
        title: '工具面',
        meta: count => `共 ${count} 个`,
        base: '基础',
        note: '数字来自本会话最近一次模型请求实际可调用的工具。',
        settingsTitle: '工具选取',
        enabled: '启用工具限制',
        enabledHint: '关闭后只保留工具数按钮，所有工具照常可用。',
        applyOther: '在其他预设中也生效',
        applyOtherHint: '关闭时只门控 Tool Gate 预设；打开后所有 Agent 预设都会被门控（对新会话生效）。',
        saving: '保存中…',
        saveFailed: '未保存：Host 拒绝了这次修改。',
        unavailable: '当前 profile 没有暴露该行的设置。',
      },
    }

    /**
     * Read the active locale once per page load; a language switch reloads the
     * client bundle, so a fixed dictionary is enough here.
     * @param ctx - Client plugin context.
     * @returns the label set for the active language.
     */
    function labelsFor(ctx) {
      try {
        const locale = ctx.get('locale')
        const active = locale?.getSnapshot?.().active ?? locale?.getLocale?.().active ?? 'en'
        return String(active).toLowerCase().startsWith('zh') ? LABELS.zh : LABELS.en
      } catch {
        return LABELS.en
      }
    }

    /** Resolve the settings Remote namespace face, or undefined when absent. */
    function settingsRemote(ctx) {
      try {
        const remote = ctx.get('remote')
        const settings = remote?.settings
        return typeof settings?.describe === 'function' ? settings : undefined
      } catch {
        return undefined
      }
    }

    /**
     * The dock entry: a count badge plus its detail panel.
     * @param props - standard dock props, including the `useProjection` hook.
     */
    function ToolGateDock(props) {
      const read = props.useProjection
      const surface = typeof read === 'function' ? read('toolGate') : undefined
      const [open, setOpen] = React.useState(false)
      const rootRef = React.useRef(null)
      const panelId = React.useId()

      React.useEffect(() => {
        if (!open) return undefined
        const onKeyDown = event => {
          if (event.key === 'Escape') setOpen(false)
        }
        const onPointerDown = event => {
          const node = rootRef.current
          if (node !== null && !node.contains(event.target)) setOpen(false)
        }
        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('pointerdown', onPointerDown, true)
        return () => {
          document.removeEventListener('keydown', onKeyDown)
          document.removeEventListener('pointerdown', onPointerDown, true)
        }
      }, [open])

      const labels = props.__labels ?? LABELS.en
      if (surface === undefined || surface.count === 0) return null
      const base = new Set(Array.isArray(surface.base) ? surface.base : [])

      return h(
        'div',
        { ref: rootRef, style: STYLE.root },
        h(
          'button',
          {
            type: 'button',
            style: STYLE.button,
            'aria-expanded': open,
            'aria-controls': open ? panelId : undefined,
            title: labels.note,
            onClick: () => setOpen(value => !value),
          },
          h('span', { style: STYLE.dot, 'aria-hidden': true }),
          h('span', null, labels.button(surface.count)),
        ),
        open
          ? h(
            'div',
            { id: panelId, role: 'dialog', 'aria-label': labels.title, style: STYLE.panel },
            h(
              'div',
              { style: STYLE.header },
              h('span', { style: STYLE.title }, labels.title),
              h('span', { style: STYLE.meta }, labels.meta(surface.count)),
            ),
            Array.isArray(surface.tools) && surface.tools.length > 0
              ? surface.tools.map(tool => h(
                'div',
                { key: tool.name, style: STYLE.row },
                h('span', { style: STYLE.name }, tool.name),
                base.has(tool.name) ? h('span', { style: STYLE.tag }, labels.base) : null,
                tool.description ? h('span', { style: STYLE.description }, tool.description) : null,
              ))
              : h('div', { style: STYLE.empty }, labels.note),
          )
          : null,
      )
    }

    /**
     * One labelled switch; a plain button keeps the row accessible without the
     * host's primitive components (client halves must not import them).
     * @param props - label, hint, checked state, change callback, busy flag.
     */
    function SwitchRow(props) {
      const { label, hint, checked, busy, onChange } = props
      return h(
        'div',
        { style: STYLE.settingRow },
        h(
          'div',
          null,
          h('div', null, label),
          hint ? h('div', { style: STYLE.settingHint }, hint) : null,
        ),
        h(
          'button',
          {
            type: 'button',
            role: 'switch',
            'aria-checked': checked,
            'aria-label': label,
            disabled: busy,
            style: STYLE.toggle,
            onClick: () => onChange(!checked),
          },
          h('span', { style: { ...STYLE.knob, ...(checked ? STYLE.knobOn : null) }, 'aria-hidden': true }),
        ),
      )
    }

    /**
     * The bundle's settings page: two Host-persisted switches read from and
     * written to the row's config through `settings.describe` / `settings.mutate`.
     * @param props - slot props plus the `api` supplied at registration.
     */
    function BundleSettings(props) {
      const { api } = props
      const labels = api.labels
      const [state, setState] = React.useState({ status: 'loading', value: undefined, ns: undefined, revision: undefined })
      const [busy, setBusy] = React.useState(false)
      const [failed, setFailed] = React.useState(false)

      const load = React.useCallback(async () => {
        const settings = api.settings()
        if (settings === undefined) {
          setState({ status: 'unavailable', value: undefined, ns: undefined, revision: undefined })
          return
        }
        try {
          const response = await settings.describe()
          if (!response?.ok) {
            setState({ status: 'unavailable', value: undefined, ns: undefined, revision: undefined })
            return
          }
          const rows = response.value?.namespaces ?? []
          const row = rows.find(candidate => String(candidate.ns).endsWith(':tool-gate'))
          if (row === undefined) {
            setState({ status: 'unavailable', value: undefined, ns: undefined, revision: undefined })
            return
          }
          setState({ status: 'ready', value: row.value ?? {}, ns: row.ns, revision: row.revision })
        } catch {
          setState({ status: 'unavailable', value: undefined, ns: undefined, revision: undefined })
        }
      }, [api])

      React.useEffect(() => {
        void load()
      }, [load])

      const write = async (field, next) => {
        const settings = api.settings()
        if (settings === undefined || state.ns === undefined) return
        setBusy(true)
        setFailed(false)
        const previous = state.value ?? {}
        setState(current => ({ ...current, value: { ...previous, [field]: next } }))
        try {
          const response = await settings.mutate(state.ns, [{ op: 'set', path: [field], value: next }], state.revision)
          if (response?.ok === false) setFailed(true)
        } catch {
          setFailed(true)
        } finally {
          setBusy(false)
          void load()
        }
      }

      if (state.status === 'loading') return null
      if (state.status === 'unavailable') return h('div', { style: STYLE.settings }, h('div', { style: STYLE.settingHint }, labels.unavailable))

      const value = state.value ?? {}
      return h(
        'div',
        { style: STYLE.settings },
        h('div', { style: STYLE.title }, labels.settingsTitle),
        h(SwitchRow, {
          label: labels.enabled,
          hint: labels.enabledHint,
          checked: value.enabled !== false,
          busy,
          onChange: next => { void write('enabled', next) },
        }),
        h(SwitchRow, {
          label: labels.applyOther,
          hint: labels.applyOtherHint,
          checked: value.applyToOtherPresets === true,
          busy,
          onChange: next => { void write('applyToOtherPresets', next) },
        }),
        failed ? h('div', { style: STYLE.error }, labels.saveFailed) : (busy ? h('div', { style: STYLE.settingHint }, labels.saving) : null),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const labels = labelsFor(ctx)
        const api = { labels, settings: () => settingsRemote(ctx) }
        const WithLabels = props => h(ToolGateDock, { ...props, __labels: labels })
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register(
          { name: 'conversation.composer.dock', id: 'tool-gate-surface', order: 30 },
          WithLabels,
        ))
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
          { name: 'plugins.bundle.config', key: 'dsh-tool-gate' },
          props => h(BundleSettings, { ...props, api }),
        ))
      },
    }
  },
})
