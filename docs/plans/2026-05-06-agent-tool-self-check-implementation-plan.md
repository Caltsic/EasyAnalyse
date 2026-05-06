# EasyAnalyse M7 Agent 工具调用、自检格式与布局体积检查实施规划

> 日期：2026-05-06  
> 分支：agent  
> 状态：实施前文件级规划  
> 上位文档：`docs/plans/2026-05-06-agent-tools-examples-feasibility-plan.md`  
> 关键产品判断：作为内置 Agent，AI 模型应被配置可调用本地工具；模型应能通过工具理解并自检 EasyAnalyse semantic v4 文档，而不是只靠 prompt 猜格式。

## 0. 本规划的约束优先级

后续实现 M7 时必须优先遵守本文。若本文与早期 feasibility 文档冲突，以本文为准。

硬约束：

1. Agent 工具只能读/检查/返回报告，不能直接保存文件，不能直接改主文档。
2. 模型仍只能创建/修改蓝图候选，不能绕过蓝图预览、diff、确认、undo 流程。
3. semantic v4 连接事实只由 `device.terminals[*].label` 表达。
4. 禁止把 `wire` / `wires` / `node` / `nodes` / `junction` / `bendPoint` / `signalId` 当作电气连接模型。
5. `view.networkLines` 只能作为可读性展示，不能作为连接事实。
6. 自检发现 error/warning 只提示，不阻止蓝图入库、预览或强确认应用。
7. 真实 provider 阶段必须优先支持 DeepSeek / OpenAI-compatible tool calling；Anthropic tool use 可后置。
8. API key 不得进入 prompt trace、tool result、git、主文档、sidecar、普通 settings 或 Telegram。

## 1. 目标

M7 要把 Agent 从“只输出 JSON 的聊天模型”升级为“可使用 EasyAnalyse 本地检查工具的工程 Agent”。

目标能力：

```text
用户需求
  -> Agent 构造/修改 semantic v4 蓝图候选
  -> 模型可调用 check_blueprint_candidate 工具自检格式、语义、布局重合
  -> 本地工具返回机器可读 self-check report
  -> 模型根据报告修正候选
  -> 最终返回 AgentResponse v1
  -> 产品再次执行同一检查作为兜底
  -> 蓝图入库，用户预览/diff/应用
```

## 2. 文件级任务拆分

### M7-T1：布局体积/重合检查纯函数

新增：

```text
easyanalyse-desktop/src/lib/layoutValidation.ts
easyanalyse-desktop/src/lib/layoutValidation.test.ts
```

复用：

```text
easyanalyse-desktop/src/lib/circuitDescription.ts::deriveCircuitInsights(document)
```

禁止：

- 不另写一套 device default size。
- 不把 networkLines 当连接事实。
- 不修改输入 document。

建议接口：

```ts
export interface LayoutOverlapCheckOptions {
  padding?: number
  includeTouching?: boolean
  maxPairs?: number
}

export interface LayoutOverlapIssue {
  severity: 'warning'
  code: 'layout.device.overlap'
  message: string
  entityId: string
  path: string
  details: {
    leftDeviceId: string
    rightDeviceId: string
    leftBounds: { x: number; y: number; width: number; height: number }
    rightBounds: { x: number; y: number; width: number; height: number }
    overlapWidth: number
    overlapHeight: number
    overlapArea: number
    padding: number
  }
}

export interface LayoutOverlapReport {
  ok: boolean
  issueCount: number
  checkedDeviceCount: number
  checkedPairCount: number
  truncated: boolean
  issues: LayoutOverlapIssue[]
}

export function checkLayoutOverlaps(
  document: DocumentFile,
  options?: LayoutOverlapCheckOptions,
): LayoutOverlapReport
```

MVP 规则：

1. 只做 device-device AABB 检查。
2. 默认 `padding = 0`。
3. 边界刚接触默认不算重合。
4. `includeTouching=true` 时边界接触也作为 warning。
5. `padding > 0` 时先将 bounds 向外扩张再检查。
6. issue 稳定排序：按 `leftDeviceId/rightDeviceId` 字典序。
7. `maxPairs` 只限制返回 issue 数，不影响 `checkedPairCount`。
8. 所有重合问题都是 warning，不阻止应用。

测试清单：

- 两器件不重合。
- 完全重合。
- 部分重合。
- 边界接触默认不报。
- `includeTouching=true` 报。
- `padding` 让近距离器件变成重合。
- 缺少 `view.devices[id].size` 时与画布默认尺寸一致。
- 多器件结果稳定排序。
- `maxPairs` 截断。
- 输入 document deep-equal 不变。

### M7-T2：Agent 工具类型、统一结果、自检报告格式

新增：

```text
easyanalyse-desktop/src/types/agentTools.ts
easyanalyse-desktop/src/lib/agentTools.ts
easyanalyse-desktop/src/lib/agentTools.test.ts
```

#### 2.1 工具名

```ts
export type AgentToolName =
  | 'validate_document'
  | 'check_layout_overlaps'
  | 'check_blueprint_candidate'
```

#### 2.2 工具统一结果格式

所有工具返回稳定 JSON，便于模型阅读、UI 展示、日志脱敏和测试。

```ts
export interface AgentToolResult<TData = unknown> {
  schemaVersion: 'agent-tool-result-v1'
  semanticVersion: 'easyanalyse-semantic-v4'
  ok: boolean
  toolName: AgentToolName
  summary: string
  issueCount: number
  issues: ValidationIssue[]
  data?: TData
}
```

要求：

- `summary` 必须短小、无密钥、无完整 prompt。
- `issues` 使用当前 ValidationIssue 风格，至少包含 severity/code/message/path/entityId。
- 工具异常也返回 `ok=false` 的 tool result；除 abort/timeout 外不要直接让 provider loop 崩溃。

#### 2.3 自检报告格式

新增格式：

```ts
export interface AgentSelfCheckReport {
  schemaVersion: 'agent-self-check-v1'
  semanticVersion: 'easyanalyse-semantic-v4'
  ok: boolean
  summary: string
  candidates: AgentSelfCheckCandidateReport[]
}

export interface AgentSelfCheckCandidateReport {
  index: number
  title?: string
  ok: boolean
  issueCount: number
  validation: {
    ok: boolean
    schemaValid: boolean
    semanticValid: boolean
    issueCount: number
    issues: ValidationIssue[]
  }
  layout: {
    ok: boolean
    issueCount: number
    checkedDeviceCount: number
    checkedPairCount: number
    issues: ValidationIssue[]
  }
}
```

用途：

1. `check_blueprint_candidate` 的 `data.selfCheck`。
2. provider 自动修正 prompt 的输入。
3. AgentPanel tool trace 展示。
4. 蓝图 candidate extensions 中记录自检结果。

### M7-T3：实现三个本地 Agent 工具

在 `src/lib/agentTools.ts` 中注册：

#### `validate_document`

输入：

```ts
{ document: DocumentFile }
```

实现：

```text
context.validateDocument(document)
  默认调用 validateDocumentCommand(document)
```

输出：

```text
AgentToolResult<{ validation: ValidationReport; normalizedDocument?: DocumentFile | null }>
```

`ok = validation.schemaValid && validation.semanticValid`。

#### `check_layout_overlaps`

输入：

```ts
{ document: DocumentFile, options?: LayoutOverlapCheckOptions }
```

实现：

```text
checkLayoutOverlaps(document, options)
```

输出：

```text
AgentToolResult<{ layout: LayoutOverlapReport }>
```

#### `check_blueprint_candidate`

这是默认暴露给模型的首选工具。

输入：

```ts
{
  candidate: AgentBlueprintCandidate | { document: DocumentFile },
  options?: LayoutOverlapCheckOptions
}
```

实现：

```text
extract document
  -> validate_document(document)
  -> check_layout_overlaps(normalizedDocument ?? document)
  -> assemble AgentSelfCheckReport
```

输出：

```text
AgentToolResult<{ selfCheck: AgentSelfCheckReport }>
```

`ok` 规则：

- validation ok 且 layout ok，则 true。
- validation error 或 layout overlap warning，均 false/可提示。
- 注意：`ok=false` 不代表候选不能入库/应用，只代表需要模型或用户注意。

测试清单：

- validate 工具调用注入的 validateDocument mock。
- malformed args 返回 tool result，不抛未处理异常。
- unknown tool 返回 `ok=false`。
- check_blueprint_candidate 组合 validation + layout。
- 工具不 mutation 输入 candidate/document。
- tool result 不含 `sk-` / `apiKey` / `Authorization`。

### M7-T4：DeepSeek / OpenAI-compatible tool calling loop

修改：

```text
easyanalyse-desktop/src/lib/openAiCompatibleProvider.ts
easyanalyse-desktop/src/lib/openAiCompatibleProvider.test.ts
easyanalyse-desktop/src/lib/agentProviderClient.ts
```

#### 4.1 OpenAI-compatible payload

开启 tool calling 时 payload 包含：

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "check_blueprint_candidate",
        "description": "Validate an EasyAnalyse semantic v4 blueprint candidate and check device bounds overlaps. Connectivity must be expressed by terminal.label only; wires/nodes/junctions/signalId are forbidden.",
        "parameters": { "type": "object", "additionalProperties": false, "required": ["candidate"], "properties": { "candidate": { "type": "object" }, "options": { "type": "object" } } }
      }
    }
  ],
  "tool_choice": "auto"
}
```

#### 4.2 loop

```text
messages = system + user
for step <= maxToolIterations:
  call provider with tools
  if assistant.tool_calls:
    append assistant tool_calls message
    for each tool_call:
      parse JSON args
      run local tool
      append role='tool' result JSON
    continue
  if assistant.content:
    parseAgentResponse(content)
    return response + toolTrace
throw AGENT_PROVIDER_PROTOCOL_ERROR
```

规则：

- `maxToolIterations` 默认 3。
- 未知工具/参数 JSON 错误作为 tool result 返回模型，不直接中断。
- abort/timeout 必须中断。
- tool result 不能包含 API key。
- 最终 content 必须仍为 `AgentResponse v1`，不能接受工具结果替代最终回答。
- 工具调用期间可关闭 `response_format`；最终轮 prompt 必须要求 JSON AgentResponse。DeepSeek 对 `tools + response_format` 的兼容性必须真实 smoke。

### M7-T5：产品自动后置自检 + 修正重试兜底

即便模型支持 tool calling，产品也必须兜底检查，避免模型没有调用工具或工具调用失败。

修改：

```text
easyanalyse-desktop/src/lib/agentProviderClient.ts
```

新增输入：

```ts
selfCheck?: {
  enabled: boolean
  repairOnIssues: boolean
  maxRepairAttempts: number
}
```

流程：

```text
provider final AgentResponse
  -> parse
  -> if kind=blueprints:
       run check_blueprint_candidate for each candidate
       merge issues/selfCheck into candidate metadata/result trace
       if repairOnIssues && repair attempts remain:
         send fixed repair prompt containing AgentSelfCheckReport
         ask model to return full corrected AgentResponse
```

修正 prompt 必须包含机器可读报告：

```text
The following candidate failed EasyAnalyse self-check. Return a complete corrected AgentResponse v1. Do not explain outside JSON.
<AgentSelfCheckReport JSON>
```

### M7-T6：AgentPanel 工具 trace UI

修改：

```text
easyanalyse-desktop/src/components/agent/AgentPanel.tsx
easyanalyse-desktop/src/components/agent/AgentPanel.test.tsx
```

状态扩展：

```ts
interface AgentRunState {
  ...
  toolTrace: AgentToolTraceEntry[]
  repairTrace: AgentRepairTraceEntry[]
}
```

UI 展示：

```text
工具检查
- check_blueprint_candidate: 2 candidates checked, 0 errors, 1 layout warning
- validate_document: schema valid, semantic valid
- check_layout_overlaps: 1 device overlap warning

自动修复
- attempt 1: fixed malformed AgentResponse / moved overlapping devices
```

注意：

- layout warning 不显示成阻断 error。
- cancel 后不应继续追加 tool trace。
- 文档切换 stale guard 仍必须生效。

### M7-T7：蓝图入库记录自检结果

修改：

```text
easyanalyse-desktop/src/store/blueprintStore.ts
easyanalyse-desktop/src/types/blueprint.ts
```

建议扩展：

```ts
extensions.agentCandidate.selfCheck?: AgentSelfCheckReport
extensions.agentCandidate.toolIssues?: ValidationIssue[]
```

保持：

- candidate 可 invalid 入库。
- self-check issues 作为用户/模型提示。
- 不改变应用策略。

## 3. DeepSeek 真实验收要求

M7 必须新增真实 DeepSeek smoke，但默认跳过，需环境变量启用：

```bash
EASYANALYSE_RUN_DEEPSEEK_TOOL_SMOKE=1 npm test -- --run src/lib/deepseekToolSmoke.test.ts
```

smoke 必须验证：

1. DeepSeek 能收到 `check_blueprint_candidate` tool schema。
2. DeepSeek 至少一次调用工具，或明确按 prompt 要求先调用工具再最终回答。
3. 本地工具返回自检报告。
4. DeepSeek 根据自检报告返回最终 `AgentResponse v1`。
5. 最终 response 至少包含一个 blueprint candidate。
6. candidate 可入库为蓝图，不直接修改主文档。

如果 DeepSeek 对原生 tool calling 支持不稳定，必须启用 M7-T5 的自动后置自检 + 修正重试作为产品兜底，并在报告里记录 provider 差异。

## 4. 示例库规划与工具关系

示例库不是替代工具，而是帮助模型减少错误的上下文。M7 示例库一期建议后置于工具自检之后。

要求：

1. 每个示例必须通过：
   - schema/semantic validation
   - layout overlap check
   - no BOM
2. 示例来源必须记录在：
   ```text
   docs/examples/SOURCES.md
   ```
3. 优先手工重建经典公共拓扑，不直接复制无许可复杂原理图。
4. Agent prompt 只注入 1–3 个最相关示例，不一次塞入完整大库。

推荐一期示例：

- LED 限流 + 开关
- RC 低通
- 反相运放
- Sallen-Key 二阶滤波
- Buck 控制骨架
- LDO 电源入口保护
- MCU 最小系统
- RS-485 接口
- CAN 接口
- 电机 MOSFET 驱动

## 5. 验收门禁

M7 完成前必须通过：

```bash
cd easyanalyse-desktop
npm test -- --run
npx tsc -b --pretty false
npm run lint
npx vite build
cd src-tauri && cargo test
```

额外检查：

```bash
python3 scripts/check_no_bom.py testJson   # 若新增脚本
python3 automation/autonomous_lock_test.py
git diff --check
git grep -n 'sk-' || true
```

M7 若涉及真实 DeepSeek tool smoke，需额外运行：

```bash
EASYANALYSE_RUN_DEEPSEEK_TOOL_SMOKE=1 npm test -- --run src/lib/deepseekToolSmoke.test.ts
```

## 6. 子代理任务模板

后续派子代理实现任一 M7-Tx，必须包含：

```text
上位文档：本文件 + exchange.md + 2026-05-06-agent-tools-examples-feasibility-plan.md
输入文件：列出允许读取/修改的文件
输出文件：列出必须新增/修改的文件
禁止：不改 semantic v4 schema、不直接应用主文档、不提交密钥、不把 wire/node 当连接事实
验收：列出必须跑的 targeted tests
回传：实现摘要、风险、测试结果、是否需用户决策
```

## 7. 推荐执行顺序

```text
1. M7-T1 布局重合检查纯函数
2. M7-T2/T3 Agent tool registry + check_blueprint_candidate
3. M7-T5 自动后置自检 + 修正重试兜底
4. M7-T4 DeepSeek/OpenAI-compatible tool calling loop
5. M7-T6 AgentPanel tool trace UI
6. M7-T7 蓝图自检 metadata 入库
7. 示例库一期 + 检索注入
```

原因：先有稳定本地工具，再让模型调用；先有产品兜底，再依赖 provider tool calling；最后再做示例库规模化。
