function activate(ctx) {
  const providers = ctx.ref([]);
  const currentEnv = ctx.ref({});
  const loading = ctx.ref(true);
  const showForm = ctx.ref(false);
  const editId = ctx.ref(null);
  const switching = ctx.ref(null);
  const stats = ctx.ref({});
  const latencies = ctx.ref({});
  const testingLatency = ctx.ref(false);
  const showStats = ctx.ref(false);
  const tokenStats = ctx.ref({ by_provider: {}, daily: {}, request_log: [] });
  const loadingTokenStats = ctx.ref(false);
  const showRequestLog = ctx.ref(false);
  const formName = ctx.ref("");
  const formUrl = ctx.ref("");
  const formToken = ctx.ref("");
  const formModel = ctx.ref("");
  const formHaiku = ctx.ref("");
  const formSonnet = ctx.ref("");
  const formOpus = ctx.ref("");
  async function run(args) {
    const res = await ctx.exec.run(args);
    if (res.code !== 0) throw new Error(res.stderr || `exit code ${res.code}`);
    return JSON.parse(res.stdout);
  }
  async function loadProviders() {
    const data = await run(["list"]);
    providers.value = data.providers || [];
  }
  async function loadCurrent() {
    try {
      currentEnv.value = await run(["current"]);
    } catch {
      currentEnv.value = {};
    }
  }
  async function loadStats() {
    try {
      stats.value = await run(["stats"]);
    } catch {
      stats.value = {};
    }
  }
  async function loadTokenStats() {
    loadingTokenStats.value = true;
    try {
      tokenStats.value = await run(["token_stats", "7"]);
    } catch {
      tokenStats.value = { by_provider: {}, daily: {}, request_log: [] };
    } finally {
      loadingTokenStats.value = false;
    }
  }
  async function refresh() {
    loading.value = true;
    try {
      await Promise.all([loadProviders(), loadCurrent(), loadStats(), loadTokenStats()]);
    } catch (e) {
      ctx.ui.notify("\u52A0\u8F7D\u5931\u8D25: " + e.message, "error");
    } finally {
      loading.value = false;
    }
  }
  function resetForm() {
    formName.value = "";
    formUrl.value = "";
    formToken.value = "";
    formModel.value = "";
    formHaiku.value = "";
    formSonnet.value = "";
    formOpus.value = "";
    editId.value = null;
    showForm.value = false;
  }
  function openAddForm() {
    resetForm();
    showForm.value = true;
  }
  function openEditForm(p) {
    editId.value = p.id;
    formName.value = p.name;
    formUrl.value = p.base_url;
    formToken.value = p.auth_token;
    formModel.value = p.model;
    formHaiku.value = p.haiku_model || "";
    formSonnet.value = p.sonnet_model || "";
    formOpus.value = p.opus_model || "";
    showForm.value = true;
  }
  async function saveForm() {
    const payload = JSON.stringify({
      name: formName.value,
      base_url: formUrl.value,
      auth_token: formToken.value,
      model: formModel.value,
      haiku_model: formHaiku.value,
      sonnet_model: formSonnet.value,
      opus_model: formOpus.value
    });
    try {
      if (editId.value) {
        await run(["update", editId.value, payload]);
        ctx.ui.notify("\u5DF2\u66F4\u65B0", "info");
      } else {
        await run(["add", payload]);
        ctx.ui.notify("\u5DF2\u6DFB\u52A0", "info");
      }
      resetForm();
      await loadProviders();
    } catch (e) {
      ctx.ui.notify("\u4FDD\u5B58\u5931\u8D25: " + e.message, "error");
    }
  }
  async function switchProvider(id) {
    switching.value = id;
    try {
      await run(["switch", id]);
      ctx.ui.notify("\u5DF2\u5207\u6362", "info");
      await Promise.all([loadCurrent(), loadStats()]);
    } catch (e) {
      ctx.ui.notify("\u5207\u6362\u5931\u8D25: " + e.message, "error");
    } finally {
      switching.value = null;
    }
  }
  async function deleteProvider(id) {
    const ok = await ctx.ui.confirm("\u786E\u5B9A\u5220\u9664\u6B64 Provider\uFF1F");
    if (!ok) return;
    try {
      await run(["delete", id]);
      ctx.ui.notify("\u5DF2\u5220\u9664", "info");
      await loadProviders();
    } catch (e) {
      ctx.ui.notify("\u5220\u9664\u5931\u8D25: " + e.message, "error");
    }
  }
  async function importCurrent() {
    const alreadyTracked = providers.value.find((p) => isCurrent(p));
    if (alreadyTracked) {
      ctx.ui.notify("\u914D\u7F6E\u5DF2\u5B58\u5728: " + alreadyTracked.name + "\uFF0C\u65E0\u9700\u91CD\u590D\u5BFC\u5165", "warn");
      return;
    }
    try {
      await run(["import"]);
      ctx.ui.notify("\u5DF2\u5BFC\u5165\u5F53\u524D\u914D\u7F6E", "info");
      await loadProviders();
    } catch (e) {
      if (e.message.includes("duplicate")) {
        const nameMatch = e.message.match(/"existing_name"\s*:\s*"([^"]+)"/);
        const aliasMatch = e.message.match(/"existing"\s*:\s*"([^"]+)"/);
        const existingName = nameMatch ? nameMatch[1] : aliasMatch ? aliasMatch[1] : "\u672A\u77E5";
        ctx.ui.notify("\u914D\u7F6E\u5DF2\u5B58\u5728: " + existingName + "\uFF0C\u65E0\u9700\u91CD\u590D\u5BFC\u5165", "warn");
      } else {
        ctx.ui.notify("\u5BFC\u5165\u5931\u8D25: " + e.message, "error");
      }
    }
  }
  async function switchNext() {
    try {
      await run(["next"]);
      ctx.ui.notify("\u5DF2\u5207\u6362", "info");
      await Promise.all([loadCurrent(), loadStats()]);
    } catch (e) {
      ctx.ui.notify("\u5207\u6362\u5931\u8D25: " + e.message, "error");
    }
  }
  async function runSpeedtest() {
    testingLatency.value = true;
    try {
      const data = await run(["speedtest"]);
      const results = data.results || [];
      const map = {};
      for (const r of results) {
        map[r.alias] = r;
      }
      latencies.value = map;
    } catch (e) {
      ctx.ui.notify("\u6D4B\u901F\u5931\u8D25: " + e.message, "error");
    } finally {
      testingLatency.value = false;
    }
  }
  async function resetStats(id) {
    const label = id ? "\u6B64 Provider \u7684\u7EDF\u8BA1" : "\u6240\u6709\u7EDF\u8BA1";
    const ok = await ctx.ui.confirm(`\u786E\u5B9A\u91CD\u7F6E${label}\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002`);
    if (!ok) return;
    try {
      const args = id ? ["stats_reset", id] : ["stats_reset"];
      await run(args);
      ctx.ui.notify("\u7EDF\u8BA1\u5DF2\u91CD\u7F6E", "info");
      await loadStats();
    } catch (e) {
      ctx.ui.notify("\u91CD\u7F6E\u5931\u8D25: " + e.message, "error");
    }
  }
  function getLast7Days() {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = /* @__PURE__ */ new Date();
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }
    return days;
  }
  function getDailyTotals() {
    const totals = {};
    for (const stat of Object.values(stats.value)) {
      if (stat.daily) {
        for (const [date, count] of Object.entries(stat.daily)) {
          totals[date] = (totals[date] || 0) + count;
        }
      }
    }
    return totals;
  }
  function isCurrent(p) {
    return currentEnv.value.ANTHROPIC_BASE_URL === p.base_url && (currentEnv.value.ANTHROPIC_API_KEY === p.auth_token || currentEnv.value.ANTHROPIC_AUTH_TOKEN === p.auth_token);
  }
  function maskToken(token) {
    if (!token) return "";
    if (token.length <= 8) return "***";
    return token.slice(0, 4) + "..." + token.slice(-4);
  }
  function formatTokens(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return String(n);
  }
  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const now = /* @__PURE__ */ new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 6e4);
    const diffHour = Math.floor(diffMs / 36e5);
    const diffDay = Math.floor(diffMs / 864e5);
    if (diffMin < 1) return "\u521A\u521A";
    if (diffMin < 60) return diffMin + "\u5206\u949F\u524D";
    if (diffHour < 24) return diffHour + "\u5C0F\u65F6\u524D";
    if (diffDay < 30) return diffDay + "\u5929\u524D";
    return d.toLocaleDateString("zh-CN");
  }
  ctx.commands.register("cc-switch.open", () => {
  });
  ctx.commands.register("cc-switch.next", switchNext);
  ctx.onMounted(() => refresh());
  const h = ctx.h;
  function renderForm() {
    if (!showForm.value) return null;
    return h("div", { class: "cs-form" }, [
      h("h3", { class: "cs-form-title" }, editId.value ? "\u7F16\u8F91 Provider" : "\u6DFB\u52A0 Provider"),
      h("div", { class: "cs-form-grid" }, [
        renderInput("\u540D\u79F0", formName, "\u4F8B\u5982: PackyCode"),
        renderInput("API Base URL", formUrl, "https://api.example.com"),
        renderInput("API Key", formToken, "sk-xxx", "password"),
        renderInput("\u4E3B\u6A21\u578B", formModel, "claude-sonnet-4-20250514"),
        renderInput("Haiku \u6A21\u578B", formHaiku, "claude-haiku-4-20250514"),
        renderInput("Sonnet \u6A21\u578B", formSonnet, "claude-sonnet-4-20250514"),
        renderInput("Opus \u6A21\u578B", formOpus, "claude-sonnet-4-20250514")
      ]),
      h("div", { class: "cs-form-actions" }, [
        h("button", {
          class: "cs-btn cs-btn-primary",
          onClick: saveForm
        }, editId.value ? "\u4FDD\u5B58" : "\u6DFB\u52A0"),
        h("button", {
          class: "cs-btn cs-btn-ghost",
          onClick: resetForm
        }, "\u53D6\u6D88")
      ])
    ]);
  }
  function renderInput(label, model, placeholder, type = "text") {
    return h("label", { class: "cs-field" }, [
      h("span", { class: "cs-label" }, label),
      h("input", {
        class: "cs-input",
        type,
        value: model.value,
        placeholder,
        onInput: (e) => {
          model.value = e.target.value;
        }
      })
    ]);
  }
  function renderStatBadge(p) {
    const s = stats.value[p.id];
    if (!s || s.switchCount === 0) return null;
    return h("div", { class: "cs-stat-badge" }, [
      h("span", { class: "cs-stat-count" }, s.switchCount + "\u6B21"),
      s.lastUsed ? h("span", { class: "cs-stat-time" }, formatDate(s.lastUsed)) : null
    ].filter(Boolean));
  }
  function renderLatency(p) {
    const l = latencies.value[p.id];
    if (!l) return null;
    let statusClass = "cs-latency-ok";
    let statusText = "";
    if (l.latency !== null) {
      statusText = l.latency + "ms";
      if (l.latency > 2e3) statusClass = "cs-latency-slow";
      else if (l.latency > 800) statusClass = "cs-latency-mid";
    } else {
      statusClass = "cs-latency-err";
      statusText = l.status === "auth_error" ? "\u8BA4\u8BC1\u5931\u8D25" : "\u4E0D\u53EF\u8FBE";
    }
    return h("span", { class: "cs-latency " + statusClass }, statusText);
  }
  function renderCard(p) {
    const active = isCurrent(p);
    const busy = switching.value === p.id;
    return h("div", {
      key: p.id,
      class: "cs-card" + (active ? " cs-card-active" : "")
    }, [
      // Left: info
      h("div", { class: "cs-card-info" }, [
        h("div", { class: "cs-card-header" }, [
          h("span", { class: "cs-card-name" }, p.name),
          active ? h("span", { class: "cs-badge cs-badge-active" }, "\u4F7F\u7528\u4E2D") : null,
          renderLatency(p)
        ].filter(Boolean)),
        p.base_url ? h("div", { class: "cs-card-url" }, p.base_url) : null,
        h("div", { class: "cs-card-models" }, [
          p.model ? h("span", { class: "cs-model-tag" }, p.model) : null,
          p.haiku_model && p.haiku_model !== p.model ? h("span", { class: "cs-model-tag cs-model-tag-haiku" }, "Haiku: " + p.haiku_model) : null
        ].filter(Boolean)),
        p.auth_token ? h("div", { class: "cs-card-token" }, "Key: " + maskToken(p.auth_token)) : null,
        renderStatBadge(p)
      ].filter(Boolean)),
      // Right: actions
      h("div", { class: "cs-card-actions" }, [
        active ? h("button", { class: "cs-btn cs-btn-sm cs-btn-active", disabled: true }, "\u4F7F\u7528\u4E2D") : h("button", {
          class: "cs-btn cs-btn-sm cs-btn-primary",
          disabled: busy,
          onClick: () => switchProvider(p.id)
        }, busy ? "\u5207\u6362\u4E2D..." : "\u542F\u7528"),
        h("button", {
          class: "cs-btn cs-btn-sm cs-btn-ghost",
          title: "\u7F16\u8F91",
          onClick: () => openEditForm(p)
        }, "\u7F16\u8F91"),
        h("button", {
          class: "cs-btn cs-btn-sm cs-btn-danger",
          title: "\u5220\u9664",
          onClick: () => deleteProvider(p.id)
        }, "\u5220\u9664")
      ])
    ]);
  }
  function renderDailyChart() {
    const days = getLast7Days();
    const tokenDaily = tokenStats.value.daily;
    const switchDaily = getDailyTotals();
    const hasTokenData = Object.keys(tokenDaily).length > 0;
    const maxIn = Math.max(...days.map((d) => tokenDaily[d]?.input || 0), 1);
    const maxOut = Math.max(...days.map((d) => tokenDaily[d]?.output || 0), 1);
    const maxSwitch = Math.max(...days.map((d) => switchDaily[d] || 0), 1);
    const dayLabels = ["\u65E5", "\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D"];
    return h("div", { class: "cs-daily-chart" }, [
      hasTokenData ? h("div", { class: "cs-chart-legend" }, [
        h("span", { class: "cs-legend-in" }, "\u8F93\u5165"),
        h("span", { class: "cs-legend-out" }, "\u8F93\u51FA")
      ]) : null,
      h(
        "div",
        { class: "cs-daily-bars" },
        days.map((d, i) => {
          const isToday = i === 6;
          const date = /* @__PURE__ */ new Date(d + "T00:00:00");
          const dow = dayLabels[date.getDay()];
          let label = "";
          let inPct = 0, outPct = 0;
          if (hasTokenData) {
            const inp = tokenDaily[d]?.input || 0;
            const out = tokenDaily[d]?.output || 0;
            const total = inp + out;
            if (total > 0) label = formatTokens(total);
            inPct = Math.max(inp / maxIn * 100, inp > 0 ? 4 : 1);
            outPct = Math.max(out / maxOut * 100, out > 0 ? 4 : 1);
          } else {
            const val = switchDaily[d] || 0;
            if (val > 0) label = String(val);
            inPct = Math.max(val / maxSwitch * 100, val > 0 ? 8 : 2);
          }
          return h("div", { key: d, class: "cs-daily-col" + (isToday ? " cs-daily-today" : "") }, [
            label ? h("span", { class: "cs-daily-count" }, label) : null,
            h("div", { class: "cs-daily-bar-wrap" }, [
              h("div", {
                class: "cs-daily-bar" + (isToday ? " cs-daily-bar-today" : ""),
                style: { height: inPct + "%" }
              }),
              hasTokenData ? h("div", {
                class: "cs-daily-bar-output" + (isToday ? " cs-daily-bar-today" : ""),
                style: { height: outPct + "%" }
              }) : null
            ].filter(Boolean)),
            h("span", { class: "cs-daily-label" }, dow)
          ]);
        })
      )
    ]);
  }
  function renderTokenSummary() {
    const bp = tokenStats.value.by_provider;
    const totalIn = Object.values(bp).reduce((s, v) => s + v.input, 0);
    const totalOut = Object.values(bp).reduce((s, v) => s + v.output, 0);
    const totalCache = Object.values(bp).reduce((s, v) => s + v.cache, 0);
    const totalReq = Object.values(bp).reduce((s, v) => s + v.requests, 0);
    if (totalIn === 0 && totalOut === 0) return null;
    return h("div", { class: "cs-token-summary" }, [
      h("div", { class: "cs-token-card" }, [
        h("div", { class: "cs-token-value" }, formatTokens(totalIn)),
        h("div", { class: "cs-token-label" }, "\u8F93\u5165 Tokens")
      ]),
      h("div", { class: "cs-token-card" }, [
        h("div", { class: "cs-token-value cs-token-out" }, formatTokens(totalOut)),
        h("div", { class: "cs-token-label" }, "\u8F93\u51FA Tokens")
      ]),
      totalCache > 0 ? h("div", { class: "cs-token-card" }, [
        h("div", { class: "cs-token-value cs-token-cache" }, formatTokens(totalCache)),
        h("div", { class: "cs-token-label" }, "\u7F13\u5B58 Tokens")
      ]) : null,
      h("div", { class: "cs-token-card" }, [
        h("div", { class: "cs-token-value cs-token-req" }, String(totalReq)),
        h("div", { class: "cs-token-label" }, "\u8BF7\u6C42\u6570\uFF087\u5929\uFF09")
      ])
    ].filter(Boolean));
  }
  function renderRequestLog() {
    const log = tokenStats.value.request_log;
    if (log.length === 0) return null;
    return h("div", { class: "cs-req-section" }, [
      h("div", {
        class: "cs-req-toggle",
        onClick: () => {
          showRequestLog.value = !showRequestLog.value;
        }
      }, [
        h("span", null, "\u8BF7\u6C42\u65E5\u5FD7"),
        h("span", { class: "cs-req-count" }, log.length + " \u6761"),
        h("span", { class: "cs-req-arrow" }, showRequestLog.value ? "\u25B2" : "\u25BC")
      ]),
      showRequestLog.value ? h("div", { class: "cs-req-log" }, [
        h("div", { class: "cs-req-header" }, [
          h("span", { class: "cs-req-col cs-req-col-time" }, "\u65F6\u95F4"),
          h("span", { class: "cs-req-col cs-req-col-alias" }, "Provider"),
          h("span", { class: "cs-req-col cs-req-col-proj" }, "\u9879\u76EE"),
          h("span", { class: "cs-req-col cs-req-col-tokens" }, "In / Out")
        ]),
        ...log.map((entry, i) => {
          const provider = providers.value.find((p) => p.id === entry.alias);
          const name = provider ? provider.name : entry.alias || "\u672A\u77E5";
          return h("div", { key: i, class: "cs-req-row" }, [
            h("span", { class: "cs-req-col cs-req-col-time" }, formatDate(entry.ts)),
            h("span", { class: "cs-req-col cs-req-col-alias", title: entry.alias }, name),
            h("span", { class: "cs-req-col cs-req-col-proj", title: entry.project }, entry.project),
            h(
              "span",
              { class: "cs-req-col cs-req-col-tokens" },
              formatTokens(entry.input) + " / " + formatTokens(entry.output)
            )
          ]);
        })
      ]) : null
    ]);
  }
  function renderStatsSummary() {
    const entries = Object.entries(stats.value);
    if (entries.length === 0) return null;
    const sorted = entries.sort((a, b) => b[1].switchCount - a[1].switchCount);
    const totalSwitches = sorted.reduce((sum, [, s]) => sum + s.switchCount, 0);
    const dailyTotals = getDailyTotals();
    const todayKey = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const todayCount = dailyTotals[todayKey] || 0;
    return h("div", { class: "cs-stats-summary" }, [
      h("div", { class: "cs-stats-header" }, [
        h("div", { class: "cs-stats-title-group" }, [
          h("span", { class: "cs-stats-title" }, "\u4F7F\u7528\u7EDF\u8BA1"),
          h(
            "span",
            { class: "cs-stats-subtitle" },
            "\u5171\u5207\u6362 " + totalSwitches + " \u6B21" + (todayCount > 0 ? " \xB7 \u4ECA\u65E5 " + todayCount + " \u6B21" : "")
          )
        ]),
        h("div", { class: "cs-stats-actions" }, [
          h("button", {
            class: "cs-btn cs-btn-sm cs-btn-ghost",
            onClick: runSpeedtest,
            disabled: testingLatency.value
          }, testingLatency.value ? "\u6D4B\u901F\u4E2D..." : "\u6D4B\u901F"),
          h("button", {
            class: "cs-btn cs-btn-sm cs-btn-ghost cs-btn-danger-ghost",
            onClick: () => resetStats(),
            title: "\u91CD\u7F6E\u6240\u6709\u7EDF\u8BA1"
          }, "\u91CD\u7F6E"),
          h("button", {
            class: "cs-btn cs-btn-sm cs-btn-ghost",
            onClick: () => {
              showStats.value = false;
            }
          }, "\u6536\u8D77")
        ])
      ]),
      renderTokenSummary(),
      renderDailyChart(),
      h(
        "div",
        { class: "cs-stats-list" },
        sorted.map(([id, s]) => {
          const provider = providers.value.find((p) => p.id === id);
          const name = provider ? provider.name : id;
          const pct = totalSwitches > 0 ? Math.round(s.switchCount / totalSwitches * 100) : 0;
          const tStat = tokenStats.value.by_provider[id];
          return h("div", { key: id, class: "cs-stats-row" }, [
            h("span", { class: "cs-stats-name", title: name }, name),
            h("div", { class: "cs-stats-bar-wrap" }, [
              h("div", {
                class: "cs-stats-bar",
                style: { width: Math.max(pct, 2) + "%" }
              })
            ]),
            h("span", { class: "cs-stats-count" }, s.switchCount + "\u6B21"),
            tStat ? h(
              "span",
              { class: "cs-stats-token" },
              formatTokens(tStat.input) + " / " + formatTokens(tStat.output)
            ) : h("span", { class: "cs-stats-token" }),
            s.firstUsed ? h("span", { class: "cs-stats-first" }, "\u9996\u6B21 " + formatDate(s.firstUsed)) : h("span", { class: "cs-stats-first" }),
            s.lastUsed ? h("span", { class: "cs-stats-last" }, formatDate(s.lastUsed)) : null
          ].filter(Boolean));
        })
      ),
      renderRequestLog()
    ]);
  }
  return {
    component: {
      setup() {
        ctx.onMounted(() => refresh());
        return {};
      },
      render() {
        return h("div", { class: "cc-switch" }, [
          // Header
          h("div", { class: "cs-header" }, [
            h("h2", { class: "cs-title" }, "CC Switch"),
            h("div", { class: "cs-header-actions" }, [
              h("button", {
                class: "cs-btn cs-btn-sm cs-btn-ghost",
                onClick: importCurrent,
                title: "\u4ECE\u5F53\u524D\u914D\u7F6E\u5BFC\u5165"
              }, "\u5BFC\u5165\u5F53\u524D"),
              h("button", {
                class: "cs-btn cs-btn-sm cs-btn-ghost",
                onClick: switchNext,
                title: "\u5207\u6362\u5230\u4E0B\u4E00\u4E2A"
              }, "\u5207\u6362\u4E0B\u4E00\u4E2A"),
              h("button", {
                class: "cs-btn cs-btn-sm cs-btn-ghost",
                onClick: () => {
                  showStats.value = !showStats.value;
                },
                title: "\u4F7F\u7528\u7EDF\u8BA1"
              }, showStats.value ? "\u7EDF\u8BA1 \u25B2" : "\u7EDF\u8BA1 \u25BC"),
              h("button", {
                class: "cs-btn cs-btn-sm cs-btn-primary",
                onClick: openAddForm
              }, "+ \u6DFB\u52A0")
            ])
          ]),
          // Current env display
          currentEnv.value.ANTHROPIC_BASE_URL ? h("div", { class: "cs-current-env" }, [
            h("div", { class: "cs-current-label" }, "\u5F53\u524D\u914D\u7F6E"),
            h("div", { class: "cs-current-info" }, [
              h("span", null, currentEnv.value.ANTHROPIC_BASE_URL),
              currentEnv.value.ANTHROPIC_MODEL ? h("span", { class: "cs-model-tag" }, currentEnv.value.ANTHROPIC_MODEL) : null
            ].filter(Boolean))
          ]) : null,
          // Stats summary
          showStats.value ? renderStatsSummary() : null,
          // Form
          renderForm(),
          // Provider list
          loading.value ? h("div", { class: "cs-loading" }, "\u52A0\u8F7D\u4E2D...") : providers.value.length === 0 ? h("div", { class: "cs-empty" }, [
            h("div", { class: "cs-empty-icon" }, "\u2699"),
            h("p", null, "\u8FD8\u6CA1\u6709\u914D\u7F6E\u4EFB\u4F55 Provider"),
            h("p", { class: "cs-empty-hint" }, '\u70B9\u51FB"\u6DFB\u52A0"\u6216"\u5BFC\u5165\u5F53\u524D"\u5F00\u59CB\u4F7F\u7528')
          ]) : h("div", { class: "cs-list" }, providers.value.map(renderCard))
        ]);
      }
    }
  };
}
export {
  activate
};
