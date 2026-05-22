# Agent Filter Blueprint Tool Plan

Date: 2026-05-22

Related issue: https://github.com/Caltsic/EasyAnalyse/issues/1

## Goal

Turn the broad “programmatic quick-build” proposal into a small, deterministic Agent tool MVP:

- The model decides when to call the tool.
- The tool generates a complete EASYAnalyse semantic v4 `AgentBlueprintCandidate`.
- The generated candidate uses deterministic topology templates, component values, network labels, and default layout.
- The tool does not mutate the main document directly.
- The Agent can then run format/layout checks and store the candidate through the existing blueprint workflow.

## MVP Scope

- Tool name: `generate_filter_blueprint`.
- Supported filter types:
  - passive RC low-pass,
  - passive RC high-pass,
  - Sallen-Key low-pass.
- Supported parameters:
  - `filterType`,
  - `topology`,
  - `cutoffFrequencyHz`,
  - optional `q`,
  - optional `gain`,
  - optional R/C values,
  - optional supply labels.

## Deferred

- General DSL parser.
- CLI entry point.
- GUI toolbar/context-menu entry point.
- New `.ain.json` file extension.
- Higher-order cascade synthesis.
- MFB/state-variable filters.

## Validation

- Add unit coverage for schema exposure, valid generation, invalid arguments, and prompt guidance.
- Run targeted tests for Agent tools/provider prompt/tool registration.
- Run full `npm run verify`.

## Result

- Issue #1 was replied to and labeled as `feature`, `discussion`, `agent`, and `desktop`.
- `generate_filter_blueprint` MVP was added as an Agent tool.
- The tool returns a complete `AgentBlueprintCandidate` with standard EASYAnalyse semantic v4 JSON and does not mutate the main document.
- Targeted tests passed: `agentTools`, `agentProviderClient`, and `openAiCompatibleProvider`.
- Full `npm run verify` passed.
