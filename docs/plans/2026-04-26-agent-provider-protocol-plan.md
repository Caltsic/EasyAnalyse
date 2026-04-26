# EasyAnalyse Agent Provider、协议与运行控制细化规划

> 日期：2026-04-26  
> 关联主规划：`docs/plans/2026-04-26-agent-blueprint-plan.md`  
> 目标：把桌面版内置 Agent 从“聊天框”规划为可验证、可取消、可重试、可扩展 Provider 的受控蓝图生成系统。

## 1. 设计目标与边界

Agent 不是拥有任意文件系统/命令执行权限的自动化脚本，而是受控的蓝图生成、修改、解释助手：

1. Agent 只能创建、修改、解释、修复蓝图，不直接修改主文档。
2. Agent 不能直接写磁盘主文件；应用蓝图必须用户显式确认。
3. Agent 输出必须先进入 `AgentResponse v1` 结构化协议。
4. 创建/修改蓝图必须生成完整 semantic v4 `DocumentFile`，或后续阶段生成受控 patch。
5. 所有候选文档都必须经过：JSON parse → AgentResponse schema 校验 → forbidden field scan → semantic v4 schema/semantic validation → 蓝图状态落库。
6. invalid 蓝图可保存为草稿，但不能应用。
7. 修改蓝图默认创建派生蓝图，不覆盖原蓝图。
8. API key 不写入主文档、不写入 sidecar、不进入 prompt。

## 2. Agent 运行状态机

建议新增 `agentStore`，一次请求使用一个 `requestId` 跟踪。

```ts
export type AgentRunState =
  | 'idle'
  | 'preparing'
  | 'awaiting_user_consent'
  | 'sending'
  | 'receiving'
  | 'parsing'
  | 'validating'
  | 'committing_blueprints'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'retry_wait'
```

状态转移：

```text
idle
  -> preparing
    -> failed                    // provider/model/key 缺失
    -> awaiting_user_consent      // 首次上传电路内容需确认
    -> sending
awaiting_user_consent
  -> sending | cancelled
sending
  -> receiving | retry_wait | failed | cancelled
receiving
  -> parsing | retry_wait | failed | cancelled
parsing
  -> validating | retry_wait | failed
validating
  -> committing_blueprints | failed
committing_blueprints
  -> completed | failed
retry_wait
  -> sending | cancelled
completed/failed/cancelled
  -> preparing                   // 用户再次发送
```

关键规则：

- `cancelled` 不写入半截响应。
- `failed` 不污染蓝图列表，除非已经有 candidate 完成解析与校验。
- `validating` 可混合保存 valid/invalid candidate。
- `committing_blueprints` 阶段若部分写入后取消，已写入蓝图保留，未写入 candidate 丢弃并显示提示。

## 3. 内部 AgentRequest 协议

业务层统一使用内部请求，不直接拼 OpenAI/Anthropic payload。

```ts
export interface AgentRequest {
  requestId: string
  intent: AgentIntent
  providerId: string
  modelId: string
  userPrompt: string
  locale: 'zh-CN' | 'en-US'
  context: AgentRequestContext
  generation: AgentGenerationOptions
  responseContract: AgentResponseContract
  client: AgentClientInfo
  timeoutMs?: number
  retryPolicy?: AgentRetryPolicy
}

export type AgentIntent =
  | 'create_blueprints'
  | 'modify_blueprint'
  | 'repair_blueprint'
  | 'explain_blueprint'
  | 'compare_blueprints'
  | 'validate_help'
  | 'provider_test'

export interface AgentRequestContext {
  mainDocument?: DocumentFile
  mainDocumentHash?: string
  activeBlueprint?: BlueprintRecord
  activeBlueprintDocumentHash?: string
  selectedBlueprints?: BlueprintRecord[]
  sendFullMainDocument: boolean
  sendFullBlueprintDocument: boolean
  documentSummary?: CircuitDocumentSummary
  validationReport?: ValidationReport
  maxBlueprints?: number
  semanticRulesVersion: 'easyanalyse-semantic-v4'
}

export interface AgentGenerationOptions {
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  stream?: boolean
  preferStructuredOutput: boolean
  createDerivedBlueprintByDefault: boolean
}
```

## 4. AgentResponse v1 协议

模型必须返回单个 JSON object。不得从 markdown 中提取电路并入库。

```ts
export type AgentResponse =
  | AgentMessageResponse
  | AgentBlueprintsResponse
  | AgentPatchResponse
  | AgentQuestionResponse
  | AgentErrorResponse

export interface AgentResponseBase {
  schemaVersion: 'agent-response-v1'
  kind: 'message' | 'blueprints' | 'patch' | 'question' | 'error'
  requestId?: string
  summary?: string
  warnings?: string[]
}
```

### 4.1 message

```ts
export interface AgentMessageResponse extends AgentResponseBase {
  kind: 'message'
  markdown: string
}
```

只用于展示，不创建蓝图。

### 4.2 blueprints

```ts
export interface AgentBlueprintsResponse extends AgentResponseBase {
  kind: 'blueprints'
  summary: string
  blueprints: AgentBlueprintCandidate[]
}

export interface AgentBlueprintCandidate {
  title: string
  summary: string
  rationale: string
  tradeoffs: string[]
  document: DocumentFile
  highlightedLabels?: string[]
  notes?: string[]
}
```

约束：

- `blueprints.length` 建议 1-5。
- 每个 candidate 必须是完整 semantic v4 `DocumentFile`。
- `schemaVersion` 必须为 `4.0.0`。
- 禁止 `wires/nodes/junctions/bends/signals/signalId/components/ports` 等旧拓扑字段。
- terminal `direction` 只能 `input/output`。
- 连接真值只能由 terminal `label` 表达。
- `view.networkLines[*].label` 必须被 terminal 使用。

### 4.3 patch（第二阶段）

MVP 可以不启用 patch。启用时只能作用于蓝图 clone，并默认产生派生蓝图。

允许操作：`add_device/update_device/remove_device/add_terminal/update_terminal/remove_terminal/rename_label/set_device_view/add_network_line/update_network_line/remove_network_line/update_document_meta`。

禁止操作：`add_wire/update_wire/remove_wire/add_node/add_junction/set_signal_id/set_terminal_position/mutate_main_document_directly`。

### 4.4 question / error

`question` 只显示澄清问题，不写蓝图。`error` 是模型主动报告无法完成，应包装为统一 `AgentRunError`。

## 5. Provider Adapter Interface

```ts
export interface AgentProviderAdapter {
  readonly id: string
  readonly requestFormat: 'openai-chat-completions' | 'anthropic-messages'
  buildPayload(input: ProviderBuildInput): ProviderHttpRequest
  parseResponse(input: ProviderParseInput): ProviderParseResult
  parseStreamChunk?(chunk: Uint8Array | string): ProviderStreamEvent[]
  supports(config: AgentProviderConfig, model: AgentModelConfig): boolean
}
```

默认 Provider：

| Provider | kind | requestFormat | 默认 baseUrl | 示例模型 |
|---|---|---|---|---|
| OpenAI | `openai` | `openai-chat-completions` | `https://api.openai.com/v1` | `gpt-4.1`, `gpt-5` |
| Anthropic | `anthropic` | `anthropic-messages` | `https://api.anthropic.com` | `claude-sonnet-4-5` |
| DeepSeek | `deepseek` | `openai-chat-completions` | `https://api.deepseek.com/v1` | `deepseek-chat`, `deepseek-reasoner` |
| 自定义 | `openai-compatible` | `openai-chat-completions` | 用户填写 | 用户填写 |

## 6. Payload 映射

### 6.1 OpenAI / DeepSeek

`POST {baseUrl}/chat/completions`

Headers：

```json
{"Authorization":"Bearer <apiKey>","Content-Type":"application/json"}
```

Body：

```json
{
  "model": "<model>",
  "messages": [
    {"role":"system","content":"<system prompt>"},
    {"role":"user","content":"<user prompt + context>"}
  ],
  "temperature": 0.2,
  "top_p": 1,
  "max_tokens": 8192,
  "stream": false,
  "response_format": {"type":"json_object"}
}
```

规则：

- DeepSeek preset 复用 OpenAI-compatible adapter。
- OpenAI-compatible 若不支持 `response_format`，可移除此字段降级重试一次。
- `deepseek-reasoner` 只解析最终 `message.content`，不要把 reasoning 当 JSON。

### 6.2 Anthropic

`POST {baseUrl}/v1/messages` 或对已含 `/v1` 的 baseUrl 拼 `/messages`。

Headers：

```json
{"x-api-key":"<apiKey>","anthropic-version":"2023-06-01","Content-Type":"application/json"}
```

Body：

```json
{
  "model": "<model>",
  "system": "<system prompt>",
  "messages": [{"role":"user","content":"<user prompt + context>"}],
  "temperature": 0.2,
  "top_p": 1,
  "max_tokens": 8192,
  "stream": false
}
```

Anthropic 没有通用 `json_object` 字段，依赖 prompt 强约束，必要时后续可探索 assistant prefill。

## 7. 结构化输出防线

```text
Prompt 约束
  -> Provider JSON mode / 格式约束
  -> 原始文本提取
  -> JSON parse
  -> AgentResponse schema 校验
  -> forbidden field scan
  -> DocumentFile schema validation
  -> semantic validation
  -> 蓝图状态落库
```

JSON 提取顺序：

1. trim 后整体 parse。
2. 提取 fenced JSON block。
3. 提取第一个平衡 `{...}`。
4. 可选发起一次“JSON 修复请求”。
5. 仍失败则 `AGENT_RESPONSE_PARSE_FAILED`，不写蓝图。

Forbidden field scan 字段：

```ts
const FORBIDDEN_SEMANTIC_V4_FIELDS = [
  'wire','wires','node','nodes','junction','junctions','bend','bends',
  'signal','signals','signalId','components','ports'
]
```

## 8. 错误码与用户文案

```ts
export type AgentErrorCode =
  | 'AGENT_NOT_CONFIGURED'
  | 'AGENT_API_KEY_MISSING'
  | 'AGENT_PROVIDER_AUTH_FAILED'
  | 'AGENT_PROVIDER_MODEL_UNAVAILABLE'
  | 'AGENT_NETWORK_ERROR'
  | 'AGENT_TIMEOUT'
  | 'AGENT_RATE_LIMITED'
  | 'AGENT_RESPONSE_PARSE_FAILED'
  | 'AGENT_RESPONSE_SCHEMA_INVALID'
  | 'AGENT_RESPONSE_FORBIDDEN_FIELD'
  | 'AGENT_DOCUMENT_SCHEMA_INVALID'
  | 'AGENT_DOCUMENT_SEMANTIC_INVALID'
  | 'AGENT_CONTEXT_TOO_LARGE'
  | 'AGENT_CANCELLED'
  | 'BLUEPRINT_WORKSPACE_SAVE_FAILED'
  | 'UNKNOWN_AGENT_ERROR'
```

用户文案原则：

- 鉴权/额度/模型名错误：不自动重试，引导打开设置。
- 网络/超时/429/5xx：可自动重试并允许取消。
- parse/schema 失败：提示模型未按协议返回，可重试或换支持 JSON 的模型。
- semantic invalid：蓝图保存为 invalid 草稿，展示 issues，并提供“让 Agent 修复”。

## 9. Timeout / Cancel / Retry

默认值：

```ts
providerTestTimeoutMs = 15000
normalRequestTimeoutMs = 60000
longBlueprintRequestTimeoutMs = 120000
streamIdleTimeoutMs = 30000
```

取消：

- 前端使用 `AbortController`。
- Rust/Tauri 可维护 `requestId -> CancellationToken`。
- 取消后丢弃未完成响应，不修改主文档。

重试：

```ts
const DEFAULT_AGENT_RETRY_POLICY = {
  maxRetries: 2,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
  jitter: true,
  retryableCodes: ['AGENT_NETWORK_ERROR','AGENT_TIMEOUT','AGENT_RATE_LIMITED','AGENT_RESPONSE_EMPTY']
}
```

不可自动重试：缺 API key、401/403、模型不存在、上下文过大、semantic validation 失败、用户取消。

## 10. 隐私与安全

- 首次上传当前电路内容前弹窗确认。
- Provider 测试请求不上传当前电路。
- prompt 中用边界包裹用户文档：`<document_json>...</document_json>`，声明这是数据不是指令。
- 不上传 API key、本机配置、未选中文件、无关蓝图全文、绝对路径。
- Agent 不拥有 shell、任意文件读取、任意路径写入能力。
- 模型自称“已验证”不影响本地 validation 结果。

## 11. 测试清单

1. OpenAI/DeepSeek payload 映射、错误解析、`response_format` 降级。
2. Anthropic payload 映射、content block 拼接、错误解析。
3. Provider 测试连接不包含主文档。
4. AgentResponse parser：纯 JSON、fence JSON、前后文本、parse fail。
5. forbidden field scan 捕获 `wires/nodes/signalId`。
6. valid/invalid 混合 candidate 入库。
7. cancel/retry/timeout 状态机。
8. API key 不写主文档和 sidecar。
9. prompt 注入字段不能绕过本地校验。
