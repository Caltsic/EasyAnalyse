# Contributing To EASYAnalyse / 贡献指南

Languages: [中文](#中文) | [English](#english)

## 中文

EASYAnalyse 是硬件电路语义表达、桌面编辑、AI Agent 和移动只读查看的综合项目。贡献应保持小范围、可验证、可审阅。

### 角色与权限

- **Maintainer**：维护 `main`、发布版本、管理标签和模板、合并 PR、处理安全披露、更新治理规则。
- **Contributor**：通过 issue、discussion、fork 或短分支提交 PR；不直接推送 `main`；不强推公共分支；不绕过 CI。
- **Security reporter**：通过 [SECURITY.md](SECURITY.md) 的流程报告漏洞，不在公开 issue 中披露可利用细节。

任何人都不应随意推送到受保护分支。`main` 必须通过 PR、CI 和 maintainer 审阅进入。

### 分支管理：Trunk-Based Development

- `main` 是唯一主干，代表可集成、可验证的当前版本。
- 功能分支应短生命周期，建议 1 到 3 天内合并或关闭。
- 分支命名使用提交类型前缀：`feat/*`、`fix/*`、`docs/*`、`style/*`、`refactor/*`、`perf/*`、`test/*`、`ci/*`、`chore/*`。
- `agent` 只能作为 Agent 工作的受保护预览/集成镜像，不允许长期偏离 `main`。
- `release/*` 只用于短期发版稳定，不承载长期开发。

### Issue 规范

请使用 GitHub issue 模板：

- `bug`：必须包含复现步骤、期望结果、实际结果、环境信息、日志或截图。
- `feature`：需求提案先讨论可行性，包括目标用户、使用场景、成功标准、可能风险。
- `discussion`：用于设计方向、架构取舍、流程提案和开放问题。

常用标签：

- `bug`：缺陷。
- `feature`：新功能或增强。
- `discussion`：需要先讨论的问题。
- `docs`：文档。
- `security`：安全相关。
- `ci`：持续集成或构建流程。

### 提交规范

使用 Conventional Commits：

```text
type(scope): summary
```

允许的 `type`：

- `feat`：新增用户可见功能。
- `fix`：修复缺陷。
- `style`：样式或视觉表现调整，不改变业务逻辑。
- `perf`：性能优化。
- `refactor`：不改变行为的代码结构调整。
- `docs`：文档。
- `test`：测试。
- `build`：构建系统或依赖。
- `ci`：CI/CD。
- `chore`：维护性工作。
- `revert`：回滚。

示例：

```text
feat(agent): add blueprint format check tool
fix(blueprints): hide duplicate origin reset in preview
style(inspector): align field spacing
perf(canvas): cache network relation layout
docs(governance): document trunk based workflow
```

破坏性变更使用 `!` 或正文中的 `BREAKING CHANGE:`：

```text
feat(schema)!: migrate document format to v5
```

### Pull Request 流程

1. 先确认是否需要 issue 或 `docs/plans/` 设计说明。
2. 保持一个 PR 只解决一个根因或一个功能切片。
3. 避免无关格式化和顺手重构。
4. PR 中写清楚变更内容、原因、用户影响、验证命令和发布影响。
5. UI 变化附截图或简短录屏说明。
6. 通过 CI 后由 maintainer 审阅并合并。

### 本地验证

桌面端：

```powershell
cd easyanalyse-desktop
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

完整桌面验证：

```powershell
cd easyanalyse-desktop
npm run verify
npm run tauri:build
```

Rust core：

```powershell
cargo test --manifest-path easyanalyse-desktop/src-tauri/crates/easyanalyse-core/Cargo.toml
```

### 版本发布

遵循 [Release Policy](docs/governance/release-policy.md)：

- patch：修复、打包、兼容性、文档小修。
- minor：非破坏性功能或工具增加。
- major：页面级重构、格式破坏、迁移、权限/API 模型改变。

发布只能由 maintainer 执行。发版前必须确认版本号、验证结果、tag、GitHub Release notes 和必要产物。

## English

EASYAnalyse combines semantic circuit representation, a desktop editor, an AI Agent, and a mobile read-only viewer. Contributions should be small, typed, verifiable, and reviewable.

### Roles And Permissions

- **Maintainer**: maintains `main`, publishes releases, manages labels/templates, merges PRs, handles security reports, and updates governance rules.
- **Contributor**: proposes work through issues, discussions, forks, or short-lived branches; does not push directly to `main`; does not force-push shared branches; does not bypass CI.
- **Security reporter**: reports vulnerabilities through [SECURITY.md](SECURITY.md), not through public issues with exploitable details.

Protected branches must not receive arbitrary pushes. `main` must be updated through PR review, CI, and maintainer approval.

### Branching: Trunk-Based Development

- `main` is the single trunk and represents the current integrated version.
- Feature branches should be short-lived, preferably merged or closed within 1 to 3 days.
- Branch names use commit-type prefixes: `feat/*`, `fix/*`, `docs/*`, `style/*`, `refactor/*`, `perf/*`, `test/*`, `ci/*`, `chore/*`.
- `agent` may exist only as a protected preview/integration mirror for Agent work and must not diverge from `main` long-term.
- `release/*` is only for short release stabilization windows.

### Issues

Use the GitHub issue templates:

- `bug`: must include reproduction steps, expected result, actual result, environment, and logs or screenshots.
- `feature`: starts with feasibility discussion, target users, use case, success criteria, and risks.
- `discussion`: for design direction, architecture tradeoffs, process proposals, and open questions.

Core labels:

- `bug`: defects.
- `feature`: features and enhancements.
- `discussion`: topics that need discussion first.
- `docs`: documentation.
- `security`: security-related work.
- `ci`: continuous integration or build flow.

### Commit Convention

Use Conventional Commits:

```text
type(scope): summary
```

Allowed `type` values:

- `feat`: user-visible feature.
- `fix`: bug fix.
- `style`: visual/style change without business logic change.
- `perf`: performance improvement.
- `refactor`: behavior-preserving code restructure.
- `docs`: documentation.
- `test`: tests.
- `build`: build system or dependencies.
- `ci`: CI/CD.
- `chore`: maintenance.
- `revert`: revert.

Examples:

```text
feat(agent): add blueprint format check tool
fix(blueprints): hide duplicate origin reset in preview
style(inspector): align field spacing
perf(canvas): cache network relation layout
docs(governance): document trunk based workflow
```

Use `!` or `BREAKING CHANGE:` for breaking changes:

```text
feat(schema)!: migrate document format to v5
```

### Pull Request Flow

1. Decide whether an issue or `docs/plans/` design note is required.
2. Keep one PR focused on one root cause or one feature slice.
3. Avoid unrelated formatting and drive-by refactors.
4. State what changed, why, user impact, validation commands, and release impact.
5. Include screenshots or short recordings for visible UI changes.
6. Maintainers review and merge after CI passes.

### Local Validation

Desktop:

```powershell
cd easyanalyse-desktop
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Full desktop verification:

```powershell
cd easyanalyse-desktop
npm run verify
npm run tauri:build
```

Rust core:

```powershell
cargo test --manifest-path easyanalyse-desktop/src-tauri/crates/easyanalyse-core/Cargo.toml
```

### Releases

Follow [Release Policy](docs/governance/release-policy.md):

- patch: fixes, packaging repairs, compatibility repairs, and small docs updates.
- minor: non-breaking features or tools.
- major: page-level redesign, breaking format changes, migrations, or permission/API model changes.

Only maintainers publish releases. Before publishing, confirm the version, validation result, tag, GitHub Release notes, and required artifacts.
