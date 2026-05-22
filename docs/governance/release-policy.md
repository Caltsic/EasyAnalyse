# EASYAnalyse Release Policy / 发布流程

Date: 2026-05-22

## 中文

### 版本号含义

EASYAnalyse 使用 SemVer 风格版本号：

- **Patch `x.y.z+1`**：热修复、崩溃修复、打包修复、Provider 兼容性修复、文档小修，不新增用户工作流。
- **Minor `x.y+1.0`**：小功能、新工具、新设置、增量协议字段、非破坏性体验改进。
- **Major `x+1.0.0`**：页面级重构、文档格式破坏、需要用户操作的存储迁移、Provider 协议破坏、API/权限/数据模型破坏。

示例：

- `1.1.1`：修复 Provider 协议 bug、打包问题或小 UI 缺陷。
- `1.2.0`：增加新的 Agent 只读工具或蓝图面板动作。
- `2.0.0`：重写编辑器页面、改变语义 JSON 兼容性或引入账户/云架构。

Agent 专项版本可以使用 `agent1.1.1`，主产品版本使用 `v1.1.1`。

### 分支

- `main`：trunk，稳定集成线。
- `agent`：受保护的 Agent 预览/集成镜像，应从 `main` fast-forward 或快速合回 `main`。
- `release/*`：短期发版稳定分支。
- `feat/*`、`fix/*`、`docs/*`、`style/*`、`refactor/*`、`perf/*`、`test/*`、`ci/*`、`chore/*`：短生命周期工作分支。

正常开发通过 PR、CI 和 maintainer review 进入 `main`。直接推送 `main` 只允许 maintainer 在发布或紧急维护场景下执行，并应保持可追踪。

### 发版清单

1. 确认范围和版本级别：patch、minor 或 major。
2. 需要时更新版本文件：
   - `CHANGELOG.md`
   - `easyanalyse-desktop/package.json`
   - `easyanalyse-desktop/package-lock.json`
   - `easyanalyse-desktop/src-tauri/Cargo.toml`
   - `easyanalyse-desktop/src-tauri/Cargo.lock`
   - `easyanalyse-desktop/src-tauri/tauri.conf.json`
   - `easyanalyse-desktop/src-tauri/crates/easyanalyse-core/Cargo.toml`
   - `easyanalyse-mobile-android/app/build.gradle.kts`
3. 运行验证：
   - `npm run verify` from `easyanalyse-desktop`
   - Rust core `cargo test`
   - Android build when Android changed
   - `npm run tauri:build` when desktop packaging changed
4. 确认 GitHub Actions 在发布目标分支上通过。
5. 使用发布提交信息，例如 `chore: release v1.2.0` 或 `chore: release agent 1.2.0`。
6. 创建 tag：
   - 主产品：`v1.2.0`
   - Agent 专项：`agent1.2.0`
7. 推送分支和 tag。
8. 创建 GitHub Release，包含：
   - 摘要，
   - 用户可见变化，
   - 验证命令，
   - 必要产物。
9. 发布后核对：
   - tag 指向预期 commit，
   - 产物上传成功，
   - release notes 包含验证结果，
   - draft/prerelease 状态符合预期。

### Maintainer 职责

只有 maintainer 可以发布版本。发布者负责：

- 选择正确版本级别。
- 确认发布目标在 `main` 或批准的 `release/*` 分支。
- 确认 CI 与本地打包结果。
- 创建清晰、不可误导的 release notes。
- 只上传可信构建产物。
- 发布后不移动 tag；若必须修正，需公开说明原因和影响。

### Changelog 规则

- 用户可见变化写入 `CHANGELOG.md`。
- 纯内部重构只有在影响维护、稳定性或后续开发时才记录。
- 破坏性变更必须包含 `Migration` 段落。
- 实验性功能必须标注实验状态和稳定性预期。

## English

### Version Meaning

EASYAnalyse uses SemVer-style release numbers:

- **Patch `x.y.z+1`**: hotfixes, crash fixes, packaging fixes, Provider compatibility fixes, and small docs updates with no new user workflow.
- **Minor `x.y+1.0`**: small features, new tools, new settings, additive protocol fields, and non-breaking UX improvements.
- **Major `x+1.0.0`**: page-level redesign, document format break, storage migration requiring user action, Provider protocol break, or API/permission/data model break.

Examples:

- `1.1.1`: fixes a Provider protocol bug, packaging issue, or small UI defect.
- `1.2.0`: adds a new Agent read-only tool or blueprint panel action.
- `2.0.0`: rewrites the editor page, changes semantic JSON compatibility, or introduces account/cloud architecture.

Agent-only releases may use `agent1.1.1`. Main product releases should use `v1.1.1`.

### Branches

- `main`: trunk and stable integration line.
- `agent`: protected Agent preview/integration mirror. It should fast-forward from `main` or merge back quickly.
- `release/*`: short-lived release stabilization branches.
- `feat/*`, `fix/*`, `docs/*`, `style/*`, `refactor/*`, `perf/*`, `test/*`, `ci/*`, `chore/*`: short-lived work branches.

Normal development enters `main` through PR review, CI, and maintainer approval. Direct pushes to `main` are limited to maintainer-controlled release or emergency maintenance operations and must remain traceable.

### Release Checklist

1. Confirm scope and version level: patch, minor, or major.
2. Update version files when applicable:
   - `CHANGELOG.md`
   - `easyanalyse-desktop/package.json`
   - `easyanalyse-desktop/package-lock.json`
   - `easyanalyse-desktop/src-tauri/Cargo.toml`
   - `easyanalyse-desktop/src-tauri/Cargo.lock`
   - `easyanalyse-desktop/src-tauri/tauri.conf.json`
   - `easyanalyse-desktop/src-tauri/crates/easyanalyse-core/Cargo.toml`
   - `easyanalyse-mobile-android/app/build.gradle.kts`
3. Run validation:
   - `npm run verify` from `easyanalyse-desktop`
   - Rust core `cargo test`
   - Android build when Android changed
   - `npm run tauri:build` when desktop packaging changed
4. Confirm GitHub Actions is green on the release target branch.
5. Commit with a release message such as `chore: release v1.2.0` or `chore: release agent 1.2.0`.
6. Create tag:
   - Main product: `v1.2.0`
   - Agent-only: `agent1.2.0`
7. Push branch and tag.
8. Create GitHub Release with:
   - summary,
   - user-facing changes,
   - validation commands,
   - required assets.
9. Verify after publication:
   - tag points to the intended commit,
   - assets are uploaded,
   - release notes include validation,
   - draft/prerelease state is intentional.

### Maintainer Responsibilities

Only maintainers publish releases. The release owner is responsible for:

- selecting the correct version level,
- ensuring the release target is on `main` or an approved `release/*` branch,
- confirming CI and local packaging results,
- writing clear and non-misleading release notes,
- uploading only trusted build artifacts,
- avoiding tag movement after publication unless the correction is publicly documented.

### Changelog Rules

- User-facing changes go in `CHANGELOG.md`.
- Internal-only refactors are listed only when they affect maintenance, stability, or future development.
- Breaking changes require a `Migration` section.
- Experimental features must be marked experimental and include stability expectations.
