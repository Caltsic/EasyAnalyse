# EasyAnalyse 自主施工任务队列

> 执行规则：cronjob 每 30 分钟启动一次；每轮先通过 `automation/autonomous_lock.py` / cron preflight 原子获取 `automation/.autonomous_run.lock` 防并发，然后优先完成一个最小任务。完成后把 `[ ]` 改为 `[x]`，必要时追加 commit/test 信息。阻塞任务用 `[!]` 标记并写明原因。

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

- [x] **M2-T2：抽取 CircuitCanvasRenderer**
  - 输出：纯渲染组件，不依赖 editorStore mutation。
  - 验收：主 CanvasView 仍可编辑；renderer 可被预览复用；预览前后 mainDocumentHash 不变。
  - 禁止：只用 readOnly guard 掩盖所有写路径。

- [x] **M2-T3：BlueprintPreviewCanvas**
  - 输出：只读蓝图预览组件。
  - 验收：拖拽/Delete/Space/快捷键不改主文档；预览组件不调用 editorStore mutation。

- [x] **M2-T4：RightSidebar + BlueprintsPanel**
  - 输出：蓝图列表、创建快照、选择蓝图、保存/加载状态展示。
  - 验收：可人工创建多个蓝图；可看到 validationState/appliedInfo/current 标记。

- [x] **M2-T5：校验提示、摘要 diff、ApplyBlueprintDialog**
  - 输出：校验报告展示、diff 摘要、应用确认弹窗。
  - 验收：valid/invalid/unknown 都可进入确认；invalid/unknown 强提示；确认后应用到内存主文档。

- [x] **M2-T6：M2 集成验收与回归**
  - 输出：测试补全、文档更新、端到端手测记录。
  - 验收：无 Agent 蓝图闭环完整可用，提交推送。

## Milestone 3：Settings + Secrets（M2 验收通过后自动执行）

- [x] M3-T1：App settings 基础结构
- [x] M3-T2：system/light/dark 主题迁移
- [x] M3-T3：Provider/Model 配置骨架
- [x] M3-T4：SecretStore/API key 存储策略

## Milestone 4：Agent Protocol + Mock Agent（M3 验收通过后自动执行）

- [x] M4-T1：AgentResponse parser/schema
- [x] M4-T2：mock provider
- [ ] M4-T3：Agent 面板基础流

## Milestone 5：真实 Provider（M4 验收通过后自动执行；真实调用优先 DeepSeek）

- [ ] M5-T1：OpenAI-compatible adapter
- [ ] M5-T2：DeepSeek preset
- [ ] M5-T3：Anthropic adapter
- [ ] M5-T4：timeout/cancel/retry/context budget

M5 真实调用约束：用户已提供项目专用 DeepSeek API key；自动化任务可从仓库外 `/home/ubuntu/.config/EasyAnalyse/secrets/deepseek_api_key` 读取。不得把 key 明文写入仓库、主文档、sidecar、普通设置、prompt 日志或 Telegram。真实 API smoke test 必须低成本、最小化；若出现高额费用风险或默认调用策略不确定，再暂停询问。


## 完成记录

### M1-T1 完成记录

- 完成时间：2026-04-27 01:04 +0800
- 新增：`easyanalyse-desktop/src/types/blueprint.ts`
- 新增：`easyanalyse-desktop/src/lib/documentHash.ts`
- 新增：`easyanalyse-desktop/src/lib/documentHash.test.ts`
- 验证通过：`npm test`、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`
- 已修复：`npm run build` 的 icon 生成脚本路径已改为跨 Linux 可用的 `python3 ../scripts/generate_app_icons.py`（环境修复提交 `1bc5dce`）。

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
- 任务提交：`cda2c2a`。

### M2-T2 完成记录

- 完成时间：2026-04-27 15:00 +0800
- 新增：`easyanalyse-desktop/src/components/canvas/CircuitCanvasRenderer.tsx`
- 新增：`easyanalyse-desktop/src/components/canvas/CircuitCanvasRenderer.test.tsx`
- 修改：`easyanalyse-desktop/src/components/CanvasView.tsx`
- 实现：从 `CanvasView` 抽出 `CircuitCanvasRenderer`，`CanvasView` 只负责连接 `editorStore` 并传入 document、locale、theme、selection、focus、viewport animation 与交互 callbacks。
- 质量修复：renderer 默认 `interactive=false`，无 callbacks/预览场景不会暴露 Konva draggable 写路径；主 `CanvasView` 显式传 `interactive` 保持编辑行为。
- 覆盖：静态 document 渲染、禁止 editorStore/direct mutation import/call、默认非 draggable、interactive/CanvasView 可启用 draggable。
- 验证通过：`npm test -- --run`、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
- Spec Reviewer：PASS；Quality Reviewer 修复后 APPROVED；Final Integration Reviewer：PASS。
- 任务提交：`f534770`。

### M2-T3 完成记录

- 完成时间：2026-04-27 17:39 +0800
- 新增：`easyanalyse-desktop/src/components/blueprints/BlueprintPreviewCanvas.tsx`
- 新增：`easyanalyse-desktop/src/components/blueprints/BlueprintPreviewCanvas.test.tsx`
- 新增：`easyanalyse-desktop/src/components/blueprints/BlueprintPreviewCanvas.integration.test.tsx`
- 修改：`easyanalyse-desktop/package.json`、`easyanalyse-desktop/package-lock.json`，新增 devDependency `jsdom` 以支持 DOM 交互回归测试。
- 实现：基于 `CircuitCanvasRenderer` 的只读蓝图预览组件，显式 `interactive={false}`，不 import/use `editorStore`，不传主文档 mutation callbacks。
- 覆盖：预览渲染前后主文档 canonical hash 不变；无 mutation callbacks；focused preview 隔离 Delete/Space/Home/Escape 与 Ctrl/Cmd Save/Open/New/Undo/Redo/Home 等全局快捷键；真实 renderer 路径下非交互预览 pointer events 不暴露 draggable 写路径。
- 验证通过：`npm test -- --run`、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
- Spec Reviewer：修复后 PASS；Quality Reviewer：修复后 APPROVED；Final Integration Reviewer：PASS/READY。
- 任务提交：`e211bf1`。

### M2-T4 完成记录

- 完成时间：2026-04-27 20:18 +0800
- 新增：`easyanalyse-desktop/src/components/layout/RightSidebar.tsx` 与 `RightSidebar.test.tsx`。
- 新增：`easyanalyse-desktop/src/components/blueprints/BlueprintsPanel.tsx`、`BlueprintCard.tsx` 与 `BlueprintsPanel.test.tsx`。
- 修改：`easyanalyse-desktop/src/App.tsx`、`App.css`，将右侧改为 Inspector / Blueprints 单列 tab 容器，不新增第三列。
- 修改：`blueprintStore` / `editorStore` 及测试，补齐默认文档 blueprint workspace 初始化、workspace=null 快照 metadata/base hash、归档/删除/校验幂等与 busy guard。
- 实现：蓝图列表、创建快照、选择蓝图、保存/重载 workspace 状态展示；卡片展示 lifecycle、validationState、appliedInfo、runtime current main document、issue/warning 计数与 sidecar dirty/clean 状态。
- 覆盖：tab 切换、创建快照列表展示、dirty 隔离、主文档 hash 不变、未保存主文档提示、重复 action guard、archived/deleted 幂等、startup workspace 初始化。
- 验证通过：`npm test -- --run`（13 files / 70 tests）、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
- 已修复：`npm run build` 的 icon 生成脚本路径已改为跨 Linux 可用的 `python3 ../scripts/generate_app_icons.py`（环境修复提交 `1bc5dce`）。
- Spec Reviewer：PASS；Quality Reviewer：三轮修复后 APPROVED。
- 任务提交：`9bfcefc feat: add blueprint sidebar panel`。

### M2-T5 完成记录

- 完成时间：2026-04-27 23:19 +0800
- 新增：`easyanalyse-desktop/src/lib/blueprintDiff.ts` 与 `blueprintDiff.test.ts`，提供 device / terminal / label / view / document meta / raw JSON 摘要 diff。
- 新增：`easyanalyse-desktop/src/components/blueprints/ApplyBlueprintDialog.tsx`，展示校验报告、diff 摘要、base hash mismatch 整文档替换风险、invalid/unknown 强提示与二次确认。
- 修改：`BlueprintsPanel` / `BlueprintCard` / `App.css`，接入 Apply 操作；确认后调用 `editorStore.applyBlueprintDocument`，再通过 `blueprintStore.markApplied` 写入 `appliedInfo`；不直接保存磁盘、不使用 `status='applied'`。
- 质量修复：应用弹窗默认聚焦取消按钮而非破坏性确认；捕获并隔离 Enter/Space/Delete/Escape 等快捷键；Tab focus trap；应用中禁止 backdrop 关闭；弹窗打开时禁用蓝图卡片后台操作。
- 覆盖：valid/invalid/unknown 均可进入确认，invalid/unknown 强提示，base hash mismatch 提示，确认后主文档 dirty 且 undo 可恢复，`appliedInfo` 保留且生命周期不变，diff 覆盖 terminal changed，弹窗键盘/焦点隔离。
- Review：Spec Reviewer 首轮发现 terminal changed 展示与 valid/unknown 测试不足，修复后 PASS；Quality Reviewer 首轮发现破坏性默认焦点、focus trap、backdrop applying 竞态，修复后 APPROVED。
- 验证通过：`npm test -- --run`（14 files / 82 tests）、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。


### M2-T6 完成记录

- 完成时间：2026-04-28 01:58 +0800
- 新增：`docs/manual-tests/m2-blueprint-ui-loop-acceptance.md`。
- 修改：`BlueprintsPanel` 接入选中蓝图的 `BlueprintPreviewCanvas` 只读预览区域。
- 补充：`BlueprintsPanel.test.tsx` 端到端无 Agent 蓝图 UI 闭环验收测试：sidecar 列表 -> 选择预览 -> validate -> diff/apply dialog -> invalid 强提示但可应用 -> editor dirty -> `appliedInfo` -> undo 恢复；断言 preview 接收选中蓝图 document。
- 质量修复：手测文档澄清 panel 测试使用 seeded store 与 mocked preview；真实 preview renderer 和磁盘 sidecar 加载由既有专项测试覆盖。
- 验证通过：`npm test -- --run`（14 files / 83 tests）、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
- Review：Spec Reviewer PASS；Quality Reviewer 修复后 APPROVED；Final Integration Reviewer PASS/READY。
- 任务提交：`442642d test: tighten m2 blueprint acceptance coverage`。

### M3-T1 完成记录

- 完成时间：2026-04-28 04:18 +0800
- 新增：`easyanalyse-desktop/src/types/settings.ts`，定义 `AppSettings`、`basic`、`appearance`、Provider public config、`apiKeyRef` 边界。
- 新增：`easyanalyse-desktop/src/lib/appSettings.ts`，实现默认设置、迁移/normalize、序列化、可替换 localStorage wrapper 与可读 storage warning。
- 新增：`easyanalyse-desktop/src/store/settingsStore.ts`，提供最小 Zustand settings store skeleton（load / replaceSettings / reset）。
- 新增测试：`appSettings.test.ts`、`settingsStore.test.ts`，覆盖默认值、partial/legacy migration、secret-like 字段剥离、provider/model selection normalize、corrupt/unavailable storage、reset warning propagation。
- Review：Spec Reviewer 修复 `basic` group 后 PASS；Quality Reviewer 修复 storage error handling 后 APPROVED；Final Integration Reviewer PASS/READY。
- 验证通过：`npm test -- --run`（16 files / 95 tests）、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
- 任务提交：`89577eb feat: add app settings foundation`。

### M3-T2 完成记录

- 完成时间：2026-04-28 05:04 +0800
- 修改：`easyanalyse-desktop/src/lib/theme.ts`、`easyanalyse-desktop/src/lib/useTheme.ts`。
- 新增测试：`easyanalyse-desktop/src/lib/theme.test.ts`、`easyanalyse-desktop/src/lib/useTheme.test.tsx`。
- 实现：主题偏好迁移到 AppSettings `appearance.theme`，支持 `system | light | dark`；`system` 根据系统配色解析并监听变化；强制 light/dark 保持即时应用与持久化。
- 兼容：旧 `easyanalyse.theme` 会迁移进 AppSettings；当 AppSettings 已存在时会 best-effort 清理 stale/divergent legacy key，避免双源分歧。
- 覆盖：system 默认、强制 light/dark、legacy migration、divergent legacy cleanup、显式偏好持久化、系统 media query 切换与 toggle 持久化。
- Review：Spec Reviewer 修复后 PASS；Quality Reviewer 修复后 APPROVED。
- 验证通过：`npm test -- --run`（18 files / 103 tests）、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
- 任务提交：`c056c01 feat: migrate theme preference to app settings`。

### M3-T3 完成记录

- 完成时间：2026-04-28 06:13 +0800
- 修改：`easyanalyse-desktop/src/lib/appSettings.ts`、`src/store/settingsStore.ts`、`src/App.tsx`、`src/App.css`。
- 新增：`easyanalyse-desktop/src/components/settings/ProviderModelSettings.tsx` 与 `ProviderModelSettings.test.tsx`。
- 实现：Provider/Model public config 骨架与设置入口；支持公开 provider metadata 增改删选、模型选择、持久化 normalize；只保存 `apiKeyRef` 引用，不保存 plaintext API key。
- 质量修复：`baseUrl` 仅允许 http/https 且拒绝 URL credentials；`apiKeyRef` 仅接受 reference-shaped 值；无效 provider 不清空 UI 草稿；warning key 避免重复。
- 覆盖：provider/model add/edit/delete/select、selected provider/model fallback、persistence、unknown/secret-shaped field stripping、invalid baseUrl/apiKeyRef rejection、UI invalid warning/draft retention。
- Review：Spec Reviewer 修复后 PASS；Quality Reviewer 两轮修复后 APPROVED；Final Integration Reviewer PASS/READY。
- 验证通过：`npm test -- --run`（19 files / 111 tests）、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
- 任务提交：`7c46896 feat: add provider model settings skeleton`。


### M3-T4 完成记录

- 完成时间：2026-04-28 07:38 +0800
- 新增：`easyanalyse-desktop/src/lib/secretStore.ts` 与 `secretStore.test.ts`，提供 SecretStore abstraction、`secret-ref:` opaque refs、masked display、Tauri backend 与测试 backend。
- 修改：`ProviderModelSettings`，支持 masked API key 输入、保存、Clear API key、删除 Provider 时清理关联 secret、后端安全状态/弱安全 fallback 提示与错误/忙碌状态。
- 修改：`settingsStore`，Provider 删除/清除 API key 会协调 `apiKeyRef` 与 SecretStore；settings 持久化失败不删除 secret，secret 删除失败会恢复普通设置，替换 key 成功后清理旧 ref。
- 修改：Tauri commands，注册 `secret_store_status/save/read/delete`；Linux 优先 `secret-tool`/Secret Service（secret 经 stdin 传入并关闭 stdin 防挂起），macOS/Windows 使用 target-specific Rust `keyring` crate，失败/不可用时降级本机 app-data secret 文件并提示弱安全；Unix fallback 文件/目录使用 owner-only 权限。
- 覆盖：SecretStore ref/mask/fallback warning/legacy ref delete；Provider UI save/clear/delete/error；settings store 清理/回滚；Rust fallback 权限、native/fallback 状态、stdin close、fallback read、无 macOS process-arg secret path。
- Review：Spec Reviewer PASS；Quality Reviewer 多轮修复后 APPROVED；Final Integration Reviewer PASS/READY。
- 验证通过：`npm test -- --run`（20 files / 123 tests）、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`、`cargo test --manifest-path src-tauri/Cargo.toml`（14 tests）。
- 任务提交：`d60e507 feat: add secret store api key management`。


### M4-T1 完成记录

- 完成时间：2026-04-28 13:40 +0800
- 新增：`easyanalyse-desktop/src/types/agent.ts`，定义 AgentResponse v1、capabilities、message/blueprints/patch/question/error response 类型与 parse result/issue 类型。
- 新增：`easyanalyse-desktop/src/lib/agentResponse.ts`，实现纯 AgentResponse parser/schema：接受 JSON string 或 object，校验 `schemaVersion='agent-response-v1'` 与 kind，支持 message/blueprints/question/error，patch 仅作为 unsupported/deferred warning，不执行 patch。
- 新增：`easyanalyse-desktop/src/lib/agentResponse.test.ts`，覆盖 valid message/blueprints/question/error、unknown schema/kind rejection、capabilities normalization、optional notes、invalid candidate retained、forbidden legacy topology issue、non-object document rejection、no main/source mutation。
- 质量修复：candidate document 必须是 object-shaped 才能作为可保留语义 v4 候选；语义 invalid object 文档仍保留并附 issues；legacy topology 扫描保留 root/device/terminal 检测，同时跳过 `properties`/`metadata`/`extensions` 等开放元数据子树以减少误报。
- Review：Spec Reviewer 修复后 PASS；Quality Reviewer 修复后 APPROVED；Final Integration Reviewer PASS/READY。
- 验证通过：`npm test -- --run`（21 files / 135 tests）、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
- 任务提交：`5d7953b feat: add agent response parser schema`。

### M4-T2 完成记录

- 完成时间：2026-04-28 14:29 +0800
- 新增：`easyanalyse-desktop/src/lib/agentMockProvider.ts`，实现本地 deterministic mock Agent provider，提供 `runMockAgentProvider` 与 `createMockAgentResponse`，输出 AgentResponse v1 并通过 `parseAgentResponse` 解析。
- 新增：`easyanalyse-desktop/src/lib/agentMockProvider.test.ts`，覆盖 message、question、error、valid+invalid blueprints、invalid-only candidate、parser issue 保留、无 fetch/Tauri invoke/SecretStore 使用、主文档不 mutation。
- 支持场景：`message`、`question`、`error`、`blueprints`、`blueprints-invalid`；蓝图场景保留 object-shaped invalid semantic v4 candidate，不调用真实 Provider、网络、SecretStore 或 API key。
- Review：Spec Reviewer PASS；Quality Reviewer APPROVED；Final Integration Reviewer PASS/READY。
- 验证通过：`npm test -- --run`（22 files / 139 tests）、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
- 任务提交：`78a1627 feat: add mock agent provider`。

