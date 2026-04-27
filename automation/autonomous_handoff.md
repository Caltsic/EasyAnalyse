# EasyAnalyse 自主施工交接

## 当前目标

在 `agent` 分支上落地 EasyAnalyse 桌面版蓝图系统，并在蓝图闭环稳定后再接入内置 Agent。

当前阶段只授权自动推进：

- Milestone 1：Blueprint Core
- Milestone 2：Blueprint UI 闭环

Milestone 3/4/5 暂不自动实施，除非 M1/M2 稳定或用户明确扩权。

## 最高优先文档

必须优先遵守：

1. `automation/autonomous_supervisor.md`
2. `docs/plans/2026-04-26-agent-blueprint-mvp-revision.md`
3. `docs/plans/2026-04-26-blueprint-milestone-1-2-file-level-implementation-plan.md`
4. `automation/decision_log.md`
5. `automation/task_queue.md`

旧规划如有冲突，以以上文件为准。

## 当前状态

- 当前分支：`agent`
- 当前远端：`origin/agent`
- 最近已知任务提交：`9bfcefc`
- 当前任务：`M2-T5 校验提示、摘要 diff、ApplyBlueprintDialog`
- 当前阻塞：无。M2-T4 已通过 `npm test -- --run`、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。桌面编译/运行环境已补齐：Rust/Cargo、Tauri Linux 依赖、xvfb/dbus-x11 已安装；`npm run build`、`cargo test`、`npm run tauri:build` 均已通过，release binary 已用 xvfb 启动验证。环境/脚本修复提交：`1bc5dce`。

## 最近完成

- M1-T1 至 M1-T5 已完成并验证通过，详见 `automation/task_queue.md` 完成记录。
- M2-T1 已完成：新增 `editorStore.applyBlueprintDocument(document)`。
  - 行为：normalize 后整文档替换内存主文档；`dirty=true`；当前文档进入 history；future 清空；触发 validation；不写磁盘。
  - undo/redo：应用后 undo 恢复旧主文档，redo 恢复蓝图文档。
  - invalid/unknown/valid 策略：apply 阶段不因校验问题阻止；保存磁盘仍走现有保存门禁。
  - 任务提交：`cda2c2a`。
- M2-T2 已完成：抽取 `CircuitCanvasRenderer`。
  - `CanvasView.tsx` 现在作为 `editorStore` 连接层；`CircuitCanvasRenderer` 不 import/use `editorStore`，写路径由可选 callbacks 承载。
  - renderer 默认 `interactive=false`；无 callbacks/静态预览场景不会启用 Konva draggable；主画布显式传 `interactive`。
  - 任务提交：`f534770`。
- M2-T3 已完成：新增 `BlueprintPreviewCanvas`。
  - 新增 `easyanalyse-desktop/src/components/blueprints/BlueprintPreviewCanvas.tsx`。
  - 新增 `BlueprintPreviewCanvas.test.tsx` 与 `BlueprintPreviewCanvas.integration.test.tsx`。
  - 基于 `CircuitCanvasRenderer` 渲染传入 `DocumentFile`，显式 `interactive={false}`，不 import/use `editorStore`，不传主文档 mutation callbacks。
  - 预览容器 focusable 且 capture 阶段隔离当前 App 全局写路径快捷键：Delete、Space、Home、Escape、Ctrl/Cmd+S/O/N/Z/Y/0，避免 focused preview 事件冒泡到主编辑器 window handler。
  - 测试覆盖 main document canonical hash 不变、无 mutation callbacks、快捷键不泄漏、真实 renderer 非交互 pointer events 下无 draggable 写路径。
  - 为 DOM 交互测试新增 devDependency `jsdom`。
  - Review：Spec Reviewer 首轮发现键盘/交互覆盖不足，修复后 PASS；Quality Reviewer 首轮发现 Home/Escape 泄漏风险，修复后 APPROVED；Final Integration Reviewer PASS/READY。
  - 验证通过：`npm test -- --run`、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
  - 任务提交：`e211bf1`。
- M2-T4 已完成：新增 `RightSidebar` + `BlueprintsPanel`。
  - `App.tsx` 右侧由直接 `Inspector` 改为单列 tab 容器，支持 Inspector / Blueprints 切换，不引入第三列。
  - 新增 `BlueprintsPanel` 与 `BlueprintCard`，支持创建当前主文档快照、选择蓝图、保存/重载 workspace、校验、归档、软删除，并展示 sidecar/in-memory、dirty/clean、loading/error 状态。
  - 卡片显示 lifecycleStatus、validationState、source、issue/warning 计数、appliedInfo 历史标记、runtime `isCurrentMainDocument` 与 base hash mismatch。
  - 质量修复：顶层 action/per-card validate busy guard；archived/deleted action 幂等；deleted validate store-level no-op、archived validate 可用；`editorStore.initialize()` 初始化未保存默认文档的 blueprint workspace；`workspace=null` 直接创建快照时也保留 mainDocument metadata/base hash。
  - 覆盖测试：RightSidebar tab 切换、BlueprintsPanel 快照/状态展示/dirty 隔离/重复 action guard、blueprintStore 幂等与 workspace metadata、editorStore startup 初始化。
  - Review：Spec Reviewer PASS；Quality Reviewer 三轮修复后 APPROVED。
  - 验证通过：`npm test -- --run`（13 files / 70 tests）、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
  - 任务提交：`9bfcefc`。

## 下一轮建议

执行 `M2-T5`：校验提示、摘要 diff、ApplyBlueprintDialog。

建议派子代理：

1. Implementer：新增/完善 `lib/blueprintDiff.ts`、`components/blueprints/ApplyBlueprintDialog.tsx`，并接入 `BlueprintsPanel` 详情/操作区。
2. Spec Reviewer：检查 valid/invalid/unknown 都可进入确认；invalid/unknown 只强提示、不阻止；确认后应用到内存主文档，不直接保存磁盘。
3. Quality Reviewer：重点审查全局快捷键/弹窗焦点隔离、base hash mismatch 风险提示、`appliedInfo` 与 runtime `isCurrentMainDocument` 语义、dirty+undo 行为。

建议验收测试：

- 校验报告展示 schema/semantic issues 与 warning/error 数量。
- diff 摘要能显示 device/label/view/meta 级变化。
- valid/invalid/unknown 蓝图都可进入确认；invalid/unknown 必须强提示。
- 确认后调用 `editorStore.applyBlueprintDocument`，主文档 dirty=true 且 undo 可恢复。
- `blueprintStore.markApplied` 更新 `appliedInfo`，但不使用 `status='applied'`。

## 重要提醒

- 报错不阻止蓝图应用；应用确认只提示风险。
- 保存到磁盘仍走现有严格校验。
- 不要实现 Agent/Provider/API key，直到 M1/M2 完成。
- 不要把蓝图写进主 document。
- 不要使用旧的 `status='applied'` 模型。
- Canvas 预览优先使用纯渲染层 `CircuitCanvasRenderer`，不要只靠 readOnly guard 掩盖写路径。

## 自主施工 cronjob

- Job ID：`02e4bfaf3360`
- 名称：`EasyAnalyse Agent Branch Autonomous Builder`
- 频率：`every 2h`
- deliver：`origin`
- 每轮仍会主动发送 Telegram 开始/结束通知（若运行环境暴露对应发送工具；本 cron 交付也会由系统自动处理最终响应）。

## 最近任务提交

- M1-T1 任务提交：`c4a435d feat: add blueprint document hashing types`
- M1-T2 任务提交：`a343374 feat: add blueprint workspace utilities`
- M1-T3 任务提交：`633efde`
- M1-T3 handoff 更新提交：`ea75624`
- M1-T4 任务提交：`b1a984f`
- M1-T5 任务提交：`d54041a`
- M2-T1 任务提交：`cda2c2a`
- M2-T2 任务提交：`f534770`
- M2-T3 任务提交：`e211bf1`
- M2-T4 任务提交：`9bfcefc`
