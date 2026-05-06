# EasyAnalyse M6 收尾验收补充报告

> 日期：2026-05-06
> 分支：`agent`
> 范围：M6 真实 Provider 接入 AgentPanel、RightSidebar 状态保持、editorStore 保存竞态修复、DeepSeek 真实 smoke、后续 Agent 工具增强可行性评估。

## 1. 结论

M6 的发布前阻塞项已经收口：

- `AgentPanel` 已接入真实 Provider 产品路径，不再只是 mock-only。
- DeepSeek 真实 API 已通过产品 provider client smoke：生成蓝图 + 基于当前文档生成修改蓝图。
- 真实 Provider 仍只创建蓝图候选，不直接改主文档。
- RightSidebar tab 切换已改为常驻隐藏，避免面板局部状态丢失。
- `editorStore.saveDocument` / `saveDocumentAs` 已修复“保存期间编辑”以及“重叠 Save As 较旧结果覆盖较新路径”的竞态。
- API key 没有写入仓库；DeepSeek smoke 从仓库外 secret 文件读取。

因此，2026-04-30 验收报告中的以下阻塞项已被 M6 修复：

| 原问题 | M6 状态 |
|---|---|
| M5 真实 Provider 未接入 AgentPanel | 已修复 |
| RightSidebar tab 切换卸载导致状态丢失 | 已修复 |
| save/saveAs 异步结果可能覆盖新编辑/错误清 dirty | 已修复，并额外覆盖重叠 Save As |
| 缺少 DeepSeek 真实生成/修改 smoke | 已补充 |

仍建议另起 M7 做“Agent 工具自检、布局重合检查、示例库增强”，详见：

- `docs/plans/2026-05-06-agent-tools-examples-feasibility-plan.md`

## 2. 已验证的真实 Provider 链路

DeepSeek smoke 测试文件：

```text
easyanalyse-desktop/src/lib/deepseekProviderSmoke.test.ts
```

默认跳过，只有设置环境变量时才真实请求 DeepSeek：

```bash
EASYANALYSE_RUN_DEEPSEEK_SMOKE=1 npm test -- --run src/lib/deepseekProviderSmoke.test.ts
```

已通过结果：

```text
1 test passed
DeepSeek real provider smoke:
- generate: 返回 kind=blueprints，至少一个 candidate，devices > 0
- modify: 带 currentDocument context 返回 kind=blueprints，candidate.devices.length > baseDocument.devices.length
- addAgentBlueprintCandidates 能将 generate + modify candidates 入库
```

该测试走的是产品代码路径：

```text
runConfiguredAgentProvider
  -> runProviderWithControls
  -> runOpenAiCompatibleProvider
  -> parseAgentResponse
  -> addAgentBlueprintCandidates
```

不是绕过产品代码的临时脚本。

## 3. 为 DeepSeek smoke 做的约束增强

首次真实 DeepSeek smoke 暴露出模型容易把 `blueprints` 返回成非数组。M6 收尾已对系统 prompt 和 smoke prompt 增强：

- 明确 `blueprints` 必须是数组，即使只返回一个候选。
- 禁止使用 singular `blueprint`。
- 明确候选必须包含：`title`、`summary`、`rationale`、`tradeoffs`、`document`、`issues`。
- 增加最小有效 AgentResponse skeleton。
- 继续强调 semantic v4：连接仅由 terminal `label` 表达，禁止 wires/nodes/junctions/bend points/signalId。

这解决了 smoke 级别的不合规问题，但也说明后续需要更强的工具化自检与 few-shot 示例支持。

## 4. 验证命令

已通过完整验证：

```bash
cd easyanalyse-desktop
EASYANALYSE_RUN_DEEPSEEK_SMOKE=1 npm test -- --run src/lib/deepseekProviderSmoke.test.ts
npm test -- --run
npx tsc -b --pretty false
npm run lint
npx vite build
cd src-tauri && cargo test
cd ../..
git diff --check
python3 automation/autonomous_lock_test.py
```

结果摘要：

```text
DeepSeek smoke: 1 passed
Vitest full: 27 files passed, 1 smoke file skipped by default, 207 tests passed
TypeScript: passed
ESLint: passed
Vite build: passed
Cargo test: 14 passed
Autonomous lock test: passed
git diff --check: passed
```

## 5. 子代理复核

已分派只读子代理审查：

- 真实 Provider 接入 AgentPanel：PASS。
- API key 泄露：未发现。
- Agent 不直接改主文档：PASS。
- RightSidebar 状态保持：PASS。
- DeepSeek smoke 走产品 provider client：PASS。
- 保存竞态：原“保存期间编辑”已修复；复核额外提出“两个 Save/SaveAs 同版本重叠返回”的非阻塞提示，主控已进一步补充 `saveOperationToken` 和重叠 Save As 回归测试。

## 6. 仍需后续阶段关注

1. `testJson` 中多个示例含 UTF-8 BOM，导致 Rust `bundled_examples_validate` 直接 `serde_json::from_str` 解析失败。建议 M7/Maintenance 修复编码或 loader。
2. sidecar 保存目前仍是直接写文件，后续可改 temp + fsync + rename 提升可靠性。
3. Agent 当前仍是单轮生成；DeepSeek 第一次不合规说明仅靠 prompt 不够，建议 M7 引入工具自检 loop / 自动检查修正。
4. 示例库需要更系统的高质量 few-shot，不宜直接复制复杂原理图，应手工转换/抽象并记录来源许可。
