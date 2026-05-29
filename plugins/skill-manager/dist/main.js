// src/ui.ts
function activate(ctx) {
  const h = ctx.h;
  const skills = ctx.ref([]);
  const loading = ctx.ref(true);
  const tab = ctx.ref("installed");
  const editingSkill = ctx.ref(null);
  const editContent = ctx.ref("");
  const editDirty = ctx.ref(false);
  const saving = ctx.ref(false);
  const deleting = ctx.ref(null);
  const showNewForm = ctx.ref(false);
  const newName = ctx.ref("");
  const creating = ctx.ref(false);
  const syncing = ctx.ref(null);
  const syncingAll = ctx.ref(false);
  const searchQuery = ctx.ref("");
  const searchResults = ctx.ref([]);
  const searching = ctx.ref(false);
  const searchTotal = ctx.ref(0);
  const searchPage = ctx.ref(0);
  const installing = ctx.ref(null);
  const PAGE_SIZE = 20;
  async function sh(cmd) {
    const res = await ctx.exec.run(["sh", "-c", cmd]);
    if (res.code !== 0) throw new Error(res.stderr || `exit ${res.code}`);
    return res.stdout;
  }
  function parseFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return { name: "", description: "", allowedTools: [] };
    const fm = match[1];
    const nameM = fm.match(/^name:\s*(.+)$/m);
    const name = nameM ? nameM[1].trim() : "";
    const descM = fm.match(/^description:\s*([\s\S]*?)(?=\n\w|\n---$|$)/m);
    let description = "";
    if (descM) {
      description = descM[1].replace(/^\|\s*\n/, "").replace(/\n\s{2,}/g, " ").trim();
    }
    const toolsM = fm.match(/^allowed-tools:\s*\n((?:\s+-\s+.+\n?)*)/m);
    let allowedTools = [];
    if (toolsM) {
      allowedTools = toolsM[1].match(/^\s+-\s+(.+)$/mg)?.map((s) => s.replace(/^\s+-\s+/, "").trim()) || [];
    } else {
      const inlineM = fm.match(/^allowed-tools:\s*\[([^\]]+)\]/m);
      if (inlineM) {
        allowedTools = inlineM[1].split(",").map((s) => s.trim());
      }
    }
    return { name, description, allowedTools };
  }
  async function loadSkills() {
    loading.value = true;
    try {
      const skillsDir = `${await sh("echo -n $HOME")}/.claude/skills`;
      let dirs = [];
      try {
        const out = await sh(`ls -1 "${skillsDir}" 2>/dev/null`);
        dirs = out.split("\n").filter((d) => d.trim());
      } catch {
        dirs = [];
      }
      const loaded = [];
      for (const id of dirs) {
        const skillPath = `${skillsDir}/${id}`;
        const skillMdPath = `${skillPath}/SKILL.md`;
        try {
          const raw = await sh(`cat "${skillMdPath}"`);
          const { name, description, allowedTools } = parseFrontmatter(raw);
          let meta;
          try {
            const metaRaw = await sh(`cat "${skillPath}/.skill-meta.json"`);
            meta = JSON.parse(metaRaw);
          } catch {
          }
          loaded.push({ id, name: name || id, description, allowedTools, path: skillPath, raw, meta });
        } catch {
        }
      }
      skills.value = loaded;
    } catch (e) {
      ctx.ui.notify("\u52A0\u8F7D\u5931\u8D25: " + e.message, "error");
    } finally {
      loading.value = false;
    }
  }
  function openEdit(skill) {
    editingSkill.value = skill;
    editContent.value = skill.raw;
    editDirty.value = false;
  }
  function closeEdit() {
    if (editDirty.value) {
      ctx.ui.confirm("\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539\uFF0C\u786E\u5B9A\u653E\u5F03\uFF1F").then((ok) => {
        if (ok) {
          editingSkill.value = null;
          editDirty.value = false;
        }
      });
    } else {
      editingSkill.value = null;
    }
  }
  async function saveEdit() {
    if (!editingSkill.value) return;
    saving.value = true;
    try {
      const content = editContent.value;
      const escapedPath = editingSkill.value.path.replace(/'/g, "'\\''");
      await sh(`printf '%s' '${content.replace(/'/g, "'\\''")}' > "${escapedPath}/SKILL.md"`);
      ctx.ui.notify("\u5DF2\u4FDD\u5B58", "info");
      await loadSkills();
      editingSkill.value = null;
      editDirty.value = false;
    } catch (e) {
      ctx.ui.notify("\u4FDD\u5B58\u5931\u8D25: " + e.message, "error");
    } finally {
      saving.value = false;
    }
  }
  async function deleteSkill(skill) {
    const ok = await ctx.ui.confirm(`\u786E\u5B9A\u5220\u9664 Skill "${skill.name}"\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002`);
    if (!ok) return;
    deleting.value = skill.id;
    try {
      await sh(`rm -rf "${skill.path}"`);
      ctx.ui.notify("\u5DF2\u5220\u9664", "info");
      await loadSkills();
    } catch (e) {
      ctx.ui.notify("\u5220\u9664\u5931\u8D25: " + e.message, "error");
    } finally {
      deleting.value = null;
    }
  }
  async function createSkill() {
    const name = newName.value.trim();
    if (!name) return;
    const dirName = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
    creating.value = true;
    try {
      const homeDir = await sh("echo -n $HOME");
      const skillDir = `${homeDir}/.claude/skills/${dirName}`;
      const template = `---
name: ${name}
description: |
  ${name} skill description.
allowed-tools:
  - Read
  - Bash
---

# ${name}

\u5728\u6B64\u7F16\u5199 Skill \u7684\u8BE6\u7EC6\u6307\u4EE4\u3002
`;
      await sh(`mkdir -p "${skillDir}"`);
      await sh(`printf '%s' '${template.replace(/'/g, "'\\''")}' > "${skillDir}/SKILL.md"`);
      ctx.ui.notify("\u5DF2\u521B\u5EFA", "info");
      newName.value = "";
      showNewForm.value = false;
      await loadSkills();
      const created = skills.value.find((s) => s.id === dirName);
      if (created) openEdit(created);
    } catch (e) {
      ctx.ui.notify("\u521B\u5EFA\u5931\u8D25: " + e.message, "error");
    } finally {
      creating.value = false;
    }
  }
  async function searchSkillsSh(reset = true) {
    const q = searchQuery.value.trim();
    if (q.length < 2) return;
    searching.value = true;
    if (reset) {
      searchPage.value = 0;
      searchResults.value = [];
    }
    const offset = reset ? 0 : searchPage.value * PAGE_SIZE;
    try {
      const url = `https://skills.sh/api/search?q=${encodeURIComponent(q)}&limit=${PAGE_SIZE}&offset=${offset}`;
      const res = await ctx.exec.run(["sh", "-c", `curl -sf "${url}"`]);
      if (res.code !== 0) throw new Error("\u7F51\u7EDC\u8BF7\u6C42\u5931\u8D25");
      const data = JSON.parse(res.stdout);
      const results = (data.skills || []).map((s) => ({
        key: s.key || `${s.directory}:${s.repoOwner}:${s.repoName}`,
        name: s.name,
        directory: s.directory,
        repoOwner: s.repoOwner,
        repoName: s.repoName,
        repoBranch: s.repoBranch || "main",
        installs: s.installs || 0,
        readmeUrl: s.readmeUrl
      }));
      searchTotal.value = data.totalCount || results.length;
      if (reset) {
        searchResults.value = results;
      } else {
        searchResults.value = [...searchResults.value, ...results];
      }
    } catch (e) {
      ctx.ui.notify("\u641C\u7D22\u5931\u8D25: " + e.message, "error");
    } finally {
      searching.value = false;
    }
  }
  async function installSkill(skill) {
    installing.value = skill.key;
    try {
      const homeDir = await sh("echo -n $HOME");
      const skillDir = `${homeDir}/.claude/skills/${skill.directory}`;
      const exists = await ctx.exec.run(["sh", "-c", `test -d "${skillDir}" && echo yes || echo no`]);
      if (exists.stdout.trim() === "yes") {
        ctx.ui.notify(`"${skill.name}" \u5DF2\u5B89\u88C5`, "warn");
        return;
      }
      const repoUrl = `https://github.com/${skill.repoOwner}/${skill.repoName}`;
      const branch = skill.repoBranch || "main";
      const parentDir = `${homeDir}/.claude/skills`;
      await sh([
        `cd "${parentDir}"`,
        `git clone --depth 1 --filter=blob:none --sparse -b "${branch}" "${repoUrl}" ".${skill.directory}_tmp"`,
        `cd ".${skill.directory}_tmp"`,
        `git sparse-checkout set "${skill.directory}"`,
        `mv "${skill.directory}" "../${skill.directory}"`,
        `cd ..`,
        `rm -rf ".${skill.directory}_tmp"`
      ].join(" && "));
      const meta = {
        repoOwner: skill.repoOwner,
        repoName: skill.repoName,
        repoBranch: branch,
        directory: skill.directory,
        installedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      const metaJson = JSON.stringify(meta, null, 2).replace(/'/g, "'\\''");
      await sh(`printf '%s' '${metaJson}' > "${skillDir}/.skill-meta.json"`);
      ctx.ui.notify(`\u5DF2\u5B89\u88C5 "${skill.name}"`, "info");
      await loadSkills();
    } catch (e) {
      ctx.ui.notify("\u5B89\u88C5\u5931\u8D25: " + e.message, "error");
    } finally {
      installing.value = null;
    }
  }
  function isInstalled(skill) {
    return skills.value.some((s) => s.id === skill.directory);
  }
  async function syncSkill(skill) {
    if (!skill.meta) return;
    syncing.value = skill.id;
    try {
      const { repoOwner, repoName, repoBranch, directory } = skill.meta;
      const repoUrl = `https://github.com/${repoOwner}/${repoName}`;
      const parentDir = skill.path.replace(/\/[^/]+$/, "");
      const tmpDir = `${parentDir}/.${directory}_sync_tmp`;
      await sh([
        `rm -rf "${tmpDir}"`,
        `git clone --depth 1 --filter=blob:none --sparse -b "${repoBranch}" "${repoUrl}" "${tmpDir}"`,
        `cd "${tmpDir}"`,
        `git sparse-checkout set "${directory}"`,
        // copy files over, preserve .skill-meta.json
        `rsync -a --exclude='.skill-meta.json' "${tmpDir}/${directory}/" "${skill.path}/"`,
        `rm -rf "${tmpDir}"`
      ].join(" && "));
      const newMeta = { ...skill.meta, installedAt: (/* @__PURE__ */ new Date()).toISOString() };
      const metaJson = JSON.stringify(newMeta, null, 2).replace(/'/g, "'\\''");
      await sh(`printf '%s' '${metaJson}' > "${skill.path}/.skill-meta.json"`);
      ctx.ui.notify(`"${skill.name}" \u5DF2\u540C\u6B65`, "info");
      await loadSkills();
    } catch (e) {
      ctx.ui.notify("\u540C\u6B65\u5931\u8D25: " + e.message, "error");
    } finally {
      syncing.value = null;
    }
  }
  async function syncAllSkills() {
    const syncable = skills.value.filter((s) => s.meta);
    if (syncable.length === 0) return;
    syncingAll.value = true;
    let ok = 0, fail = 0;
    for (const skill of syncable) {
      try {
        await syncSkill(skill);
        ok++;
      } catch {
        fail++;
      }
    }
    syncingAll.value = false;
    ctx.ui.notify(`\u540C\u6B65\u5B8C\u6210\uFF1A${ok} \u6210\u529F${fail > 0 ? `\uFF0C${fail} \u5931\u8D25` : ""}`, fail > 0 ? "warn" : "info");
  }
  ctx.commands.register("skill-manager.open", () => {
    tab.value = "installed";
  });
  ctx.commands.register("skill-manager.new", () => {
    tab.value = "installed";
    showNewForm.value = true;
  });
  ctx.onMounted(() => loadSkills());
  function renderEditor() {
    const skill = editingSkill.value;
    return h("div", { class: "sm-editor" }, [
      h("div", { class: "sm-editor-header" }, [
        h("div", { class: "sm-editor-title" }, [
          h("span", { class: "sm-editor-name" }, skill.name),
          h("span", { class: "sm-editor-path" }, skill.id)
        ]),
        h("div", { class: "sm-editor-actions" }, [
          h("button", {
            class: "sm-btn sm-btn-primary sm-btn-sm",
            disabled: saving.value || !editDirty.value,
            onClick: saveEdit
          }, saving.value ? "\u4FDD\u5B58\u4E2D..." : "\u4FDD\u5B58"),
          h("button", {
            class: "sm-btn sm-btn-ghost sm-btn-sm",
            onClick: closeEdit
          }, "\u5173\u95ED")
        ])
      ]),
      h("textarea", {
        class: "sm-textarea",
        value: editContent.value,
        spellcheck: false,
        onInput: (e) => {
          editContent.value = e.target.value;
          editDirty.value = true;
        }
      })
    ]);
  }
  function renderNewForm() {
    if (!showNewForm.value) return null;
    return h("div", { class: "sm-new-form" }, [
      h("input", {
        class: "sm-input",
        placeholder: "Skill \u540D\u79F0\uFF0C\u4F8B\u5982: my-workflow",
        value: newName.value,
        autofocus: true,
        onInput: (e) => {
          newName.value = e.target.value;
        },
        onKeydown: (e) => {
          if (e.key === "Enter") createSkill();
          if (e.key === "Escape") {
            showNewForm.value = false;
            newName.value = "";
          }
        }
      }),
      h("button", {
        class: "sm-btn sm-btn-primary sm-btn-sm",
        disabled: creating.value || !newName.value.trim(),
        onClick: createSkill
      }, creating.value ? "\u521B\u5EFA\u4E2D..." : "\u521B\u5EFA"),
      h("button", {
        class: "sm-btn sm-btn-ghost sm-btn-sm",
        onClick: () => {
          showNewForm.value = false;
          newName.value = "";
        }
      }, "\u53D6\u6D88")
    ]);
  }
  function renderSkillCard(skill) {
    const isBusy = deleting.value === skill.id;
    const isSyncing = syncing.value === skill.id;
    return h("div", { key: skill.id, class: "sm-card" }, [
      h("div", { class: "sm-card-info" }, [
        h("div", { class: "sm-card-header" }, [
          h("span", { class: "sm-card-name" }, skill.name),
          skill.id !== skill.name ? h("span", { class: "sm-card-dir" }, skill.id) : null,
          skill.meta ? h("span", { class: "sm-card-repo" }, `${skill.meta.repoOwner}/${skill.meta.repoName}`) : null
        ].filter(Boolean)),
        skill.description ? h("div", { class: "sm-card-desc" }, skill.description) : null,
        skill.allowedTools.length ? h(
          "div",
          { class: "sm-card-tools" },
          skill.allowedTools.map(
            (t) => h("span", { key: t, class: "sm-tool-tag" }, t)
          )
        ) : null
      ].filter(Boolean)),
      h("div", { class: "sm-card-actions" }, [
        skill.meta ? h("button", {
          class: "sm-btn sm-btn-ghost sm-btn-sm",
          disabled: isSyncing || syncingAll.value,
          onClick: () => syncSkill(skill)
        }, isSyncing ? "\u540C\u6B65\u4E2D..." : "\u540C\u6B65") : null,
        h("button", {
          class: "sm-btn sm-btn-ghost sm-btn-sm",
          onClick: () => openEdit(skill)
        }, "\u7F16\u8F91"),
        h("button", {
          class: "sm-btn sm-btn-danger sm-btn-sm",
          disabled: isBusy,
          onClick: () => deleteSkill(skill)
        }, isBusy ? "\u5220\u9664\u4E2D..." : "\u5220\u9664")
      ].filter(Boolean))
    ]);
  }
  function renderInstalled() {
    const syncableCount = skills.value.filter((s) => s.meta).length;
    return h("div", { class: "sm-installed" }, [
      h("div", { class: "sm-toolbar" }, [
        h("span", { class: "sm-count" }, `${skills.value.length} \u4E2A Skills`),
        syncableCount > 0 ? h("button", {
          class: "sm-btn sm-btn-ghost sm-btn-sm",
          disabled: syncingAll.value || syncing.value !== null,
          onClick: syncAllSkills
        }, syncingAll.value ? "\u540C\u6B65\u4E2D..." : `\u5168\u90E8\u540C\u6B65 (${syncableCount})`) : null,
        h("button", {
          class: "sm-btn sm-btn-primary sm-btn-sm",
          onClick: () => {
            showNewForm.value = !showNewForm.value;
          }
        }, "+ \u65B0\u5EFA"),
        h("button", {
          class: "sm-btn sm-btn-ghost sm-btn-sm",
          onClick: loadSkills
        }, "\u5237\u65B0")
      ].filter(Boolean)),
      renderNewForm(),
      loading.value ? h("div", { class: "sm-loading" }, "\u52A0\u8F7D\u4E2D...") : skills.value.length === 0 ? h("div", { class: "sm-empty" }, [
        h("div", { class: "sm-empty-icon" }, "\u26A1"),
        h("p", null, "\u8FD8\u6CA1\u6709\u5B89\u88C5\u4EFB\u4F55 Skill"),
        h("p", { class: "sm-empty-hint" }, '\u70B9\u51FB"\u65B0\u5EFA"\u521B\u5EFA\uFF0C\u6216\u5207\u6362\u5230"\u53D1\u73B0"\u4ECE skills.sh \u5B89\u88C5')
      ]) : h("div", { class: "sm-list" }, skills.value.map(renderSkillCard))
    ]);
  }
  function renderDiscoverCard(skill) {
    const installed = isInstalled(skill);
    const busy = installing.value === skill.key;
    return h("div", { key: skill.key, class: "sm-card" }, [
      h("div", { class: "sm-card-info" }, [
        h("div", { class: "sm-card-header" }, [
          h("span", { class: "sm-card-name" }, skill.name),
          h("span", { class: "sm-card-dir" }, skill.directory),
          h("span", { class: "sm-card-repo" }, `${skill.repoOwner}/${skill.repoName}`),
          skill.installs > 0 ? h("span", { class: "sm-installs" }, `\u2193${skill.installs}`) : null,
          installed ? h("span", { class: "sm-badge-installed" }, "\u5DF2\u5B89\u88C5") : null
        ].filter(Boolean))
      ]),
      h("div", { class: "sm-card-actions" }, [
        installed ? h("button", { class: "sm-btn sm-btn-ghost sm-btn-sm", disabled: true }, "\u5DF2\u5B89\u88C5") : h("button", {
          class: "sm-btn sm-btn-primary sm-btn-sm",
          disabled: busy,
          onClick: () => installSkill(skill)
        }, busy ? "\u5B89\u88C5\u4E2D..." : "\u5B89\u88C5")
      ])
    ]);
  }
  function renderDiscover() {
    const hasMore = searchResults.value.length < searchTotal.value && searchResults.value.length > 0;
    return h("div", { class: "sm-discover" }, [
      h("div", { class: "sm-search-bar" }, [
        h("input", {
          class: "sm-input sm-search-input",
          placeholder: "\u641C\u7D22 skills.sh \u516C\u5171\u76EE\u5F55\uFF08\u81F3\u5C11 2 \u4E2A\u5B57\u7B26\uFF09...",
          value: searchQuery.value,
          onInput: (e) => {
            searchQuery.value = e.target.value;
          },
          onKeydown: (e) => {
            if (e.key === "Enter") searchSkillsSh(true);
          }
        }),
        h("button", {
          class: "sm-btn sm-btn-primary sm-btn-sm",
          disabled: searching.value || searchQuery.value.trim().length < 2,
          onClick: () => searchSkillsSh(true)
        }, searching.value ? "\u641C\u7D22\u4E2D..." : "\u641C\u7D22")
      ]),
      searchResults.value.length === 0 && !searching.value ? h("div", { class: "sm-empty" }, [
        h("div", { class: "sm-empty-icon" }, "\u{1F50D}"),
        h("p", null, "\u8F93\u5165\u5173\u952E\u8BCD\u641C\u7D22 skills.sh \u4E0A\u7684\u516C\u5171 Skills"),
        h("p", { class: "sm-empty-hint" }, "Powered by skills.sh")
      ]) : h("div", { class: "sm-list" }, [
        ...searchResults.value.map(renderDiscoverCard),
        hasMore ? h("button", {
          class: "sm-btn sm-btn-ghost sm-load-more",
          disabled: searching.value,
          onClick: () => {
            searchPage.value++;
            searchSkillsSh(false);
          }
        }, searching.value ? "\u52A0\u8F7D\u4E2D..." : "\u52A0\u8F7D\u66F4\u591A") : null
      ].filter(Boolean))
    ]);
  }
  return {
    component: {
      setup() {
        ctx.onMounted(() => loadSkills());
        return {};
      },
      render() {
        if (editingSkill.value) {
          return h("div", { class: "skill-manager" }, renderEditor());
        }
        return h("div", { class: "skill-manager" }, [
          h("div", { class: "sm-header" }, [
            h("h2", { class: "sm-title" }, "Skill Manager"),
            h("div", { class: "sm-tabs" }, [
              h("button", {
                class: "sm-tab" + (tab.value === "installed" ? " sm-tab-active" : ""),
                onClick: () => {
                  tab.value = "installed";
                }
              }, `\u5DF2\u5B89\u88C5 (${skills.value.length})`),
              h("button", {
                class: "sm-tab" + (tab.value === "discover" ? " sm-tab-active" : ""),
                onClick: () => {
                  tab.value = "discover";
                }
              }, "\u53D1\u73B0")
            ])
          ]),
          tab.value === "installed" ? renderInstalled() : renderDiscover()
        ]);
      }
    }
  };
}
export {
  activate
};
