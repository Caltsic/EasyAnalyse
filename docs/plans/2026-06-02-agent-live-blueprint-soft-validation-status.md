# Agent Live Blueprint, Soft Validation, And Simulation Preview Status

Date: 2026-06-02

Branch target: `agent`

## Goal

This work moves the Agent from a one-shot blueprint generator toward a circuit-design collaborator:

- The model can declare that it is starting blueprint generation.
- The app can project streamed blueprint JSON into a live working copy instead of waiting for a fully finalized answer.
- Blueprint format/display problems are treated as recoverable diagnostics and should be sent back to the model for repair.
- The app keeps the last displayable blueprint candidate instead of clearing the canvas when a newer draft is malformed.
- DeepSeek v4 thinking mode can be configured for Agent work.
- Generated blueprints can carry lightweight simulation artifacts for preview and self-check.
- Deterministic tools such as `generate_filter_blueprint` can produce standard EASYAnalyse semantic JSON so the model can focus on placement, explanation, and correction.

This is still an experimental Agent branch. The goal is to make failures observable and recoverable, not to claim industrial-grade circuit simulation or perfect model correctness.

## Completed

- Added the `begin_blueprint_generation` tool so the model can explicitly enter blueprint-generation mode.
- Added the canvas-save gate for blueprint generation when the current document already contains circuit content.
- Added live blueprint draft parsing through `parseLiveBlueprintDraft`.
- Added a live working-copy path for projected drafts and persisted partial text to `working-copy/live-draft.raw.json.partial`.
- Added `.easyanalyse` project path helpers and project-oriented types.
- Changed blueprint hard-format issues into recoverable diagnostics where possible instead of immediately turning them into Provider errors.
- Expanded diagnostics with actionable information such as JSON path, expected shape, actual value summary, allowed fields, and likely fix direction.
- Added DeepSeek thinking-mode settings: disabled, auto, high, and max.
- Added DeepSeek reasoning-content replay support for thinking mode with tool calls.
- Added deterministic `generate_filter_blueprint` support for filter blueprints and lightweight simulation artifacts.
- Added simulation artifact types, sandbox execution, tests, and the `BlueprintSimulationCard` UI.
- Preserved simulation data from both `candidate.simulation` and `candidate.document.extensions.simulation`.
- Added provider/client fallbacks for lenient AgentResponse normalization and inferred filter-blueprint recovery.
- Added an AgentPanel-level final fallback so a recoverable provider-shape error can still store a deterministic candidate in common filter-generation cases.
- Kept tool-call details available while improving the chat reading order from earlier Agent UI work.

## Not Completed

- Full UI verification of the latest AgentPanel-level fallback is pending because the final desktop build was interrupted during manual testing.
- The simulation card needs another packaged-app smoke test after the store promotion fix from `DocumentFile.extensions.simulation`.
- Live incremental display is implemented at the parsing/working-copy level, but still needs broader end-to-end verification across streaming and non-streaming Providers.
- Recoverable Provider-shape fallback is currently spread across provider/client/UI layers. It should eventually be centralized so the UI does not need to understand provider protocol repair.
- Project-folder save/reopen behavior has foundational helpers, but full project lifecycle UX is not complete.
- Simulation artifacts are Preview only. The worker sandbox can run lightweight scripts and show chart data, but it is not a replacement for SPICE.

## Debugging Work Already Done

- Built and launched the desktop app through Computer Use for smoke tests.
- Configured a DeepSeek Provider and tested with `deepseek-v4-flash`.
- Used the prompt:

```text
请使用generate_filter_blueprint工具生成一个一阶RC低通滤波器蓝图，截止频率5kHz，并保留工具返回的blueprints[0].simulation仿真卡。只返回一个候选。
```

- Observed successful runs where the model called `generate_filter_blueprint` and stored blueprint candidates.
- Observed that a model may move simulation data from `blueprints[0].simulation` into `DocumentFile.extensions.simulation`.
- Fixed the blueprint store to promote simulation data from the document extension into the blueprint record extension.
- Reproduced repeated red Provider errors with the message:

```text
OpenAI-compatible provider response must be a JSON object with choices[0].message.content.
```

- Inspected the AgentPanel, provider parser, client fallback, and blueprint-store persistence paths.
- Added fallback handling in multiple layers after confirming the error could still escape earlier recovery paths.

## Known Issues

- Some OpenAI-compatible responses can still arrive in a nonstandard shape. The latest UI-level fallback is intended to reduce user-visible failure, but it still needs packaged-app verification.
- DeepSeek tool-call and thinking-mode behavior is sensitive to `reasoning_content` replay. Tests cover the payload path, but live provider behavior should continue to be tested after each provider change.
- If the model emits malformed JSON during live generation, the app should preserve the last displayable working copy; however, some edge cases may still show stale preview data without making the repair state obvious enough.
- The app should eventually show clearer UI language for `format-blocked` drafts, last displayable copy, raw partial draft, and final accepted blueprint.
- Agent-generated electrical correctness remains model-dependent. The current simulation preview improves observability, but strict correctness review still needs more work.

## Verification So Far

- Passed targeted tests:

```text
npm test -- --run src/components/agent/AgentPanel.test.tsx src/lib/agentProviderClient.test.ts src/lib/openAiCompatibleProvider.test.ts src/store/blueprintStore.test.ts src/components/blueprints/BlueprintsPanel.test.tsx src/lib/agentTools.test.ts src/lib/simulationWorkerSandbox.test.ts
```

- Passed `npm run typecheck`.
- Passed `npm run lint`.
- Previous desktop builds completed successfully before the last fallback patch.
- The final `npm run tauri:build` after the last AgentPanel fallback was interrupted, so the latest packaged build still needs to be rerun.

## Next Steps

- Rebuild the desktop package and run one full UI smoke test:
  - configure Provider,
  - ask Agent to call `generate_filter_blueprint`,
  - confirm candidate storage,
  - confirm blueprint preview,
  - confirm simulation card,
  - apply blueprint to the canvas.
- Move provider-shape recovery into one provider/client-owned path.
- Add visible draft states for live generation: parsing, displayable, diagnostics pending, format-blocked, and accepted.
- Expand simulation preview examples beyond simple filter response.
- Add regression tests for simulation data stored in `DocumentFile.extensions.simulation`.
- Continue treating the `agent` branch as a collaborative experimental branch until these behaviors are stable enough for `main`.
