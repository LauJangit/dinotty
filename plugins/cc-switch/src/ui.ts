import type { PluginContext, PluginExports } from '../../plugin-api/index'

interface Provider {
  id: string
  name: string
  base_url: string
  auth_token: string
  model: string
  haiku_model: string
  sonnet_model: string
  opus_model: string
}

interface ProviderEnv {
  ANTHROPIC_BASE_URL?: string
  ANTHROPIC_API_KEY?: string
  ANTHROPIC_MODEL?: string
  ANTHROPIC_DEFAULT_HAIKU_MODEL?: string
  ANTHROPIC_DEFAULT_SONNET_MODEL?: string
  ANTHROPIC_DEFAULT_OPUS_MODEL?: string
}

export function activate(ctx: PluginContext): PluginExports {
  const providers = ctx.ref<Provider[]>([])
  const currentEnv = ctx.ref<ProviderEnv>({})
  const loading = ctx.ref(true)
  const showForm = ctx.ref(false)
  const editId = ctx.ref<string | null>(null)
  const switching = ctx.ref<string | null>(null)

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

  async function refresh() {
    loading.value = true
    try {
      await Promise.all([loadProviders(), loadCurrent()])
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
      await loadCurrent()
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
    try {
      await run(['import'])
      ctx.ui.notify('已导入当前配置', 'info')
      await loadProviders()
    } catch (e: any) {
      ctx.ui.notify('导入失败: ' + e.message, 'error')
    }
  }

  async function switchNext() {
    try {
      await run(['next'])
      ctx.ui.notify('已切换', 'info')
      await loadCurrent()
    } catch (e: any) {
      ctx.ui.notify('切换失败: ' + e.message, 'error')
    }
  }

  function isCurrent(p: Provider): boolean {
    return currentEnv.value.ANTHROPIC_BASE_URL === p.base_url
  }

  function maskToken(token: string): string {
    if (!token) return ''
    if (token.length <= 8) return '***'
    return token.slice(0, 4) + '...' + token.slice(-4)
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
        ]),
        p.base_url ? h('div', { class: 'cs-card-url' }, p.base_url) : null,
        h('div', { class: 'cs-card-models' }, [
          p.model ? h('span', { class: 'cs-model-tag' }, p.model) : null,
          p.haiku_model && p.haiku_model !== p.model
            ? h('span', { class: 'cs-model-tag cs-model-tag-haiku' }, 'Haiku: ' + p.haiku_model)
            : null,
        ].filter(Boolean)),
        p.auth_token ? h('div', { class: 'cs-card-token' }, 'Key: ' + maskToken(p.auth_token)) : null,
      ]),
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
