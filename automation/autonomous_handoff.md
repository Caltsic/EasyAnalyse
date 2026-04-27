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
- 最近已知任务提交：`e211bf1`
- 当前任务：`M2-T4 RightSidebar + BlueprintsPanel`
- 当前阻塞：无。M2-T3 已通过 `npm test -- --run`、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。

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

## 下一轮建议

执行 `M2-T4`：RightSidebar + BlueprintsPanel。

建议派子代理：

1. Implementer：新增 `components/layout/RightSidebar.tsx`、`components/blueprints/BlueprintsPanel.tsx`、`BlueprintCard.tsx`，接入 `App.tsx` / `App.css`，支持 Inspector 与 Blueprints tab 切换；用 `blueprintStore` 创建快照、选择蓝图、保存/加载状态展示。
2. Spec Reviewer：检查 BlueprintsPanel 不接 Agent/Provider/Settings，不把蓝图写入主文档，能显示 validationState / appliedInfo / runtime current 标记。
3. Quality Reviewer：重点审查 tab 切换不污染 Inspector/editor 状态、创建快照不修改主文档、sidecar dirty 与 editor dirty 隔离、未保存主文档提示清晰。

建议验收测试：

- Inspector 与 Blueprints tab 可切换。
- 创建当前主文档快照后列表出现蓝图，主文档 canonical hash 不变。
- BlueprintsPanel 显示 active/archived/deleted、unknown/valid/invalid、appliedInfo、isCurrentMainDocument。
- 保存/加载状态展示不改变 `editorStore.dirty`。

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
