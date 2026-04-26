# EasyAnalyse 蓝图工作区、Sidecar 与应用流程细化规划

> **MVP 修订优先级说明（2026-04-26）**：最新施工顺序已压实为“先完成无 Agent 蓝图闭环，再接设置与 Agent”。若本文与 `docs/plans/2026-04-26-agent-blueprint-mvp-revision.md` 冲突，以后者为准。核心修订：invalid/有报错蓝图也允许用户强确认后应用到内存主文档；报错只提示，不作为应用门禁；`applied` 不再作为状态，改为 `appliedInfo` + runtime `isCurrentMainDocument`；Canvas 预览优先拆 `CircuitCanvasRenderer` 纯渲染层；API key 与普通设置分层。

> **文件级施工补充（2026-04-26）**：Milestone 1/2 的文件级修改清单、当前代码结构映射、硬测试矩阵、旧规划冲突修正与子代理执行模板已落盘到 `docs/plans/2026-04-26-blueprint-milestone-1-2-file-level-implementation-plan.md`。后续实现 Blueprint Core / Blueprint UI 时必须同时遵守该文档。

> 日期：2026-04-26  
> 关联主规划：`docs/plans/2026-04-26-agent-blueprint-plan.md`  
> 目标：把“蓝图不影响主文件，应用后替换主文件”的产品想法细化为可实现的数据模型、sidecar 文件、hash/diff、校验、undo/redo 与测试方案。

## 1. 三层隔离

1. **主文档 Main Document**：仍是唯一标准 semantic v4 `DocumentFile`，顶层不得新增 `blueprints/agent/workspace`。
2. **蓝图工作区 Blueprint Workspace**：独立 sidecar wrapper，文件名固定为 `原文件名.easyanalyse-blueprints.json`。
3. **Agent**：只能生成/修改蓝图；修改已有蓝图默认创建派生蓝图。

## 2. BlueprintWorkspaceFile v1

建议新增 `easyanalyse-desktop/src/types/blueprint.ts`。

```ts
export type BlueprintWorkspaceVersion = '1.0.0'
export type BlueprintLifecycleStatus = 'active' | 'archived' | 'deleted'
export type BlueprintValidationState = 'unknown' | 'valid' | 'invalid'
export type BlueprintSource = 'manual_snapshot' | 'manual_import' | 'agent' | 'agent_derived'

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
  hashAlgorithm: 'easyanalyse-document-canonical-sha256-v1'
  capturedAt: string
}

export interface BlueprintRecord {
  id: string
  title: string
  summary: string
  status: BlueprintStatus
  source: BlueprintSource
  createdAt: string
  updatedAt: string
  documentHash?: string
  baseMainDocument?: BlueprintBaseRef
  parentBlueprintId?: string
  revision?: number
  appliedInfo?: BlueprintAppliedInfo
  agent?: BlueprintAgentInfo
  rationale?: string
  tradeoffs?: string[]
  notes?: string[]
  validationReport?: ValidationReport
  document: DocumentFile
  extensions?: Record<string, unknown>
}
```

原则：

- wrapper 可保存 invalid 草稿。
- wrapper 不传给 semantic v4 validator，只校验 `blueprints[*].document`。
- API key、Authorization、secret-like 字段禁止写入 sidecar。

## 3. Sidecar 路径策略

算法：去掉主文件最后一个扩展名，拼接 `.easyanalyse-blueprints.json`。

| 主文件 | sidecar |
|---|---|
| `foo.json` | `foo.easyanalyse-blueprints.json` |
| `circuit.v4.json` | `circuit.v4.easyanalyse-blueprints.json` |
| `/a/b/demo.json` | `/a/b/demo.easyanalyse-blueprints.json` |

### 新建未保存主文档

- `editorStore.filePath === null` 时蓝图仅在内存。
- UI 提示“主文档尚未保存，蓝图将在保存主文档后写入 sidecar”。
- 首次保存主文档成功后再推导 sidecar 并写入。
- sidecar 写入失败不回滚主文档保存。

### 打开主文档

- 打开主文档后推导 sidecar path。
- sidecar 不存在：创建空内存工作区，不立即写盘。
- sidecar 损坏：主文档仍打开，提示蓝图工作区无法加载。
- sidecar 高版本：只读或拒绝加载，提示升级应用。

### 另存为

另存为成功后如存在蓝图，提示：

1. 复制蓝图到新文件旁边（默认）。
2. 不复制，只保存主文档。

复制失败不回滚主文档另存为，但必须提示。

## 4. Canonical hash

算法名：`easyanalyse-document-canonical-sha256-v1`，格式 `sha256:<hex>`。

用途：

- 判断蓝图基于的主文档是否变化。
- 判断蓝图自身是否变化。
- diff 前快速判断是否一致。

规则：

1. 输入先 normalize。
2. object key 稳定排序。
3. array 顺序保持。
4. 默认忽略 `document.updatedAt`，因为 normalize 会刷新它。
5. 不忽略 `terminal.label`、`devices`、`view`、`extensions`。
6. 不包含 validationReport、蓝图状态、Agent 信息。

建议新增：`easyanalyse-desktop/src/lib/documentHash.ts`。

## 5. 蓝图状态机

| 状态 | 可预览 | 可保存 | 可应用 |
|---|---:|---:|---:|
| draft | 是 | 是 | 否 |
| valid | 是 | 是 | 是 |
| invalid | 是 | 是 | 否 |
| applied | 是 | 是 | 可再次确认应用 |
| archived | 默认隐藏 | 是 | 否 |

迁移：

```text
create/import/agent candidate -> draft
validate success -> valid
validate fail -> invalid
valid apply success -> applied
agent modify -> create derived draft/valid/invalid; parent unchanged
archive -> archived
```

invalid 策略：保存、预览、修复；应用入口不得简单禁用，必须进入强提示确认流程。

## 6. 校验策略

三层：

1. wrapper 基础校验：version、workspaceId、blueprints 数组、record 基础字段。
2. `DocumentFile` schema 校验：调用 Rust `validate_value`。
3. semantic validation：校验问题只提示，不作为应用门禁 才可应用。

校验后：

- 若返回 normalizedDocument，用它替换蓝图 document。
- 更新 validationReport、documentHash、updatedAt。
- 零 issue → `valid`，否则 `invalid`；该状态只影响提示强度，不阻止应用。
- 校验动作使 `blueprintStore.dirty=true`。

## 7. Diff 设计

默认忽略 `document.updatedAt`，但不忽略电路语义和 view。

建议新增 `easyanalyse-desktop/src/lib/documentDiff.ts`，输出结构化摘要：

- document meta 变化
- devices added/removed/changed
- terminals added/removed/changed/relabeled
- labels added/removed/changedMembership
- view deviceViews/networkLines/canvas 变化
- raw JSON diff 高级视图

semantic v4 特别强调：terminal label 改变就是连接关系改变；label 合并/拆分必须在 diff 中高亮为风险。

## 8. 蓝图预览

`CanvasView` 支持：

```ts
documentOverride?: DocumentFile
readonly?: boolean
```

蓝图预览不能替换 `editorStore.document`。

蓝图详情 tab：

1. 画布预览，只读。
2. 差异。
3. 校验。
4. JSON，只读 formatted。
5. 说明：rationale/tradeoffs/Agent prompt 摘要。

## 9. 应用蓝图流程

入口启用条件：

- 蓝图 lifecycle `status === 'active'`。
- 当前无保存/校验任务。
- validationState 不作为硬门禁：`unknown` / `valid` / `invalid` 均可进入应用确认。

流程：

```text
再次校验 blueprint.document（可失败，但只更新 validationState/report）
  -> 若 invalid/unknown，显示强提示与二次确认，不阻止
  -> 计算当前主文档 hash
  -> 与 blueprint.baseMainDocument.hash 比较
  -> 不一致则强提示“整文档替换，不做 merge”
  -> 用户确认
  -> clone/normalize blueprint.document
  -> editorStore.applyBlueprintDocument
  -> 主文档 dirty=true
  -> 写入 appliedInfo，sidecar dirty=true
  -> runtime 重新计算 isCurrentMainDocument
```

`editorStore.applyBlueprintDocument()` 语义：

- 当前主文档压入 `history`。
- 清空 `future`。
- 替换 `document`。
- `dirty=true`。
- selection 回到 document。
- 清理 pending/focus 状态。
- 触发 validation。
- 不修改 `filePath`。
- 不立即保存磁盘。

## 10. Undo/redo 与 dirty

- 应用蓝图属于主文档整文档变更，必须可 undo/redo。
- undo 恢复应用前文档，但不删除蓝图 `appliedInfo`；`appliedInfo` 表示曾经应用过，当前是否匹配由 runtime `isCurrentMainDocument` 计算。
- `editorStore.dirty` 和 `blueprintStore.dirty` 分离。
- 保存主文档不等于保存 sidecar；UI 应分别展示状态。

## 11. Rust/Tauri 命令

```rust
#[tauri::command]
pub fn get_blueprint_sidecar_path(main_path: String) -> Result<String, String>

#[tauri::command]
pub fn load_blueprint_workspace(main_path: String) -> Result<Option<serde_json::Value>, String>

#[tauri::command]
pub fn save_blueprint_workspace(main_path: String, workspace: serde_json::Value) -> Result<String, String>

#[tauri::command]
pub fn validate_blueprint_document(document: serde_json::Value) -> Result<ValidationReport, String>
```

Rust 根据 `main_path` 推导 sidecar，前端不得传任意 sidecar path。

## 12. Store 规划

新增 `easyanalyse-desktop/src/store/blueprintStore.ts`：

- `workspace`
- `sidecarPath`
- `loadedForMainPath`
- `dirty/loading/saving/error`
- `selectedBlueprintId`
- `previewMode: none/canvas/json/diff/validation`
- `initializeForMainDocument`
- `addAgentBlueprintCandidates`
- `deriveBlueprint`
- `rename/archive/deleteBlueprint`
- `validateBlueprint/validateAllBlueprints`
- `saveWorkspace`

## 13. 数据迁移

`blueprintWorkspaceVersion = '1.0.0'`。

- 缺失 version 但结构可识别：迁移并补 `workspaceId/hashAlgorithm/createdAt/updatedAt`。
- 高版本：只读或拒绝。
- 旧字段迁移：`mainDocumentId/mainDocumentPath/mainDocumentHash` → `mainDocument.*`。
- 不迁移任何 secret-like 字段。
- 主 semantic v4 文档不做蓝图相关迁移。

## 14. 测试清单

1. sidecar path 推导。
2. 主文档顶层不出现 `blueprints`。
3. wrapper 不被当作 semantic v4 校验。
4. hash 忽略 `updatedAt`，但 label/device/view 变化必须改变 hash。
5. invalid 蓝图可保存、可预览、可应用，但必须强提示。
6. valid 蓝图应用后整文档替换、dirty=true、history push、future 清空。
7. base hash 不一致显示强确认。
8. undo/redo 恢复主文档，不删除 `appliedInfo` 历史；`isCurrentMainDocument` 随 hash 变化重新计算。
9. 未保存主文档蓝图仅内存，首次保存后写 sidecar。
10. 另存为复制 sidecar。
11. 高版本/损坏 sidecar 不阻止主文档打开。
12. API key/authorization 不写入 sidecar。
