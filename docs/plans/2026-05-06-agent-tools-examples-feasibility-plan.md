# EasyAnalyse M7 Agent 自检工具、布局重合检查与高质量示例库可行性规划

> 日期：2026-05-06
> 分支：agent
> 背景：DeepSeek 首次真实 smoke 曾返回不合规 AgentResponse（`blueprints` 非数组）。这说明仅靠 prompt 约束不够，后续应让模型能借助本地检查工具自检，并提供更高质量参考案例。

## 1. 总体判断

该方向可行，且非常适合 EasyAnalyse 当前架构。

原因：

1. 格式/语义校验已有 Rust core 权威实现，并已通过 Tauri 暴露给前端。
2. 蓝图系统允许 invalid/unknown candidate 保存和强确认应用，适合把检查报告作为提示，而不是阻断用户。
3. 前端已有 `deriveCircuitInsights` / `deviceSymbols` / `geometry`，可以实现 device-device bounds overlap 检查。
4. Provider runtime 已有 timeout/cancel/retry/redaction，可作为工具调用 loop 的基础。
5. 示例库现有基础较好，但缺少系统化 few-shot 和复杂子系统参考。

建议把它作为 **M7**，不要和 M6 收尾混在同一个提交里。

## 2. M7 目标

### M7-G1：让模型更稳定地产生合规 AgentResponse / semantic v4 DocumentFile

措施：

- 加强 prompt 不是最终解法，只作为第一层。
- 增加本地工具：`validate_document` / `check_layout_overlaps` / `check_blueprint_candidate`。
- 让 DeepSeek/OpenAI-compatible 模型可以调用工具，或至少由产品自动二次检查后要求模型修正。

### M7-G2：检测器件体积重合

措施：

- 基于当前渲染推导 bounds 做 AABB 检查。
- MVP 只检查 device-device overlap。
- 默认作为 warning，不阻止保存/应用。
- 检查结果暴露给模型和 UI。

### M7-G3：建立高质量参考案例库

措施：

- 不追求直接复制“最大最复杂”电路。
- 选择架构优秀、代表性强、许可清晰的电路子系统。
- 手工转换/抽象为 semantic v4 JSON。
- 每个例子通过 schema + semantic 校验，并有来源/许可登记。

## 3. 现有可复用能力

### 3.1 格式/语义校验

已有权威路径：

```text
Rust easyanalyse-core validate_value
  -> Tauri validate_document
  -> src/lib/tauri.ts validateDocumentCommand
  -> blueprintStore.validateBlueprint
```

可以包装为 Agent 工具：

```ts
validate_document(document: DocumentFile): Promise<AgentToolResult>
```

返回：

```ts
{
  ok: boolean,
  summary: string,
  issues: ValidationIssue[],
  normalizedDocument?: DocumentFile | null
}
```

### 3.2 布局 bounds 基础

已有：

- `deriveCircuitInsights(document)`
- `DerivedDevice.bounds`
- `getDefaultSizeForKind`
- `geometry.ts`

可实现：

```ts
check_layout_overlaps(document: DocumentFile, options?: { padding?: number }): AgentToolResult
```

MVP 规则：

- 根据 `DerivedDevice.bounds` 两两 AABB 检查。
- 边界刚接触不算重合。
- 默认 padding 可为 8px 或 0。
- 结果先全部 warning，issue code：`layout.device.overlap`。
- 不改变主文档，不保存。

## 4. 推荐架构

### 4.1 Agent tool registry

新增：

```text
src/lib/agentTools.ts
src/lib/agentTools.test.ts
src/lib/layoutValidation.ts
src/lib/layoutValidation.test.ts
```

工具注册：

```ts
type AgentToolName = 'validate_document' | 'check_layout_overlaps' | 'check_blueprint_candidate'

interface AgentToolDefinition {
  name: AgentToolName
  description: string
  parameters: unknown
  run(args: unknown): Promise<AgentToolResult>
}
```

`check_blueprint_candidate` 组合：

```text
validate_document + check_layout_overlaps
```

这是最推荐暴露给模型的单一工具，因为模型不必理解先后顺序。

### 4.2 两阶段落地策略

#### 阶段 A：自动后置检查 + 修正重试（低风险 MVP）

不要求模型真正 tool_call，先做：

```text
provider 返回 AgentResponse
  -> 产品自动 validate_document + check_layout_overlaps
  -> 如果发现问题，把检查报告作为第二轮 prompt 发给模型
  -> 最多修正 1 次
  -> 入库蓝图候选
```

优点：

- 对现有 adapter 改动小。
- DeepSeek/OpenAI/Anthropic 都能复用。
- 能马上降低首次输出不规范率。

缺点：

- 不是真正“模型主动调用工具”。

#### 阶段 B：OpenAI-compatible / DeepSeek tool-calling loop

新增真正工具调用：

```text
messages = system + user
for step <= maxToolIterations:
  call provider with tools
  if tool_calls:
    execute local tool(s)
    append tool result messages
    continue
  else:
    parse final AgentResponse
```

先只做 DeepSeek / OpenAI-compatible：

- payload 增加 `tools`。
- 解析 `choices[0].message.tool_calls`。
- tool result 用 OpenAI format：`role='tool'` + `tool_call_id` + JSON content。
- final 仍必须是 AgentResponse v1。

Anthropic tool use 协议不同，建议后置。

### 4.3 UI 展示

AgentPanel 可显示：

```text
工具检查：
- validate_document: 0 errors, 2 warnings
- check_layout_overlaps: 1 warning
```

BlueprintsPanel 可把工具 issues 合并到 candidate issues / validation report 中，但继续保持：

- invalid/unknown/valid 都允许强确认应用。
- 报错只提示，不阻止应用。

## 5. 高质量示例库方案

### 5.1 不建议直接复制复杂原理图

不应从网上复杂原理图直接逐器件照搬：

- 版权/许可风险高。
- 完整复杂板会有大量与学习目标无关的 housekeeping 电路。
- semantic v4 当前没有 sheet 层级/PCB 规则/差分对约束等一等语义。
- 直接转换容易产生匿名 `Net-(...)`、方向混乱、参数缺失。

推荐：**手工重建/抽象公共拓扑和开源许可清晰的子系统**。

### 5.2 推荐示例矩阵

每类先补 2–4 个高质量例子：

1. 基础语义：LED 限流、按键上拉、RLC/RC。
2. 模拟：反相/同相运放、仪表放大器、Sallen-Key / 多反馈滤波器、低噪声前端。
3. 电源：LDO、Buck、Boost、反接保护/TVS/保险丝、MOSFET gate driver。
4. MCU/数字：STM32/RP2040/ESP32 最小系统、I2C 传感器、SPI Flash/ADC、UART/USB 转串口。
5. 接口：RS-485、CAN、USB2、Ethernet PHY 简化版。
6. 系统级：电机控制子系统、ADC 采集前端、IoT 节点电源+MCU+传感器。

### 5.3 转换流程

1. 选择来源：优先公共经典拓扑、自己设计、明确开源硬件许可。
2. 提取器件和 net：器件 pin -> terminal，net name -> label。
3. 清洗 label：禁止匿名 `Net-(...)`，电源用 `3V3`/`5V`/`12V`。
4. 补 properties：R/C/L value、crystal frequency、电源/稳压输出电压。
5. 推断 terminal direction。
6. 自动/手工布局，避免器件重合。
7. 运行 schema + semantic + overlap 检查。
8. 记录来源：`docs/examples/SOURCES.md` 或 `extensions.sourceAttribution`。
9. 将少量代表性示例纳入 Agent prompt/few-shot，更多示例供检索选择。

### 5.4 许可策略

低风险：

- 自己手工设计。
- 经典公共知识拓扑。
- CERN-OHL / CC-BY / CC-BY-SA / MIT/BSD/Apache 明确覆盖硬件设计文件的项目。

中风险：

- 厂商 datasheet/app note/evaluation board schematic。可参考拓扑，避免完整复制。

高风险，避免：

- 商业产品维修图纸、无许可博客/论坛图片、付费课程/书籍完整设计、泄露图纸。

## 6. M7 任务拆分

### M7-T1：布局重合检查纯函数

输出：

- `layoutValidation.ts`
- tests：不重合、完全重合、边界接触、默认 size、terminal crowding 后重合。

### M7-T2：Agent tool registry

输出：

- `agentTools.ts`
- `validate_document`
- `check_layout_overlaps`
- `check_blueprint_candidate`
- tests：工具输入校验、错误处理、无副作用。

### M7-T3：Provider 返回后自动检查 + 修正重试

输出：

- `agentProviderClient` 支持 `autoCheckAndRepair`。
- DeepSeek smoke 增加 “首轮不合规时修正” 或 synthetic test。

### M7-T4：OpenAI-compatible / DeepSeek tool-call loop

输出：

- tool-aware OpenAI-compatible payload。
- tool_calls parser。
- tool result loop。
- maxToolIterations / cancel / timeout。
- DeepSeek 真实 tool smoke。

### M7-T5：AgentPanel 工具 trace UI

输出：

- 显示工具调用摘要。
- candidate issues 合并检查结果。

### M7-T6：示例库一期

输出：

- `testJson/examples/` 或保持 `testJson/` 分组约定。
- 8–12 个高质量示例。
- `docs/examples/SOURCES.md`。
- 示例全部通过 schema/semantic/overlap 检查。

### M7-T7：示例检索/注入策略

输出：

- 根据用户请求选择 1–3 个最相关示例注入 prompt。
- 避免一次注入巨量 JSON。
- tests 覆盖 selection。

## 7. 已知先决问题

子代理调查发现 `testJson` 中多个 JSON 含 UTF-8 BOM，导致 Rust `bundled_examples_validate` 直接解析失败。M7 示例库开始前应先修复：

- 方案 A：统一去除 `testJson/*.json` BOM。
- 方案 B：Rust 测试/loader 支持 UTF-8 BOM。

推荐方案 A + 增加检测脚本。

## 8. 风险

1. tool calling 与 `response_format: { type: 'json_object' }` 可能在 DeepSeek 上互相影响，需要真实 smoke。
2. Anthropic tool use 协议不同，不建议和 DeepSeek/OpenAI-compatible 同期做。
3. overlap 检查与渲染 bounds 一致性要复用 `deriveCircuitInsights`，不要另写一套尺寸规则。
4. 工具 loop 会增加延迟和 token 成本，要有 max iteration 和 cancel。
5. 示例来源必须有许可记录，避免把无许可复杂电路放进仓库。

## 9. 推荐决策

建议执行 M7，且顺序为：

```text
先做 M7-T1/T2/T3：检查工具 + 自动检查修正
再做 M7-T4/T5：真正 tool-calling loop + UI trace
最后做 M7-T6/T7：高质量示例库 + 检索注入
```

这样能最快改善 DeepSeek 首次输出不规范问题，同时把更复杂的 tool-call 协议风险后置。
