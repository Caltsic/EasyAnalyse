# EasyAnalyse M7 Agent 工具调用、自检与示例库验收报告

> 日期：2026-05-06  
> 分支：agent  
> 上位规划：`docs/plans/2026-05-06-agent-tool-self-check-implementation-plan.md`

## 结论

M7 已按规划完成并通过验收：内置 Agent 现在具备本地工具调用、自检报告、布局体积重合检查、DeepSeek/OpenAI-compatible tool calling loop、后置自检与修正重试兜底、AgentPanel 工具 trace 展示、蓝图候选自检 metadata 入库，以及首期参考示例库。

## 完成范围

### M7-T1：布局体积/重合检查

新增：

- `easyanalyse-desktop/src/lib/layoutValidation.ts`
- `easyanalyse-desktop/src/lib/layoutValidation.test.ts`

实现 `checkLayoutOverlaps(document, options)`：

- 基于 `deriveCircuitInsights(document).devices[*].bounds`。
- 只做 device-device AABB 检查。
- 支持 `padding`、`includeTouching`、`maxPairs`。
- 稳定排序。
- 不修改输入 document。
- issue 为 warning，只提示，不阻止保存/应用。

### M7-T2/T3：Agent 工具协议和本地工具

新增：

- `easyanalyse-desktop/src/types/agentTools.ts`
- `easyanalyse-desktop/src/lib/agentTools.ts`
- `easyanalyse-desktop/src/lib/agentTools.test.ts`

实现：

- `agent-tool-result-v1`
- `agent-self-check-v1`
- `validate_document`
- `check_layout_overlaps`
- `check_blueprint_candidate`

工具均为只读，不直接保存文件，不直接修改主文档。

### M7-T4：DeepSeek / OpenAI-compatible tool calling loop

修改：

- `easyanalyse-desktop/src/lib/openAiCompatibleProvider.ts`
- `easyanalyse-desktop/src/lib/openAiCompatibleProvider.test.ts`

实现：

- OpenAI-compatible `tools` / `tool_choice=auto`。
- 本地执行 `check_blueprint_candidate`。
- 将 tool result append 为 `role=tool`。
- 最终仍必须解析为 `AgentResponse v1`。
- 对 DeepSeek 偶发“前置说明 + trailing JSON”做受限容错：只接受位于响应尾部的最后一个完整 AgentResponse JSON；JSON 后有额外文字则拒绝。
- 支持 `maxToolIterations` 配置。

### M7-T5：后置自检 + 修正重试

修改：

- `easyanalyse-desktop/src/lib/agentProviderClient.ts`
- `easyanalyse-desktop/src/lib/agentProviderClient.test.ts`

实现：

- Provider 返回 `blueprints` 后自动执行本地 self-check。
- 将 `selfCheck` 和 `toolIssues` 合并到候选。
- 发现问题时可用 self-check report 构造 repair prompt，要求模型返回完整修正后的 AgentResponse。
- 默认启用一次修正兜底。

### M7-T6：AgentPanel 工具 trace UI

修改：

- `easyanalyse-desktop/src/components/agent/AgentPanel.tsx`
- `easyanalyse-desktop/src/components/agent/AgentPanel.test.tsx`

实现：

- AgentPanel 展示“工具检查”。
- AgentPanel 展示“自动修复”。
- cancel / stale guard 保持有效。

### M7-T7：蓝图候选 metadata 入库

修改：

- `easyanalyse-desktop/src/types/agent.ts`
- `easyanalyse-desktop/src/types/blueprint.ts`
- `easyanalyse-desktop/src/store/blueprintStore.ts`

实现：

- `extensions.agentCandidate.selfCheck`
- `extensions.agentCandidate.toolIssues`

保持产品决策：invalid / warning 仍可入库、预览、强确认应用。

### 示例库一期

新增：

- `easyanalyse-desktop/src/lib/agentExampleLibrary.ts`
- `easyanalyse-desktop/src/lib/agentExampleLibrary.test.ts`
- `docs/examples/SOURCES.md`

示例：

1. RC low-pass filter
2. Inverting op-amp amplifier
3. MCU RS-485 interface node

示例按关键词检索注入，默认最多 2 个；无相关关键词时不注入，避免上下文膨胀和照抄。

## Review 结果

已分派子代理进行规格审查和质量审查。

- 规格审查：PASS。
- 质量审查：发现两个 Important：
  1. 嵌入 JSON 解析过宽。
  2. 示例默认注入过大。
- 已打回修复并复核：PASS。

修复内容：

- `parseTrailingAgentResponse` 只接受尾部完整 AgentResponse JSON，拒绝 JSON 后继续输出文本。
- `selectAgentReferenceExamples` 过滤 `score <= 0`，默认 `limit=2`。
- 增加对应测试。

## 真实 DeepSeek 验收

已运行：

```bash
EASYANALYSE_RUN_DEEPSEEK_TOOL_SMOKE=1 npm test -- --run src/lib/deepseekToolSmoke.test.ts
```

结果：通过。

该测试走产品路径：

```text
runConfiguredAgentProvider
  -> runProviderWithControls
  -> runOpenAiCompatibleProvider
  -> DeepSeek native tool calling
  -> 本地 check_blueprint_candidate
  -> AgentResponse v1 parse
  -> post-provider self-check / repair 兜底
```

并验证：

- DeepSeek 至少一次调用 `check_blueprint_candidate`。
- 最终返回 `kind=blueprints`。
- 至少包含一个 blueprint candidate。

## 验证命令

已通过：

```bash
cd easyanalyse-desktop
npm test -- --run
npx tsc -b --pretty false
npm run lint
npx vite build
EASYANALYSE_RUN_DEEPSEEK_TOOL_SMOKE=1 npm test -- --run src/lib/deepseekToolSmoke.test.ts

cd src-tauri
cargo test

cd ../..
python3 automation/autonomous_lock_test.py
git diff --check
```

结果摘要：

- Vitest：31 files passed, 2 skipped；225 passed, 2 skipped。
- DeepSeek tool smoke：1 passed。
- TypeScript：passed。
- ESLint：passed。
- Vite build：passed。
- Cargo test：14 passed。
- autonomous lock test：passed。
- `git diff --check`：passed。
- DeepSeek API key 未进入 git tracked files。

## 剩余建议

M7 已达到当前规划要求。后续如继续增强，可以新增 M8：

- Anthropic tool-use 协议适配。
- 更多高复杂度示例库和更细粒度检索。
- 工具 trace 更细 UI：展开每个 issue、显示布局重合位置。
- layout overlap 支持旋转/非矩形的更精细几何检查。
