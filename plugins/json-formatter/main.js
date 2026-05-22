export function activate(ctx) {
  const h = ctx.h

  const input = ctx.ref('')
  const output = ctx.ref('')
  const parsedData = ctx.ref(null)
  const error = ctx.ref('')
  const indent = ctx.ref(2)
  const copied = ctx.ref(false)
  const sortKeys = ctx.ref(false)
  const viewMode = ctx.ref('tree')
  const collapsed = ctx.ref(new Set())

  function getStats(text) {
    if (!text) return null
    try {
      const obj = JSON.parse(text)
      const lines = text.split('\n').length
      return { lines, bytes: new TextEncoder().encode(text).length }
    } catch {
      return null
    }
  }

  function sortObjKeys(obj) {
    if (typeof obj !== 'object' || obj === null) return obj
    if (Array.isArray(obj)) return obj.map(sortObjKeys)
    return Object.keys(obj).sort().reduce((acc, k) => {
      acc[k] = sortObjKeys(obj[k])
      return acc
    }, {})
  }

  function escapeStr(s) {
    return s
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
  }

  function formatJSON() {
    error.value = ''
    const raw = input.value.trim()
    if (!raw) { output.value = ''; parsedData.value = null; return }
    try {
      let parsed = JSON.parse(raw)
      if (sortKeys.value) parsed = sortObjKeys(parsed)
      parsedData.value = parsed
      output.value = JSON.stringify(parsed, null, indent.value)
      collapsed.value = new Set()
    } catch (e) {
      error.value = e.message
      output.value = ''
      parsedData.value = null
    }
  }

  function minifyJSON() {
    error.value = ''
    const raw = input.value.trim()
    if (!raw) { output.value = ''; parsedData.value = null; return }
    try {
      const parsed = JSON.parse(raw)
      parsedData.value = parsed
      output.value = JSON.stringify(parsed)
      collapsed.value = new Set()
      viewMode.value = 'raw'
    } catch (e) {
      error.value = e.message
      output.value = ''
      parsedData.value = null
    }
  }

  function clearAll() {
    input.value = ''
    output.value = ''
    error.value = ''
    parsedData.value = null
    collapsed.value = new Set()
  }

  function pasteFromClipboard() {
    navigator.clipboard.readText().then(text => {
      input.value = text
      error.value = ''
      output.value = ''
      parsedData.value = null
    }).catch(() => {
      ctx.ui.notify('无法读取剪贴板', 'warn')
    })
  }

  async function copyOutput() {
    if (!output.value) return
    try {
      await navigator.clipboard.writeText(output.value)
      copied.value = true
      setTimeout(() => { copied.value = false }, 1500)
    } catch {
      ctx.ui.notify('复制失败', 'error')
    }
  }

  function useOutput() {
    if (!output.value) return
    input.value = output.value
    output.value = ''
    parsedData.value = null
    error.value = ''
    collapsed.value = new Set()
  }

  function toggleCollapse(path) {
    const s = new Set(collapsed.value)
    if (s.has(path)) s.delete(path)
    else s.add(path)
    collapsed.value = s
  }

  function collectCollapsiblePaths(value, path, result) {
    if (typeof value !== 'object' || value === null) return
    const keys = Array.isArray(value) ? [...Array(value.length).keys()] : Object.keys(value)
    if (keys.length === 0) return
    result.add(path)
    for (const k of keys) collectCollapsiblePaths(value[k], `${path}/${k}`, result)
  }

  function collapseAll() {
    const paths = new Set()
    if (parsedData.value !== null) collectCollapsiblePaths(parsedData.value, 'root', paths)
    collapsed.value = paths
  }

  function expandAll() {
    collapsed.value = new Set()
  }

  // ── Tree rendering ────────────────────────────────────────────────────────────

  function renderLeaf(key, display, cls, isLast, depth) {
    return h('div', { class: 'jf-row' }, [
      h('span', { class: 'jf-indent', style: `width:${depth * 14}px` }),
      h('span', { class: 'jf-toggle-gap' }),
      key !== null ? h('span', { class: 'jf-key' }, (typeof key === 'number' ? key : `"${key}"`) + ': ') : null,
      h('span', { class: 'jf-val ' + cls }, display),
      isLast ? null : h('span', { class: 'jf-comma' }, ','),
    ].filter(Boolean))
  }

  function renderNode(value, key, path, depth, isLast) {
    if (value === null) {
      return renderLeaf(key, 'null', 'jf-null', isLast, depth)
    }
    if (typeof value !== 'object') {
      const t = typeof value
      const raw = t === 'string' ? `"${escapeStr(value)}"` : String(value)
      const cls = t === 'string' ? 'jf-str' : t === 'number' ? 'jf-num' : 'jf-bool'
      return renderLeaf(key, raw, cls, isLast, depth)
    }

    const isArr = Array.isArray(value)
    const keys = isArr ? [...Array(value.length).keys()] : Object.keys(value)
    const count = keys.length
    const open = isArr ? '[' : '{'
    const close = isArr ? ']' : '}'

    if (count === 0) {
      return h('div', { class: 'jf-row' }, [
        h('span', { class: 'jf-indent', style: `width:${depth * 14}px` }),
        h('span', { class: 'jf-toggle-gap' }),
        key !== null ? h('span', { class: 'jf-key' }, (typeof key === 'number' ? key : `"${key}"`) + ': ') : null,
        h('span', { class: 'jf-brace' }, open + close),
        isLast ? null : h('span', { class: 'jf-comma' }, ','),
      ].filter(Boolean))
    }

    const isCollapsed = collapsed.value.has(path)

    return h('div', { key: path, class: 'jf-node' }, [
      // Header row (clickable)
      h('div', {
        class: 'jf-row jf-row-toggle',
        onClick: () => toggleCollapse(path),
      }, [
        h('span', { class: 'jf-indent', style: `width:${depth * 14}px` }),
        h('span', { class: 'jf-toggle' }, isCollapsed ? '▶' : '▼'),
        key !== null ? h('span', { class: 'jf-key' }, (typeof key === 'number' ? key : `"${key}"`) + ': ') : null,
        h('span', { class: 'jf-brace' }, open),
        isCollapsed ? h('span', { class: 'jf-ellipsis' }, ' … ') : null,
        isCollapsed ? h('span', { class: 'jf-count' }, `${count} ${isArr ? 'items' : 'keys'}`) : null,
        isCollapsed ? h('span', { class: 'jf-brace' }, ' ' + close) : null,
        isCollapsed && !isLast ? h('span', { class: 'jf-comma' }, ',') : null,
      ].filter(Boolean)),

      // Children
      isCollapsed ? null : h('div', null,
        keys.map((k, i) => renderNode(value[k], k, `${path}/${k}`, depth + 1, i === count - 1))
      ),

      // Closing brace
      isCollapsed ? null : h('div', { class: 'jf-row' }, [
        h('span', { class: 'jf-indent', style: `width:${depth * 14}px` }),
        h('span', { class: 'jf-toggle-gap' }),
        h('span', { class: 'jf-brace' }, close),
        isLast ? null : h('span', { class: 'jf-comma' }, ','),
      ].filter(Boolean)),
    ].filter(Boolean))
  }

  // ── Commands ──────────────────────────────────────────────────────────────────

  ctx.commands.register('json-formatter.open', () => {})

  // ── Render ────────────────────────────────────────────────────────────────────

  return {
    component: {
      render() {
        const inputStats = getStats(input.value)
        const outputStats = getStats(output.value)
        const hasOutput = !!output.value
        const hasTree = parsedData.value !== null
        const showTree = viewMode.value === 'tree' && hasTree

        return h('div', { class: 'jf-root' }, [

          // Header
          h('div', { class: 'jf-header' }, [
            h('h2', { class: 'jf-title' }, 'JSON Formatter'),
            h('div', { class: 'jf-header-opts' }, [
              h('label', { class: 'jf-opt-label' }, [
                h('input', {
                  type: 'checkbox',
                  class: 'jf-checkbox',
                  checked: sortKeys.value,
                  onChange: e => { sortKeys.value = e.target.checked },
                }),
                '排序 Keys',
              ]),
              h('label', { class: 'jf-opt-label' }, [
                '缩进',
                h('select', {
                  class: 'jf-select',
                  value: indent.value,
                  onChange: e => { indent.value = Number(e.target.value) },
                }, [
                  h('option', { value: 2 }, '2'),
                  h('option', { value: 4 }, '4'),
                  h('option', { value: '\t' }, 'Tab'),
                ]),
              ]),
            ]),
          ]),

          // Main layout
          h('div', { class: 'jf-layout' }, [

            // Input panel
            h('div', { class: 'jf-panel' }, [
              h('div', { class: 'jf-panel-header' }, [
                h('span', { class: 'jf-panel-title' }, '输入'),
                inputStats ? h('span', { class: 'jf-stat' }, `${inputStats.bytes}B`) : null,
                h('div', { class: 'jf-panel-actions' }, [
                  h('button', { class: 'jf-btn jf-btn-ghost', onClick: pasteFromClipboard }, '粘贴'),
                  h('button', { class: 'jf-btn jf-btn-ghost', onClick: clearAll }, '清空'),
                ]),
              ].filter(Boolean)),
              h('textarea', {
                class: 'jf-textarea',
                placeholder: '在此粘贴 JSON...',
                value: input.value,
                spellcheck: false,
                onInput: e => {
                  input.value = e.target.value
                  error.value = ''
                  output.value = ''
                  parsedData.value = null
                },
              }),
            ]),

            // Action column
            h('div', { class: 'jf-actions' }, [
              h('button', { class: 'jf-btn jf-btn-primary jf-btn-action', onClick: formatJSON }, '格式化 →'),
              h('button', { class: 'jf-btn jf-btn-ghost jf-btn-action', onClick: minifyJSON }, '压缩 →'),
              hasOutput ? h('button', { class: 'jf-btn jf-btn-ghost jf-btn-action', onClick: useOutput }, '← 回填') : null,
            ].filter(Boolean)),

            // Output panel
            h('div', { class: 'jf-panel' }, [
              h('div', { class: 'jf-panel-header' }, [
                h('span', { class: 'jf-panel-title' }, '输出'),
                outputStats ? h('span', { class: 'jf-stat' }, `${outputStats.lines} 行 · ${outputStats.bytes}B`) : null,
                hasOutput ? h('div', { class: 'jf-panel-actions' }, [
                  // Tree / Raw toggle
                  hasTree ? h('div', { class: 'jf-seg' }, [
                    h('button', {
                      class: 'jf-btn jf-btn-seg' + (viewMode.value === 'tree' ? ' jf-btn-seg-active' : ''),
                      onClick: () => { viewMode.value = 'tree' },
                    }, '树'),
                    h('button', {
                      class: 'jf-btn jf-btn-seg' + (viewMode.value === 'raw' ? ' jf-btn-seg-active' : ''),
                      onClick: () => { viewMode.value = 'raw' },
                    }, 'Raw'),
                  ]) : null,
                  // Collapse / Expand (tree mode only)
                  showTree ? h('button', { class: 'jf-btn jf-btn-ghost', onClick: collapseAll }, '全折叠') : null,
                  showTree && collapsed.value.size > 0 ? h('button', { class: 'jf-btn jf-btn-ghost', onClick: expandAll }, '展开全部') : null,
                  // Copy
                  h('button', {
                    class: 'jf-btn jf-btn-ghost' + (copied.value ? ' jf-btn-copied' : ''),
                    onClick: copyOutput,
                  }, copied.value ? '已复制 ✓' : '复制'),
                ].filter(Boolean)) : null,
              ].filter(Boolean)),

              // Content
              error.value
                ? h('div', { class: 'jf-error' }, [
                    h('span', { class: 'jf-error-icon' }, '✕'),
                    h('span', null, error.value),
                  ])
                : showTree
                  ? h('div', { class: 'jf-tree' }, [
                      renderNode(parsedData.value, null, 'root', 0, true),
                    ])
                  : h('textarea', {
                      class: 'jf-textarea jf-textarea-output',
                      readonly: true,
                      spellcheck: false,
                      value: output.value,
                      placeholder: '格式化结果将显示在这里',
                    }),
            ]),
          ]),
        ])
      },
    },
  }
}
