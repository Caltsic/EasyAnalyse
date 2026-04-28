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
- 锁文件：`automation/.autonomous_run.lock`，不提交，已加入 `.gitignore`。
- 每轮启动后优先依赖 cron preflight script `~/.hermes/scripts/easyanalyse_autonomous_preflight.py` 原子获取锁；如果 preflight 未运行，才手动执行 `python3 automation/autonomous_lock.py acquire --task <currentTask>`。只有拿到 `AUTONOMOUS_LOCK=ACQUIRED` / `EASYANALYSE_PREFLIGHT_LOCK=ACQUIRED` 后才能发送开始通知、git pull、派子代理或改仓库。
- 锁未过期则跳过本轮，锁超过 6 小时按 stale lock 处理；结束/失败/暂停前必须运行 `python3 automation/autonomous_lock.py release`。
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
- 最近已知任务提交：`78a1627`
- 当前任务：`M4-T3 Agent 面板基础流`
- 当前阻塞：无。M4-T2 已通过 `npm test -- --run`、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`；Spec Reviewer PASS，Quality Reviewer APPROVED，Final Integration Reviewer PASS/READY。

## 最近完成

- 30 分钟轮询防卡死 review 已完成：新增 `automation/autonomous_lock.py` 原子锁，live cronjob 已配置 `~/.hermes/scripts/easyanalyse_autonomous_preflight.py` 作为 preflight，在模型启动前获取锁；锁未过期时本轮跳过，不运行 git/subagent/写文件；结束前 release。任务提交：`c3ea9cd`。

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


- M3-T1 已完成：App settings 基础结构。
  - 新增 `types/settings.ts`、`lib/appSettings.ts`、`store/settingsStore.ts` 及测试。
  - AppSettings 现在包含 `basic.locale`、`appearance.theme`、`agent.providers/selectedProviderId/selectedModelId`，Provider public config 只保存公开 metadata 与 `apiKeyRef`。
  - normalize/serialize 使用 allowlist，剥离 `apiKey`/`password` 等 plaintext secret-like 字段；storage wrapper 对 corrupt JSON、localStorage 不可用、read/write/clear 异常返回 readable warnings。
  - Review：Spec Reviewer 修复 `basic` group 后 PASS；Quality Reviewer 修复 storage error handling 后 APPROVED；Final Integration Reviewer PASS/READY。
  - 验证通过：`npm test -- --run`（16 files / 95 tests）、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
  - 任务提交：`89577eb`。
- M3-T2 已完成：system/light/dark 主题迁移。
  - `useTheme` 现在以 AppSettings `appearance.theme` 为偏好源，支持 `system | light | dark`；对 Canvas/UI 仍输出解析后的 `light | dark` effective theme。
  - `system` 模式监听 `prefers-color-scheme: dark`，系统配色变化会即时更新 DOM `data-theme`/`colorScheme`，不会把解析值写回覆盖 `system` 偏好。
  - 旧 `easyanalyse.theme` 会迁移到 AppSettings；当 AppSettings 已存在时清理 stale/divergent legacy key，避免主题双源分歧。
  - 新增 `theme.test.ts` 与 `useTheme.test.tsx`，覆盖 system 默认、强制 light/dark、legacy migration/cleanup、显式持久化、media query 切换与 toggle。
  - Review：Spec Reviewer 修复后 PASS；Quality Reviewer 修复后 APPROVED。
  - 验证通过：`npm test -- --run`（18 files / 103 tests）、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
  - 任务提交：`c056c01`。

- M3-T3 已完成：Provider/Model 配置骨架。
  - 新增 `ProviderModelSettings` 设置入口，接入 `App.tsx` modal；支持 provider public metadata 增改删选与模型选择。
  - `settingsStore` 新增 upsert/delete/select provider/model actions；所有写入通过 `normalizeAppSettings`，保持持久化 sanitize 与 fallback。
  - `appSettings` 强化 provider normalize：`baseUrl` 只允许 http/https、拒绝 URL credentials；`apiKeyRef` 只允许 reference-shaped 值（如 `keychain://...` / `secret-ref:id`），避免 plaintext secret 存入 AppSettings。
  - 覆盖测试：provider/model add/edit/delete/select、selected fallback、persistence、unknown/secret-shaped field stripping、invalid baseUrl/apiKeyRef rejection、UI invalid warning/draft retention。
  - Review：Spec Reviewer 修复后 PASS；Quality Reviewer 两轮修复后 APPROVED；Final Integration Reviewer PASS/READY。
  - 验证通过：`npm test -- --run`（19 files / 111 tests）、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
  - 任务提交：`7c46896`。


- M3-T4 已完成：SecretStore/API key 存储策略。
  - 新增 `secretStore.ts` abstraction 与测试；SecretStore 生成 opaque `secret-ref:`，UI 只显示 masked ref，AppSettings 只保存 `apiKeyRef`。
  - `ProviderModelSettings` 支持 masked API key 输入、保存、Clear API key、Provider 删除时关联 secret 清理、弱安全 fallback 提示和错误/忙碌状态。
  - `settingsStore` 协调 Provider metadata 与 SecretStore：持久化失败不删除 secret，secret 删除失败恢复普通设置，替换 key 成功后清理旧 ref。
  - Tauri 注册 `secret_store_status/save/read/delete`；Linux 优先 `secret-tool`/Secret Service，macOS/Windows 使用 target-specific `keyring` crate，失败/不可用降级本机 app-data secret 文件并提示弱安全；Unix fallback 文件/目录 owner-only 权限。
  - 覆盖回归：ref/mask/fallback warning/legacy ref delete、UI save/clear/delete/error、settings 清理/回滚、Rust fallback 权限/native 状态/stdin close/fallback read/无 process-arg secret。
  - 验证通过：`npm test -- --run`（20 files / 123 tests）、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`、`cargo test --manifest-path src-tauri/Cargo.toml`（14 tests）。
  - Review：Spec Reviewer PASS；Quality Reviewer 多轮修复后 APPROVED；Final Integration Reviewer PASS/READY。
  - 任务提交：`d60e507`。


- M4-T1 已完成：AgentResponse parser/schema。
  - 新增 `types/agent.ts`，定义 AgentResponse v1、capabilities、message/blueprints/patch/question/error response、parse result/issue 类型。
  - 新增 `lib/agentResponse.ts`，实现纯 parser/schema：JSON string/object 输入、schemaVersion/kind readable rejection、base fields/capabilities normalize、message/blueprints/question/error 解析；patch 仅 deferred/unsupported warning，不应用 patch。
  - 蓝图候选：保留 object-shaped semantic v4 candidate document，即使语义 invalid 也只附 issues 不丢弃；非 object document 直接 readable parse error；forbidden legacy topology 字段会在 root/device/terminal 位置报告，同时跳过 properties/metadata/extensions 开放子树减少误报。
  - 覆盖测试：valid message/blueprints/question/error、unknown schema/kind、capabilities normalization、optional notes、invalid candidate retained、forbidden legacy fields、non-object document rejection、no main/source mutation。
  - Review：Spec Reviewer 修复后 PASS；Quality Reviewer 修复后 APPROVED；Final Integration Reviewer PASS/READY。
  - 验证通过：`npm test -- --run`（21 files / 135 tests）、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
  - 任务提交：`5d7953b`。


- M4-T2 已完成：mock provider。
  - 新增 `easyanalyse-desktop/src/lib/agentMockProvider.ts` 与测试。
  - 实现本地 deterministic mock Agent provider，`runMockAgentProvider` 会生成 AgentResponse v1 并通过 `parseAgentResponse` 解析；不调用真实网络、Tauri invoke、SecretStore 或 API key。
  - 支持 `message`、`question`、`error`、`blueprints`、`blueprints-invalid` 场景；蓝图场景包含 valid candidate 与 intentionally invalid object-shaped candidate，invalid candidate 保留 parser issues 供 UI/验证流展示。
  - 覆盖测试：parseable AgentResponse v1、valid/invalid candidate、error/question、无 fetch/invoke/secret、主文档不 mutation。
  - Review：Spec Reviewer PASS；Quality Reviewer APPROVED；Final Integration Reviewer PASS/READY。
  - 验证通过：`npm test -- --run`（22 files / 139 tests）、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
  - 任务提交：`78a1627`。

## 下一轮建议

执行 `M4-T3`：Agent 面板基础流。

建议派子代理：

1. Implementer：基于 M4-T1 `parseAgentResponse` 与 M4-T2 `runMockAgentProvider` 实现桌面内 Agent 面板基础流；允许用户输入 prompt，调用 mock provider，展示 message/question/error 与 blueprint candidates，并将候选保存为 blueprintStore 中的蓝图记录。
2. Spec Reviewer：检查 Agent 只能通过蓝图候选进入 workspace，不得直接 mutate 主文档；invalid candidate 必须保留并展示风险，不得阻止后续 apply；不得调用真实 Provider、SecretStore 或 API key。
3. Quality Reviewer：重点审查 async busy/error 状态、重复提交/竞态、面板键盘/弹窗安全、候选写入 sidecar/workspace 的 dirty 隔离、测试覆盖。

建议验收测试：

- Agent 面板使用 mock provider 返回 message/question/error；blueprints 响应会创建/显示候选蓝图；invalid candidate 保留 issues；不直接修改 main document；不调用真实网络/secret；回归 `npm test -- --run`、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。

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
- 频率：`every 30m`
- deliver：`origin`
- 运行模式：短周期轮询 + 原子运行锁；cron prompt 与 `automation/autonomous_supervisor.md` 都要求先 acquire lock，再发开始通知/读写仓库。

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
- M3-T1 任务提交：`89577eb`
- M3-T2 任务提交：`c056c01`
- M3-T3 任务提交：`7c46896`
- M3-T4 任务提交：`d60e507`
- M4-T1 任务提交：`5d7953b`
- M4-T2 任务提交：`78a1627`
