# Branching And Permissions

Date: 2026-05-22

## 中文

### 分支模型

EASYAnalyse 使用 trunk-based development。

- `main` 是唯一主干，代表当前可集成、可验证版本。
- `agent` 是 Agent 工作的受保护预览/集成镜像，只能从 `main` fast-forward 或在短期 Agent 验证后合回 `main`，不能长期偏离主干。
- `release/*` 只用于短期发版稳定，发版完成后关闭。
- 工作分支必须短生命周期，命名为 `feat/*`、`fix/*`、`docs/*`、`style/*`、`refactor/*`、`perf/*`、`test/*`、`ci/*`、`chore/*`。

### 合并规则

- `main` 通过 PR 更新，不接受随意直接推送。
- PR 必须通过 CI，除非 maintainer 明确记录豁免原因。
- 大范围架构、UI 页面、数据格式、Provider 协议、权限模型变化必须先有 issue 或 `docs/plans/` 设计说明。
- 不允许 force push `main`、`agent`、`release/*`。
- 不允许把 API key、私钥、证书、生产凭据提交到仓库。

### 权限范围

**Maintainer 可以：**

- 合并 PR。
- 管理受保护分支规则。
- 创建、修改、删除标签和 release。
- 管理 issue/PR 标签与模板。
- 处理安全报告。
- 修改治理文档。

**Contributor 可以：**

- 创建 issue、discussion、PR。
- 在自己的 fork 或短分支上提交代码。
- 请求 review、提出设计方案、补充测试和文档。

**Contributor 不应：**

- 直接推送 `main`。
- 绕过 CI 合并。
- 强推共享分支。
- 修改发布 tag 指向。
- 公开披露未修复安全漏洞细节。

## English

### Branch Model

EASYAnalyse uses trunk-based development.

- `main` is the single trunk and represents the current integrated, verifiable version.
- `agent` is a protected preview/integration mirror for Agent work. It should fast-forward from `main` or merge back into `main` after short Agent validation. It must not become a long-lived divergent branch.
- `release/*` is only for short release stabilization windows and should be closed after release.
- Work branches must be short-lived and named `feat/*`, `fix/*`, `docs/*`, `style/*`, `refactor/*`, `perf/*`, `test/*`, `ci/*`, or `chore/*`.

### Merge Rules

- `main` is updated through PRs, not arbitrary direct pushes.
- PRs must pass CI unless a maintainer records an explicit exemption.
- Broad architecture, UI page, data format, Provider protocol, or permission model changes require an issue or `docs/plans/` design note first.
- Force-push is forbidden on `main`, `agent`, and `release/*`.
- API keys, private keys, certificates, and production credentials must not be committed.

### Permission Boundaries

**Maintainers may:**

- Merge PRs.
- Manage protected branch rules.
- Create, edit, and delete tags and releases.
- Manage issue/PR labels and templates.
- Handle security reports.
- Update governance documents.

**Contributors may:**

- Create issues, discussions, and PRs.
- Commit to their fork or short-lived work branch.
- Request review, propose designs, and add tests or documentation.

**Contributors should not:**

- Push directly to `main`.
- Bypass CI for merges.
- Force-push shared branches.
- Move release tags.
- Publicly disclose unfixed security vulnerability details.

