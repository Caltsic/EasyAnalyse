# Issue And Commit Policy

Date: 2026-05-22

## 中文

### Issue 分类

EASYAnalyse 使用三类核心 issue：

- `bug`：缺陷。必须提供复现步骤、环境、期望结果、实际结果、日志或截图。
- `feature`：需求或增强。先讨论可行性，再进入实现。必须说明目标用户、使用场景、验收标准、替代方案和风险。
- `discussion`：设计方向、架构取舍、流程提案或开放问题。

辅助标签：

- `docs`：文档。
- `security`：安全相关。不要在公开 issue 中披露可利用细节。
- `ci`：持续集成、构建、打包。
- `release`：发版相关。
- `agent`：Agent、Provider、工具调用、蓝图生成。
- `desktop`：桌面端。
- `mobile`：移动端。

### Bug Issue 必填内容

- 复现步骤。
- 期望结果。
- 实际结果。
- 环境：操作系统、EASYAnalyse 版本、桌面/移动端、Provider/模型（如相关）。
- 日志、截图、JSON 片段或最小复现文件。
- 影响范围和是否阻断使用。

### Feature Issue 必填内容

- 目标用户是谁。
- 解决什么问题。
- 建议行为或交互。
- 成功标准。
- 可行性风险。
- 是否影响文档格式、Provider 协议、权限、发布或迁移。

### 提交格式

统一使用：

```text
type(scope): summary
```

允许的 type：

- `feat`
- `fix`
- `style`
- `perf`
- `refactor`
- `docs`
- `test`
- `build`
- `ci`
- `chore`
- `revert`

规则：

- `type` 必须小写。
- `scope` 可选，建议使用模块名，如 `agent`、`blueprints`、`canvas`、`inspector`、`governance`。
- `summary` 简短描述结果，不以句号结尾。
- 破坏性变更使用 `type(scope)!:` 或正文 `BREAKING CHANGE:`。

## English

### Issue Categories

EASYAnalyse uses three core issue categories:

- `bug`: defects. Must include reproduction steps, environment, expected result, actual result, and logs or screenshots.
- `feature`: feature requests or enhancements. Feasibility must be discussed before implementation. Include target users, use case, acceptance criteria, alternatives, and risks.
- `discussion`: design direction, architecture tradeoffs, process proposals, or open questions.

Supporting labels:

- `docs`: documentation.
- `security`: security-related work. Do not disclose exploitable details in public issues.
- `ci`: continuous integration, build, and packaging.
- `release`: release work.
- `agent`: Agent, Provider, tool calls, and blueprint generation.
- `desktop`: desktop app.
- `mobile`: mobile app.

### Bug Issue Required Fields

- Reproduction steps.
- Expected result.
- Actual result.
- Environment: OS, EASYAnalyse version, desktop/mobile, Provider/model if relevant.
- Logs, screenshots, JSON snippet, or minimal reproduction file.
- Impact and whether it blocks usage.

### Feature Issue Required Fields

- Target user.
- Problem being solved.
- Proposed behavior or interaction.
- Success criteria.
- Feasibility risks.
- Whether it affects document format, Provider protocol, permissions, release, or migration.

### Commit Format

Use:

```text
type(scope): summary
```

Allowed types:

- `feat`
- `fix`
- `style`
- `perf`
- `refactor`
- `docs`
- `test`
- `build`
- `ci`
- `chore`
- `revert`

Rules:

- `type` must be lowercase.
- `scope` is optional and should use a module name such as `agent`, `blueprints`, `canvas`, `inspector`, or `governance`.
- `summary` describes the result and does not end with a period.
- Breaking changes use `type(scope)!:` or `BREAKING CHANGE:` in the body.

