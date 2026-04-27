# EasyAnalyse 自主施工任务队列

> 执行规则：每轮优先完成一个最小任务。完成后把 `[ ]` 改为 `[x]`，必要时追加 commit/test 信息。阻塞任务用 `[!]` 标记并写明原因。

## Milestone 1：Blueprint Core（无 Agent、无 Provider）

目标：证明主文档与蓝图 sidecar 隔离，蓝图可创建、保存、加载、校验状态可记录，但不触碰 UI 复杂预览和真实 Agent。

- [x] **M1-T1：类型与 canonical hash**
  - 输入：`docs/plans/2026-04-26-blueprint-milestone-1-2-file-level-implementation-plan.md`，现有 DocumentFile 类型。
  - 输出：`src/types/blueprint.ts`、`src/lib/documentHash.ts`、相关测试。
  - 验收：canonical hash 忽略 `document.updatedAt`；相同语义文档 hash 稳定；主文档类型不增加 blueprints 字段。
  - 禁止：改 schema、改 exchange.md、接 Agent/Provider。

- [x] **M1-T2：Blueprint workspace 工具**
  - 输出：`src/lib/blueprintWorkspace.ts`、workspace 创建/迁移/序列化/反序列化测试。
  - 验收：支持 active/archived/deleted lifecycle；validationState unknown/valid/invalid；appliedInfo 可选；sidecar wrapper schemaVersion 明确。
  - 禁止：把 invalid 作为不可应用逻辑写死。

- [x] **M1-T3：Tauri sidecar IO**
  - 输出：前端 invoke wrapper 与 Rust/Tauri command（如需要）；sidecar path 规则为 `原文件名.easyanalyse-blueprints.json`。
  - 验收：sidecar 损坏不阻止主文档打开；未保存主文档时蓝图只在内存；主文档 JSON 不出现 blueprints。
  - 禁止：改变主文档保存语义。

- [x] **M1-T4：blueprintStore**
  - 输出：`src/store/blueprintStore.ts`，从当前主文档创建蓝图快照、加载/保存 workspace、dirty 状态隔离。
  - 验收：blueprintStore.dirty 不影响 editorStore.dirty；创建快照不修改主文档；sidecar 保存/加载通过测试。
  - 禁止：接 UI 大重构、Agent、Provider。

- [x] **M1-T5：M1 集成验收**
  - 输出：补充测试/文档，确保 M1 端到端可用。
  - 验收：能从当前文档创建蓝图快照并保存 sidecar；重新打开后恢复蓝图列表；工作区干净提交。

## Milestone 2：Blueprint UI 闭环（无 Agent）

目标：用户可以人工创建蓝图、查看只读预览、看校验/diff、强确认应用，undo/redo 可恢复。

- [x] **M2-T1：editorStore.applyBlueprintDocument**
  - 输出：`editorStore` 新 action，整文档替换主文档，进入 history，dirty=true。
  - 验收：应用后 undo 恢复旧文档；redo 恢复蓝图文档；保存仍走现有门禁。
  - 禁止：在 apply 阶段阻止 invalid 文档。

- [ ] **M2-T2：抽取 CircuitCanvasRenderer**
  - 输出：纯渲染组件，不依赖 editorStore mutation。
  - 验收：主 CanvasView 仍可编辑；renderer 可被预览复用；预览前后 mainDocumentHash 不变。
  - 禁止：只用 readOnly guard 掩盖所有写路径。

- [ ] **M2-T3：BlueprintPreviewCanvas**
  - 输出：只读蓝图预览组件。
  - 验收：拖拽/Delete/Space/快捷键不改主文档；预览组件不调用 editorStore mutation。

- [ ] **M2-T4：RightSidebar + BlueprintsPanel**
  - 输出：蓝图列表、创建快照、选择蓝图、保存/加载状态展示。
  - 验收：可人工创建多个蓝图；可看到 validationState/appliedInfo/current 标记。

- [ ] **M2-T5：校验提示、摘要 diff、ApplyBlueprintDialog**
  - 输出：校验报告展示、diff 摘要、应用确认弹窗。
  - 验收：valid/invalid/unknown 都可进入确认；invalid/unknown 强提示；确认后应用到内存主文档。

- [ ] **M2-T6：M2 集成验收与回归**
  - 输出：测试补全、文档更新、端到端手测记录。
  - 验收：无 Agent 蓝图闭环完整可用，提交推送。

## Milestone 3：Settings + Secrets（暂不自动执行）

- [ ] M3-T1：App settings 基础结构
- [ ] M3-T2：system/light/dark 主题迁移
- [ ] M3-T3：Provider/Model 配置骨架
- [ ] M3-T4：SecretStore/API key 存储策略

## Milestone 4：Agent Protocol + Mock Agent（暂不自动执行）

- [ ] M4-T1：AgentResponse parser/schema
- [ ] M4-T2：mock provider
- [ ] M4-T3：Agent 面板基础流

## Milestone 5：真实 Provider（暂不自动执行）

- [ ] M5-T1：OpenAI-compatible adapter
- [ ] M5-T2：DeepSeek preset
- [ ] M5-T3：Anthropic adapter
- [ ] M5-T4：timeout/cancel/retry/context budget


## 完成记录

### M1-T1 完成记录

- 完成时间：2026-04-27 01:04 +0800
- 新增：`easyanalyse-desktop/src/types/blueprint.ts`
- 新增：`easyanalyse-desktop/src/lib/documentHash.ts`
- 新增：`easyanalyse-desktop/src/lib/documentHash.test.ts`
- 验证通过：`npm test`、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`
- 已知非本次问题：`npm run build` 因 Windows 风格 icon 脚本路径 `..\scripts\generate_app_icons.py` 在当前 Linux 环境失败。

### M1-T2 完成记录

- 完成时间：2026-04-27 03:24 +0800
- 新增：`easyanalyse-desktop/src/lib/blueprintWorkspace.ts`
- 新增：`easyanalyse-desktop/src/lib/blueprintWorkspace.test.ts`
- 实现：workspace 创建、结构化 normalize/migration、serialize/deserialize、sidecar path、蓝图快照创建、runtime currentness。
- 覆盖：active/archived/deleted lifecycle，unknown/valid/invalid validationState，optional appliedInfo，invalid roundtrip，不把 invalid 写死为不可应用。
- 质量修复：`createBlueprintFromDocument` 深拷贝主文档形成不可变快照，避免源文档后续 mutation 污染蓝图。
- 验证通过：`npm test -- --run`、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
- 任务提交：`a343374 feat: add blueprint workspace utilities`

### M1-T3 完成记录

- 完成时间：2026-04-27 05:38 +0800
- 修改：`easyanalyse-desktop/src-tauri/src/commands.rs`
- 修改：`easyanalyse-desktop/src-tauri/src/main.rs`
- 修改：`easyanalyse-desktop/src/lib/tauri.ts`
- 实现：Tauri sidecar path/read/write commands 与前端 invoke wrappers；sidecar path 使用 `原文件名.easyanalyse-blueprints.json`。
- 覆盖：缺失 sidecar 返回 None/null、损坏 JSON 返回可读错误、非 `.easyanalyse-blueprints.json` 路径拒绝、pretty JSON 保存、允许语义 invalid 蓝图 JSON roundtrip。
- 验证通过：`npm test -- --run`、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
- 替代验证：已新增 Rust 单元测试，但当前环境缺少 `cargo`，`cd easyanalyse-desktop/src-tauri && cargo test` 无法运行（`cargo: command not found`）。


### M1-T4 完成记录

- 完成时间：2026-04-27 08:00 +0800
- 新增：`easyanalyse-desktop/src/store/blueprintStore.ts`
- 新增：`easyanalyse-desktop/src/store/blueprintStore.test.ts`
- 实现：蓝图工作区 Zustand store；支持主文档加载 sidecar/in-memory workspace、保存 workspace、创建主文档快照、选择/归档/软删除、校验并记录 valid/invalid、记录 appliedInfo。
- 覆盖：未保存主文档 `sidecarPath=null`、sidecar load/save、sidecar 加载失败可恢复、`blueprintStore.dirty` 与 `editorStore.dirty` 隔离、invalid 校验不丢弃蓝图、异步 load/save/validate/createSnapshot 竞态防护、缺失 id 操作 no-op。
- 验证通过：`npm test -- --run`、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
- 任务提交：`b1a984f`。


### M1-T5 完成记录

- 完成时间：2026-04-27 10:22 +0800
- 新增：`easyanalyse-desktop/src/store/blueprintCoreIntegration.test.ts`
- 修改：`easyanalyse-desktop/src/store/editorStore.ts`
- 修改：`easyanalyse-desktop/src/store/blueprintStore.ts`
- 实现：`editorStore.openDocument` 在主文档打开后加载对应蓝图 sidecar workspace；`editorStore.newDocument` 初始化未保存文档的空蓝图 workspace；`blueprintStore.loadForMainDocument(null)` 不再继承旧 sidecar workspace。
- 覆盖：重新打开主文档恢复蓝图列表、创建 manual snapshot 并保存 sidecar、主文档不出现 `blueprints`、editor/blueprint dirty 隔离、new document 清空旧蓝图、sidecar 损坏时主文档仍打开并记录错误、metadata hash 使用 normalized editor document、overlapping open stale result 防护。
- 验证通过：`npm test -- --run`、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
- Spec Reviewer：PASS；Quality Reviewer：APPROVED。
- 任务提交：`d54041a`。


### M2-T1 完成记录

- 完成时间：2026-04-27 12:40 +0800
- 修改：`easyanalyse-desktop/src/store/editorStore.ts`
- 新增：`easyanalyse-desktop/src/store/editorStore.test.ts`
- 实现：新增 `editorStore.applyBlueprintDocument(document)`，支持蓝图整文档替换到内存主文档，`dirty=true`，history 入栈，future 清空，undo/redo 可恢复，应用阶段不写磁盘、不因 invalid 校验结果阻止应用。
- 质量修复：应用时递增 `documentOperationToken`，防止 pending `openDocument/newDocument` 旧结果覆盖刚应用的蓝图文档；validation 继续沿用 stale token 防护。
- 覆盖：apply 后 dirty/history/future/临时态清理、不写磁盘、undo/redo、invalid 蓝图可应用、stale validation、pending open stale result。
- 验证通过：`npm test -- --run`、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
- Spec Reviewer：PASS；Quality Reviewer：APPROVED；Final Integration Reviewer：PASS。
- 任务提交：待提交。
