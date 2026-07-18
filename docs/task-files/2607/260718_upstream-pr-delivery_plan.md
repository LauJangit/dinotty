
## §6d — Follow-up session round 2 (2026-07-18, post-compact)

**Upstream reality (verified via gh):** #163/164/165/166/167/169 all MERGED overnight. Only **#168 (Supervise Tabs) remains OPEN** (CONFLICTING — #166 prereq merged). I#1/I#2 (in merged #169) → must ship as a NEW follow-up PR.

**#168 rebase (scratch/svt-rebase):** rebased 8 supervise commits onto upstream/dev@c73c57ed. ONE App.vue conflict — UNION graft of `const { supervise } = useSuperviseTabs()` beside dev's presentationSettings/clearToastInstance/clearActiveReadContext. range-diff: 6/8 commits `=`, only App.vue(graft) + AppPaneClose.test.ts(auto-merge) `!`. Net diff frontend-only, 11 files. CI GREEN: vue-tsc 0, build OK, 605/605 vitest.

**H/I fix round:**
- H#2 (App.vue closeTab ~1091): added `nextRevealNavGen()` before close-reselect. DONE, committed.
- H#3 (App.vue onGlobalKeydown ~1713): AltGr exclusion `!(altAsCmd && ...)` → `!(isWindowsClient && e.ctrlKey && e.altKey)`. DONE, committed. **codex r3 CONFIRMED correct** (mac unchanged, Win Ctrl passes, Ctrl+Alt always rejected).
- codex r3 verdict FAIL — but the FAIL is the H#1 sync-echo family (findings 1/2/3): sync handlers (useSyncWebSocket tab_closed:316 / tab_activated:332 / workspace_activated:425) write activePaneId without navGen; verified on disk. closeTab has `if(idx===-1) return` so H#2 bump is bypassed when sync echo removes the tab first.

**DECISION — H#1 family = DOCUMENT in PR body, not fix in #168.** Rationale: pre-existing multi-device sync semantics (shared with merged #163 reveal-goto); the only safe fix (sync commits participate in navGen) changes multi-device last-writer-wins behavior (untestable by single-client CI, scope-creep for maintainer); finding 2 needs protocol request-id correlation. H#2 kept (correct on non-sync path, harmless), H#3 confirmed clean. Propose sync-navGen participation as upstream follow-up. **Pending user ack on this disposition.**

**In flight:** bg implementer — icon IconPlay→IconTerminal (plugins repo, ui.ts 2 sites); bg implementer — H#2/H#3 regression tests on scratch/svt-rebase. Claude reviewer r3 returned empty/no-file (codex + on-disk verification substituted).

**Next:** tests green → fast-forward feat/supervise-tabs to scratch + force-push (pre-authorized) + PR body update (document H#1 family). Then I-fix follow-up PR (host_key config_dir suffix + port=0 bound-port) in _prbuild worktree. Then icon review+push (plugin origin + dinotty-plugins#2). Then local 8999/8998 rebuild (dev→custom merge).
