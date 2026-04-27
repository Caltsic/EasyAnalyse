# EasyAnalyse 自主施工交接

## 当前目标

在 `agent` 分支上落地 EasyAnalyse 桌面版蓝图系统，并在蓝图闭环稳定后再接入内置 Agent。

当前已授权自动顺序推进：

- Milestone 1：Blueprint Core
- Milestone 2：Blueprint UI 闭环
- Milestone 3：Settings + Secrets
- Milestone 4：Agent Protocol + Mock Agent
- Milestone 5：真实 Provider

执行方式：仍然每轮只做一个可验证小任务；M1/M2 完成后自动进入 M3，再进入 M4/M5。只有遇到 supervisor 定义的停止条件、测试连续失败、需要产品决策或高风险权限升级时才暂停询问用户。


## 调度模式

- 当前 cronjob 频率：`every 30m`。
- 当前运行模式：短周期轮询 + 仓库运行锁。
- 锁文件：`automation/.autonomous_run.lock`，不提交。
- 每轮启动时先检查锁；锁未过期则跳过本轮，锁超过 6 小时按 stale lock 处理。
- 目的：任务完成后最多约 30 分钟进入下一轮，同时避免多轮并发改同一分支。

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
- 最近已知任务提交：`442642d`
- 当前任务：`M3-T1 App settings 基础结构`
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
- M2-T5 已完成：校验提示、摘要 diff、ApplyBlueprintDialog。
  - 新增 `blueprintDiff.ts`，覆盖 device / terminal / label / view / document meta / raw JSON 摘要。
  - 新增 `ApplyBlueprintDialog`，在 `BlueprintsPanel` 中接入 Apply；valid/invalid/unknown 都可进入确认，invalid/unknown 强提示但不阻止，base hash mismatch 显示整文档替换/no merge 风险。
  - 确认后调用 `editorStore.applyBlueprintDocument` 替换内存主文档并 dirty=true，再 `blueprintStore.markApplied` 记录 `appliedInfo`；不直接保存主文档或 sidecar，不使用 `status='applied'`。
  - 质量修复：确认弹窗默认焦点在取消按钮；捕获危险快捷键；Tab focus trap；应用中禁止 backdrop 关闭；弹窗打开时禁用蓝图卡片后台操作。
  - 覆盖测试：valid/invalid/unknown 确认、强提示、base mismatch、diff terminal changed、appliedInfo/status、dirty+undo、键盘/焦点隔离。
  - Review：Spec Reviewer 修复后 PASS；Quality Reviewer 修复后 APPROVED。
  - 验证通过：`npm test -- --run`（14 files / 82 tests）、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
  - 任务提交：`e9dbc19`。


- M2-T6 已完成：M2 集成验收与回归。
  - 新增 M2 手测验收文档：`docs/manual-tests/m2-blueprint-ui-loop-acceptance.md`。
  - `BlueprintsPanel` 现在在选中蓝图时显示只读 `BlueprintPreviewCanvas` 预览。
  - 新增无 Agent 蓝图闭环验收测试：sidecar/list/select/preview/validate/diff/apply/dirty/undo；补充断言确认 preview 接收的是选中蓝图 document，不是主文档或错误记录。
  - Quality 修复：手测文档已明确区分 panel/store 合约测试、磁盘 sidecar 加载覆盖与真实 preview renderer 专项测试，避免夸大 mock 覆盖范围。
  - 验证通过：`npm test -- --run`（14 files / 83 tests）、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
  - Review：Spec Reviewer PASS；Quality Reviewer 修复后 APPROVED；Final Integration Reviewer PASS/READY。
  - 任务提交：`442642d`。

## 下一轮建议

执行 `M3-T1`：App settings 基础结构。

建议派子代理：

1. Implementer：实现 M3-T1 App settings 基础结构。先侦察现有 theme/settings/tauri 存储方式，新增最小 AppSettings 类型、默认值、序列化/迁移/本地持久化 wrapper 或 store 骨架；只做普通设置基础设施，不接 API key 明文、不做 Provider 调用。
2. Spec Reviewer：检查 M3-T1 是否只建立 Settings 基础结构，是否为后续 appearance/provider/model/secret 分组预留清晰边界，是否未把 secrets 写入仓库/文档/sidecar。
3. Quality Reviewer：重点审查设置迁移兼容性、默认值、错误处理、测试覆盖、与现有主题/状态初始化的集成风险。

建议验收测试：

- 针对 M3-T1 的新增单元测试/集成测试。
- 回归 `npm test -- --run`、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
- 当前 M2-T6 已完成；下一轮自动进入 M3 Settings + Secrets。

## 重要提醒

- 报错不阻止蓝图应用；应用确认只提示风险。
- 保存到磁盘仍走现有严格校验。
- M2-T6 完成后不要停在蓝图闭环；继续自动进入 M3 Settings + Secrets。
- M3 完成后进入 M4 Mock Agent；M4 完成后进入 M5 真实 Provider。
- M5 可以实现 provider adapter 与配置测试；用户已提供项目专用 DeepSeek API key，真实模型调用优先使用 DeepSeek。key 只允许从仓库外本机 secret 文件读取：`/home/ubuntu/.config/EasyAnalyse/secrets/deepseek_api_key`。不要把明文写入 git、主文档、sidecar、普通设置、prompt 日志或 Telegram。若出现高额费用风险、频繁失败、额度/速率限制、或需要改变默认调用策略，再暂停询问。
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
- M2-T5 任务提交：`e9dbc19`
- M2-T6 任务提交：`442642d`
