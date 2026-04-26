# EasyAnalyse 桌面端蓝图与内置 Agent：MVP 修订施工规划

> 本文是对 `2026-04-26-agent-blueprint-plan.md` 及三份细化规划的压实修订。它吸收最新评审意见后，作为后续实现顺序与验收边界的优先依据。若本文与旧规划冲突，以本文为准。

## 0. 修订结论

原规划的总体架构方向保持不变：

- Agent 不直接修改主文档。
- 蓝图存放在 sidecar 文件中。
- 应用蓝图采用整文档替换主文档。
- 应用前展示校验结果、diff、风险确认。
- 应用后进入主文档 undo/redo 历史。

但第一版交付范围需要大幅压实：

> **首个 MVP 不接真实 Agent、不要求 API key、不依赖 Provider。先完成“无 Agent 蓝图工作区闭环”。**

也就是说，Agent 在体系中只是“蓝图来源之一”。在 Agent 接入前，必须先证明蓝图本身可被创建、保存、加载、预览、校验提示、diff、应用、undo。

同时确认一个重要产品原则：

> **无论蓝图有多少 schema / semantic 报错，都允许用户直接应用到内存主文档。报错只用于提示和风险确认，不作为应用门禁。**

原因：EasyAnalyse 当前目标不是仿真器，蓝图同时服务用户阅读、AI 参考、方案讨论。有时报错不影响阅读或人工判断。因此：

- 应用蓝图到编辑器内存：始终允许，但要提示。
- 保存主文档到磁盘：继续遵守现有保存校验门禁，除非未来另行调整保存策略。

## 1. MVP 0：无 Agent 蓝图闭环

第一阶段目标是跑通以下闭环：

```text
当前主文档
  -> 人工创建蓝图快照
  -> 写入 sidecar
  -> 蓝图列表展示
  -> 蓝图只读预览
  -> 校验并显示问题
  -> 摘要 diff
  -> 用户确认应用
  -> 整文档替换主文档
  -> 主文档 dirty=true
  -> undo/redo 可恢复
```

MVP 0 明确不包含：

- 真实 OpenAI / Anthropic / DeepSeek 调用。
- API key 输入与存储。
- Agent prompt 构造。
- Agent 自动生成多个蓝图。
- Patch DSL。
- 自动修复。
- 复杂布局优化。

这些放入后续 Milestone。

## 2. 蓝图 sidecar 文件与主文档边界

### 2.1 sidecar 文件名

确认采用：

```text
原文件名.easyanalyse-blueprints.json
```

示例：

```text
demo.easyanalyse.json
demo.easyanalyse.easyanalyse-blueprints.json
```

### 2.2 主文档不扩展蓝图字段

主 semantic v4 文档继续遵守 `exchange.md` 和 JSON Schema。MVP 不在主文档顶层加入 `blueprints` 或 Agent 字段，避免破坏格式兼容。

### 2.3 sidecar wrapper 草案

```ts
export interface BlueprintWorkspaceFileV1 {
  schemaVersion: 'easyanalyse-blueprint-workspace-v1'
  semanticVersion: 'easyanalyse-semantic-v4'
  workspaceId: string
  mainDocument: {
    path?: string
    lastKnownHash?: string
    schemaVersion: '4.0.0'
  }
  blueprints: BlueprintRecord[]
  createdAt: string
  updatedAt: string
}
```

## 3. 蓝图状态语义重构

旧规划中的：

```ts
status: 'draft' | 'valid' | 'invalid' | 'applied' | 'archived'
```

容易混淆三类不同语义：

1. 蓝图生命周期。
2. 蓝图校验结果。
3. 蓝图是否曾经应用，或当前主文档是否等于该蓝图。

修订后必须拆开。

### 3.1 生命周期状态

```ts
export type BlueprintLifecycleStatus = 'active' | 'archived' | 'deleted'
```

含义：

| 状态 | 含义 | 默认是否显示 | 是否可应用 |
|---|---|---:|---:|
| `active` | 正常蓝图 | 是 | 是 |
| `archived` | 用户归档 | 可筛选显示 | 默认不可应用，恢复后可应用 |
| `deleted` | 软删除 / 待清理 | 否 | 否 |

### 3.2 校验状态

```ts
export type BlueprintValidationState = 'unknown' | 'valid' | 'invalid'
```

含义：

| 状态 | 含义 | 是否阻止应用 |
|---|---|---:|
| `unknown` | 尚未校验或校验结果过期 | 否 |
| `valid` | 最近一次校验没有发现问题 | 否 |
| `invalid` | 最近一次校验有 schema/semantic 问题 | 否 |

> 注意：`invalid` 不再表示“不可应用”。它只表示“应用前必须强提示”。

### 3.3 应用历史

```ts
export interface BlueprintAppliedInfo {
  appliedAt: string
  appliedToMainDocumentHash: string
  sourceBlueprintDocumentHash: string
  appVersion?: string
}
```

`appliedInfo` 只表示“这个蓝图历史上曾被应用过”。它不表示当前主文档仍然等于该蓝图。

### 3.4 当前匹配态

```ts
export interface BlueprintRuntimeView {
  isCurrentMainDocument: boolean
}
```

`isCurrentMainDocument` 不落盘，由 UI 运行时根据当前主文档 canonical hash 与蓝图 document hash 计算。

这样可以避免 undo 之后 UI 仍误导用户“当前正在使用该蓝图”：

- `appliedInfo`：曾经应用过，保留历史。
- `isCurrentMainDocument`：当前主文档是否仍等于该蓝图，运行时计算。

### 3.5 BlueprintRecord 草案

```ts
export interface BlueprintRecord {
  id: string
  name: string
  description?: string
  status: BlueprintLifecycleStatus
  validationState: BlueprintValidationState
  validationReport?: BlueprintValidationReport
  document: DocumentFile
  documentHash: string
  baseMainDocumentHash?: string
  source: 'manual_snapshot' | 'manual_import' | 'agent' | 'agent_derived'
  parentBlueprintId?: string
  appliedInfo?: BlueprintAppliedInfo
  createdAt: string
  updatedAt: string
  lastValidatedAt?: string
  tags?: string[]
}
```

## 4. 校验策略：提示，不拦截应用

### 4.1 校验输出

每次校验更新：

- `validationState`
- `validationReport`
- `lastValidatedAt`
- `documentHash`

### 4.2 校验不应导致数据丢失

无论校验结果如何：

- 蓝图都可以保存到 sidecar。
- 蓝图都可以预览。
- 蓝图都可以参与 diff。
- 蓝图都可以被用户确认后应用到内存主文档。

### 4.3 应用时的提示级别

应用确认弹窗根据校验结果调整提示强度：

| 情况 | UI 行为 |
|---|---|
| 未校验 | 提示“该蓝图尚未校验，建议先校验”，但允许继续 |
| 有 warning | 展示 warning 摘要，允许直接确认 |
| 有 error / schema issue | 强提示，要求二次确认或勾选确认框，但允许继续 |
| base hash 不一致 | 提示“这是整文档替换，不做 merge”，允许继续 |

### 4.4 应用与保存分离

必须在文档中和 UI 中区分：

```text
应用蓝图到内存主文档：允许。
保存主文档到磁盘：继续走现有保存校验逻辑。
```

因此可能出现：

1. 用户应用一个 invalid 蓝图。
2. 主编辑器显示校验问题。
3. 用户仍可阅读、修改、让 Agent 修复。
4. 用户保存时，现有保存流程可能拒绝，需要用户修正或未来另行支持“强制保存”。

## 5. Canvas 预览架构：优先拆纯渲染层

蓝图预览是高风险区域。不能简单依赖 `CanvasView readOnly` 的若干 guard，因为容易漏掉拖拽、删除、键盘快捷键、放置器、选择态等隐性写路径。

推荐结构：

```text
CircuitCanvasRenderer
  只负责根据 DocumentFile 渲染图形，不持有 editorStore 写动作

CanvasView / MainCanvasView
  主文档交互层，组合 CircuitCanvasRenderer 与 editorStore mutation

BlueprintPreviewCanvas
  蓝图只读预览层，只传 document、theme、viewport，不接主文档写动作
```

### 5.1 CircuitCanvasRenderer 允许做的事

- 读取 document。
- 渲染 devices / terminals / labels / view.networkLines。
- 支持 pan / zoom。
- 支持 hover / highlight。
- 支持 fit-to-screen。

### 5.2 CircuitCanvasRenderer 禁止做的事

- 不 import 或调用 `useEditorStore` mutation。
- 不调用 moveDevice / placeDevice / deleteSelection / updateTerminal / updateDevice。
- 不写入主 document。
- 不注册会修改主文档的键盘快捷键。

### 5.3 预览验收

- 预览蓝图前后，主文档 canonical hash 完全一致。
- 在预览区域拖拽、点击、按 Delete、Esc、快捷键，不改变主文档。
- 预览组件不暴露 mutation callbacks。
- 预览只读不是靠 CSS 禁用，而是架构上没有写路径。

## 6. API key 与设置存储策略

设置中心仍然是正式产品的一部分，但不是 MVP 0 的前置条件。它放到 Milestone 3。

### 6.1 普通设置与密钥分离

```ts
export interface AppSettings {
  appearance: {
    theme: 'system' | 'light' | 'dark'
  }
  agent: {
    providers: AgentProviderPublicConfig[]
    selectedProviderId?: string
    selectedModelId?: string
  }
}

export interface AgentProviderPublicConfig {
  id: string
  name: string
  kind: 'openai-compatible' | 'anthropic' | 'deepseek'
  baseUrl: string
  models: string[]
  defaultModel?: string
  apiKeyRef?: string
}
```

`AppSettings` 只能保存普通配置和 `apiKeyRef`，不得保存 API key 明文。

### 6.2 SecretStore 分层

优先级：

1. 系统 keychain / credential manager：
   - macOS Keychain
   - Windows Credential Manager
   - Linux Secret Service / libsecret
2. Tauri app local data 下的本机 secret 文件：
   - 仅作为降级方案。
   - UI 明确提示安全性较弱。
3. 开发期明文配置：
   - 只能用于开发调试。
   - UI / 文档明确标注“不安全，不建议正式使用”。

### 6.3 硬性测试

保存以下内容后，全项目/应用数据目录扫描不得出现 API key 明文：

- 主 semantic v4 文档。
- blueprint sidecar。
- AppSettings。
- 导出的设置文件。
- 普通日志。
- Agent request/response debug 日志。

## 7. AgentResponse v1 协议修订

Agent 属于后续 Milestone 4/5。协议先保留，但不阻塞 MVP 0。

### 7.1 基础字段

```ts
export interface AgentResponseBase {
  schemaVersion: 'agent-response-v1'
  semanticVersion: 'easyanalyse-semantic-v4'
  capabilities?: AgentResponseCapabilities
  kind: 'message' | 'blueprints' | 'patch' | 'question' | 'error'
  requestId?: string
  summary?: string
  warnings?: string[]
}

export interface AgentResponseCapabilities {
  canCreateBlueprints?: boolean
  canModifyBlueprints?: boolean
  supportsPatch?: boolean
  maxBlueprints?: number
  responseLanguages?: Array<'zh-CN' | 'en-US'>
}
```

### 7.2 解析策略

- 未知 `schemaVersion`：拒绝，并提示协议不兼容。
- 未知 `semanticVersion`：拒绝或只读导入，具体由后续实现决定；MVP 先拒绝。
- 未知 `kind`：拒绝。
- 未知字段：默认保留 warning，不直接失败。
- 协议级失败：不污染蓝图列表。
- Document 校验失败：仍可入库为蓝图，并记录 `validationState='invalid'` 与 report。

### 7.3 Agent 永远不能直接改主文档

即使真实 Provider 接入后，Agent 的输出也只能成为：

- 新蓝图。
- 派生蓝图。
- 后续 patch 草案。
- 问题或解释文本。

主文档改变必须始终经过用户在 UI 中点击“应用蓝图”。

## 8. Agent 上下文发送策略

为避免大文档超限和隐私风险，Agent 接入时按以下优先级构造上下文。

### 8.1 默认上下文

默认发送：

1. 当前用户请求。
2. semantic v4 精简规则摘要。
3. 当前主文档摘要：
   - device 列表。
   - terminal 与 label 列表。
   - validation summary。
   - 当前选中对象摘要。
4. 如用户明确要求基于完整文档改造，才附完整 DocumentFile。

### 8.2 大文档降级

当上下文超限时，不应只报 `AGENT_CONTEXT_TOO_LARGE`。应按顺序降级：

1. 只发送选中对象及其相邻 label 网络。
2. 只发送 device/terminal/label 摘要。
3. 发送 validation report 与用户目标。
4. 请求用户选择范围或允许发送完整文档。

### 8.3 上传确认

首次向远端 Provider 发送当前电路内容前，应显示确认：

- 将发送哪些内容。
- 发送到哪个 Provider / baseUrl。
- 是否包含完整文档。
- API key 不会写入文档或 sidecar。

## 9. 五个可执行 Milestone

### Milestone 1：Blueprint Core，无 Agent、无 Provider

目标：证明主文档与蓝图 sidecar 能隔离存在。

完成内容：

- `BlueprintWorkspaceFileV1` 类型。
- sidecar path 计算。
- workspace parse / serialize / migration。
- canonical document hash。
- `blueprintStore` 基础状态。
- 从当前主文档创建蓝图快照。
- 保存/加载 sidecar。
- 校验状态 `unknown / valid / invalid` 基础流转。

验收：

- 不配置任何 API key 也能创建和保存蓝图。
- 主文档不出现蓝图字段。
- sidecar 不影响主文档保存。
- invalid 蓝图不会丢失。

### Milestone 2：Blueprint UI 闭环，无 Agent

目标：形成完整人工蓝图流程。

完成内容：

- 右侧 Blueprints 面板。
- 蓝图列表、重命名、删除/归档、复制。
- `CircuitCanvasRenderer` 纯渲染层。
- `BlueprintPreviewCanvas` 只读预览。
- 蓝图校验报告展示。
- 摘要 diff。
- `ApplyBlueprintDialog`。
- `editorStore.applyBlueprintDocument`。
- 应用后 dirty=true，进入 undo/redo。
- `appliedInfo` 写入 sidecar。
- `isCurrentMainDocument` 运行时展示。

验收：

- invalid 蓝图可应用，但必须强提示。
- 应用不直接写磁盘。
- 应用后 undo 能恢复应用前主文档。
- undo 后 `appliedInfo` 保留，但 `isCurrentMainDocument=false`。
- 预览蓝图不会改变主文档 hash。

### Milestone 3：Settings + Secrets

目标：把成熟软件设置体系搭好，但不要求真实 Agent 生成蓝图。

完成内容：

- 设置中心 shell。
- 基本配置。
- 外观：`system | light | dark`。
- Provider public config。
- Model config。
- SecretStore / keychain 封装。
- API key masked 输入、保存、删除。
- Provider 测试连接可先 mock 或只发最小 ping。

验收：

- API key 不进入主文档、sidecar、AppSettings、普通日志。
- 夜间模式即时生效且持久化。
- 删除 Provider 时能处理关联 secret。

### Milestone 4：Agent Protocol + Mock Agent

目标：验证 Agent 协议、UI 与蓝图入库链路，不被真实 API 干扰。

完成内容：

- AgentResponse schema parser。
- `schemaVersion / semanticVersion / capabilities` 校验。
- Mock provider 返回多个 blueprint candidates。
- valid / invalid candidates 都可入蓝图列表。
- 协议错误不污染蓝图列表。
- Agent 面板最小版：输入、发送、取消、错误、结果卡片。

验收：

- Mock Agent 不能直接修改主文档。
- Agent candidate 入库后与人工蓝图走同一预览/应用流程。
- invalid candidate 不被丢弃，只显示强提示。

### Milestone 5：真实 Provider + 打磨回归

目标：接入真实模型并完成产品化打磨。

完成内容：

- OpenAI-compatible adapter。
- DeepSeek preset。
- Anthropic Messages adapter。
- timeout / cancel / retry。
- Provider 错误映射。
- 首次上传确认。
- 上下文大小控制与降级。
- 回归测试、文档、可访问性与错误文案。

验收：

- OpenAI / Anthropic / DeepSeek 均可通过设置中心配置。
- 模型生成多个蓝图后可进入统一蓝图列表。
- 网络/鉴权/协议错误不会破坏主文档或 sidecar。

## 10. 子任务模板：输入 / 输出 / 禁止边界

后续所有可委派给子代理的任务都必须带三段边界。

```markdown
### Task X：任务名

Input:
- 允许读取哪些文件/类型。
- 依赖哪些现有 store / commands / schema。
- 需要遵守哪些规划文档。

Output:
- 必须新增/修改哪些文件。
- 必须导出哪些函数/组件/类型。
- 必须补哪些测试或验收脚本。

Forbidden:
- 不得修改哪些文件或格式。
- 不得引入哪些依赖。
- 不得改变哪些用户可见行为。
- 不得绕过哪些校验/确认流程。
```

### 示例：Blueprint Preview Renderer

Input:

- 读取现有 `CanvasView.tsx` 渲染逻辑。
- 读取 `editorStore` 但只用于识别当前写路径，不得复用 mutation。
- 遵守 semantic v4 中 view 只负责可读性、不表达电气真值的规则。

Output:

- 新增 `CircuitCanvasRenderer`。
- 新增 `BlueprintPreviewCanvas`。
- 主 `CanvasView` 可逐步迁移到使用 renderer。
- 补预览 hash 不变测试。

Forbidden:

- `BlueprintPreviewCanvas` 不得调用 `editorStore` mutation。
- readOnly 不能只靠 CSS 或事件冒泡阻断。
- 预览交互不得改变 selection、placement、device positions 或 terminal labels。

### 示例：Apply Blueprint

Input:

- 当前主文档。
- `BlueprintRecord.document`。
- 当前主文档 hash。
- 蓝图 base hash 与 validation report。

Output:

- `editorStore.applyBlueprintDocument(document, metadata)`。
- history push。
- dirty=true。
- sidecar 中 `appliedInfo` 更新。
- 运行时 `isCurrentMainDocument` 重新计算。

Forbidden:

- 不得因为 validation issue 阻止应用。
- 不得直接保存磁盘。
- 不得修改 semantic v4 schema。
- 不得绕过用户确认弹窗。

## 11. 第一批实施任务清单

第一批只做 Milestone 1 和 Milestone 2。

### Task 1：蓝图类型与 sidecar 路径

Input:

- `exchange.md`
- `AI原生电路交换格式.schema.json`
- 现有 Rust/TS DocumentFile 类型位置
- 当前打开/保存文件路径逻辑

Output:

- `BlueprintWorkspaceFileV1` / `BlueprintRecord` TS 类型。
- sidecar path 计算函数。
- 基础 parse/serialize 函数。

Forbidden:

- 不得给主 semantic v4 文档添加蓝图字段。
- 不得接入 Agent 或 Provider。
- 不得保存 API key。

### Task 2：canonical hash 与 validation report wrapper

Input:

- 当前 DocumentFile。
- 现有 Rust core validation 能力。
- 现有保存/校验 command。

Output:

- canonical hash helper。
- 蓝图 validation report wrapper。
- `validationState` 更新函数。

Forbidden:

- 不得把 validation issue 作为 apply 门禁。
- 不得丢弃 invalid 蓝图。

### Task 3：blueprintStore 基础

Input:

- `editorStore` 当前模式。
- sidecar 类型与 parse/serialize。

Output:

- `blueprintStore`。
- create snapshot / duplicate / rename / archive / delete。
- load/save workspace。
- dirty state。

Forbidden:

- store action 不得直接改主文档，除 apply 相关 action 外。
- 不得写磁盘时修改主文档。

### Task 4：Blueprints 面板基础 UI

Input:

- 当前 App layout / Inspector / Canvas 结构。
- `blueprintStore`。

Output:

- 右侧 Blueprints tab/panel。
- 空状态。
- 列表。
- 创建当前主文档快照按钮。
- 重命名、复制、归档/删除。

Forbidden:

- 不得实现 Agent 输入框作为 MVP 必需项。
- 不得让列表操作修改主文档。

### Task 5：纯渲染预览

Input:

- 当前 `CanvasView.tsx` 渲染逻辑。
- 当前主题变量。

Output:

- `CircuitCanvasRenderer`。
- `BlueprintPreviewCanvas`。
- 蓝图详情区预览。

Forbidden:

- 预览组件不得 import 主 store mutation。
- 不得通过 readOnly guard 假装只读但保留写路径。

### Task 6：diff 与应用确认

Input:

- 当前主文档。
- 选中蓝图 document。
- validation report。
- document hash。

Output:

- 摘要 diff：device / terminal / label / view / raw JSON。
- `ApplyBlueprintDialog`。
- 强风险提示逻辑。
- `editorStore.applyBlueprintDocument`。

Forbidden:

- 不得因 invalid 阻止应用。
- 不得直接保存磁盘。
- 不得跳过用户确认。

### Task 7：undo/redo 与 appliedInfo

Input:

- `editorStore` history 结构。
- `BlueprintRecord.appliedInfo`。

Output:

- 应用动作进入 undo history。
- 应用后写 `appliedInfo`。
- `isCurrentMainDocument` selector。
- undo 后状态展示正确。

Forbidden:

- 不得把 `applied` 作为生命周期 status。
- 不得在 undo 时删除 appliedInfo 历史。

## 12. 与旧规划的冲突处理

以下旧表述全部被本文覆盖：

| 旧表述 | 新表述 |
|---|---|
| invalid 蓝图不能应用 | invalid 蓝图可应用，但必须强提示 |
| 零 warning/issue 才可应用 | 校验问题只提示，不作为应用门禁 |
| status 包含 valid/invalid/applied | 生命周期、校验状态、应用历史拆分 |
| applied 表示蓝图状态 | `appliedInfo` 表示历史，`isCurrentMainDocument` 运行时计算 |
| MVP 包含 Agent / Provider | MVP 先做无 Agent 蓝图闭环 |
| CanvasView readOnly/documentOverride 是推荐 MVP | 优先拆 `CircuitCanvasRenderer` 纯渲染层 |
| API key 存本机应用配置 | 普通设置与 SecretStore 分层，优先 OS keychain |

## 13. 当前仍需后续细化的问题

以下不是阻塞 MVP 0 的问题，但进入对应 Milestone 前需要细化：

1. 保存主文档是否未来支持“强制保存 invalid 文档”。当前保持现状：保存仍走现有门禁。
2. Linux Secret Service 不可用时的降级实现细节。
3. Agent prompt 中 semantic v4 摘要的最终文本。
4. 大文档上下文摘要算法。
5. Provider 测试连接是否允许发真实最小请求，还是先 mock。
6. raw JSON diff 使用现有库还是自实现。
7. 蓝图 sidecar 是否需要自动备份/恢复机制。

## 14. 推荐下一步

下一步不是继续扩展 Agent 规划，而是正式进入 Milestone 1 的实现准备：

1. 派子代理读取当前桌面端 `editorStore`、文件打开/保存逻辑、CanvasView 渲染路径。
2. 让子代理输出 Milestone 1 具体文件级施工图。
3. 主代理审查后，按 Task 1 -> Task 3 顺序先落地 blueprints core。
4. Milestone 1 通过后再进入预览和应用闭环。
