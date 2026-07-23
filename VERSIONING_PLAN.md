# Dinotty Cargo Workspace 统一版本方案（设计稿）

> 状态：已实施。
>
> 核心约束：server/desktop 只使用根 `Cargo.toml` 的
> `[workspace.package].version` 作为应用版本；正式发布仍由现有 `v*` Git
> tag 触发，tag 版本必须与 workspace version 严格一致。

## 1. 目标与非目标

### 1.1 目标

1. 根 `[workspace.package].version` 是 server/desktop 应用版本的唯一权威源。
2. `dinotty-server` 和 `dinotty-desktop` 都使用 `version.workspace = true`。
3. Tauri、Rust 运行时、插件宿主、deb 和 portable 文件名使用同一个解析版本。
4. 普通 clone、shallow clone 和不带 `.git` 的源码归档构建出相同版本。
5. 正式 tag 必须是 `v{workspace_version}`，且继续使用现有 Package workflow 发布。
6. 版本修改只需要编辑根 `Cargo.toml`，然后更新 `Cargo.lock`。
7. Android 保持独立版本线，不继承根 workspace version。

### 1.2 非目标

本方案不重构完整打包和发布流程，也不新增以下能力：

- build metadata、revision 或 channel 字段；
- 平台 metadata JSON、总 metadata 或 `SHA256SUMS`；
- Release environment、全局发布并发或新的审批流程；
- 资产完整性审计、同名资产检查或 Actions 全面 pin；
- `dinotty-server --version` 等当前不存在的 CLI 功能；
- Git tag 的删除、强制移动或其他管理员应急操作。

这些能力如有需要，应在独立方案中讨论，不能作为统一版本源的实施前置条件。

## 2. 当前问题与统一范围

### 2.1 当前版本来源

| 用途 | 当前来源 |
|------|----------|
| `/api/info` | `git describe --tags --always` |
| MCP / 插件宿主 | `CARGO_PKG_VERSION` |
| server Cargo/deb | 根 `Cargo.toml` |
| desktop Cargo | `src-tauri/Cargo.toml` |
| Tauri bundle / portable 文件名 | `src-tauri/tauri.conf.json.version` |
| `scripts/build.sh` | 本地 tag 排序结果，并回写三个版本文件 |

这些来源会受本地 tag 集合、浅克隆、`.git` 是否存在和人工同步影响，可能导致
运行时、安装包和文件名的版本不一致。

### 2.2 纳入统一的内容

以下内容必须等于 workspace version：

- server/desktop Cargo package 和 `Cargo.lock` 中的 package version；
- server/desktop 编译时的 `CARGO_PKG_VERSION`；
- `/api/info`、MCP `server_info.version`；
- `PluginManager::HOST_VERSION` 和插件进程的 `DINOTTY_HOST_VERSION`；
- Tauri app、桌面 bundle 和 server deb metadata；
- portable 文件名，以及现有包或 Release asset 名称中已经包含的版本字段。

以下内容属于其他兼容域，继续独立维护：

- Android Cargo/Tauri version 和 `versionCode`；
- 私有 `frontend/package.json` version；
- 配置迁移、协议、localStorage、API、数据库和资源格式版本；
- 插件自身 manifest version；
- Tauri CLI 和其他工具版本。

## 3. 目标设计

### 3.1 Cargo Workspace

根 `Cargo.toml`：

```toml
[workspace]
members = ["src-tauri"]

[workspace.package]
version = "0.18.0"
edition = "2021"
license = "MIT"
repository = "https://github.com/xichan96/dinotty"

[package]
name = "dinotty-server"
version.workspace = true
edition.workspace = true
license.workspace = true
repository.workspace = true
build = "build.rs"
```

`src-tauri/Cargo.toml`：

```toml
[package]
name = "dinotty-desktop"
version.workspace = true
edition.workspace = true
license.workspace = true
```

Cargo 根据两个 workspace packages 的解析版本更新 `Cargo.lock`。版本升级时不得
顺带升级第三方依赖。

### 3.2 Tauri 与运行时

删除 `src-tauri/tauri.conf.json` 顶层的 `version`。Tauri 从
`dinotty-desktop` 的 Cargo package 继承应用版本：

```text
[workspace.package].version
  -> dinotty-desktop version.workspace
  -> Tauri app version
  -> desktop bundle metadata
```

Rust 运行时统一使用当前 package 的：

```rust
env!("CARGO_PKG_VERSION")
```

根 `build.rs` 和 `src-tauri/build.rs` 删除 `git describe`、
`DINOTTY_VERSION` 注入和 Git refs 变更跟踪，只保留前端资源跟踪及
`tauri_build::build()`。运行时不读取 manifest、Git 历史或外部版本文件。

server 和 desktop 的 Cargo package version 相同，因此 server 独立运行和
desktop 内嵌 server 时得到相同应用版本。

### 3.3 版本读取与校验

自动化需要解析版本时使用：

```bash
cargo metadata --locked --no-deps --format-version 1
```

解析结果必须满足：

1. workspace 中恰好存在一个 `dinotty-server` 和一个 `dinotty-desktop`；
2. 两个 package version 完全相同；
3. 当前阶段版本严格符合稳定版 `MAJOR.MINOR.PATCH`；
4. manifests 与 `Cargo.lock` 一致；
5. 解析失败、package 缺失或版本不一致时立即失败。

`cargo metadata` 只能看到解析后的值，无法判断 version 是继承还是重复声明。
因此还必须使用 TOML/JSON 解析做最小结构检查：

- 根 `[workspace.package].version` 存在；
- 根 `[package]` 和 desktop `[package]` 都设置 `version.workspace = true`，且未独立声明版本；
- `src-tauri/tauri.conf.json` 顶层不存在 `version`。

结构检查不得使用容易误改或误判的正则 TOML 替换。版本校验可以放入一个小型
可复用检查脚本，但该脚本只读取和校验版本，不修改 manifest 或 lockfile。

## 4. Git Tag 与版本不可逆性

Cargo 决定应用版本，Git tag 声明“正式发布这个已经确定版本的 commit”。正式
发布沿用以下约束：

- tag 格式为 `vMAJOR.MINOR.PATCH`；
- tag 去掉 `v` 后必须等于 workspace version；
- tag 目标 commit 必须位于 `main` 历史；
- workflow 构建触发 tag 指向的 commit；
- workflow 不创建、移动或删除 tag。

`vX.Y.Z` 首次 push 后，该版本在正常发布模型中即被占用。远端已有同名 tag 时，
普通 push 不能把它改指另一个 commit，因此同一正式版本不会在正常操作中对应两套
代码或产物。

删除或强制移动 tag 需要显式的额外管理员操作，属于本方案范围外的仓库维护行为，
不计入正常版本流程，也不据此增加发布 workflow 的复杂度。仓库管理员如需定义这类
应急操作，应另行制定权限和审计规则。

失败处理遵循以下正常路径：

- 构建基础设施或临时错误：rerun 原 workflow，tag 和 commit 不变；
- tagged commit 的代码需要修改：提升 PATCH 版本并创建新 tag；
- 已创建 GitHub Release 或产物已分发：只能通过新版本修复。

这里的不可逆性指“同一个正式版本不能在正常操作下换成另一个 commit”。如果未来还
要求每个新 tag 的 SemVer 数值必须高于全部历史 tag，可单独增加一个轻量比较检查；
它不是本次统一版本源的必要条件。

## 5. 实施范围

### 5.1 Cargo 与运行时

以下修改作为一个原子 PR 合入：

1. 根 `Cargo.toml` 增加 `[workspace.package]`；
2. server/desktop 改为 `version.workspace = true`；
3. 更新 `Cargo.lock`，且不升级第三方依赖；
4. 删除 `src-tauri/tauri.conf.json.version`；
5. 删除两个 build scripts 的 Git 版本注入；
6. `/api/info` 和其他运行时版本使用 `CARGO_PKG_VERSION`；
7. 增加解析版本和检查版本源结构的自动化校验。

不设置保留旧字段的过渡阶段，也不增加随后还要删除的临时一致性 gate。当前版本字段
已经相同，可以直接原子切换到唯一版本源。

### 5.2 本地构建脚本

- `scripts/build.sh` 删除 `git_version` 和 `sync_version`，不再根据本地 tag 修改
  `Cargo.toml`、`src-tauri/Cargo.toml` 或 `tauri.conf.json`；
- `scripts/build.sh` 需要显示版本时，从 Cargo metadata 读取；
- `scripts/build-portable.ps1` 从 Cargo metadata 读取 portable 文件名所需版本；
- 所有脚本只读版本，不得在构建过程中同步或覆盖版本。

### 5.3 Package Workflow

保留 `.github/workflows/package.yml` 的现有结构和行为，包括：

- `workflow_dispatch` 对 dev/main 的手动打包；
- `v*` tag 正式发布触发器；
- tag commit 的 main 历史检查；
- macOS、Linux、Windows 构建矩阵；
- 当前 bundle、portable、deb、Actions artifacts 和 GitHub Release 发布步骤；
- 当前 permissions、concurrency 和 artifact retention 设置。

只做以下版本相关修改：

1. prepare job 读取并校验 Cargo workspace version；
2. tag 触发时，在平台构建开始前检查
   `GITHUB_REF_NAME == v{workspace_version}`；
3. 手动打包只检查 workspace 内部版本一致性，不要求 Git tag；
4. Windows portable 文件名从 Cargo metadata 读取版本，不再读取 Tauri config；
5. 继续构建触发 tag 指向的 commit，不从 tag 反向修改 Cargo version。

不重新声明完整 workflow，也不改动已有打包、上传和 Release 逻辑。`cargo deb` 继续
自动使用 `dinotty-server` package version；Tauri 继续使用
`dinotty-desktop` package version。

## 6. 修改版本与正式发布

准备新版本时只编辑根 `Cargo.toml`：

```toml
[workspace.package]
version = "0.19.0"
```

然后更新并验证 lockfile：

```bash
cargo metadata --no-deps --format-version 1 > /dev/null
cargo metadata --locked --no-deps --format-version 1 > /dev/null
```

PowerShell：

```powershell
cargo metadata --no-deps --format-version 1 | Out-Null
cargo metadata --locked --no-deps --format-version 1 | Out-Null
```

正常版本 PR 只修改 `Cargo.toml` 和 `Cargo.lock`：

```text
chore: bump version to 0.19.0
```

正式发布沿用当前分支和 Package workflow：

1. 版本 PR 合入 `dev` 并通过完整 CI；
2. `dev` 晋升到 `main`；
3. 在目标 main commit 创建并 push `v{workspace_version}`；
4. prepare 校验 tag、Cargo version 和现有 main 历史约束；
5. 现有平台 jobs 构建并上传产物；
6. 现有 Release job 向该 tag 发布 GitHub Release assets。

## 7. Android 边界

Android 是带独立 `[workspace]` 的 Cargo workspace，保持自己的 Cargo version、
Tauri version 和 `versionCode`：

- 根 workspace 不增加 Android member；
- 根版本检查和 Package workflow 不读取或构建 Android；
- Android 使用独立的版本修改、校验和发布流程。

## 8. 验收矩阵

| 场景 | 预期结果 |
|------|----------|
| 普通、shallow 或无 `.git` 构建 | Cargo/Tauri/运行时版本一致 |
| server/desktop package 缺失或解析版本不同 | metadata 检查失败 |
| package 改回独立 `version`，即使数值相同 | 结构检查失败 |
| Tauri 重新硬编码顶层 `version` | 结构检查失败 |
| lockfile 过期 | `cargo metadata --locked` 失败 |
| tag version 与 Cargo version 不同 | 平台构建开始前失败 |
| tag 目标不在 main 历史 | 现有 main 历史 gate 阻止发布 |
| dev/main 手动打包 | 不要求 tag，打包行为与当前保持一致 |
| `scripts/build.sh` 在有 tag、无 tag 或 shallow clone 中运行 | 不修改任何版本文件 |
| Package workflow 的平台、资产和 Release | 与当前流程保持一致 |
| Android 使用不同版本 | 合法，不参与根版本检查 |

实施时使用现有 macOS、Linux 和 Windows Package matrix 验证 Tauri 从 desktop Cargo
package 继承版本，并确认 cargo-deb 和 portable 文件名使用 workspace version。

## 9. 参考资料

- Cargo workspace package inheritance：<https://doc.rust-lang.org/cargo/reference/workspaces.html#the-package-table>
- Cargo manifest `package.version`：<https://doc.rust-lang.org/cargo/reference/manifest.html#the-version-field>
- Cargo metadata：<https://doc.rust-lang.org/cargo/commands/cargo-metadata.html>
- Cargo build scripts：<https://doc.rust-lang.org/cargo/reference/build-scripts.html>
- Tauri v2 config version：<https://v2.tauri.app/reference/config/#version>
- Tauri v2 schema：<https://schema.tauri.app/config/2>
