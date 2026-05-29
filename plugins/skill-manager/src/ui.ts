import type { PluginContext, PluginExports } from '../../plugin-api/index'

interface SkillMeta {
  repoOwner: string
  repoName: string
  repoBranch: string
  directory: string   // subdirectory inside the repo
  installedAt: string
}

interface Skill {
  id: string          // directory name (e.g. "git-commit")
  name: string        // from SKILL.md frontmatter
  description: string
  allowedTools: string[]
  path: string        // full path
  raw: string         // full SKILL.md content
  meta?: SkillMeta    // present if installed from a repo
}

interface SkillsShResult {
  key: string
  name: string
  directory: string
  repoOwner: string
  repoName: string
  repoBranch: string
  installs: number
  readmeUrl?: string
}

export function activate(ctx: PluginContext): PluginExports {
  const h = ctx.h

  const skills = ctx.ref<Skill[]>([])
  const loading = ctx.ref(true)
  const tab = ctx.ref<'installed' | 'discover'>('installed')

  // Installed tab state
  const editingSkill = ctx.ref<Skill | null>(null)
  const editContent = ctx.ref('')
  const editDirty = ctx.ref(false)
  const saving = ctx.ref(false)
  const deleting = ctx.ref<string | null>(null)
  const showNewForm = ctx.ref(false)
  const newName = ctx.ref('')
  const creating = ctx.ref(false)

  const syncing = ctx.ref<string | null>(null)
  const syncingAll = ctx.ref(false)
  const searchQuery = ctx.ref('')
  const searchResults = ctx.ref<SkillsShResult[]>([])
  const searching = ctx.ref(false)
  const searchTotal = ctx.ref(0)
  const searchPage = ctx.ref(0)
  const installing = ctx.ref<string | null>(null)
  const PAGE_SIZE = 20

  async function sh(cmd: string): Promise<string> {
    const res = await ctx.exec.run(['sh', '-c', cmd])
    if (res.code !== 0) throw new Error(res.stderr || `exit ${res.code}`)
    return res.stdout
  }

  function parseFrontmatter(content: string): Pick<Skill, 'name' | 'description' | 'allowedTools'> {
    const match = content.match(/^---\n([\s\S]*?)\n---/)
    if (!match) return { name: '', description: '', allowedTools: [] }
    const fm = match[1]

    const nameM = fm.match(/^name:\s*(.+)$/m)
    const name = nameM ? nameM[1].trim() : ''

    // description can be multi-line (with | or inline)
    const descM = fm.match(/^description:\s*([\s\S]*?)(?=\n\w|\n---$|$)/m)
    let description = ''
    if (descM) {
      description = descM[1].replace(/^\|\s*\n/, '').replace(/\n\s{2,}/g, ' ').trim()
    }

    const toolsM = fm.match(/^allowed-tools:\s*\n((?:\s+-\s+.+\n?)*)/m)
    let allowedTools: string[] = []
    if (toolsM) {
      allowedTools = toolsM[1].match(/^\s+-\s+(.+)$/mg)?.map(s => s.replace(/^\s+-\s+/, '').trim()) || []
    } else {
      const inlineM = fm.match(/^allowed-tools:\s*\[([^\]]+)\]/m)
      if (inlineM) {
        allowedTools = inlineM[1].split(',').map(s => s.trim())
      }
    }

    return { name, description, allowedTools }
  }

  async function loadSkills() {
    loading.value = true
    try {
      const skillsDir = `${await sh('echo -n $HOME')}/.claude/skills`
      let dirs: string[] = []
      try {
        const out = await sh(`ls -1 "${skillsDir}" 2>/dev/null`)
        dirs = out.split('\n').filter(d => d.trim())
      } catch {
        dirs = []
      }

      const loaded: Skill[] = []
      for (const id of dirs) {
        const skillPath = `${skillsDir}/${id}`
        const skillMdPath = `${skillPath}/SKILL.md`
        try {
          const raw = await sh(`cat "${skillMdPath}"`)
          const { name, description, allowedTools } = parseFrontmatter(raw)
          // load meta if exists
          let meta: SkillMeta | undefined
          try {
            const metaRaw = await sh(`cat "${skillPath}/.skill-meta.json"`)
            meta = JSON.parse(metaRaw)
          } catch { /* no meta */ }
          loaded.push({ id, name: name || id, description, allowedTools, path: skillPath, raw, meta })
        } catch {
          // no SKILL.md, skip
        }
      }
      skills.value = loaded
    } catch (e: any) {
      ctx.ui.notify('加载失败: ' + e.message, 'error')
    } finally {
      loading.value = false
    }
  }

  function openEdit(skill: Skill) {
    editingSkill.value = skill
    editContent.value = skill.raw
    editDirty.value = false
  }

  function closeEdit() {
    if (editDirty.value) {
      ctx.ui.confirm('有未保存的修改，确定放弃？').then(ok => {
        if (ok) { editingSkill.value = null; editDirty.value = false }
      })
    } else {
      editingSkill.value = null
    }
  }

  async function saveEdit() {
    if (!editingSkill.value) return
    saving.value = true
    try {
      const content = editContent.value
      const escapedPath = editingSkill.value.path.replace(/'/g, "'\\''")
      // write via printf to preserve newlines
      await sh(`printf '%s' '${content.replace(/'/g, "'\\''")}' > "${escapedPath}/SKILL.md"`)
      ctx.ui.notify('已保存', 'info')
      await loadSkills()
      editingSkill.value = null
      editDirty.value = false
    } catch (e: any) {
      ctx.ui.notify('保存失败: ' + e.message, 'error')
    } finally {
      saving.value = false
    }
  }

  async function deleteSkill(skill: Skill) {
    const ok = await ctx.ui.confirm(`确定删除 Skill "${skill.name}"？此操作不可撤销。`)
    if (!ok) return
    deleting.value = skill.id
    try {
      await sh(`rm -rf "${skill.path}"`)
      ctx.ui.notify('已删除', 'info')
      await loadSkills()
    } catch (e: any) {
      ctx.ui.notify('删除失败: ' + e.message, 'error')
    } finally {
      deleting.value = null
    }
  }

  async function createSkill() {
    const name = newName.value.trim()
    if (!name) return
    const dirName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')
    creating.value = true
    try {
      const homeDir = await sh('echo -n $HOME')
      const skillDir = `${homeDir}/.claude/skills/${dirName}`
      const template = `---\nname: ${name}\ndescription: |\n  ${name} skill description.\nallowed-tools:\n  - Read\n  - Bash\n---\n\n# ${name}\n\n在此编写 Skill 的详细指令。\n`
      await sh(`mkdir -p "${skillDir}"`)
      await sh(`printf '%s' '${template.replace(/'/g, "'\\''")}' > "${skillDir}/SKILL.md"`)
      ctx.ui.notify('已创建', 'info')
      newName.value = ''
      showNewForm.value = false
      await loadSkills()
      // open edit for the new skill
      const created = skills.value.find(s => s.id === dirName)
      if (created) openEdit(created)
    } catch (e: any) {
      ctx.ui.notify('创建失败: ' + e.message, 'error')
    } finally {
      creating.value = false
    }
  }

  async function searchSkillsSh(reset = true) {
    const q = searchQuery.value.trim()
    if (q.length < 2) return
    searching.value = true
    if (reset) { searchPage.value = 0; searchResults.value = [] }
    const offset = reset ? 0 : searchPage.value * PAGE_SIZE
    try {
      const url = `https://skills.sh/api/search?q=${encodeURIComponent(q)}&limit=${PAGE_SIZE}&offset=${offset}`
      const res = await ctx.exec.run(['sh', '-c', `curl -sf "${url}"`])
      if (res.code !== 0) throw new Error('网络请求失败')
      const data = JSON.parse(res.stdout)
      const results: SkillsShResult[] = (data.skills || []).map((s: any) => ({
        key: s.key || `${s.directory}:${s.repoOwner}:${s.repoName}`,
        name: s.name,
        directory: s.directory,
        repoOwner: s.repoOwner,
        repoName: s.repoName,
        repoBranch: s.repoBranch || 'main',
        installs: s.installs || 0,
        readmeUrl: s.readmeUrl,
      }))
      searchTotal.value = data.totalCount || results.length
      if (reset) {
        searchResults.value = results
      } else {
        searchResults.value = [...searchResults.value, ...results]
      }
    } catch (e: any) {
      ctx.ui.notify('搜索失败: ' + e.message, 'error')
    } finally {
      searching.value = false
    }
  }

  async function installSkill(skill: SkillsShResult) {
    installing.value = skill.key
    try {
      const homeDir = await sh('echo -n $HOME')
      const skillDir = `${homeDir}/.claude/skills/${skill.directory}`
      // check if already exists
      const exists = await ctx.exec.run(['sh', '-c', `test -d "${skillDir}" && echo yes || echo no`])
      if (exists.stdout.trim() === 'yes') {
        ctx.ui.notify(`"${skill.name}" 已安装`, 'warn')
        return
      }
      const repoUrl = `https://github.com/${skill.repoOwner}/${skill.repoName}`
      const branch = skill.repoBranch || 'main'
      // sparse checkout: only the skill's subdirectory
      const parentDir = `${homeDir}/.claude/skills`
      await sh([
        `cd "${parentDir}"`,
        `git clone --depth 1 --filter=blob:none --sparse -b "${branch}" "${repoUrl}" ".${skill.directory}_tmp"`,
        `cd ".${skill.directory}_tmp"`,
        `git sparse-checkout set "${skill.directory}"`,
        `mv "${skill.directory}" "../${skill.directory}"`,
        `cd ..`,
        `rm -rf ".${skill.directory}_tmp"`,
      ].join(' && '))
      // write meta for future sync
      const meta: SkillMeta = {
        repoOwner: skill.repoOwner,
        repoName: skill.repoName,
        repoBranch: branch,
        directory: skill.directory,
        installedAt: new Date().toISOString(),
      }
      const metaJson = JSON.stringify(meta, null, 2).replace(/'/g, "'\\''")
      await sh(`printf '%s' '${metaJson}' > "${skillDir}/.skill-meta.json"`)
      ctx.ui.notify(`已安装 "${skill.name}"`, 'info')
      await loadSkills()
    } catch (e: any) {
      ctx.ui.notify('安装失败: ' + e.message, 'error')
    } finally {
      installing.value = null
    }
  }

  function isInstalled(skill: SkillsShResult): boolean {
    return skills.value.some(s => s.id === skill.directory)
  }

  async function syncSkill(skill: Skill) {
    if (!skill.meta) return
    syncing.value = skill.id
    try {
      const { repoOwner, repoName, repoBranch, directory } = skill.meta
      const repoUrl = `https://github.com/${repoOwner}/${repoName}`
      const parentDir = skill.path.replace(/\/[^/]+$/, '')
      const tmpDir = `${parentDir}/.${directory}_sync_tmp`
      await sh([
        `rm -rf "${tmpDir}"`,
        `git clone --depth 1 --filter=blob:none --sparse -b "${repoBranch}" "${repoUrl}" "${tmpDir}"`,
        `cd "${tmpDir}"`,
        `git sparse-checkout set "${directory}"`,
        // copy files over, preserve .skill-meta.json
        `rsync -a --exclude='.skill-meta.json' "${tmpDir}/${directory}/" "${skill.path}/"`,
        `rm -rf "${tmpDir}"`,
      ].join(' && '))
      // update installedAt in meta
      const newMeta: SkillMeta = { ...skill.meta, installedAt: new Date().toISOString() }
      const metaJson = JSON.stringify(newMeta, null, 2).replace(/'/g, "'\\''")
      await sh(`printf '%s' '${metaJson}' > "${skill.path}/.skill-meta.json"`)
      ctx.ui.notify(`"${skill.name}" 已同步`, 'info')
      await loadSkills()
    } catch (e: any) {
      ctx.ui.notify('同步失败: ' + e.message, 'error')
    } finally {
      syncing.value = null
    }
  }

  async function syncAllSkills() {
    const syncable = skills.value.filter(s => s.meta)
    if (syncable.length === 0) return
    syncingAll.value = true
    let ok = 0, fail = 0
    for (const skill of syncable) {
      try {
        await syncSkill(skill)
        ok++
      } catch {
        fail++
      }
    }
    syncingAll.value = false
    ctx.ui.notify(`同步完成：${ok} 成功${fail > 0 ? `，${fail} 失败` : ''}`, fail > 0 ? 'warn' : 'info')
  }

  ctx.commands.register('skill-manager.open', () => { tab.value = 'installed' })
  ctx.commands.register('skill-manager.new', () => { tab.value = 'installed'; showNewForm.value = true })

  ctx.onMounted(() => loadSkills())

  // ──────── Render ────────

  function renderEditor() {
    const skill = editingSkill.value!
    return h('div', { class: 'sm-editor' }, [
      h('div', { class: 'sm-editor-header' }, [
        h('div', { class: 'sm-editor-title' }, [
          h('span', { class: 'sm-editor-name' }, skill.name),
          h('span', { class: 'sm-editor-path' }, skill.id),
        ]),
        h('div', { class: 'sm-editor-actions' }, [
          h('button', {
            class: 'sm-btn sm-btn-primary sm-btn-sm',
            disabled: saving.value || !editDirty.value,
            onClick: saveEdit,
          }, saving.value ? '保存中...' : '保存'),
          h('button', {
            class: 'sm-btn sm-btn-ghost sm-btn-sm',
            onClick: closeEdit,
          }, '关闭'),
        ]),
      ]),
      h('textarea', {
        class: 'sm-textarea',
        value: editContent.value,
        spellcheck: false,
        onInput: (e: Event) => {
          editContent.value = (e.target as HTMLTextAreaElement).value
          editDirty.value = true
        },
      }),
    ])
  }

  function renderNewForm() {
    if (!showNewForm.value) return null
    return h('div', { class: 'sm-new-form' }, [
      h('input', {
        class: 'sm-input',
        placeholder: 'Skill 名称，例如: my-workflow',
        value: newName.value,
        autofocus: true,
        onInput: (e: Event) => { newName.value = (e.target as HTMLInputElement).value },
        onKeydown: (e: KeyboardEvent) => {
          if (e.key === 'Enter') createSkill()
          if (e.key === 'Escape') { showNewForm.value = false; newName.value = '' }
        },
      }),
      h('button', {
        class: 'sm-btn sm-btn-primary sm-btn-sm',
        disabled: creating.value || !newName.value.trim(),
        onClick: createSkill,
      }, creating.value ? '创建中...' : '创建'),
      h('button', {
        class: 'sm-btn sm-btn-ghost sm-btn-sm',
        onClick: () => { showNewForm.value = false; newName.value = '' },
      }, '取消'),
    ])
  }

  function renderSkillCard(skill: Skill) {
    const isBusy = deleting.value === skill.id
    const isSyncing = syncing.value === skill.id
    return h('div', { key: skill.id, class: 'sm-card' }, [
      h('div', { class: 'sm-card-info' }, [
        h('div', { class: 'sm-card-header' }, [
          h('span', { class: 'sm-card-name' }, skill.name),
          skill.id !== skill.name
            ? h('span', { class: 'sm-card-dir' }, skill.id)
            : null,
          skill.meta
            ? h('span', { class: 'sm-card-repo' }, `${skill.meta.repoOwner}/${skill.meta.repoName}`)
            : null,
        ].filter(Boolean)),
        skill.description
          ? h('div', { class: 'sm-card-desc' }, skill.description)
          : null,
        skill.allowedTools.length
          ? h('div', { class: 'sm-card-tools' },
              skill.allowedTools.map(t =>
                h('span', { key: t, class: 'sm-tool-tag' }, t)
              )
            )
          : null,
      ].filter(Boolean)),
      h('div', { class: 'sm-card-actions' }, [
        skill.meta
          ? h('button', {
              class: 'sm-btn sm-btn-ghost sm-btn-sm',
              disabled: isSyncing || syncingAll.value,
              onClick: () => syncSkill(skill),
            }, isSyncing ? '同步中...' : '同步')
          : null,
        h('button', {
          class: 'sm-btn sm-btn-ghost sm-btn-sm',
          onClick: () => openEdit(skill),
        }, '编辑'),
        h('button', {
          class: 'sm-btn sm-btn-danger sm-btn-sm',
          disabled: isBusy,
          onClick: () => deleteSkill(skill),
        }, isBusy ? '删除中...' : '删除'),
      ].filter(Boolean)),
    ])
  }

  function renderInstalled() {
    const syncableCount = skills.value.filter(s => s.meta).length
    return h('div', { class: 'sm-installed' }, [
      h('div', { class: 'sm-toolbar' }, [
        h('span', { class: 'sm-count' }, `${skills.value.length} 个 Skills`),
        syncableCount > 0
          ? h('button', {
              class: 'sm-btn sm-btn-ghost sm-btn-sm',
              disabled: syncingAll.value || syncing.value !== null,
              onClick: syncAllSkills,
            }, syncingAll.value ? '同步中...' : `全部同步 (${syncableCount})`)
          : null,
        h('button', {
          class: 'sm-btn sm-btn-primary sm-btn-sm',
          onClick: () => { showNewForm.value = !showNewForm.value },
        }, '+ 新建'),
        h('button', {
          class: 'sm-btn sm-btn-ghost sm-btn-sm',
          onClick: loadSkills,
        }, '刷新'),
      ].filter(Boolean)),
      renderNewForm(),
      loading.value
        ? h('div', { class: 'sm-loading' }, '加载中...')
        : skills.value.length === 0
          ? h('div', { class: 'sm-empty' }, [
              h('div', { class: 'sm-empty-icon' }, '⚡'),
              h('p', null, '还没有安装任何 Skill'),
              h('p', { class: 'sm-empty-hint' }, '点击"新建"创建，或切换到"发现"从 skills.sh 安装'),
            ])
          : h('div', { class: 'sm-list' }, skills.value.map(renderSkillCard)),
    ])
  }

  function renderDiscoverCard(skill: SkillsShResult) {
    const installed = isInstalled(skill)
    const busy = installing.value === skill.key
    return h('div', { key: skill.key, class: 'sm-card' }, [
      h('div', { class: 'sm-card-info' }, [
        h('div', { class: 'sm-card-header' }, [
          h('span', { class: 'sm-card-name' }, skill.name),
          h('span', { class: 'sm-card-dir' }, skill.directory),
          h('span', { class: 'sm-card-repo' }, `${skill.repoOwner}/${skill.repoName}`),
          skill.installs > 0
            ? h('span', { class: 'sm-installs' }, `↓${skill.installs}`)
            : null,
          installed ? h('span', { class: 'sm-badge-installed' }, '已安装') : null,
        ].filter(Boolean)),
      ]),
      h('div', { class: 'sm-card-actions' }, [
        installed
          ? h('button', { class: 'sm-btn sm-btn-ghost sm-btn-sm', disabled: true }, '已安装')
          : h('button', {
              class: 'sm-btn sm-btn-primary sm-btn-sm',
              disabled: busy,
              onClick: () => installSkill(skill),
            }, busy ? '安装中...' : '安装'),
      ]),
    ])
  }

  function renderDiscover() {
    const hasMore = searchResults.value.length < searchTotal.value && searchResults.value.length > 0
    return h('div', { class: 'sm-discover' }, [
      h('div', { class: 'sm-search-bar' }, [
        h('input', {
          class: 'sm-input sm-search-input',
          placeholder: '搜索 skills.sh 公共目录（至少 2 个字符）...',
          value: searchQuery.value,
          onInput: (e: Event) => { searchQuery.value = (e.target as HTMLInputElement).value },
          onKeydown: (e: KeyboardEvent) => {
            if (e.key === 'Enter') searchSkillsSh(true)
          },
        }),
        h('button', {
          class: 'sm-btn sm-btn-primary sm-btn-sm',
          disabled: searching.value || searchQuery.value.trim().length < 2,
          onClick: () => searchSkillsSh(true),
        }, searching.value ? '搜索中...' : '搜索'),
      ]),
      searchResults.value.length === 0 && !searching.value
        ? h('div', { class: 'sm-empty' }, [
            h('div', { class: 'sm-empty-icon' }, '🔍'),
            h('p', null, '输入关键词搜索 skills.sh 上的公共 Skills'),
            h('p', { class: 'sm-empty-hint' }, 'Powered by skills.sh'),
          ])
        : h('div', { class: 'sm-list' }, [
            ...searchResults.value.map(renderDiscoverCard),
            hasMore
              ? h('button', {
                  class: 'sm-btn sm-btn-ghost sm-load-more',
                  disabled: searching.value,
                  onClick: () => { searchPage.value++; searchSkillsSh(false) },
                }, searching.value ? '加载中...' : '加载更多')
              : null,
          ].filter(Boolean)),
    ])
  }

  return {
    component: {
      setup() {
        ctx.onMounted(() => loadSkills())
        return {}
      },
      render() {
        if (editingSkill.value) {
          return h('div', { class: 'skill-manager' }, renderEditor())
        }
        return h('div', { class: 'skill-manager' }, [
          h('div', { class: 'sm-header' }, [
            h('h2', { class: 'sm-title' }, 'Skill Manager'),
            h('div', { class: 'sm-tabs' }, [
              h('button', {
                class: 'sm-tab' + (tab.value === 'installed' ? ' sm-tab-active' : ''),
                onClick: () => { tab.value = 'installed' },
              }, `已安装 (${skills.value.length})`),
              h('button', {
                class: 'sm-tab' + (tab.value === 'discover' ? ' sm-tab-active' : ''),
                onClick: () => { tab.value = 'discover' },
              }, '发现'),
            ]),
          ]),
          tab.value === 'installed' ? renderInstalled() : renderDiscover(),
        ])
      },
    },
  }
}
