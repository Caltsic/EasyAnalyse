# EasyAnalyse Design Agent Roadmap

Date: 2026-05-20

## Goal

Turn the current Agent from a blueprint-generation MVP into a strong circuit-design collaborator:

- The user can talk freely with the model in the Agent sidebar.
- The model can choose when to inspect the current circuit, inspect blueprint candidates, generate new candidates, compare alternatives, and ask clarifying questions.
- Blueprint generation is a tool-assisted workflow, not a one-shot text response.
- Hard format errors that would prevent opening or rendering are automatically returned to the model with detailed, actionable diagnostics.
- Semantic/layout findings are exposed as engineering hints, not mandatory blockers.
- Layout diagnostics expose concrete coordinates for module-module, module-line, and eventually module/text overlaps.
- The main document remains protected: the model writes blueprint candidates; the user applies them.

## Current State

Implemented:

- Agent sidebar with local threads and persisted sidecar messages.
- Real provider runtime for OpenAI-compatible providers and Anthropic plain mode.
- Tool calling loop for OpenAI-compatible providers.
- Tools: current document, format rules, document format check, blueprint format check, create blueprint candidate, validate document, layout overlap check, full candidate self-check.
- Blueprint candidate store and blueprints panel.
- Hard format gate for `check_blueprint_format` and `create_blueprint_candidate`.
- Advisory validation/layout checks.
- Local post-provider self-check.
- Tool trace UI defaults to collapsed.

Gaps:

- Thread history is displayed and persisted, but not passed back to the model.
- Agent tool runtime cannot read blueprint workspace, selected blueprint, editor selection, or topology summaries.
- Layout diagnostics cover only device-device and networkLine-device overlaps.
- Terminal label text, network label text, device titles, and parameter text are not exposed as diagnostic bounds.
- `create_blueprint_candidate` can store during a run; it needs the same stale-document guard as final insertion.
- Format diagnostics need richer issue details: expected shape, actual value summary, allowed keys, and repair suggestions.
- Anthropic path is not tool-enabled.

## Product Semantics

### Hard Format Errors

Hard format errors are issues that can prevent a JSON document from opening, rendering, or being interpreted by EasyAnalyse:

- Invalid JSON.
- Unsupported `schemaVersion`.
- Missing required top-level fields.
- Missing required device or terminal fields.
- Invalid field type.
- Unknown persisted fields outside `properties` or `extensions`.
- Forbidden old topology fields such as `wires`, `nodes`, `junctions`, `components`, `ports`, `signalId`.
- Invalid `view.canvas.units`.
- Invalid `view.devices` or `view.networkLines` shape.

When these occur, the runtime must automatically return the error context to the model. The model should then decide whether to repair and continue, ask a question, or return an error.

### Advisory Findings

These are not blockers by themselves:

- Missing part values or frequencies.
- Suspicious terminal direction.
- Unconnected terminals.
- Power label ambiguity.
- Device overlap or label overlap.
- Network-line visual clutter.

They should be returned as structured hints.

## Target Agent Workflow

1. User sends a message in the Agent sidebar.
2. Runtime builds provider prompt with:
   - system role and tool rules,
   - recent thread history summary,
   - current user request,
   - optional current document JSON when `Context` is enabled,
   - guidance that tools are available for deeper inspection.
3. Model decides whether to answer directly or call tools.
4. For circuit generation or modification:
   - model calls `get_easyanalyse_format_rules` when needed,
   - model may call current document/topology/blueprint/layout tools,
   - model produces a complete blueprint candidate,
   - model checks hard format with `check_blueprint_format` or writes via `create_blueprint_candidate`.
5. If hard format fails:
   - runtime sends structured repair prompt back to model,
   - includes exact paths, expected shape, actual value summary, allowed keys, suggested minimal fix,
   - model can repair or decline.
6. Candidate is stored in blueprint workspace.
7. User reviews candidate in Blueprints panel and applies it manually.

## Tool Roadmap

### Phase 1: Conversation and State Read Tools

Implement now.

- `threadHistory` prompt injection:
  - summarize recent messages in same thread,
  - cap by message count and character count,
  - include tool summaries but not raw large JSON,
  - redact secret-like content.
- `get_blueprint_workspace`:
  - returns workspace summary and blueprint list,
  - default excludes full documents,
  - optional `includeDocuments`.
- `get_blueprint_candidate`:
  - read one candidate by id,
  - optional full document and validation/agent metadata.
- `compare_blueprint_candidate`:
  - compare current main document with selected/specified blueprint using existing `blueprintDiff`.
- `get_current_selection`:
  - editor selection, focused device/label/network line, selected blueprint id.
- `summarize_topology`:
  - devices, terminals, labels, connection groups, relations, network lines.

### Phase 2: Hard Format Diagnostic Upgrade

Implement now.

- Extend format issue `details` with:
  - expected,
  - actual type,
  - actual value summary,
  - allowed keys when applicable,
  - forbidden field replacement guidance,
  - minimal fix hint.
- Improve repair prompt to list detailed diagnostics.
- Add tests that a malformed blueprint produces actionable repair context.

### Phase 3: Layout Coordinates Diagnostic

Implemented first useful slice; leave renderer-perfect text layout extraction for later.

- Extend layout report with:
  - all device bounds,
  - all network line segments,
  - connection group points.
- Keep existing overlap warnings.
- Expand `check_layout_overlaps` with module-module, module-line, and terminal/network-label text vs module overlap diagnostics.

Later:

- Extract terminal-label placement from `CircuitCanvasRenderer` into a pure module.
- Report label-label overlaps.
- Report device title and parameter text overflow.

### Phase 4: Write Safety

- Add stale-document guard to tool-time `create_blueprint_candidate`.
- Return `ok=false` with a stale-context issue if the user changed document/path during the run.
- Never let tools mutate main document.

Implemented now:

- The runtime callback refuses to store tool-time blueprint candidates when the editor document/path changed during the run.

### Phase 5: Native Multi-message Providers

- Move from prompt-summary history to provider-native message history where safe.
- Keep summary fallback for context control.
- Add tool-result memory summarization for long sessions.

## Execution Order

1. Implement thread history summary injection.
2. Implement hard format issue detail enrichment.
3. Add read-only Agent tools for workspace, candidate, diff, selection, topology.
4. Inject tool runtime callbacks from `AgentPanel`.
5. Add focused tests.
6. Run `npm exec tsc`, targeted tests, full tests.

## Execution Status

Completed on 2026-05-20:

- Thread history summary is injected into provider prompts with bounds and secret redaction.
- Hard format diagnostics now include expected shape, actual type/value summary, allowed keys, and repair hints.
- Hard format tool failures are automatically returned to the OpenAI-compatible provider loop with detailed repair prompts, while allowing the model to repair, ask a question, or return an error.
- Added read-only tools: `get_blueprint_workspace`, `get_blueprint_candidate`, `compare_blueprint_candidate`, `get_current_selection`, `summarize_topology`.
- AgentPanel injects blueprint workspace, selected blueprint id, editor selection, and focus callbacks into tool runtime context.
- `check_layout_overlaps` can report module-module, module-line, and terminal/network-label text vs module overlaps with concrete bounds.
- Tool-time blueprint creation is guarded against stale editor document/path.
- Verified with typecheck, full Vitest suite, ESLint, and production build.

Deferred:

- Anthropic tool calling path.
- Provider-native multi-message history.
- Renderer-perfect shared text layout extraction and label-label/title/parameter text diagnostics.

## Acceptance Criteria

- Second user message in same thread reaches provider with a recent history summary.
- Model can call a tool to list blueprint candidates.
- Model can read one blueprint candidate by id or selected candidate.
- Model can compare selected blueprint with current document.
- Model can read current editor selection/focus state.
- Model can ask for topology summary without receiving full raw JSON.
- A hard format failure returns repair context with path, expected shape, actual value summary, and minimal fix hints.
- Existing advisory issues do not block final blueprint return.
- Tests cover new tools and history prompt injection.
