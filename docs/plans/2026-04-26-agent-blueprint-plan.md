# EasyAnalyse 桌面版内置 Agent 与蓝图功能实施规划

> **For Hermes:** 后续实施请优先使用 `subagent-driven-development` 或派子代理按阶段执行；大量文件读取、脚本运行、测试输出由子代理压缩回传。

**目标：** 在 EasyAnalyse 桌面版中引入“蓝图（Blueprint）+ 内置 Agent”工作流，让用户配置大模型 API 后，可基于自然语言创建/修改多个电路蓝图；蓝图编辑不影响主文件，用户确认应用后再用蓝图替换主文件。

**架构：** 采用“主文档 / 蓝图工作区 / Agent 会话”三层隔离。主文档继续保持 semantic v4 标准文件；蓝图使用 wrapper 持久化多个候选 semantic v4 文档及元数据；Agent 只能创建/修改蓝图，不能直接写主文档。应用蓝图时经过校验、预览、确认，再整文档替换主文档。

**技术栈：** Tauri 2 + React 19 + TypeScript + Zustand + Rust easyanalyse-core + semantic v4 schema/validation + OpenAI-compatible Agent provider 抽象。

---

## 0. 背景与硬约束

### 0.1 最高优先级格式规范

`exchange.md` 是本规划的格式最高优先级来源。当前唯一规范交换格式：

```json
{
  "schemaVersion": "4.0.0",
  "document": {},
  "devices": [],
  "view": {},
  "extensions": {}
}
```

所有蓝图内部电路文档必须是 semantic v4 `DocumentFile`。Agent 不能生成旧拓扑模型。

### 0.2 semantic v4 不可违反约束

- 连接真值只由 terminal 的非空 `label` 决定。
- 禁止持久化：`wires`、`nodes`、`junctions`、bend points、standalone `signals`、`signalId`、terminal 自由坐标、terminal label 坐标。
- `view` 只表示可读性；`view.networkLines` 是公共网络 label 的视觉摘要，不是 wire。
- `terminal.direction` 只允许 `input` / `output`。
- `view.devices` 只能引用已有 device id。
- `view.networkLines[*].label` 必须被至少一个 terminal 使用。
- 保存门禁要求 `schemaValid=true` 且 `semanticValid=true`；当前 warning 也会导致 semantic invalid，所以最终可应用蓝图必须零 issue。

### 0.3 当前项目关键入口

- 主编辑状态：`easyanalyse-desktop/src/store/editorStore.ts`
- 前端类型：`easyanalyse-desktop/src/types/document.ts`
- 前端 normalize：`easyanalyse-desktop/src/lib/document.ts`
- Canvas：`easyanalyse-desktop/src/components/CanvasView.tsx`
- Inspector：`easyanalyse-desktop/src/components/Inspector.tsx`
- App 顶层：`easyanalyse-desktop/src/App.tsx`
- Tauri invoke：`easyanalyse-desktop/src/lib/tauri.ts`
- Rust commands：`easyanalyse-desktop/src-tauri/src/commands.rs`
- Rust core：`easyanalyse-desktop/src-tauri/crates/easyanalyse-core/src/{model.rs,validation.rs,lib.rs}`
- Schema：`easyanalyse-desktop/src-tauri/crates/easyanalyse-core/schema/ai-native-circuit-exchange.schema.json`

---

## 1. 产品定义

### 1.1 核心概念

#### 主文档 Main Document

用户当前打开/保存的标准 semantic v4 文件。它仍由现有打开、保存、校验、画布、Inspector 流程管理。

#### 蓝图 Blueprint

一个不会直接影响主文档的候选电路方案。每个蓝图至少包含：

- 标准 semantic v4 `document`。
- 蓝图元数据：id、标题、摘要、创建时间、更新时间、来源、状态。
- 与主文档的关系：baseDocumentId、baseHash、生成 prompt、Agent 模型信息。
- 校验结果：schema/semantic validation report。
- 可选说明：适用场景、优缺点、关键设计取舍。

#### 蓝图工作区 Blueprint Workspace

当前主文件旁边或应用内部维护的一组蓝图。一个主文档可对应多个蓝图。

#### Agent

桌面内置的受控自然语言助手。Agent 只能操作蓝图，不直接修改主文档。它的能力包括：

1. 基于当前主文档或空白需求创建一个或多个蓝图。
2. 修改指定蓝图。
3. 解释蓝图差异与电路设计思路。
4. 请求校验蓝图。
5. 在用户确认后触发应用蓝图。

### 1.2 MVP 范围

MVP 必须支持：

- 用户配置 OpenAI-compatible API：base URL、model、API key。
- Agent 面板对话。
- 一次请求生成多个蓝图方案。
- 蓝图列表：标题、摘要、状态、校验结果。
- 蓝图预览：查看蓝图电路 JSON/画布预览/校验报告。
- 修改蓝图：通过 Agent 对指定蓝图重新生成或 patch。
- 应用蓝图：确认后整文档替换主文档，标记 dirty，并重新校验。
- 蓝图删除/重命名。

MVP 暂不做：

- 自动 merge 主文档局部差异。
- 电路仿真。
- 云端账户同步。
- 任意 shell/tool 执行。
- 移动端蓝图编辑。
- 复杂多 Agent 自主循环。

### 1.3 非目标

- 不把 EasyAnalyse 变成传统 wire-based EDA。
- 不让大模型直接写磁盘主文件。
- 不让大模型绕过 schema/semantic validation。
- 不在主 `DocumentFile` 顶层添加 `blueprints` 字段。

---

## 2. 蓝图数据模型设计

### 2.1 推荐：独立 Blueprint Workspace wrapper

不要修改 semantic v4 主文档 schema。新增独立蓝图文件结构，例如：

```ts
export interface BlueprintWorkspaceFile {
  blueprintWorkspaceVersion: '1.0.0'
  mainDocumentId?: string
  mainDocumentPath?: string
  mainDocumentHash?: string
  createdAt: string
  updatedAt: string
  blueprints: BlueprintRecord[]
}

export interface BlueprintRecord {
  id: string
  title: string
  summary: string
  status: 'draft' | 'valid' | 'invalid' | 'applied' | 'archived'
  source: 'agent' | 'human' | 'imported'
  createdAt: string
  updatedAt: string
  baseDocumentId?: string
  baseDocumentHash?: string
  parentBlueprintId?: string
  prompt?: string
  rationale?: string
  tradeoffs?: string[]
  model?: AgentModelInfo
  document: DocumentFile
  validationReport?: ValidationReport
}

export interface AgentModelInfo {
  provider: 'openai-compatible' | 'ollama' | 'custom'
  baseUrl?: string
  model: string
}
```

### 2.2 文件存储策略

推荐 MVP：**sidecar 蓝图文件**。

如果主文件是：

```text
/path/project/foo.json
```

对应蓝图工作区：

```text
/path/project/foo.easyanalyse-blueprints.json
```

优点：

- 不污染主 semantic v4 文件。
- 可随项目文件一起备份/版本控制。
- 便于多蓝图持久化。
- 不依赖 Tauri app data 隐藏目录，用户可掌控。

注意：

- 新建未保存主文档时，蓝图可暂存在 app memory，直到主文档保存后再落 sidecar。
- 如用户另存为主文件，应提示是否迁移/复制 blueprints sidecar。
- sidecar wrapper 不能直接传给现有 `validate_value`；只能校验其中 `BlueprintRecord.document`。

### 2.3 蓝图 hash 与冲突检测

应用蓝图前比较：

- 蓝图 `baseDocumentHash`
- 当前主文档 hash

若不一致，说明蓝图生成后主文档已变化。MVP 策略：

- 弹窗提示：“当前主文件已变更，应用蓝图会用蓝图整文档替换当前内容。”
- 用户仍可强制应用。
- 不做自动 merge。

hash 建议：

- 对 normalized document 做稳定 JSON stringify。
- diff/hash 时忽略 `document.updatedAt`，避免 normalize 刷新时间导致误报。

### 2.4 蓝图状态机

```text
created/draft
  ├─ validate success -> valid
  ├─ validate fail    -> invalid
  ├─ modified         -> draft
  ├─ apply success    -> applied
  └─ delete/archive   -> archived/deleted
```

推荐状态字段：

- `draft`：可编辑，但尚未确认最新校验。
- `valid`：最近一次校验零 issue，可应用。
- `invalid`：最近一次校验失败，不允许直接应用。
- `applied`：已应用过，保留记录。
- `archived`：隐藏但不删除。

---

## 3. Agent 输出协议设计

### 3.1 不接受自由文本直接改文档

Agent response 必须是结构化 JSON。推荐顶层 union：

```ts
export type AgentResponse =
  | AgentMessageResponse
  | AgentBlueprintsResponse
  | AgentPatchResponse
  | AgentQuestionResponse
  | AgentErrorResponse

export interface AgentMessageResponse {
  kind: 'message'
  markdown: string
}

export interface AgentBlueprintsResponse {
  kind: 'blueprints'
  summary: string
  blueprints: AgentBlueprintCandidate[]
}

export interface AgentPatchResponse {
  kind: 'patch'
  blueprintId: string
  summary: string
  operations: CircuitEditOperation[]
}

export interface AgentQuestionResponse {
  kind: 'question'
  question: string
  options?: string[]
}

export interface AgentErrorResponse {
  kind: 'error'
  message: string
  recoverable: boolean
}
```

### 3.2 多蓝图 candidate

```ts
export interface AgentBlueprintCandidate {
  title: string
  summary: string
  rationale: string
  tradeoffs: string[]
  document: DocumentFile
}
```

要求：

- `document` 必须完整 semantic v4。
- 每个 candidate 先在前端/Rust 校验，再进入蓝图列表。
- 若部分 valid、部分 invalid，仍可保存 invalid 蓝图，但 UI 必须明确不可应用。

### 3.3 Patch DSL：第二阶段增强

MVP 可先要求模型返回完整 `DocumentFile` candidate。第二阶段再引入 patch DSL，降低大文档误改风险。

建议操作集：

```ts
export type CircuitEditOperation =
  | { op: 'add_device'; device: DeviceDefinition; view?: DeviceViewDefinition }
  | { op: 'update_device'; deviceId: string; patch: Partial<DeviceDefinition> }
  | { op: 'remove_device'; deviceId: string }
  | { op: 'add_terminal'; deviceId: string; terminal: TerminalDefinition }
  | { op: 'update_terminal'; terminalId: string; patch: Partial<TerminalDefinition> }
  | { op: 'remove_terminal'; terminalId: string }
  | { op: 'rename_label'; from: string; to: string }
  | { op: 'set_device_view'; deviceId: string; view: DeviceViewDefinition }
  | { op: 'add_network_line'; id: string; line: NetworkLineViewDefinition }
  | { op: 'update_network_line'; id: string; patch: Partial<NetworkLineViewDefinition> }
  | { op: 'remove_network_line'; id: string }
  | { op: 'update_document_meta'; patch: Partial<DocumentMeta> }
```

Patch 应用规则：

1. 对蓝图 clone 应用 patch。
2. 本地 normalize。
3. Rust validate。
4. 生成 diff。
5. 用户确认后写回蓝图。

禁止 patch 操作：

- add_wire
- add_node
- add_junction
- set_terminal_position
- set_signal_id
- mutate_main_document_directly

### 3.4 Agent system prompt 必备规则

Agent prompt 必须包含精简但硬性的 semantic v4 规则：

- 只生成 `schemaVersion: "4.0.0"`。
- 不生成 wires/nodes/junctions/signals/signalId。
- 连接只通过 terminal label。
- view 不表达电气连接。
- networkLines 只给已存在 terminal label 做视觉摘要。
- direction 只能 input/output。
- 常见器件用 canonical kind。
- 电阻/电容/电感必须填 value，晶振必须填 frequency，电源 rail 必须有电压。
- 目标是零 validation issue。
- 需要多个方案时，用多个完整 blueprint candidate。

---

## 4. Agent Provider 与安全设计

### 4.1 Provider 抽象

新增：

```ts
export interface AgentProviderConfig {
  id: string
  type: 'openai-compatible'
  name: string
  baseUrl: string
  apiKeyRef: string
  model: string
  temperature?: number
  maxTokens?: number
}
```

运行接口：

```ts
export interface AgentProvider {
  complete(request: AgentRequest): Promise<AgentResponse>
}
```

首期只做 OpenAI-compatible，保留扩展：Ollama、LM Studio、Hermes/Open WebUI、本地模型。

### 4.2 API key 存储

安全原则：

- API key 不写入 `.easyanalyse` 主文件。
- API key 不写入 blueprint sidecar。
- 优先使用 Tauri secure store / OS keychain；若暂不可用，使用应用配置文件也必须明确告知用户风险并避免进入项目目录。
- UI 中只显示 masked key。

### 4.3 数据上传告知

因为用户电路内容会发送给模型 provider，UI 必须明确：

- “将当前主文档/选定蓝图发送到配置的模型 API。”
- “不要使用不可信 provider 处理敏感电路。”
- 支持只发送必要上下文：需求 + 当前文档摘要 + 完整 JSON 可由用户选择。

### 4.4 Tauri 命令安全边界

Agent 不应拥有任意 shell/file 权限。推荐新增受控 commands：

- `load_agent_settings`
- `save_agent_settings`
- `send_agent_request`
- `load_blueprint_workspace`
- `save_blueprint_workspace`
- `validate_blueprint_document`
- `apply_blueprint_document`

所有文件写入路径由 Rust 侧根据主文件路径推导或通过 dialog 确认，不接受模型直接提供任意系统路径。

---

## 5. 前端状态架构

### 5.1 新增 store：blueprintStore

新增文件：

- `easyanalyse-desktop/src/store/blueprintStore.ts`

核心状态：

```ts
interface BlueprintState {
  workspace: BlueprintWorkspaceFile | null
  activeBlueprintId: string | null
  previewMode: 'main' | 'blueprint'
  dirty: boolean
  loading: boolean
  error: string | null
}
```

核心 actions：

- `loadWorkspaceForMainFile(filePath, document)`
- `saveWorkspace()`
- `createBlueprintFromDocument(document, meta)`
- `addAgentBlueprints(candidates)`
- `selectBlueprint(id)`
- `renameBlueprint(id, title)`
- `deleteBlueprint(id)`
- `mutateBlueprint(id, mutator)`
- `validateBlueprint(id)`
- `applyBlueprint(id)`
- `setPreviewMode(mode)`

### 5.2 新增 store：agentStore

新增文件：

- `easyanalyse-desktop/src/store/agentStore.ts`

核心状态：

```ts
interface AgentState {
  settings: AgentSettings
  messages: AgentChatMessage[]
  running: boolean
  activeRequestId: string | null
  error: string | null
}
```

核心 actions：

- `loadSettings()`
- `saveSettings(settings)`
- `sendMessage(prompt, context)`
- `cancelRequest()`
- `clearConversation()`

### 5.3 主 store 交互

`editorStore` 保持主文档权威来源。蓝图应用时调用一个明确 action，例如：

```ts
replaceDocumentFromBlueprint(document, options)
```

行为：

- normalize document。
- reset selection/focus/pending placement。
- push current main doc into undo history 或清空 history（二者选一，见下）。
- set dirty true。
- request validation。

推荐 MVP：应用蓝图作为一次可撤销替换，进入 undo history。

---

## 6. UI/UX 设计

### 6.1 推荐布局

在桌面端右侧新增 Agent/Blueprint 面板，与 Inspector 可切换 tab：

```text
┌───────────────────────────────┬─────────────────────────┐
│ Canvas                        │ Inspector | Agent       │
│                               │ ─────────────────────── │
│                               │ Agent 对话              │
│                               │ Prompt 输入             │
│                               │ Blueprint 列表          │
│                               │ 校验 / Diff / 应用按钮  │
└───────────────────────────────┴─────────────────────────┘
```

### 6.2 蓝图列表

每个蓝图卡片显示：

- 标题
- 简述
- 状态：draft/valid/invalid/applied
- validation issue count
- 创建时间/更新时间
- 模型名
- 按钮：预览、校验、复制、重命名、删除、应用

### 6.3 预览模式

MVP 两种实现选择：

#### 方案 A：独立只读 BlueprintPreviewCanvas

优点：隔离彻底，不容易误改主文档。  
缺点：复用 Canvas 代码需要抽象。

#### 方案 B：Canvas 支持 documentOverride + readOnly

改造 `CanvasView.tsx`：

```ts
<CanvasView documentOverride={activeBlueprint.document} readOnly />
```

推荐 MVP：方案 B，但必须禁止拖拽/Inspector 修改直接写主文档。

### 6.4 Diff/替换确认

应用蓝图前弹确认：

- 主文档标题 -> 蓝图标题。
- device 数变化。
- terminal 数变化。
- label/net 数变化。
- validation 状态。
- base hash 是否匹配。
- 明确文案：“应用后会用该蓝图替换当前主文档，当前主文档未保存修改可能被覆盖；可使用撤销返回。”

MVP diff 可先摘要化；后续做结构化 diff。

### 6.5 Agent 对话体验

推荐快捷 prompt：

- “基于当前电路生成 3 个改进蓝图”
- “创建一个 RC 低通滤波器蓝图”
- “把当前蓝图改成 5V 输入、3.3V 输出”
- “检查该蓝图为什么不能保存”
- “解释这几个蓝图的区别”

Agent 回复中如果包含蓝图，直接进入蓝图列表，不只显示文本。

---

## 7. Rust/Tauri 后端规划

### 7.1 Rust core 复用

现有 `easyanalyse-core::validate_value` 是所有蓝图可应用性的权威校验。新增蓝图校验命令应复用它。

新增命令建议：

```rust
#[tauri::command]
pub fn validate_blueprint_document(document: Value) -> Result<ValidationReport, String>
```

可直接调用 `validate_value`。

### 7.2 蓝图工作区文件命令

新增：

```rust
#[tauri::command]
pub fn load_blueprint_workspace(main_path: String) -> Result<Option<Value>, String>

#[tauri::command]
pub fn save_blueprint_workspace(main_path: String, workspace: Value) -> Result<(), String>
```

Rust 侧职责：

- 根据 main_path 推导 sidecar path。
- 防止路径穿越。
- pretty JSON 写入。
- 基础 wrapper version 校验。

### 7.3 Agent request 命令

MVP 可由前端直接 fetch OpenAI-compatible API，但更推荐 Rust command：

```rust
#[tauri::command]
pub async fn send_agent_request(request: AgentRequest) -> Result<AgentResponse, String>
```

原因：

- 避免浏览器/CORS 问题。
- API key 不暴露给前端运行时更多位置。
- 可统一 timeout/retry/error。
- 未来可接 OS keychain。

### 7.4 应用蓝图命令是否需要后端

应用蓝图可以在前端调用 `editorStore.replaceDocumentFromBlueprint`，再由现有保存流程处理。无需立即写磁盘。

如果要由后端 apply：

- 后端只返回 normalized valid document。
- 前端负责替换 store。

MVP 推荐前端应用，后端只校验。

---

## 8. 分阶段实施计划

### Phase 1：基础类型与蓝图工作区

**目标：** 建立蓝图数据类型、store、sidecar 读写，不接 Agent。

**文件：**

- Create: `easyanalyse-desktop/src/types/blueprint.ts`
- Create: `easyanalyse-desktop/src/store/blueprintStore.ts`
- Modify: `easyanalyse-desktop/src/lib/tauri.ts`
- Modify: `easyanalyse-desktop/src-tauri/src/commands.rs`
- Modify: `easyanalyse-desktop/src-tauri/src/main.rs`

**验收：**

- 可从当前主文档创建一个蓝图。
- 蓝图保存在 sidecar wrapper。
- 重新打开主文档能加载蓝图列表。
- 主文档 JSON 未新增任何 `blueprints` 顶层字段。

### Phase 2：蓝图 UI 与只读预览

**目标：** 用户能查看多个蓝图，不影响主文件。

**文件：**

- Create: `easyanalyse-desktop/src/components/BlueprintPanel.tsx`
- Create: `easyanalyse-desktop/src/components/BlueprintList.tsx`
- Create: `easyanalyse-desktop/src/components/BlueprintPreview.tsx`
- Modify: `easyanalyse-desktop/src/components/CanvasView.tsx`
- Modify: `easyanalyse-desktop/src/App.tsx`

**验收：**

- 右侧面板显示蓝图列表。
- 选中蓝图可只读预览。
- 预览模式下拖拽/Inspector 不会修改主文档。
- 可删除/重命名蓝图。

### Phase 3：蓝图校验与应用

**目标：** 蓝图经过 validation 后可替换主文档。

**文件：**

- Modify: `easyanalyse-desktop/src/store/blueprintStore.ts`
- Modify: `easyanalyse-desktop/src/store/editorStore.ts`
- Create: `easyanalyse-desktop/src/components/ApplyBlueprintDialog.tsx`
- Create: `easyanalyse-desktop/src/lib/documentHash.ts`
- Create: `easyanalyse-desktop/src/lib/documentSummary.ts`

**验收：**

- 点击校验，显示 schema/semantic issue。
- invalid 蓝图不能直接应用。
- valid 蓝图应用前有摘要确认。
- 应用后主文档被替换、dirty=true、重新校验。
- 应用操作可撤销或至少有明确确认。

### Phase 4：Agent provider 设置

**目标：** 用户可配置模型 API。

**文件：**

- Create: `easyanalyse-desktop/src/types/agent.ts`
- Create: `easyanalyse-desktop/src/store/agentStore.ts`
- Create: `easyanalyse-desktop/src/components/AgentSettingsDialog.tsx`
- Modify: `easyanalyse-desktop/src-tauri/src/commands.rs`
- Modify: `easyanalyse-desktop/src/lib/tauri.ts`

**验收：**

- 可保存 baseUrl/model/apiKey。
- API key 不写入主文档/蓝图 sidecar。
- 可发送测试请求并显示成功/失败。

### Phase 5：Agent 创建多个蓝图

**目标：** Agent 根据自然语言一次返回多个 blueprints。

**文件：**

- Create: `easyanalyse-desktop/src/lib/agentPrompt.ts`
- Create: `easyanalyse-desktop/src/lib/agentResponseSchema.ts`
- Create: `easyanalyse-desktop/src/components/AgentPanel.tsx`
- Modify: `easyanalyse-desktop/src/store/agentStore.ts`
- Modify: `easyanalyse-desktop/src/store/blueprintStore.ts`

**验收：**

- 用户输入“生成 3 种分压电路方案”后，蓝图列表新增 3 个 candidate。
- 每个 candidate 自动校验并显示 valid/invalid。
- 模型返回非 JSON/格式错误时，不污染蓝图列表，并给出修复提示。
- Agent prompt 中包含 semantic v4 硬约束。

### Phase 6：Agent 修改蓝图

**目标：** Agent 可基于选定蓝图做修改。

**文件：**

- Modify: `easyanalyse-desktop/src/lib/agentPrompt.ts`
- Modify: `easyanalyse-desktop/src/store/agentStore.ts`
- Modify: `easyanalyse-desktop/src/store/blueprintStore.ts`
- Optional Create: `easyanalyse-desktop/src/lib/circuitPatch.ts`

**验收：**

- 选中蓝图后输入“把输出改为 3.3V 并加 LED 指示”，生成修改后的新版本或派生蓝图。
- 默认不覆盖原蓝图，可选择“覆盖”或“创建派生蓝图”。
- 修改后自动校验。

### Phase 7：测试、文档与回归

**目标：** 建立可持续验证。

**文件：**

- Create tests under `easyanalyse-desktop/src/**/*.test.ts`
- Modify: `easyanalyse-desktop/README.md`
- Optional Modify: root `README.md`

**验收命令：**

```bash
cd easyanalyse-desktop
npm install
npm test
npm run build
```

如果 Rust 工具链可用：

```bash
cd easyanalyse-desktop/src-tauri
cargo test
```

验收标准：

- 新增类型/工具函数有单测。
- 蓝图保存/加载/hash/summary/agent response parse 有单测。
- 现有 semantic v4 示例仍通过 core validation。
- 构建通过。

---

## 9. 测试策略

### 9.1 单元测试

重点覆盖：

- `documentHash` 忽略 `updatedAt` 后稳定。
- sidecar path 推导。
- blueprint wrapper parse/serialize。
- invalid Agent JSON 不进入 store。
- 多蓝图 candidate 部分失败时的状态。
- apply blueprint 替换主文档并设置 dirty。
- networkLine label 未使用时显示 invalid。
- 禁止出现 wires/nodes/signals/signalId。

### 9.2 集成测试

- 创建主文档 -> 创建蓝图 -> 保存 sidecar -> 重新打开 -> 蓝图仍存在。
- Agent mock 返回 2 个 valid + 1 个 invalid candidate。
- 应用 valid candidate 后主 Canvas 展示新文档。
- invalid candidate 应用按钮 disabled。

### 9.3 Prompt 回归语料

使用 `testJson` 示例构造 prompt：

- RC 低通
- 电阻分压
- LM358 放大器
- STM32 最小系统
- PWM motor driver

每类 prompt 校验：

- 输出 semantic v4。
- 无 wire/node/signal。
- value/frequency/voltage 完整。
- validation 零 issue。

---

## 10. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 模型生成旧 wire/node 格式 | 无法校验/破坏理念 | system prompt + response schema + forbidden field scan |
| 模型输出 JSON 不完整 | 蓝图不可用 | parse 失败不入库，提示重试/自动修复一次 |
| 蓝图污染主文档 | 用户数据风险 | store 隔离；Agent 只能写 blueprintStore |
| warning 也阻止保存 | Agent 方案常 invalid | prompt 要求零 issue；UI 明确 issue；可提供“让 Agent 修复” |
| API key 泄漏 | 安全风险 | 不写项目文件，使用 keychain/应用配置，UI mask |
| 主文档变更后应用旧蓝图 | 覆盖风险 | baseHash 检测 + 强确认 |
| normalize 更新时间影响 diff | 误报变化 | hash/diff 忽略 `document.updatedAt` |
| Canvas/Inspector 误编辑蓝图/主文档 | 状态错乱 | preview readOnly；后续再做显式 blueprint edit mode |
| 大文档 prompt 太长 | 请求失败/成本高 | 支持摘要模式；必要时用户选择发送完整 JSON |

---

## 11. 推荐优先级

1. **先做蓝图工作区，不接模型。** 证明主文档隔离与应用替换流程正确。
2. **再做蓝图 UI/预览/校验/应用。** 让手工蓝图可用。
3. **再接 Agent 创建蓝图。** 只允许完整 candidate，不做 patch。
4. **再做 Agent 修改蓝图。** 初期用“生成派生蓝图”，避免覆盖。
5. **最后做 patch DSL、结构化 diff、局部 merge。**

---

## 12. 需要用户进一步确认的产品决策

1. sidecar 文件名是否接受 `原文件名.easyanalyse-blueprints.json`？
2. MVP 应用蓝图是否确认采用“整文档替换主文件”，不做 merge？
3. 蓝图是否允许保存 invalid 草稿？本规划建议允许保存，但不可应用。
4. Agent 修改蓝图时，默认覆盖原蓝图还是创建派生蓝图？本规划建议默认创建派生蓝图。
5. API key 首期是否可以存本机应用配置，还是必须 OS keychain？
6. Agent 请求是否必须支持本地 Ollama/LM Studio，还是首期只做 OpenAI-compatible？

---

## 13. 第一批可执行任务清单（bite-sized）

### Task 1：新增蓝图类型

**Objective:** 定义 `BlueprintWorkspaceFile`、`BlueprintRecord` 等类型。

**Files:**

- Create: `easyanalyse-desktop/src/types/blueprint.ts`
- Test: `easyanalyse-desktop/src/types/blueprint.test.ts` 或相关 lib test

**Verification:** TypeScript 编译通过。

### Task 2：新增 document hash 工具

**Objective:** 为 baseHash 与冲突检测提供稳定 hash。

**Files:**

- Create: `easyanalyse-desktop/src/lib/documentHash.ts`
- Create: `easyanalyse-desktop/src/lib/documentHash.test.ts`

**Key requirement:** 忽略 `document.updatedAt`，稳定排序对象 key。

### Task 3：新增蓝图 workspace store skeleton

**Objective:** 建立 `blueprintStore`，可从主文档创建内存蓝图。

**Files:**

- Create: `easyanalyse-desktop/src/store/blueprintStore.ts`

**Verification:** 可通过临时 UI 或单测创建/选择/删除蓝图。

### Task 4：新增 sidecar Tauri 命令

**Objective:** 支持按主文件路径读写 blueprints sidecar。

**Files:**

- Modify: `easyanalyse-desktop/src-tauri/src/commands.rs`
- Modify: `easyanalyse-desktop/src-tauri/src/main.rs`
- Modify: `easyanalyse-desktop/src/lib/tauri.ts`

**Verification:** 保存/读取 wrapper JSON 成功，不影响主保存命令。

### Task 5：接入 App 生命周期

**Objective:** 打开主文件时加载蓝图 sidecar，保存/关闭时处理蓝图 dirty。

**Files:**

- Modify: `easyanalyse-desktop/src/App.tsx`
- Modify: `easyanalyse-desktop/src/store/editorStore.ts`
- Modify: `easyanalyse-desktop/src/store/blueprintStore.ts`

**Verification:** 重新打开文件后蓝图列表恢复。

### Task 6：蓝图列表 UI

**Objective:** 右侧显示蓝图列表与基础操作。

**Files:**

- Create: `easyanalyse-desktop/src/components/BlueprintPanel.tsx`
- Create: `easyanalyse-desktop/src/components/BlueprintList.tsx`
- Modify: `easyanalyse-desktop/src/App.tsx`

**Verification:** 可创建、选择、重命名、删除蓝图。

### Task 7：只读蓝图预览

**Objective:** 选中蓝图后可以只读查看画布。

**Files:**

- Create: `easyanalyse-desktop/src/components/BlueprintPreview.tsx`
- Modify: `easyanalyse-desktop/src/components/CanvasView.tsx`

**Verification:** 预览蓝图不会改主 `document`。

### Task 8：蓝图校验

**Objective:** 调用 Rust validation 校验蓝图内部 `DocumentFile`。

**Files:**

- Modify: `easyanalyse-desktop/src/store/blueprintStore.ts`
- Modify: `easyanalyse-desktop/src/lib/tauri.ts`

**Verification:** invalid 蓝图显示 issues，valid 蓝图可应用。

### Task 9：应用蓝图

**Objective:** valid 蓝图整文档替换主文档。

**Files:**

- Create: `easyanalyse-desktop/src/components/ApplyBlueprintDialog.tsx`
- Modify: `easyanalyse-desktop/src/store/editorStore.ts`
- Modify: `easyanalyse-desktop/src/store/blueprintStore.ts`

**Verification:** 应用后主文档变化、dirty=true、validation 刷新。

### Task 10：Agent settings MVP

**Objective:** 配置 OpenAI-compatible API。

**Files:**

- Create: `easyanalyse-desktop/src/types/agent.ts`
- Create: `easyanalyse-desktop/src/store/agentStore.ts`
- Create: `easyanalyse-desktop/src/components/AgentSettingsDialog.tsx`

**Verification:** 可保存配置，可 test connection。

### Task 11：Agent 创建蓝图 MVP

**Objective:** 用户 prompt -> 模型返回多个 blueprint candidates -> 入蓝图列表。

**Files:**

- Create: `easyanalyse-desktop/src/lib/agentPrompt.ts`
- Create: `easyanalyse-desktop/src/lib/agentResponseSchema.ts`
- Create: `easyanalyse-desktop/src/components/AgentPanel.tsx`
- Modify: `easyanalyse-desktop/src/store/agentStore.ts`
- Modify: `easyanalyse-desktop/src/store/blueprintStore.ts`

**Verification:** mock provider 返回多个方案并校验入库。

---

## 14. 当前规划结论

本功能应以“蓝图隔离”为第一性原则：Agent 永远先产出蓝图，蓝图永远先校验与预览，用户确认应用后才替换主文档。semantic v4 的核心规则必须贯穿 prompt、类型、校验、UI 与测试：**连接只由 terminal label 决定，view 只负责可读性，不生成任何 wire/junction/bend/signal 式拓扑数据。**
