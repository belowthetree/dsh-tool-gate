/**
 * Browser half: the tool-surface badge in `conversation.composer.dock`.
 *
 * The badge is a thin reader of the Host projection `toolGate`: the Host folds
 * each `request/header` into `{ count, base, tools }`, so this module renders a
 * finished value and never replays session events (see
 * `references/practices.md`: declare `wire.view` on the Host projection).
 *
 * Clicking the badge expands an inline panel above it with the exposed tools;
 * base tools are marked, everything else is what the current turn kept. The
 * panel is absolutely positioned inside the dock rather than fixed, because the
 * docked composer is the containing block for fixed descendants.
 *
 * Loaded by the Client module loader as a lazy factory whose id equals the
 * package name; React comes from the browser module table.
 */
window.__ModuleLoader__.load({
  id: 'dsh-tool-gate',
  factory(require) {
    const React = require('react')
    const h = React.createElement

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
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 999,
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        font: 'inherit',
        fontSize: 12,
        lineHeight: '22px',
        cursor: 'pointer',
      },
      dot: {
        width: 6,
        height: 6,
        borderRadius: 999,
        background: 'var(--dsw-alias-brand-primary)',
        flex: '0 0 auto',
      },
      count: {
        color: 'var(--dsw-alias-label-primary)',
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
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 10,
        background: 'var(--dsw-alias-bg-overlay)',
        color: 'var(--dsw-alias-label-primary)',
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
        color: 'var(--dsw-alias-label-secondary)',
        fontVariantNumeric: 'tabular-nums',
      },
      row: {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        columnGap: 8,
        padding: '4px 0',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      name: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 12,
        overflowWrap: 'anywhere',
      },
      tag: {
        color: 'var(--dsw-alias-brand-primary)',
        fontSize: 11,
        whiteSpace: 'nowrap',
      },
      description: {
        gridColumn: '1 / -1',
        marginTop: 2,
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 11,
        overflow: 'hidden',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
      },
      empty: {
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 11,
        paddingTop: 4,
      },
    }

    const LABELS = {
      en: {
        button: count => `${count} tools`,
        title: 'Tool surface',
        meta: count => `${count} exposed`,
        base: 'base',
        note: 'Tools the model could call on this session’s latest request.',
      },
      zh: {
        button: count => `${count} 个工具`,
        title: '工具面',
        meta: count => `共 ${count} 个`,
        base: '基础',
        note: '数字来自本会话最近一次模型请求实际可调用的工具。',
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
            {
              id: panelId,
              role: 'dialog',
              'aria-label': labels.title,
              style: STYLE.panel,
            },
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

    return {
      inject: ['slots'],
      apply(ctx) {
        const labels = labelsFor(ctx)
        const WithLabels = props => h(ToolGateDock, { ...props, __labels: labels })
        // The owner of the dock entry is the conversation shell; the callback's
        // registration is torn down when that declaration collapses.
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register(
          { name: 'conversation.composer.dock', id: 'tool-gate-surface', order: 30 },
          WithLabels,
        ))
      },
    }
  },
})
