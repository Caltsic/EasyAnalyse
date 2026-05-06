# EasyAnalyse M1-M5 全面验收报告

> **M6 修订说明（2026-05-06）：** 本报告原结论中的 M5 真实 Provider 未接 AgentPanel、RightSidebar 状态丢失、editorStore 保存竞态等阻塞项，已由 M6 修复并通过补充验收。发布/合并判断请同时阅读 `docs/plans/2026-05-06-m6-acceptance-addendum.md`；本文件以下内容保留为 2026-04-30 验收时的历史问题记录。

> 分支：`agent`  
> 验收日期：2026-05-06  
> 验收方式：按 `docs/plans/2026-04-30-full-acceptance-plan.md` 拆分 A-H 八条检查线，分派子代理并行审查；主控汇总。  
> 当前结论：**FAIL / 不建议进入发布或合并 main；M1-M4 主链路基本可用，但 M5 “真实 Provider”未端到端接入产品 UI，另有若干 Important UX/竞态风险需要修复。**

## 1. 总体结论

### 1.1 发布/合并判定

当前不建议发布或合并到 `main`。

原因不是基础构建失败，而是验收发现：

1. **M5 Real Providers 标记完成，但真实 Provider 仍未接入 AgentPanel 产品路径。**
   - OpenAI-compatible、DeepSeek、Anthropic adapter 与 runtime 控制均已实现并有单元测试。
   - 但 `AgentPanel` 仍是 `Local mock flow only`，只调用 `runMockAgentProvider`。
   - Settings / SecretStore / selected provider / runtime / adapters 没有串成真实可用链路。

2. **右侧 Inspector / Agent / Blueprints tab 切换会卸载面板，导致用户输入与局部状态丢失。**
   - Agent prompt、run state、Blueprints apply dialog / errors / busy state 都可能因切 tab 消失。

3. **`editorStore.saveDocument` / `saveDocumentAs` 存在异步保存期间覆盖后续编辑并错误清 dirty 的风险。**
   - 保存请求发起后，如果用户继续编辑，保存返回时当前实现可能把旧保存结果写回 store 并 `dirty=false`。

4. **最高优先验收计划此前未跟踪，旧规划仍有部分冲突表述。**
   - 本报告已将验收结果落盘，后续应修正旧规划或明确废弃片段。

### 1.2 通过的核心内容

- M1 Blueprint Core：类型、hash、workspace、sidecar IO、blueprintStore 基本覆盖充分。
- M2 Blueprint UI Loop：创建快照、sidecar 保存/加载、只读预览、校验提示、diff、强确认应用、undo/redo 基本通过。
- M3 Settings + Secrets：配置与密钥存储边界基本通过，未发现 DeepSeek key 明文进入 git tracked files。
- M4 Agent Protocol + Mock Agent：AgentResponse 版本强制、mock flow、candidate 入库基本通过。
- 构建测试：前端测试、TypeScript、lint、Vite、Tauri build、Rust cargo test 基本通过。

## 2. 验收线结果汇总

| 检查线 | 结果 | 主要结论 |
|---|---|---|
| A 规划-实现覆盖矩阵 | FAIL | M1-M4 覆盖充分；M5 库层完成但产品端到端缺口；旧规划冲突片段仍可能误导；验收计划此前未跟踪。 |
| B 自动化测试与构建 | PASS with note | 前端/Rust/Tauri build 通过；`~` 路径 py_compile 在子代理 HOME 环境下失败，但绝对路径验证通过；xvfb smoke 20s 未崩溃。 |
| C 蓝图数据安全与 UX | PASS | sidecar path、Save/Save As rebind、损坏 sidecar guard、未保存主文档 guard、dirty snapshot hash、invalid apply、undo/redo 均通过。 |
| D Canvas 只读预览与 UI 交互 | FAIL | Canvas 只读隔离通过；右侧 tab 切换卸载面板导致 Agent/Blueprints/Inspector 局部状态丢失。 |
| E Settings/Secrets 安全 | PASS | key 不进 tracked files；普通 settings 只保存 apiKeyRef；SecretStore 权限/异常路径通过。 |
| F Agent 协议与 Provider | FAIL | 协议/adapters/runtime 单元层通过；真实 Provider 未接入 AgentPanel，Settings/SecretStore/runtime 没有端到端打通。 |
| G semantic v4 合规 | PASS | 主文档无 blueprints，sidecar 独立；invalid 可应用到内存但保存仍走门禁；mock/provider candidate schemaVersion 4.0.0。 |
| H 安全/回归/维护性总审 | FAIL | 发现 editorStore 异步 save 丢更新/清 dirty 风险；sidecar 保存非原子写；build 脚本 `python3` Windows 跨平台性瑕疵。 |

## 3. 子代理验收摘要

### A. 规划-实现覆盖矩阵

**结果：FAIL。**

已确认 M1-T1 到 M5-T4 都能找到实现、测试、状态/交接证据，但发现 Important 缺口：

1. M5 “Real Providers”主要是 adapter/runtime 纯库与单元测试证据，未发现接入 AgentPanel / settings / SecretStore 的端到端真实 Provider 调用路径。
2. 旧规划文档仍保留 `applied` 状态、`invalid` 不可应用、`CanvasView readOnly/documentOverride` 等旧设计片段，虽有优先级说明但仍可能误导维护。
3. 最高优先验收计划 `docs/plans/2026-04-30-full-acceptance-plan.md` 此前显示为未跟踪文件。

### B. 自动化测试与构建

**结果：PASS with note。**

命令结果：

| 命令 | exit code | 结论 |
|---|---:|---|
| `cd easyanalyse-desktop && npm test -- --run` | 0 | 通过 |
| `cd easyanalyse-desktop && npx tsc -b --pretty false` | 0 | 通过 |
| `cd easyanalyse-desktop && npm run lint` | 0 | 通过 |
| `cd easyanalyse-desktop && npx vite build` | 0 | 通过 |
| `cd easyanalyse-desktop && npm run tauri:build` | 0 | 通过 |
| `cd easyanalyse-desktop/src-tauri && cargo test` | 0 | 通过 |
| `python3 automation/autonomous_lock_test.py` | 0 | 通过 |
| `python3 -m py_compile automation/autonomous_lock.py ~/.hermes/scripts/... ~/.hermes/profiles/...` | 1 | 子代理 HOME 导致 `~` 展开错误；绝对路径补跑通过 |
| `timeout 20s xvfb-run -a easyanalyse-desktop/src-tauri/target/release/easyanalyse-desktop` | 124 | 20s 未崩溃，被 timeout 杀掉；仅 EGL/DRI3 warning |

补充：`npm run tauri:build` 重新生成了图标资源，主控已还原这些构建副作用，避免污染验收提交。

### C. 蓝图数据安全与 UX

**结果：PASS。**

通过项：

- sidecar 路径派生与后缀 guard。
- Save / Save As 后重新绑定新 sidecar 路径。
- 普通 Save 后更新 workspace mainDocument metadata。
- 损坏 sidecar 加载失败后禁止保存覆盖。
- 未保存主文档 workspace 保存 guard。
- dirty 主文档 snapshot 使用当前内存 document hash。
- valid / invalid / unknown 蓝图都能强确认应用。
- apply 后 `dirty=true`，支持 undo/redo。
- `appliedInfo` 只表示历史应用，`isCurrentMainDocument` 由 hash 运行时计算。

### D. Canvas 只读预览与 UI 交互

**结果：FAIL。**

通过项：

- `CircuitCanvasRenderer` 不直接依赖 `editorStore` mutation。
- `BlueprintPreviewCanvas` 不调用 editorStore mutation。
- Delete / Space / Ctrl+S / Ctrl+Z / 拖拽 / 点击选择隔离通过。

失败项：

- `RightSidebar.tsx` 用条件渲染切换面板：

```tsx
{activeTab === 'inspector' ? <Inspector /> : null}
{activeTab === 'blueprints' ? <BlueprintsPanel /> : null}
{activeTab === 'agent' ? <AgentPanel /> : null}
```

这会卸载非当前面板，导致：

- Agent prompt 输入内容丢失。
- Agent run result / running state 可能丢失。
- Blueprints Apply dialog、actionError、busy 状态、validation local state 丢失。
- Inspector 局部 autocomplete/open state 丢失。

严重度：Important（明显 UX 问题，不是数据破坏）。

### E. Settings/Secrets 安全

**结果：PASS。**

通过项：

- git tracked files 中未发现 DeepSeek key 明文。
- `/home/ubuntu/.config/EasyAnalyse/secrets/deepseek_api_key` 存在、权限 `600`，在仓库外。
- 普通 app settings 只保存 `apiKeyRef`。
- Provider id 编辑时只读。
- 替换 API key 时旧 key 删除失败不会删除新 key。
- metadata save rejected 后清空明文 key input。
- SecretStore Rust fallback 目录/文件权限符合预期。
- 未发现 key 被 console/log/Telegram 发送。

### F. Agent 协议与 Provider

**结果：FAIL。**

通过项：

- `AgentResponse.schemaVersion = agent-response-v1` 强制。
- `AgentResponse.semanticVersion = easyanalyse-semantic-v4` 强制。
- 未知 kind/schema/semantic 会 reject。
- invalid candidate 会保留但带 issue。
- OpenAI-compatible / DeepSeek / Anthropic adapter 单元测试通过。
- timeout/cancel/retry/context budget runtime 单元测试通过。

失败项：

1. `AgentPanel` 仍只 import/call `runMockAgentProvider`。
2. UI 文案仍显示 `Local mock flow only.`。
3. Settings selected provider/model 与 SecretStore `apiKeyRef` 未被 AgentPanel 读取。
4. `defaultSecretStore.readSecret` 没有进入 Agent runtime 调用链。
5. `runProviderWithControls` 主要只在 lib/test 中使用，没有产品路径接入。
6. AgentPanel 的 cancel 只递增 local ref，不向真实 provider 传 `AbortSignal`。
7. 真实 Provider 接入后，当前文档首次上传缺少用户同意/显式控制入口。
8. Adapters 要求 injected fetch，但应用层没有统一 network execution bridge。

严重度：High / 阻塞 M5 真实 Provider 宣称完成。

### G. semantic v4 合规

**结果：PASS。**

通过项：

- `DocumentFile` 顶层无 `blueprints`。
- schema 顶层 `additionalProperties: false`。
- sidecar wrapper 独立，不作为 semantic 主文档保存。
- 蓝图应用只改内存，保存仍走 Tauri/Rust schema+semantic 门禁。
- mock/provider candidate 输出 `schemaVersion: "4.0.0"`。
- README / exchange.md / examples 均强调 label 连通性、view 非真值、禁止 wires/junction/bend points。

### H. 安全/回归/维护性总审

**结果：FAIL。**

Important：

1. `editorStore.saveDocument` / `saveDocumentAs` 异步保存存在 stale result 覆盖与错误清 dirty 风险。
   - 保存发起后如果用户继续编辑，保存返回时会无条件 `document: savedDocument`、`dirty: false`。
   - `blueprintStore.saveWorkspace` 已有 stale guard，`editorStore` 保存路径没有等价保护。

2. sidecar 保存非原子写。
   - `save_blueprint_workspace_to_path()` 直接 `fs::write(&path, content)`。
   - 崩溃/断电可能产生损坏 sidecar。
   - 低于主文档丢更新风险，但建议修。

Minor：

1. `package.json` 的 `generate:icons` 使用 `python3`，Windows clean build 可能找不到。
2. live cron 当前暂停且无锁；owner-safe lock 测试通过。这个不是问题。

## 4. 阻塞项清单

### Critical

本次未发现已经确认的数据破坏、密钥泄漏、主文档 schema 污染或构建全线失败型 Critical。

### High / Important，建议作为修复队列

1. **真实 Provider 产品端到端接入缺失。**
   - 修复目标：AgentPanel 根据 settings 选择 mock / OpenAI-compatible / DeepSeek / Anthropic；读取 SecretStore key；通过 `runProviderWithControls` 执行；支持 AbortSignal、timeout、retry、context budget；返回 AgentResponse 后入库蓝图。
   - 同时添加首次上传当前文档的明确同意/控制。

2. **RightSidebar tab 切换卸载导致状态丢失。**
   - 修复目标：面板保持挂载、仅隐藏；或将 AgentPanel / BlueprintsPanel 关键状态提升到 store。
   - 最小修复：RightSidebar 同时渲染三个 panel，用 `hidden` / `aria-hidden` / CSS 控制显示，保留状态；注意避免隐藏 panel 抢 focus。

3. **editorStore save/saveAs stale-result 覆盖与 dirty 清理风险。**
   - 修复目标：引入 document revision / save token / hash 快照；保存返回时若当前文档已经变化，不覆盖 document、不清 dirty。
   - 需要增加并发 save 回归测试。

4. **旧规划冲突清理。**
   - 修复目标：将旧状态表和 invalid 不可应用表述标为 deprecated 或移除；避免后续维护误读。

5. **验收计划/报告纳入 git。**
   - 本报告与验收计划应提交到 `agent` 分支，保证可追溯。

### Optional / Minor

1. sidecar 保存改成 temp file + fsync + rename，提高持久化可靠性。
2. build script Python launcher 跨平台化。
3. AgentResponse forbidden legacy fields 如确有历史单数字段，应补充 `wire` / `node` 单数扫描。
4. M5 做低成本 DeepSeek smoke test，但必须避免打印/提交 key，且需明确付费调用策略。

## 5. 建议下一步计划

建议新增 M6，不要直接发布：

### M6-T1：真实 Provider 端到端接入

- AgentPanel 支持 provider mode：mock / configured provider。
- 从 settingsStore 读取 selected provider/model。
- 从 SecretStore 读取 API key。
- 使用 adapter + `runProviderWithControls`。
- 支持 cancel/timeout/retry/context budget。
- 首次发送当前文档前要求用户明确同意或设置项确认。
- 测试：mock fetch、不真实扣费；DeepSeek 可选手动 smoke。

### M6-T2：右侧面板状态保持

- 修复 tab 切换卸载状态问题。
- 加测试：Agent prompt 输入后切 tab 再回来仍保留；Apply dialog 切 tab 不丢或有明确关闭行为。

### M6-T3：editorStore 保存并发安全

- 增加 `documentRevision` 或 `saveToken`。
- 保存返回时检测当前文档是否与发起保存时一致。
- 增加并发 save + edit 回归测试。

### M6-T4：文档冲突清理与发布前手测

- 清理旧规划冲突片段。
- 完成一次真实 GUI 手测/DeepSeek smoke 记录。

## 6. 当前仓库/自动化状态

- 分支：`agent`
- 自动化 cron：暂停状态，适合验收/修复期。
- 运行锁：验收开始前为 absent。
- 构建副作用：`npm run tauri:build` 修改的图标资源已由主控还原。
- 本报告和验收计划为文档输出，建议提交到 `agent`。
