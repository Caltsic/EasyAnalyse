# EasyAnalyse 蓝图 Milestone 1/2 文件级施工规划

> 日期：2026-04-26
> 状态：可作为 Milestone 1/2 代码落地的优先施工图。
> 上位依据：`2026-04-26-agent-blueprint-mvp-revision.md`。若本文与旧规划冲突，以 MVP revision 与本文为准。
> 范围：只覆盖无 Agent 蓝图闭环，即 Blueprint Core 与 Blueprint UI。**不接真实 Agent、不接 Provider、不做 API key/Settings。**

## 0. 本文补齐的五类施工信息

1. **文件级修改清单**：明确新增/修改文件、导出类型、函数、store action、Tauri command。
2. **当前代码结构映射**：记录现有 `editorStore`、Tauri open/save/validate、Canvas、App layout、测试命令。
3. **硬测试矩阵**：每个 Milestone 必须通过的测试与验收条件。
4. **旧规划冲突修正**：列出旧文档中容易误导实现的 deprecated 表述与新版替代表述。
5. **实现前侦察报告**：把只读代码侦察结果沉淀为后续子代理执行输入。

---

## 1. 不可变实施原则

1. 主 semantic v4 `DocumentFile` 顶层不得新增 `blueprints`、`agent`、`workspace` 等字段。
2. 蓝图持久化使用 sidecar：`原文件名.easyanalyse-blueprints.json`。
3. 首批只做人工蓝图闭环：当前主文档快照 -> sidecar -> 列表 -> 只读预览 -> 校验提示 -> 摘要 diff -> 强确认应用 -> dirty + undo。
4. Agent/Provider/Settings/SecretStore 是后续 Milestone 3-5，不得混入 Milestone 1/2。
5. `invalid` 只表示最近校验有问题，不表示不可应用。任何蓝图都可强确认后应用到内存主文档。
6. 应用蓝图不直接保存磁盘；保存仍走现有保存门禁。
7. `applied` 不作为主状态。使用 `appliedInfo` 记录历史应用；当前匹配态用 runtime `isCurrentMainDocument` 根据 hash 计算。
8. 蓝图预览优先拆纯渲染层 `CircuitCanvasRenderer`，不靠 `CanvasView readOnly` 作为主要安全边界。
9. 每个子任务必须写清 Input / Output / Forbidden，防止子代理互相踩主文档 store、Tauri wrapper 或格式定义。

---

## 2. 当前代码结构映射

### 2.1 `editorStore.ts`

文件：`easyanalyse-desktop/src/store/editorStore.ts`

当前 `EditorState` 关键字段：

```ts
document: DocumentFile
filePath: string | null
dirty: boolean
validationReport: ValidationReport | null
selection: EditorSelection | null
history: DocumentFile[]
future: DocumentFile[]
statusMessage: string | null
```

现有行为：

- 主文档权威状态是 `document`。
- `filePath` 决定当前主文档路径。
- `dirty` 是主文档 dirty，不应与蓝图 sidecar dirty 混用。
- `history/future` 只保存 `DocumentFile[]`，没有 action metadata。
- 所有编辑动作通过内部 `mutateDocument`：clone 当前 document -> mutate -> `normalizeDocumentLocal` -> `dirty=true` -> push history -> clear future -> async validation。
- `undo/redo` 会替换主 `document` 并触发 validation。
- `saveDocument` 与 `saveDocumentAs` 保存前会校验，Rust 保存命令还会再次校验并拒绝 invalid。

Milestone 2 必须新增公开 action：

```ts
applyBlueprintDocument(document: DocumentFile): void
```

建议语义：

1. `normalized = normalizeDocumentLocal(document)`。
2. `history = [...state.history, state.document]`。
3. `future = []`。
4. `document = normalized`。
5. `dirty = true`。
6. `selection = { entityType: 'document' }` 或等价当前文档选择态。
7. 清空 pending placement、focus、viewport animation 等主编辑临时态。
8. 触发 `requestValidation(normalized)`。
9. 不写磁盘、不调用 `saveDocumentToPath`。

### 2.2 文档类型与工具

文件：

```text
easyanalyse-desktop/src/types/document.ts
easyanalyse-desktop/src/lib/document.ts
```

现有类型：`DocumentFile`、`ValidationReport`、`OpenDocumentResult`、`SaveDocumentResult` 等都在 `types/document.ts`。

注意：`normalizeDocumentLocal` 会更新 `document.updatedAt`，Rust `normalize_document` 也会刷新 `updatedAt`。因此 canonical hash **不能**直接以 normalize 后的实时时间为输入，必须单独实现稳定 hash 规则，默认忽略 `document.updatedAt`。

### 2.3 Tauri open/save/validate 链路

前端 wrapper：`easyanalyse-desktop/src/lib/tauri.ts`

现有命令：

```ts
newDocumentCommand(title?)
validateDocumentCommand(document)
openDocumentFromPath(path)
saveDocumentToPath(path, document)
startMobileShare(document, snapshot)
stopMobileShare()
```

Rust 注册：`easyanalyse-desktop/src-tauri/src/main.rs`

Rust 实现：`easyanalyse-desktop/src-tauri/src/commands.rs`

关键行为：

- `open_document_from_path`：能 parse 并得到 normalizedDocument 即可打开；会返回 report。
- `save_document_to_path`：如果 `!report.schema_valid || !report.semantic_valid`，直接返回错误，拒绝保存。
- 这符合本规划：蓝图 apply 到内存允许 invalid；保存磁盘继续由现有门禁保护。

Milestone 1 需要新增 sidecar 读写命令或安全文件 IO wrapper。

### 2.4 Canvas 当前风险

文件：`easyanalyse-desktop/src/components/CanvasView.tsx`

当前 `CanvasView` 直接从 `useEditorStore` 读取：

```ts
document
selection
locale
pendingDeviceShape
pendingDeviceTemplateKey
focusedDeviceId
focusedLabelKey
focusedNetworkLineId
viewportAnimationTarget
```

当前 `CanvasView` 直接调用 mutation：

```ts
moveDevice
moveDevices
repositionTerminal
updateNetworkLine
setSelection
setDeviceGroupSelection
placePendingDevice
focusDevice
focusNetworkLine
clearFocus
resetViewportToOrigin
```

因此不能简单把 `CanvasView` 加 `documentOverride/readOnly` 后用于预览。必须优先拆出纯渲染层，预览组件不 import/use `editorStore` mutation。

可拆入 `CircuitCanvasRenderer` 的内容：

- canvas grid / viewport / zoom / pan。
- `deriveCircuitInsights(document, locale)`。
- focus layout、terminal layout、label layout。
- device glyph / network line / terminal label 绘制。
- 只读 hover/highlight。

主编辑交互仍留在 `CanvasView` / `MainCanvasView`：拖拽、选择、放置、删除、快捷键、mutation callbacks。

### 2.5 App layout 与全局快捷键

文件：

```text
easyanalyse-desktop/src/App.tsx
easyanalyse-desktop/src/App.css
easyanalyse-desktop/src/components/Inspector.tsx
```

当前布局：

```tsx
<main className="workspace">
  <section className="workspace__canvas">
    <CanvasView theme={theme} />
    {statusMessage && <div className="status-bar">...</div>}
  </section>
  <Inspector />
</main>
```

CSS：

```css
.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 356px;
}
```

推荐 Milestone 2 改为右侧 tab 容器：

```tsx
<RightSidebar>
  <Inspector />
  <BlueprintsPanel />
</RightSidebar>
```

风险：`App.tsx` 注册了全局快捷键，如 Save/Open/New/Undo/Redo/Home/Space/Delete/Escape。蓝图预览或应用 dialog 打开时，必须避免 Delete/Space 等快捷键误改主文档。可用策略：

- modal/dialog 获得 focus trap。
- App 全局 keydown 判断 `isModalOpen` / `isTextInputTarget` / `isBlueprintPreviewFocused` 后跳过主文档 mutation。
- 测试要求预览前后主文档 hash 不变。

### 2.6 当前测试命令

前端：

```bash
cd easyanalyse-desktop
npm install
npm test
npm run build
npm run lint
```

当前环境曾出现 `vitest: not found`，原因是依赖未安装。先 `npm install`。

Rust：

```bash
cd easyanalyse-desktop/src-tauri
cargo test
```

若环境缺 Rust/Cargo，需要在具备工具链的环境验证。

---

## 3. Milestone 1：Blueprint Core 文件级施工图

### 3.1 目标

实现无 UI 或轻 UI 可调用的蓝图核心能力：类型、sidecar 路径、canonical hash、workspace load/save、blueprintStore、从当前主文档创建快照。

### 3.2 新增文件

#### `easyanalyse-desktop/src/types/blueprint.ts`

导出：

```ts
import type { DocumentFile, ValidationReport } from './document'

export type BlueprintWorkspaceVersion = '1.0.0'
export type BlueprintLifecycleStatus = 'active' | 'archived' | 'deleted'
export type BlueprintValidationState = 'unknown' | 'valid' | 'invalid'
export type BlueprintSource = 'manual_snapshot' | 'manual_import' | 'agent' | 'agent_derived'
export type BlueprintHashAlgorithm = 'easyanalyse-document-canonical-sha256-v1'

export interface BlueprintWorkspaceFile {
  blueprintWorkspaceVersion: BlueprintWorkspaceVersion
  workspaceId: string
  mainDocument?: BlueprintMainDocumentRef
  createdAt: string
  updatedAt: string
  appVersion?: string
  blueprints: BlueprintRecord[]
  extensions?: Record<string, unknown>
}

export interface BlueprintMainDocumentRef {
  documentId?: string
  path?: string
  hash?: string
  hashAlgorithm: BlueprintHashAlgorithm
  updatedAt?: string
}

export interface BlueprintRecord {
  id: string
  title: string
  description?: string
  status: BlueprintLifecycleStatus
  validationState: BlueprintValidationState
  validationReport?: ValidationReport
  document: DocumentFile
  documentHash: string
  baseMainDocumentHash?: string
  source: BlueprintSource
  parentBlueprintId?: string
  appliedInfo?: BlueprintAppliedInfo
  createdAt: string
  updatedAt: string
  tags?: string[]
  notes?: string
  extensions?: Record<string, unknown>
}

export interface BlueprintAppliedInfo {
  appliedAt: string
  appliedToMainDocumentHash: string
  sourceBlueprintDocumentHash: string
  appVersion?: string
}

export interface BlueprintRuntimeState {
  isCurrentMainDocument: boolean
  hasBaseHashMismatch: boolean
}
```

禁止：

- 不要修改 `DocumentFile`。
- 不要新增主文档顶层字段。
- 不要使用旧 `draft | valid | invalid | applied | archived` 单一状态。

#### `easyanalyse-desktop/src/lib/documentHash.ts`

导出：

```ts
export const DOCUMENT_HASH_ALGORITHM = 'easyanalyse-document-canonical-sha256-v1'
export function canonicalizeDocumentForHash(document: DocumentFile): unknown
export async function hashDocument(document: DocumentFile): Promise<string>
export function stableStringify(value: unknown): string
```

规则：

1. 默认忽略 `document.updatedAt`。
2. 不忽略 `schemaVersion`、`document.id/title/revision/tags`、`devices`、`terminals`、`labels`、`view`、`extensions`。
3. 对 object key 做稳定排序。
4. array 顺序保留；不要擅自排序 devices/terminals/networkLines，除非另有明确规范。
5. 不调用会刷新时间的 normalize。
6. 在浏览器环境优先 `crypto.subtle.digest('SHA-256')`；测试可提供 Node fallback 或 mock。

#### `easyanalyse-desktop/src/lib/blueprintWorkspace.ts`

导出：

```ts
export function createEmptyBlueprintWorkspace(args): BlueprintWorkspaceFile
export function createBlueprintFromDocument(args): Promise<BlueprintRecord>
export function normalizeBlueprintWorkspace(value: unknown): BlueprintWorkspaceFile
export function getBlueprintSidecarPath(documentPath: string): string
export function isBlueprintWorkspaceFile(value: unknown): value is BlueprintWorkspaceFile
export function getBlueprintRuntimeState(record: BlueprintRecord, currentMainHash: string): BlueprintRuntimeState
```

sidecar path 规则：

- 输入 `/path/foo.json` -> `/path/foo.easyanalyse-blueprints.json`。
- 输入 `/path/foo.easyanalyse.json` -> `/path/foo.easyanalyse.easyanalyse-blueprints.json`（除非后续另定 special-case，MVP 可保持简单可预测）。
- 未保存主文档 `filePath=null`：蓝图只保存在内存 workspace，不写 sidecar；UI 提示保存主文档后可持久化蓝图。

#### `easyanalyse-desktop/src/store/blueprintStore.ts`

建议 Zustand store，导出：

```ts
export interface BlueprintState {
  workspace: BlueprintWorkspaceFile | null
  sidecarPath: string | null
  dirty: boolean
  selectedBlueprintId: string | null
  loadForMainDocument(filePath: string | null, mainDocument: DocumentFile): Promise<void>
  saveWorkspace(): Promise<void>
  createSnapshotFromDocument(document: DocumentFile, options?: { title?: string; description?: string }): Promise<BlueprintRecord>
  validateBlueprint(id: string): Promise<void>
  archiveBlueprint(id: string): void
  deleteBlueprint(id: string): void
  selectBlueprint(id: string | null): void
  markApplied(id: string, info: BlueprintAppliedInfo): void
}
```

注意：

- `blueprintStore.dirty` 与 `editorStore.dirty` 完全分离。
- `validateBlueprint` 调用 `validateDocumentCommand`，但 validation 结果只更新蓝图 record，不反写主文档。
- validation 失败或 report invalid 不丢弃蓝图。
- sidecar 损坏时不得阻止主文档打开；应显示蓝图加载错误，并允许创建新 workspace 或备份损坏文件后重建。

#### `easyanalyse-desktop/src/lib/blueprintSidecar.ts`（可选）

若不把 IO 放在 store 中，可新增该文件封装：

```ts
export async function loadBlueprintWorkspace(path: string): Promise<BlueprintWorkspaceFile | null>
export async function saveBlueprintWorkspace(path: string, workspace: BlueprintWorkspaceFile): Promise<void>
```

### 3.3 修改文件

#### `easyanalyse-desktop/src/lib/tauri.ts`

新增 wrapper（二选一，推荐专用）：

```ts
export function getBlueprintSidecarPathCommand(documentPath: string): Promise<string>
export function loadBlueprintWorkspaceFromPath(path: string): Promise<unknown | null>
export function saveBlueprintWorkspaceToPath(path: string, workspace: BlueprintWorkspaceFile): Promise<void>
```

如果前端侧 path 计算足够，Rust command 可只做 read/write：

```ts
readTextFile(path: string): Promise<string | null>
writeTextFile(path: string, content: string): Promise<void>
```

但通用 read/write 风险更大，必须限制路径在当前文档 sidecar 或明确校验扩展名。

#### `easyanalyse-desktop/src-tauri/src/commands.rs`

新增命令建议：

```rust
#[tauri::command]
pub fn get_blueprint_sidecar_path(document_path: String) -> Result<String, String>

#[tauri::command]
pub fn load_blueprint_workspace_from_path(path: String) -> Result<Option<serde_json::Value>, String>

#[tauri::command]
pub fn save_blueprint_workspace_to_path(path: String, workspace: serde_json::Value) -> Result<(), String>
```

安全要求：

- 只读写 `.easyanalyse-blueprints.json`。
- `load` 文件不存在返回 `Ok(None)`。
- JSON parse 失败返回可读错误，不 panic。
- `save` 使用 pretty JSON。

#### `easyanalyse-desktop/src-tauri/src/main.rs`

把新增 command 加入 `tauri::generate_handler!`。

### 3.4 Milestone 1 子任务拆分

#### M1-T1：蓝图类型与 hash

Input：

- `types/document.ts`
- `lib/document.ts`
- `exchange.md`

Output：

- `types/blueprint.ts`
- `lib/documentHash.ts`
- `documentHash.test.ts`

Forbidden：

- 不改 `DocumentFile`。
- 不调用刷新 `updatedAt` 的 normalize 参与 hash。
- 不引入大型 hash 依赖，优先 Web Crypto/Node crypto。

验收：

- 相同文档仅 `document.updatedAt` 不同，hash 相同。
- label/device/view 变化，hash 变化。
- stable stringify object key 顺序稳定。

#### M1-T2：sidecar workspace 工具

Input：

- M1-T1 输出。
- 当前主文档 path 规则。

Output：

- `lib/blueprintWorkspace.ts`
- 单元测试。

Forbidden：

- 不写磁盘。
- 不依赖 editorStore。

验收：

- 正确生成 `原文件名.easyanalyse-blueprints.json`。
- 可创建 empty workspace。
- 可从当前 document 创建 `manual_snapshot` record。
- `status='active'`，`validationState='unknown'`。

#### M1-T3：Tauri sidecar IO

Input：

- `lib/tauri.ts`
- `src-tauri/src/commands.rs`
- `src-tauri/src/main.rs`

Output：

- 新增 sidecar IO commands 与 TS wrapper。
- Rust tests（如已有测试风格允许）。

Forbidden：

- 不修改主文档 open/save command 语义。
- 不允许任意路径通用写入未校验 JSON。
- 不在 Rust command 中校验 semantic v4 蓝图内容；sidecar 可保存 invalid 蓝图。

验收：

- sidecar 不存在返回 null/None。
- sidecar JSON 损坏返回可读错误。
- 非 `.easyanalyse-blueprints.json` 路径拒绝写入。

#### M1-T4：blueprintStore

Input：

- M1-T1/T2/T3 输出。
- `editorStore` 当前 filePath/document。

Output：

- `store/blueprintStore.ts`
- store 单元测试或可测试 pure helper。

Forbidden：

- 不 import/use `editorStore` mutation。
- 不改变 `editorStore.dirty`。
- 不把 validation invalid 当作丢弃条件。

验收：

- `createSnapshotFromDocument` 不改变主文档 hash。
- `saveWorkspace` 只清 `blueprintStore.dirty`。
- 加载 sidecar 失败不影响主文档。
- 未保存主文档时 sidecarPath=null，蓝图可保存在内存。

---

## 4. Milestone 2：Blueprint UI 闭环文件级施工图

### 4.1 目标

用户可在桌面 UI 中创建蓝图快照、查看列表、只读预览、校验、看摘要 diff、强确认应用到主文档，并可 undo。

### 4.2 新增文件

```text
easyanalyse-desktop/src/components/layout/RightSidebar.tsx
easyanalyse-desktop/src/components/blueprints/BlueprintsPanel.tsx
easyanalyse-desktop/src/components/blueprints/BlueprintCard.tsx
easyanalyse-desktop/src/components/blueprints/BlueprintPreviewCanvas.tsx
easyanalyse-desktop/src/components/blueprints/ApplyBlueprintDialog.tsx
easyanalyse-desktop/src/components/canvas/CircuitCanvasRenderer.tsx
easyanalyse-desktop/src/lib/blueprintDiff.ts
easyanalyse-desktop/src/lib/keyboardGuards.ts
```

### 4.3 修改文件

```text
easyanalyse-desktop/src/components/CanvasView.tsx
easyanalyse-desktop/src/App.tsx
easyanalyse-desktop/src/App.css
easyanalyse-desktop/src/store/editorStore.ts
easyanalyse-desktop/src/lib/tauri.ts（如 M1 未完成 sidecar wrapper）
```

### 4.4 `CircuitCanvasRenderer` 契约

推荐接口：

```ts
export interface CircuitCanvasRendererProps {
  document: DocumentFile
  locale: Locale
  theme: ThemeMode
  mode: 'interactive' | 'preview'
  selection?: EditorSelection | null
  focusedDeviceId?: string | null
  focusedLabelKey?: string | null
  focusedNetworkLineId?: string | null
  viewportAnimationTarget?: ViewportAnimationTarget | null
  onViewportReset?: () => void
  interaction?: CircuitCanvasInteractionCallbacks
}

export interface CircuitCanvasInteractionCallbacks {
  onMoveDevice?: (...args) => void
  onMoveDevices?: (...args) => void
  onRepositionTerminal?: (...args) => void
  onUpdateNetworkLine?: (...args) => void
  onSelectionChange?: (...args) => void
  onPlacePendingDevice?: (...args) => void
  onFocusDevice?: (...args) => void
  onFocusNetworkLine?: (...args) => void
  onClearFocus?: () => void
}
```

硬边界：

- `CircuitCanvasRenderer` 不 import `useEditorStore`。
- `BlueprintPreviewCanvas` 传 `mode='preview'` 且不传 mutation callbacks。
- `CanvasView` / `MainCanvasView` 才连接 `useEditorStore` 并传 callbacks。
- preview 可 pan/zoom/fit，但不能拖拽写回、不能 delete、不能放置器件。

### 4.5 `BlueprintsPanel` UX

核心功能：

- 空状态：提示“从当前主文档创建蓝图快照”。
- 按钮：`创建快照`、`保存蓝图工作区`、`重新加载 sidecar`。
- 列表卡片显示：
  - title / description。
  - lifecycle chip：active/archived/deleted。
  - validation chip：unknown/valid/invalid。
  - issue/warning 数量。
  - `appliedInfo` 历史标记。
  - runtime `isCurrentMainDocument` 当前匹配标记。
- 详情区：预览、校验报告、摘要 diff、JSON/raw 可后置。
- invalid/unknown 仍显示“应用”入口；点击后进入强确认。

### 4.6 `blueprintDiff.ts`

MVP 摘要 diff，不做复杂可视化 merge。

导出：

```ts
export interface BlueprintDiffSummary {
  deviceAdded: string[]
  deviceRemoved: string[]
  deviceChanged: string[]
  labelAdded: string[]
  labelRemoved: string[]
  labelChanged: string[]
  viewChanged: boolean
  documentMetaChanged: boolean
}

export function summarizeBlueprintDiff(current: DocumentFile, blueprint: DocumentFile): BlueprintDiffSummary
```

验收：

- devices 增删改可被摘要发现。
- terminal label 变化可被摘要发现。
- view/networkLines 变化可提示 viewChanged。
- diff 只用于提示，不作为应用门禁。

### 4.7 `ApplyBlueprintDialog`

必须展示：

1. 蓝图标题。
2. 当前主文档将被整文档替换。
3. 是否 base hash mismatch。
4. validationState 与 issue 摘要。
5. 若 invalid/unknown，强提示：报错不阻止阅读，但保存磁盘可能失败。
6. diff 摘要。
7. 二次确认控件，例如输入蓝图标题或勾选“我理解这会替换当前主文档”。

确认动作：

```ts
editorStore.applyBlueprintDocument(blueprint.document)
blueprintStore.markApplied(blueprint.id, {
  appliedAt,
  appliedToMainDocumentHash: hashDocument(blueprint.document),
  sourceBlueprintDocumentHash: blueprint.documentHash,
  appVersion,
})
```

注意：应用后主文档 dirty=true，但 sidecar 也会 dirty，因为 `appliedInfo` 更新需要保存。

### 4.8 App 与快捷键 guard

新增或复用 `keyboardGuards.ts`：

```ts
export function isEditableTextTarget(target: EventTarget | null): boolean
export function shouldIgnoreGlobalEditorShortcut(event: KeyboardEvent, uiState: { modalOpen: boolean; blueprintPreviewFocused: boolean }): boolean
```

App 全局 keydown 在执行 Delete/Space/Undo/Redo 等 mutation 前必须先判断 guard。

### 4.9 Milestone 2 子任务拆分

#### M2-T1：editorStore apply action

Input：

- `editorStore.ts`
- M1 hash helper。

Output：

- `applyBlueprintDocument(document)` action。
- 测试或手动验证说明。

Forbidden：

- 不调用 save。
- 不因 validation invalid 阻止 apply。
- 不改变主保存门禁。

验收：

- apply 后 `dirty=true`。
- apply 后 history 增加，可 undo。
- undo 后恢复旧 document。

#### M2-T2：抽 `CircuitCanvasRenderer`

Input：

- `CanvasView.tsx`
- 当前 device/network/terminal 渲染逻辑。

Output：

- `components/canvas/CircuitCanvasRenderer.tsx`
- `CanvasView.tsx` 改为组合 renderer。
- 保持主画布现有交互不回归。

Forbidden：

- `CircuitCanvasRenderer` 不 import `useEditorStore`。
- 不在 renderer 内调用主文档 mutation。
- 不重写 semantic 逻辑。

验收：

- 主画布仍能渲染、选择、拖拽、放置。
- renderer 可仅传 document 渲染静态预览。

#### M2-T3：BlueprintPreviewCanvas

Input：

- M2-T2 renderer。
- `BlueprintRecord.document`。

Output：

- `BlueprintPreviewCanvas.tsx`。

Forbidden：

- 不 import `useEditorStore` mutation。
- 不处理 Delete/Space 写动作。

验收：

- 预览前后 mainDocumentHash 完全一致。
- 鼠标拖拽最多改变 preview viewport，不改变主文档。

#### M2-T4：RightSidebar + BlueprintsPanel

Input：

- `App.tsx` 当前 layout。
- `Inspector.tsx`。
- `blueprintStore`。

Output：

- `RightSidebar.tsx`
- `BlueprintsPanel.tsx`
- `BlueprintCard.tsx`
- App/CSS 接入。

Forbidden：

- 不把 Blueprint UI 混进 Inspector 表单逻辑。
- 不引入第三列挤压 canvas。
- 不接 Agent/Provider。

验收：

- Inspector 与 Blueprints tab 可切换。
- 创建快照出现在列表。
- sidecar dirty 状态明确。

#### M2-T5：校验、diff、应用 dialog

Input：

- `validateDocumentCommand`
- M1/M2 store。
- `blueprintDiff.ts`。

Output：

- `blueprintDiff.ts`
- `ApplyBlueprintDialog.tsx`
- panel 中接入校验/应用。

Forbidden：

- 不禁用 invalid 应用。
- 不直接保存主文档。
- 不把 `status` 设置为 `applied`。

验收：

- invalid/unknown/valid 均可进入应用确认。
- invalid/unknown 显示强风险提示。
- 确认后主文档替换、dirty=true、undo 可恢复。
- `appliedInfo` 更新；`isCurrentMainDocument` 由 hash 运行时计算。

---

## 5. Milestone 1/2 硬测试矩阵

### 5.1 Milestone 1 必测

| 编号 | 测试 | 期望 |
|---|---|---|
| M1-01 | 主文档保存路径 `/a/b/foo.json` | sidecar path 为 `/a/b/foo.easyanalyse-blueprints.json` |
| M1-02 | 未保存主文档 `filePath=null` 创建蓝图 | 蓝图仅在内存 workspace，sidecarPath=null，主文档不 dirty |
| M1-03 | 从当前主文档创建快照 | `source='manual_snapshot'`、`status='active'`、`validationState='unknown'` |
| M1-04 | 只改 `document.updatedAt` | canonical hash 不变 |
| M1-05 | 改 device/terminal label/view | canonical hash 变化 |
| M1-06 | sidecar 不存在 | load 返回空 workspace，不阻止主文档打开 |
| M1-07 | sidecar JSON 损坏 | 主文档仍可打开；蓝图面板显示错误，不吞掉原文件 |
| M1-08 | sidecar 中包含 invalid blueprint document | 可加载、可保存，不丢弃 |
| M1-09 | 保存 sidecar | 主 semantic v4 文档 JSON 不出现 `blueprints` 字段 |
| M1-10 | `blueprintStore.dirty` 变化 | 不改变 `editorStore.dirty` |

### 5.2 Milestone 2 必测

| 编号 | 测试 | 期望 |
|---|---|---|
| M2-01 | 打开蓝图预览前后计算 mainDocumentHash | 完全一致 |
| M2-02 | 在预览中拖拽/点击/Delete/Space | 不改变主文档；最多改变预览 viewport/focus |
| M2-03 | 创建蓝图快照后修改主文档 | 蓝图 document 不随主文档变化 |
| M2-04 | valid 蓝图应用 | 主文档替换，dirty=true，history 增加 |
| M2-05 | invalid 蓝图应用 | 不禁用；强提示后可替换内存主文档 |
| M2-06 | unknown 蓝图应用 | 提示建议校验/强确认后可应用 |
| M2-07 | 应用后 undo | 主文档恢复旧内容；`appliedInfo` 保留；`isCurrentMainDocument=false` |
| M2-08 | base hash mismatch | 应用确认显示“整文档替换，不做 merge”风险 |
| M2-09 | 应用 invalid 后保存主文档 | 保存仍可能被现有保存门禁拒绝，错误可读 |
| M2-10 | diff 摘要 | 能显示 device/label/view/meta 级别变化 |
| M2-11 | 蓝图面板切换 tab | Inspector 状态不被错误污染 |
| M2-12 | 全局快捷键 guard | modal/预览焦点下 Delete/Space 不误改主文档 |

### 5.3 回归命令

```bash
cd easyanalyse-desktop
npm install
npm test
npm run build
npm run lint
```

如涉及 Rust commands：

```bash
cd easyanalyse-desktop/src-tauri
cargo test
```

若当前环境缺工具链，必须在提交说明中明确未运行原因，并在可用环境补跑。

---

## 6. 旧规划冲突修正索引

后续实施时，遇到旧文档中的以下表述，一律按本节替换理解。

### 6.1 MVP 范围

Deprecated：

- “MVP 必须支持 Provider/API key/Agent 面板/模型生成蓝图”。
- “先做 Settings，再做蓝图”。

Current：

- Milestone 1/2 只做无 Agent 蓝图闭环。
- Settings/Secrets 是 Milestone 3。
- Mock Agent 是 Milestone 4。
- 真实 Provider 是 Milestone 5。

### 6.2 蓝图状态

Deprecated：

```ts
status: 'draft' | 'valid' | 'invalid' | 'applied' | 'archived'
```

Current：

```ts
status: 'active' | 'archived' | 'deleted'
validationState: 'unknown' | 'valid' | 'invalid'
appliedInfo?: BlueprintAppliedInfo
isCurrentMainDocument // runtime only
```

### 6.3 invalid 应用

Deprecated：

- “invalid 蓝图不能直接应用”。
- “应用按钮 disabled”。
- “零 warning / 零 issue 才可应用”。

Current：

- invalid/unknown/valid 都可进入应用确认。
- invalid/unknown 必须强提示和二次确认。
- 报错只提示，不作为应用门禁。
- 保存磁盘仍走现有保存门禁。

### 6.4 applied 语义

Deprecated：

- `status='applied'`。
- “applied 表示当前正在使用该蓝图”。

Current：

- `appliedInfo` 仅表示历史上曾应用。
- 当前是否仍等于该蓝图由 `isCurrentMainDocument` 根据 hash 运行时计算。
- undo 不删除 `appliedInfo`，但会让 `isCurrentMainDocument=false`。

### 6.5 Canvas 预览

Deprecated：

- “MVP 推荐 `CanvasView documentOverride + readOnly`”。
- “readOnly guard 是主要隔离手段”。

Current：

- MVP 优先抽 `CircuitCanvasRenderer`。
- 预览组件架构上没有主文档 mutation 写路径。
- readOnly guard 只能作为额外防线或临时 fallback。

### 6.6 API key

Deprecated：

- “API key 存本机普通 AppSettings 即可”。
- “只要不写主文档/sidecar 就够”。

Current（Milestone 3 才实施）：

- `AppSettings` 只保存 public config 与 `apiKeyRef`。
- 密钥优先 OS keychain / credential manager。
- 降级本机 secret 文件时 UI 必须提示弱安全。
- 硬测试扫描主文档、sidecar、AppSettings、导出设置、普通日志、Agent debug 日志，不得出现 API key 明文。

---

## 7. 子代理执行协议模板

每次派子代理落地某个任务时，必须带上以下模板。

```md
目标：实现 [Mx-Ty]

上位文档：
- docs/plans/2026-04-26-agent-blueprint-mvp-revision.md
- docs/plans/2026-04-26-blueprint-milestone-1-2-file-level-implementation-plan.md

输入文件：
- ...

必须输出：
- 新增/修改文件：...
- 导出函数/组件/action：...
- 测试文件或验证说明：...

禁止：
- 不接 Agent/Provider/Settings，除非任务明确属于 Milestone 3+。
- 不修改主 DocumentFile schema。
- 不把 invalid 当作不可应用。
- 不用 status='applied'。
- 不让预览组件 import/use editorStore mutation。

验收：
- ...

回传格式：
- 修改摘要。
- 文件列表。
- 测试命令与结果。
- 风险/未完成项。
```

---

## 8. 串行/并行建议

必须串行：

1. M1-T1 类型与 hash。
2. M1-T2 workspace 工具。
3. M1-T4 blueprintStore。
4. M2-T1 editorStore apply action。
5. M2-T5 apply dialog 与 undo 验证。

可并行：

- M1-T3 Tauri sidecar IO 可与 M1-T2 并行，但合并前需统一 wrapper 接口。
- M2-T2 Canvas renderer 与 M2-T4 RightSidebar/BlueprintsPanel 可并行，但 M2-T3 preview 依赖 renderer。
- `blueprintDiff.ts` 可在 M2-T2 期间并行开发。

推荐落地顺序：

```text
M1-T1 -> M1-T2 -> M1-T3 -> M1-T4 -> M2-T1 -> M2-T2 -> M2-T3 -> M2-T4 -> M2-T5 -> 全量回归
```

---

## 9. Definition of Done

Milestone 1/2 完成必须同时满足：

1. 用户可以从当前主文档创建蓝图快照。
2. 已保存主文档的蓝图会写入正确 sidecar；未保存主文档的蓝图不误写磁盘。
3. 主文档 JSON 不包含蓝图字段。
4. 蓝图列表可显示多个蓝图。
5. 蓝图预览不会修改主文档。
6. 校验结果只做提示，不阻止应用。
7. 摘要 diff 可说明替换风险。
8. valid/invalid/unknown 蓝图都可经确认应用到内存主文档。
9. 应用后 dirty=true，undo 可恢复。
10. `appliedInfo` 与 runtime `isCurrentMainDocument` 语义正确。
11. 所有相关测试/构建命令已运行，或明确记录环境缺失原因。
