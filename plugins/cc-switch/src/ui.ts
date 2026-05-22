import type { PluginContext, PluginExports } from '../../plugin-api/index'

interface Provider {
  id: string           // alias (matches cc-switch CLI)
  name: string         // alias_name
  auth_token: string   // token
  base_url: string     // url
  model: string
  haiku_model?: string // small_fast_model
  sonnet_model?: string
  opus_model?: string
}

interface ProviderEnv {
  ANTHROPIC_BASE_URL?: string
  ANTHROPIC_API_KEY?: string
  ANTHROPIC_AUTH_TOKEN?: string  // cc-switch uses this
  ANTHROPIC_MODEL?: string
  ANTHROPIC_DEFAULT_HAIKU_MODEL?: string
  ANTHROPIC_DEFAULT_SONNET_MODEL?: string
  ANTHROPIC_DEFAULT_OPUS_MODEL?: string
}

interface ProviderStat {
  switchCount: number
  lastUsed: string
  firstUsed?: string
  daily?: Record<string, number>
}

interface LatencyResult {
  alias: string
  latency: number | null
  status: string
}

interface ProviderTokenStat {
  input: number
  output: number
  cache: number
  requests: number
}

interface DailyTokens {
  input: number
  output: number
}

interface RequestLogEntry {
  ts: string
  alias: string
  project: string
  input: number
  output: number
}

interface TokenStats {
  by_provider: Record<string, ProviderTokenStat>
  daily: Record<string, DailyTokens>
  request_log: RequestLogEntry[]
}

export function activate(ctx: PluginContext): PluginExports {
  const providers = ctx.ref<Provider[]>([])
  const currentEnv = ctx.ref<ProviderEnv>({})
  const loading = ctx.ref(true)
  const showForm = ctx.ref(false)
  const editId = ctx.ref<string | null>(null)
  const switching = ctx.ref<string | null>(null)

  // Stats
  const stats = ctx.ref<Record<string, ProviderStat>>({})
  const latencies = ctx.ref<Record<string, LatencyResult>>({})
  const testingLatency = ctx.ref(false)
  const showStats = ctx.ref(false)
  const tokenStats = ctx.ref<TokenStats>({ by_provider: {}, daily: {}, request_log: [] })
  const loadingTokenStats = ctx.ref(false)
  const showRequestLog = ctx.ref(false)

  // Form fields
  const formName = ctx.ref('')
  const formUrl = ctx.ref('')
  const formToken = ctx.ref('')
  const formModel = ctx.ref('')
  const formHaiku = ctx.ref('')
  const formSonnet = ctx.ref('')
  const formOpus = ctx.ref('')

  async function run(args: string[]) {
    const res = await ctx.exec.run(args)
    if (res.code !== 0) throw new Error(res.stderr || `exit code ${res.code}`)
    return JSON.parse(res.stdout)
  }

  async function loadProviders() {
    const data = await run(['list'])
    providers.value = data.providers || []
  }

  async function loadCurrent() {
    try {
      currentEnv.value = await run(['current'])
    } catch {
      currentEnv.value = {}
    }
  }

  async function loadStats() {
    try {
      stats.value = await run(['stats'])
    } catch {
      stats.value = {}
    }
  }

  async function loadTokenStats() {
    loadingTokenStats.value = true
    try {
      tokenStats.value = await run(['token_stats', '7'])
    } catch {
      tokenStats.value = { by_provider: {}, daily: {}, request_log: [] }
    } finally {
      loadingTokenStats.value = false
    }
  }

  async function refresh() {
    loading.value = true
    try {
      await Promise.all([loadProviders(), loadCurrent(), loadStats(), loadTokenStats()])
    } catch (e: any) {
      ctx.ui.notify('加载失败: ' + e.message, 'error')
    } finally {
      loading.value = false
    }
  }

  function resetForm() {
    formName.value = ''
    formUrl.value = ''
    formToken.value = ''
    formModel.value = ''
    formHaiku.value = ''
    formSonnet.value = ''
    formOpus.value = ''
    editId.value = null
    showForm.value = false
  }

  function openAddForm() {
    resetForm()
    showForm.value = true
  }

  function openEditForm(p: Provider) {
    editId.value = p.id
    formName.value = p.name
    formUrl.value = p.base_url
    formToken.value = p.auth_token
    formModel.value = p.model
    formHaiku.value = p.haiku_model || ''
    formSonnet.value = p.sonnet_model || ''
    formOpus.value = p.opus_model || ''
    showForm.value = true
  }

  async function saveForm() {
    const payload = JSON.stringify({
      name: formName.value,
      base_url: formUrl.value,
      auth_token: formToken.value,
      model: formModel.value,
      haiku_model: formHaiku.value,
      sonnet_model: formSonnet.value,
      opus_model: formOpus.value,
    })
    try {
      if (editId.value) {
        await run(['update', editId.value, payload])
        ctx.ui.notify('已更新', 'info')
      } else {
        await run(['add', payload])
        ctx.ui.notify('已添加', 'info')
      }
      resetForm()
      await loadProviders()
    } catch (e: any) {
      ctx.ui.notify('保存失败: ' + e.message, 'error')
    }
  }

  async function switchProvider(id: string) {
    switching.value = id
    try {
      await run(['switch', id])
      ctx.ui.notify('已切换', 'info')
      await Promise.all([loadCurrent(), loadStats()])
    } catch (e: any) {
      ctx.ui.notify('切换失败: ' + e.message, 'error')
    } finally {
      switching.value = null
    }
  }

  async function deleteProvider(id: string) {
    const ok = await ctx.ui.confirm('确定删除此 Provider？')
    if (!ok) return
    try {
      await run(['delete', id])
      ctx.ui.notify('已删除', 'info')
      await loadProviders()
    } catch (e: any) {
      ctx.ui.notify('删除失败: ' + e.message, 'error')
    }
  }

  async function importCurrent() {
    // Fast path: if current env already matches a known provider, skip the backend call
    const alreadyTracked = providers.value.find(p => isCurrent(p))
    if (alreadyTracked) {
      ctx.ui.notify('配置已存在: ' + alreadyTracked.name + '，无需重复导入', 'warn')
      return
    }
    try {
      await run(['import'])
      ctx.ui.notify('已导入当前配置', 'info')
      await loadProviders()
    } catch (e: any) {
      if (e.message.includes('duplicate')) {
        // Try human-readable name first, fall back to alias key
        const nameMatch = e.message.match(/"existing_name"\s*:\s*"([^"]+)"/)
        const aliasMatch = e.message.match(/"existing"\s*:\s*"([^"]+)"/)
        const existingName = nameMatch ? nameMatch[1] : (aliasMatch ? aliasMatch[1] : '未知')
        ctx.ui.notify('配置已存在: ' + existingName + '，无需重复导入', 'warn')
      } else {
        ctx.ui.notify('导入失败: ' + e.message, 'error')
      }
    }
  }

  async function switchNext() {
    try {
      await run(['next'])
      ctx.ui.notify('已切换', 'info')
      await Promise.all([loadCurrent(), loadStats()])
    } catch (e: any) {
      ctx.ui.notify('切换失败: ' + e.message, 'error')
    }
  }

  async function runSpeedtest() {
    testingLatency.value = true
    try {
      const data = await run(['speedtest'])
      const results: LatencyResult[] = data.results || []
      const map: Record<string, LatencyResult> = {}
      for (const r of results) {
        map[r.alias] = r
      }
      latencies.value = map
    } catch (e: any) {
      ctx.ui.notify('测速失败: ' + e.message, 'error')
    } finally {
      testingLatency.value = false
    }
  }

  async function resetStats(id?: string) {
    const label = id ? '此 Provider 的统计' : '所有统计'
    const ok = await ctx.ui.confirm(`确定重置${label}？此操作不可撤销。`)
    if (!ok) return
    try {
      const args = id ? ['stats_reset', id] : ['stats_reset']
      await run(args)
      ctx.ui.notify('统计已重置', 'info')
      await loadStats()
    } catch (e: any) {
      ctx.ui.notify('重置失败: ' + e.message, 'error')
    }
  }

  function getLast7Days(): string[] {
    const days: string[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      days.push(d.toISOString().slice(0, 10))
    }
    return days
  }

  function getDailyTotals(): Record<string, number> {
    const totals: Record<string, number> = {}
    for (const stat of Object.values(stats.value)) {
      if (stat.daily) {
        for (const [date, count] of Object.entries(stat.daily)) {
          totals[date] = (totals[date] || 0) + count
        }
      }
    }
    return totals
  }

  function isCurrent(p: Provider): boolean {
    return (
      currentEnv.value.ANTHROPIC_BASE_URL === p.base_url &&
      (currentEnv.value.ANTHROPIC_API_KEY === p.auth_token ||
       currentEnv.value.ANTHROPIC_AUTH_TOKEN === p.auth_token)
    )
  }

  function maskToken(token: string): string {
    if (!token) return ''
    if (token.length <= 8) return '***'
    return token.slice(0, 4) + '...' + token.slice(-4)
  }

  function formatTokens(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
    return String(n)
  }

  function formatDate(iso: string): string {
    if (!iso) return ''
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    const diffHour = Math.floor(diffMs / 3600000)
    const diffDay = Math.floor(diffMs / 86400000)

    if (diffMin < 1) return '刚刚'
    if (diffMin < 60) return diffMin + '分钟前'
    if (diffHour < 24) return diffHour + '小时前'
    if (diffDay < 30) return diffDay + '天前'
    return d.toLocaleDateString('zh-CN')
  }

  // Register command palette commands
  ctx.commands.register('cc-switch.open', () => {})
  ctx.commands.register('cc-switch.next', switchNext)

  ctx.onMounted(() => refresh())

  // Render functions
  const h = ctx.h

  function renderForm() {
    if (!showForm.value) return null
    return h('div', { class: 'cs-form' }, [
      h('h3', { class: 'cs-form-title' }, editId.value ? '编辑 Provider' : '添加 Provider'),
      h('div', { class: 'cs-form-grid' }, [
        renderInput('名称', formName, '例如: PackyCode'),
        renderInput('API Base URL', formUrl, 'https://api.example.com'),
        renderInput('API Key', formToken, 'sk-xxx', 'password'),
        renderInput('主模型', formModel, 'claude-sonnet-4-20250514'),
        renderInput('Haiku 模型', formHaiku, 'claude-haiku-4-20250514'),
        renderInput('Sonnet 模型', formSonnet, 'claude-sonnet-4-20250514'),
        renderInput('Opus 模型', formOpus, 'claude-sonnet-4-20250514'),
      ]),
      h('div', { class: 'cs-form-actions' }, [
        h('button', {
          class: 'cs-btn cs-btn-primary',
          onClick: saveForm,
        }, editId.value ? '保存' : '添加'),
        h('button', {
          class: 'cs-btn cs-btn-ghost',
          onClick: resetForm,
        }, '取消'),
      ]),
    ])
  }

  function renderInput(label: string, model: ReturnType<typeof ctx.ref<string>>, placeholder: string, type = 'text') {
    return h('label', { class: 'cs-field' }, [
      h('span', { class: 'cs-label' }, label),
      h('input', {
        class: 'cs-input',
        type,
        value: model.value,
        placeholder,
        onInput: (e: Event) => { model.value = (e.target as HTMLInputElement).value },
      }),
    ])
  }

  function renderStatBadge(p: Provider) {
    const s = stats.value[p.id]
    if (!s || s.switchCount === 0) return null

    return h('div', { class: 'cs-stat-badge' }, [
      h('span', { class: 'cs-stat-count' }, s.switchCount + '次'),
      s.lastUsed ? h('span', { class: 'cs-stat-time' }, formatDate(s.lastUsed)) : null,
    ].filter(Boolean))
  }

  function renderLatency(p: Provider) {
    const l = latencies.value[p.id]
    if (!l) return null

    let statusClass = 'cs-latency-ok'
    let statusText = ''
    if (l.latency !== null) {
      statusText = l.latency + 'ms'
      if (l.latency > 2000) statusClass = 'cs-latency-slow'
      else if (l.latency > 800) statusClass = 'cs-latency-mid'
    } else {
      statusClass = 'cs-latency-err'
      statusText = l.status === 'auth_error' ? '认证失败' : '不可达'
    }

    return h('span', { class: 'cs-latency ' + statusClass }, statusText)
  }

  function renderCard(p: Provider) {
    const active = isCurrent(p)
    const busy = switching.value === p.id

    return h('div', {
      key: p.id,
      class: 'cs-card' + (active ? ' cs-card-active' : ''),
    }, [
      // Left: info
      h('div', { class: 'cs-card-info' }, [
        h('div', { class: 'cs-card-header' }, [
          h('span', { class: 'cs-card-name' }, p.name),
          active ? h('span', { class: 'cs-badge cs-badge-active' }, '使用中') : null,
          renderLatency(p),
        ].filter(Boolean)),
        p.base_url ? h('div', { class: 'cs-card-url' }, p.base_url) : null,
        h('div', { class: 'cs-card-models' }, [
          p.model ? h('span', { class: 'cs-model-tag' }, p.model) : null,
          p.haiku_model && p.haiku_model !== p.model
            ? h('span', { class: 'cs-model-tag cs-model-tag-haiku' }, 'Haiku: ' + p.haiku_model)
            : null,
        ].filter(Boolean)),
        p.auth_token ? h('div', { class: 'cs-card-token' }, 'Key: ' + maskToken(p.auth_token)) : null,
        renderStatBadge(p),
      ].filter(Boolean)),
      // Right: actions
      h('div', { class: 'cs-card-actions' }, [
        active
          ? h('button', { class: 'cs-btn cs-btn-sm cs-btn-active', disabled: true }, '使用中')
          : h('button', {
              class: 'cs-btn cs-btn-sm cs-btn-primary',
              disabled: busy,
              onClick: () => switchProvider(p.id),
            }, busy ? '切换中...' : '启用'),
        h('button', {
          class: 'cs-btn cs-btn-sm cs-btn-ghost',
          title: '编辑',
          onClick: () => openEditForm(p),
        }, '编辑'),
        h('button', {
          class: 'cs-btn cs-btn-sm cs-btn-danger',
          title: '删除',
          onClick: () => deleteProvider(p.id),
        }, '删除'),
      ]),
    ])
  }

  function renderDailyChart() {
    const days = getLast7Days()
    const tokenDaily = tokenStats.value.daily
    const switchDaily = getDailyTotals()
    const hasTokenData = Object.keys(tokenDaily).length > 0

    const maxIn  = Math.max(...days.map(d => tokenDaily[d]?.input  || 0), 1)
    const maxOut = Math.max(...days.map(d => tokenDaily[d]?.output || 0), 1)
    const maxSwitch = Math.max(...days.map(d => switchDaily[d] || 0), 1)

    const dayLabels = ['日', '一', '二', '三', '四', '五', '六']

    return h('div', { class: 'cs-daily-chart' }, [
      hasTokenData
        ? h('div', { class: 'cs-chart-legend' }, [
            h('span', { class: 'cs-legend-in' }, '输入'),
            h('span', { class: 'cs-legend-out' }, '输出'),
          ])
        : null,
      h('div', { class: 'cs-daily-bars' },
        days.map((d, i) => {
          const isToday = i === 6
          const date = new Date(d + 'T00:00:00')
          const dow = dayLabels[date.getDay()]
          let label = ''

          let inPct = 0, outPct = 0

          if (hasTokenData) {
            const inp = tokenDaily[d]?.input  || 0
            const out = tokenDaily[d]?.output || 0
            const total = inp + out
            if (total > 0) label = formatTokens(total)
            inPct  = Math.max(inp / maxIn  * 100, inp  > 0 ? 4 : 1)
            outPct = Math.max(out / maxOut * 100, out > 0 ? 4 : 1)
          } else {
            const val = switchDaily[d] || 0
            if (val > 0) label = String(val)
            inPct = Math.max(val / maxSwitch * 100, val > 0 ? 8 : 2)
          }

          return h('div', { key: d, class: 'cs-daily-col' + (isToday ? ' cs-daily-today' : '') }, [
            label ? h('span', { class: 'cs-daily-count' }, label) : null,
            h('div', { class: 'cs-daily-bar-wrap' }, [
              h('div', {
                class: 'cs-daily-bar' + (isToday ? ' cs-daily-bar-today' : ''),
                style: { height: inPct + '%' },
              }),
              hasTokenData ? h('div', {
                class: 'cs-daily-bar-output' + (isToday ? ' cs-daily-bar-today' : ''),
                style: { height: outPct + '%' },
              }) : null,
            ].filter(Boolean)),
            h('span', { class: 'cs-daily-label' }, dow),
          ])
        })
      ),
    ])
  }

  function renderTokenSummary() {
    const bp = tokenStats.value.by_provider
    const totalIn = Object.values(bp).reduce((s, v) => s + v.input, 0)
    const totalOut = Object.values(bp).reduce((s, v) => s + v.output, 0)
    const totalCache = Object.values(bp).reduce((s, v) => s + v.cache, 0)
    const totalReq = Object.values(bp).reduce((s, v) => s + v.requests, 0)
    if (totalIn === 0 && totalOut === 0) return null

    return h('div', { class: 'cs-token-summary' }, [
      h('div', { class: 'cs-token-card' }, [
        h('div', { class: 'cs-token-value' }, formatTokens(totalIn)),
        h('div', { class: 'cs-token-label' }, '输入 Tokens'),
      ]),
      h('div', { class: 'cs-token-card' }, [
        h('div', { class: 'cs-token-value cs-token-out' }, formatTokens(totalOut)),
        h('div', { class: 'cs-token-label' }, '输出 Tokens'),
      ]),
      totalCache > 0 ? h('div', { class: 'cs-token-card' }, [
        h('div', { class: 'cs-token-value cs-token-cache' }, formatTokens(totalCache)),
        h('div', { class: 'cs-token-label' }, '缓存 Tokens'),
      ]) : null,
      h('div', { class: 'cs-token-card' }, [
        h('div', { class: 'cs-token-value cs-token-req' }, String(totalReq)),
        h('div', { class: 'cs-token-label' }, '请求数（7天）'),
      ]),
    ].filter(Boolean))
  }

  function renderRequestLog() {
    const log = tokenStats.value.request_log
    if (log.length === 0) return null

    return h('div', { class: 'cs-req-section' }, [
      h('div', {
        class: 'cs-req-toggle',
        onClick: () => { showRequestLog.value = !showRequestLog.value },
      }, [
        h('span', null, '请求日志'),
        h('span', { class: 'cs-req-count' }, log.length + ' 条'),
        h('span', { class: 'cs-req-arrow' }, showRequestLog.value ? '▲' : '▼'),
      ]),
      showRequestLog.value
        ? h('div', { class: 'cs-req-log' }, [
            h('div', { class: 'cs-req-header' }, [
              h('span', { class: 'cs-req-col cs-req-col-time' }, '时间'),
              h('span', { class: 'cs-req-col cs-req-col-alias' }, 'Provider'),
              h('span', { class: 'cs-req-col cs-req-col-proj' }, '项目'),
              h('span', { class: 'cs-req-col cs-req-col-tokens' }, 'In / Out'),
            ]),
            ...log.map((entry, i) => {
              const provider = providers.value.find(p => p.id === entry.alias)
              const name = provider ? provider.name : (entry.alias || '未知')
              return h('div', { key: i, class: 'cs-req-row' }, [
                h('span', { class: 'cs-req-col cs-req-col-time' }, formatDate(entry.ts)),
                h('span', { class: 'cs-req-col cs-req-col-alias', title: entry.alias }, name),
                h('span', { class: 'cs-req-col cs-req-col-proj', title: entry.project }, entry.project),
                h('span', { class: 'cs-req-col cs-req-col-tokens' },
                  formatTokens(entry.input) + ' / ' + formatTokens(entry.output)),
              ])
            }),
          ])
        : null,
    ])
  }

  function renderStatsSummary() {
    const entries = Object.entries(stats.value)
    if (entries.length === 0) return null

    const sorted = entries.sort((a, b) => b[1].switchCount - a[1].switchCount)
    const totalSwitches = sorted.reduce((sum, [, s]) => sum + s.switchCount, 0)

    const dailyTotals = getDailyTotals()
    const todayKey = new Date().toISOString().slice(0, 10)
    const todayCount = dailyTotals[todayKey] || 0

    return h('div', { class: 'cs-stats-summary' }, [
      h('div', { class: 'cs-stats-header' }, [
        h('div', { class: 'cs-stats-title-group' }, [
          h('span', { class: 'cs-stats-title' }, '使用统计'),
          h('span', { class: 'cs-stats-subtitle' },
            '共切换 ' + totalSwitches + ' 次' + (todayCount > 0 ? ' · 今日 ' + todayCount + ' 次' : '')),
        ]),
        h('div', { class: 'cs-stats-actions' }, [
          h('button', {
            class: 'cs-btn cs-btn-sm cs-btn-ghost',
            onClick: runSpeedtest,
            disabled: testingLatency.value,
          }, testingLatency.value ? '测速中...' : '测速'),
          h('button', {
            class: 'cs-btn cs-btn-sm cs-btn-ghost cs-btn-danger-ghost',
            onClick: () => resetStats(),
            title: '重置所有统计',
          }, '重置'),
          h('button', {
            class: 'cs-btn cs-btn-sm cs-btn-ghost',
            onClick: () => { showStats.value = false },
          }, '收起'),
        ]),
      ]),

      renderTokenSummary(),
      renderDailyChart(),

      h('div', { class: 'cs-stats-list' },
        sorted.map(([id, s]) => {
          const provider = providers.value.find(p => p.id === id)
          const name = provider ? provider.name : id
          const pct = totalSwitches > 0 ? Math.round(s.switchCount / totalSwitches * 100) : 0
          const tStat = tokenStats.value.by_provider[id]
          return h('div', { key: id, class: 'cs-stats-row' }, [
            h('span', { class: 'cs-stats-name', title: name }, name),
            h('div', { class: 'cs-stats-bar-wrap' }, [
              h('div', {
                class: 'cs-stats-bar',
                style: { width: Math.max(pct, 2) + '%' },
              }),
            ]),
            h('span', { class: 'cs-stats-count' }, s.switchCount + '次'),
            tStat
              ? h('span', { class: 'cs-stats-token' },
                  formatTokens(tStat.input) + ' / ' + formatTokens(tStat.output))
              : h('span', { class: 'cs-stats-token' }),
            s.firstUsed
              ? h('span', { class: 'cs-stats-first' }, '首次 ' + formatDate(s.firstUsed))
              : h('span', { class: 'cs-stats-first' }),
            s.lastUsed
              ? h('span', { class: 'cs-stats-last' }, formatDate(s.lastUsed))
              : null,
          ].filter(Boolean))
        })
      ),

      renderRequestLog(),
    ])
  }

  return {
    component: {
      setup() {
        ctx.onMounted(() => refresh())
        return {}
      },
      render() {
        return h('div', { class: 'cc-switch' }, [
          // Header
          h('div', { class: 'cs-header' }, [
            h('h2', { class: 'cs-title' }, 'CC Switch'),
            h('div', { class: 'cs-header-actions' }, [
              h('button', {
                class: 'cs-btn cs-btn-sm cs-btn-ghost',
                onClick: importCurrent,
                title: '从当前配置导入',
              }, '导入当前'),
              h('button', {
                class: 'cs-btn cs-btn-sm cs-btn-ghost',
                onClick: switchNext,
                title: '切换到下一个',
              }, '切换下一个'),
              h('button', {
                class: 'cs-btn cs-btn-sm cs-btn-ghost',
                onClick: () => { showStats.value = !showStats.value },
                title: '使用统计',
              }, showStats.value ? '统计 ▲' : '统计 ▼'),
              h('button', {
                class: 'cs-btn cs-btn-sm cs-btn-primary',
                onClick: openAddForm,
              }, '+ 添加'),
            ]),
          ]),

          // Current env display
          currentEnv.value.ANTHROPIC_BASE_URL
            ? h('div', { class: 'cs-current-env' }, [
                h('div', { class: 'cs-current-label' }, '当前配置'),
                h('div', { class: 'cs-current-info' }, [
                  h('span', null, currentEnv.value.ANTHROPIC_BASE_URL),
                  currentEnv.value.ANTHROPIC_MODEL
                    ? h('span', { class: 'cs-model-tag' }, currentEnv.value.ANTHROPIC_MODEL)
                    : null,
                ].filter(Boolean)),
              ])
            : null,

          // Stats summary
          showStats.value ? renderStatsSummary() : null,

          // Form
          renderForm(),

          // Provider list
          loading.value
            ? h('div', { class: 'cs-loading' }, '加载中...')
            : providers.value.length === 0
              ? h('div', { class: 'cs-empty' }, [
                  h('div', { class: 'cs-empty-icon' }, '⚙'),
                  h('p', null, '还没有配置任何 Provider'),
                  h('p', { class: 'cs-empty-hint' }, '点击"添加"或"导入当前"开始使用'),
                ])
              : h('div', { class: 'cs-list' }, providers.value.map(renderCard)),
        ])
      },
    },
  }
}
