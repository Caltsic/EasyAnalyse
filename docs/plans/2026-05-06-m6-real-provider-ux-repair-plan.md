# EasyAnalyse M6 真实 Provider 与发布前阻塞修复计划

> 日期：2026-05-06
> 分支：agent
> 优先级：高于 M1-M5 旧规划与 2026-04-30 验收报告中的“待修复项”。

## 0. 用户问题的直接结论

### 0.1 是否已经用 DeepSeek API 实测生成/修改电路图？

截至本计划创建前：**没有真实 DeepSeek API 端到端实测证据**。

已有内容是：

- DeepSeek preset 已存在。
- OpenAI-compatible adapter 已支持 `kind = deepseek`。
- provider runtime 的 timeout / cancel / retry / context budget 已存在。
- 但 `AgentPanel` 仍只调用 `runMockAgentProvider`，UI 文案仍是 `Local mock flow only`。

因此之前的 M5 “真实 Provider”只能算库层完成，不能算产品端到端完成。

### 0.2 “真实 Provider 接入 AgentPanel”是什么意思？

意思是桌面版 Agent 面板不再只走 mock，而是能完整走：

```text
用户 Prompt
  + 可选当前 semantic v4 文档上下文
  + Settings 中选中的 Provider / Model
  + SecretStore 中读取的 API key
  -> OpenAI-compatible / DeepSeek / Anthropic adapter
  -> runProviderWithControls(timeout/cancel/retry/context budget)
  -> parse AgentResponse
  -> 写入蓝图 sidecar workspace
  -> 用户预览 / diff / apply 蓝图
```

注意：即便真实模型生成“修改电路图”，也不是直接改主文档，而是生成蓝图候选；用户确认应用后才替换主文档。

## 1. M6 范围

### M6-T1：真实 Provider 端到端接入 AgentPanel

目标：AgentPanel 支持 mock 与已配置真实 provider 两种模式，优先 DeepSeek。

必须实现：

- 新增产品层 provider client，连接 settings/secret/runtime/adapters。
- AgentPanel 读取 selected provider/model。
- 读取 SecretStore API key。
- DeepSeek/openai-compatible 走 OpenAI-compatible adapter。
- Anthropic 走 Anthropic Messages adapter。
- 支持 AbortController cancel。
- 支持当前文档上传显式勾选。
- 返回 blueprints 时仍只入库蓝图，不直接改主文档。
- 缺 provider / model / apiKeyRef / secret 时给可读错误，不发真实请求。

测试：

- mock provider 旧路径仍可用。
- configured DeepSeek 路径读取 SecretStore 并调用 injected client。
- 缺 key 不调用 client。
- cancel aborts signal 且不入库。
- document changed stale guard 仍有效。

### M6-T2：RightSidebar tab 状态保持

目标：切换 Inspector / Blueprints / Agent 不再卸载面板。

实现：

- 三个 panel 常驻渲染。
- 用 `hidden` / `aria-hidden` 控制显示。
- hidden panel 不抢 focus / 不占布局。

测试：

- 三个 panel 始终存在。
- hidden 状态正确。
- Agent 局部输入状态切 tab 后保留。

### M6-T3：editorStore 保存并发安全

目标：保存期间用户继续编辑时，旧保存结果不得覆盖新编辑，也不得错误清 dirty。

实现：

- 引入 `documentContentVersion` 或等价 revision。
- 所有主文档内容变更递增 revision。
- save/saveAs 发起时记录 revision。
- validate/save 返回时若 revision 已变：不覆盖 document、不清 dirty、不设置 stale filePath、不 rebind blueprint workspace。

测试：

- saveDocument pending 时继续编辑，旧结果返回后当前编辑保留、dirty=true。
- saveDocumentAs pending 时继续编辑，旧结果返回后不设置 stale path、不清 dirty。
- 正常 save/saveAs 仍清 dirty 并 rebind sidecar。

### M6-T4：DeepSeek 真实 smoke test 与文档收口

目标：用项目专用 DeepSeek key 做低成本真实 API smoke。

测试方式：

- 从 `/home/ubuntu/.config/EasyAnalyse/secrets/deepseek_api_key` 读取 key。
- 不打印 key。
- 通过 adapter/client 直接请求 DeepSeek，要求返回 `agent-response-v1` / `easyanalyse-semantic-v4`。
- 至少覆盖：
  1. 根据需求生成一个简单蓝图。
  2. 根据已有文档生成一个修改蓝图。
- 验证返回能被 parser 接收，且可入库为蓝图候选；不要求自动应用主文档。

## 2. 非目标

- 不修改 `exchange.md` semantic v4 语义。
- 不让 Agent 直接改主文档。
- 不把 API key 写入 git、主文档、sidecar、普通 settings 或日志。
- 不默认强制上传当前文档；必须由用户勾选或测试显式传入。

## 3. 执行与验收

每个代码任务必须：

1. 先写/更新回归测试。
2. 实现最小修复。
3. 跑 targeted tests。
4. 派子代理做 spec review 与 quality review。
5. 跑完整验证：
   - `npm test -- --run`
   - `npx tsc -b --pretty false`
   - `npm run lint`
   - `npx vite build`
   - 必要时 `cargo test`
6. 提交并推送 `agent` 分支。

## 4. 当前执行状态

- M6-T1：已完成。AgentPanel 已接入 Settings/SecretStore/runtime/adapters 的真实 Provider 产品路径；无 provider 时保留 mock fallback。
- M6-T2：已完成。RightSidebar 三个面板常驻挂载，用 `hidden` / `aria-hidden` 切换，Agent 输入切 tab 后保留。
- M6-T3：已完成。`documentContentVersion` 防保存期间编辑被 stale save 覆盖；额外加入 `saveOperationToken` 防重叠 save/saveAs 较旧结果覆盖较新结果。
- M6-T4：已完成。DeepSeek 真实 API smoke 通过，覆盖生成蓝图与基于当前文档修改蓝图，且走产品 provider client。

详见补充验收报告：`docs/plans/2026-05-06-m6-acceptance-addendum.md`。
