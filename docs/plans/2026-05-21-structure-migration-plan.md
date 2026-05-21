# EasyAnalyse Structure Migration Plan

Date: 2026-05-21

## Goal

Start migrating EasyAnalyse from large shared files and repeated helpers toward a maintainable structure, without changing user-facing behavior.

## First Batch Scope

Implemented in this batch:

- Shared text helpers:
  - `src/lib/text.ts`
  - trim/fallback helpers for semantic document code,
  - non-trimming coercion helpers for canvas/layout sorting.
- Shared guards:
  - `src/lib/guards.ts`
  - first replacements for behavior-identical `isRecord`.
- Shared error helper:
  - `src/lib/errors.ts`
  - first replacements for ordinary `Error.message` extraction.
- UI primitives:
  - `components/ui/Button.tsx`
  - `components/ui/StatusBadge.tsx`
  - `components/ui/EmptyState.tsx`
  - `components/ui/index.ts`
  - `styles/ui.css`
- CSS feature split:
  - `styles/features/agent.css`
  - `styles/features/blueprints.css`
  - `App.css` remains the aggregation entry to avoid import churn and viewer regressions.

## Explicit Non-Scope

- No behavior changes.
- No page redesign.
- No Tauri/Rust command envelope migration yet.
- No SQL/data-layer introduction.
- No broad rewrite of `App.css` beyond moving isolated Agent and Blueprints sections.
- No replacement of sanitizer-aware provider/agent helper functions.

## Research Findings

CSS:

- `App.css` is imported by both desktop app and mobile viewer.
- `BlueprintsPanelLayout.test.ts` directly inspected `App.css`, so it must be updated when blueprints styles move.
- Agent styles are largely isolated, except a prior shared selector with sidebar avatar styling; the moved block starts at `.agent-panel`.
- Blueprints styles are isolated and safe to move with test update.

Utilities:

- Two text semantics exist and must stay separate:
  - trimmed string with fallback,
  - non-trimming string coercion for layout/canvas sort.
- `safeErrorMessage` and provider `sanitizeMessage` helpers must not be collapsed into plain `getErrorMessage`.
- JSON helpers are not first-batch safe because stable hashing, provider stringify, and secret-sanitized clone have different semantics.

## Next Batches

1. Replace remaining `isRecord` definitions in provider/parser modules where local `JsonRecord` aliases can be preserved cleanly.
2. Replace ordinary error helpers in provider runtime after confirming no redaction semantics are lost.
3. Move settings/share/viewer CSS into feature CSS files.
4. Convert high-use native buttons to `components/ui/Button`.
5. Extract `ModalShell` after checking focus-trap behavior in apply/settings/share dialogs.
6. Split `App.css` into a real `styles/app.css` aggregator once viewer import dependencies are explicit.

## Second Batch Plan

Goal:

- Continue structure migration with behavior-preserving changes only.
- Start reducing the previously deferred items where the semantic boundary is now clear.
- Keep each migration independently reversible and covered by the existing type/lint/test/build checks.

Scope:

- Provider/parser helpers:
  - migrate only `isRecord` helpers whose runtime semantics exactly match the shared guard;
  - keep or introduce a distinct `JsonRecord`-aware wrapper where provider parsing depends on that type alias;
  - do not touch sanitizing/redacting error paths unless the helper remains explicitly named for that purpose.
- Styles:
  - move the next isolated `App.css` sections into `styles/features/*`;
  - keep `App.css` as the import aggregator for this batch;
  - update tests that read CSS files directly.
- UI primitives:
  - replace only low-risk empty states or simple buttons where existing class names can be preserved;
  - defer modal shell extraction until all dialog behaviors are mapped.

Out of scope for this batch:

- Reworking provider request/response control flow.
- Changing agent behavior or tool-call logic.
- Visual redesign.
- Full `App.css` retirement.
- Modal focus-trap or keyboard behavior refactor.

## Validation Plan

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

## Execution Status

Completed:

- Created the first shared utility layer for text normalization, record guards, and plain error messages.
- Replaced first-batch duplicate helper implementations where semantics were behavior-identical.
- Added a small `components/ui` entry with `Button`, `StatusBadge`, and `EmptyState`.
- Moved Agent and Blueprints styles into feature CSS files while keeping `App.css` as the compatibility aggregator.
- Updated the Blueprints layout CSS test to read the new feature stylesheet.

Deferred intentionally:

- Provider/parser-local `isRecord` helpers that depend on `JsonRecord` aliases.
- Error helpers with sanitization/redaction semantics.
- Modal/focus-trap extraction.
- Further Settings, Share, Viewer, and canvas style migration.

Validation:

- Final verification pass completed successfully:
  - `npm run typecheck`
  - `npm run lint`
  - `npm test` with 34 test files passed, 3 skipped; 266 tests passed, 5 skipped
  - `npm run build`

## Second Batch Execution Status

Completed:

- Unified the remaining provider/parser `isRecord` runtime guards through `src/lib/guards.ts`.
- Kept local `JsonRecord` aliases in provider/parser files so protocol parsing types remain explicit.
- Left provider/runtime error extraction and sanitization chains unchanged in this batch.
- Split the next isolated style sections from `App.css`:
  - `styles/features/settings.css`
  - `styles/features/share.css`
  - `styles/features/viewer.css`
- Kept `App.css` as the compatibility import aggregator.
- Split the mixed `max-width: 960px` media rules so only top-level app rules remain in `App.css`.
- Started low-risk UI primitive adoption by replacing simple buttons in:
  - `components/share/MobileSharePanel.tsx`
  - `components/blueprints/BlueprintsPanel.tsx`

Deferred intentionally:

- Provider `errorMessage` to `getErrorMessage` replacement, because all call sites must be audited together with sanitizer boundaries.
- `isJsonRecord` extraction, because current `JsonRecord` aliases are type-only and do not need a new runtime abstraction yet.
- Right sidebar and inspector CSS migration, because shared avatar/list/form selectors need a separate split.
- Modal shell extraction and focus behavior normalization.
- Viewer list-item and inline-link button replacement.

Validation:

- Final verification completed successfully:
  - `npm run typecheck`
  - `npm run lint`
  - `npm test` with 34 test files passed, 3 skipped; 266 tests passed, 5 skipped
  - `npm run build`

## Third Batch Plan

Goal:

- Finish two previously deferred low-to-medium risk migrations:
  - unify provider/runtime plain error extraction through `src/lib/errors.ts`;
  - move right sidebar styles out of `App.css`.

Scope:

- Provider error helpers:
  - replace only local `errorMessage` helpers that are plain `Error.message` / `String(error)` extraction;
  - keep every existing `sanitizeMessage`, `createError`, and `sanitizeProviderError` path intact;
  - do not change provider error messages, retry behavior, status mapping, or redaction regexes.
- Right sidebar CSS:
  - split the mixed `.right-sidebar__brand-icon, .agent-message__avatar` rule into feature-owned rules;
  - move only `.right-sidebar*` selectors to `styles/features/right-sidebar.css`;
  - keep shared inspector/list/form CSS in `App.css`.

Validation plan:

- Provider-focused tests after error helper migration.
- RightSidebar component tests after CSS migration.
- Full `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.

## Third Batch Execution Status

Completed:

- Replaced provider/runtime local `errorMessage` helpers with `getErrorMessage` aliases from `src/lib/errors.ts`.
- Kept all provider sanitizer and redaction paths unchanged:
  - `sanitizeMessage`
  - `createError`
  - `sanitizeProviderError`
- Moved `.right-sidebar*` CSS rules into `styles/features/right-sidebar.css`.
- Split the prior `.right-sidebar__brand-icon, .agent-message__avatar` mixed selector into feature-owned avatar rules.
- Added `components/layout/RightSidebarLayout.test.ts` to guard right-sidebar CSS ownership and avatar base visual ownership.

Deferred intentionally:

- Provider finalization progress `detail.error` hardening, because it needs a separate semantic decision on progress metadata redaction.
- `isJsonRecord` runtime abstraction.
- Inspector CSS migration and shared `.field` / `.entity-list` / `.list-item` ownership.
- Modal shell extraction.

Validation:

- Final verification completed successfully:
  - targeted provider and right-sidebar tests: 5 test files passed, 61 tests passed
  - `npm run typecheck`
  - `npm run lint`
  - `npm test` with 35 test files passed, 3 skipped; 268 tests passed, 5 skipped
  - `npm run build`

## Fourth Batch Plan

Goal:

- Move inspector-owned styles out of `App.css` while preserving shared form/list styling for Inspector, Share, and Viewer.

Scope:

- Inspector feature styles:
  - move `.inspector-*` selectors to `styles/features/inspector.css`;
  - move Inspector-local layout helpers `.form-grid`, `.entity-list` / `.list` containers, `.entity-list__item.is-active`, and `.autocomplete*` into the inspector feature stylesheet;
  - move the mobile `.inspector-actions` media rule with the feature stylesheet.
- Shared UI styles:
  - move shared `.field`, `.field > span`, `.entity-list__item`, `.list-item`, and `.list-item` cursor rule into `styles/ui.css`;
  - do not put shared Viewer/Share styles under the Inspector feature.

Out of scope:

- Renaming generic classes to `ui-*`.
- Extracting React primitives for Field/List/Autocomplete.
- Changing Inspector component structure or behavior.

Validation plan:

- Add a CSS boundary test for Inspector style ownership.
- Run targeted CSS tests, typecheck, lint, full tests, and build.

## Fourth Batch Execution Status

Completed:

- Added `styles/features/inspector.css`.
- Moved Inspector-owned selectors out of `App.css`:
  - `.inspector-*`
  - `.form-grid`
  - `.entity-list` / `.list` containers
  - `.entity-list__item.is-active`
  - `.autocomplete*`
  - mobile `.inspector-actions` media rule
- Moved shared form/list base styles into `styles/ui.css`:
  - `.field`
  - `.field > span`
  - `.entity-list__item`
  - `.list-item`
- Kept Viewer and Share shared styling out of the Inspector feature stylesheet.
- Added `components/InspectorLayout.test.ts` to guard CSS ownership.

Deferred intentionally:

- Renaming generic classes to `ui-*`.
- Extracting React `Field`, `ListItem`, or `Autocomplete` primitives.
- Changing Inspector component structure.

Validation:

- Final verification completed successfully:
  - targeted CSS boundary tests: 3 test files passed, 5 tests passed
  - `npm run typecheck`
  - `npm run lint`
  - `npm test` with 36 test files passed, 3 skipped; 270 tests passed, 5 skipped
  - `npm run build`

## Fifth Batch Plan

Goal:

- Extract a shared `ModalShell` for real DOM modal/dialog surfaces without changing current modal behavior.

Scope:

- Create a headless `components/ui/ModalShell` that owns:
  - wrapper/backdrop/panel structure;
  - `role="dialog"` and `aria-modal`;
  - `aria-label` / `aria-labelledby` forwarding;
  - backdrop click close;
  - configurable Escape close;
  - configurable focus trap;
  - configurable initial focus selector;
  - close guard for busy/applying states;
  - non-portal rendering in this batch.
- Migrate only the three real modal surfaces:
  - settings modal in `App.tsx`;
  - `MobileSharePanel`;
  - `ApplyBlueprintDialog`.

Behavior boundaries:

- Settings modal:
  - keep backdrop and close button closing behavior;
  - keep no Escape close and no focus trap for this batch.
- Mobile share modal:
  - keep `open=false` returning `null`;
  - keep overlay click close and panel click stop behavior;
  - keep close button as `onClose`, not `onStop`;
  - keep no Escape close and no focus trap for this batch.
- Apply blueprint dialog:
  - keep backdrop/Escape cancel when not applying;
  - keep backdrop/Escape blocked while applying;
  - keep initial focus on cancel;
  - keep Tab/Shift+Tab focus loop;
  - keep Enter/Space on dialog root from applying.

Out of scope:

- Agent thread menu.
- Mobile viewer sheet.
- Tauri native open/save dialogs.
- Portal rendering.
- Changing modal visuals.
- Adding new accessibility behavior to settings/share beyond the existing behavior.

Validation plan:

- Add unit tests for `ModalShell`.
- Preserve and expand Apply Blueprint dialog behavior tests.
- Add Mobile Share modal shell behavior tests.
- Run targeted modal tests, typecheck, lint, full tests, and build.

## Fifth Batch Execution Status

Completed:

- Added headless `components/ui/ModalShell.tsx`.
- Added `components/ui/ModalShell.test.tsx` for:
  - backdrop close and panel click isolation;
  - `aria-label` / `aria-labelledby`;
  - configurable Escape close;
  - close-disabled guard;
  - initial focus;
  - Tab focus loop;
  - non-portal rendering.
- Migrated the three real DOM modal surfaces to `ModalShell`:
  - settings modal in `App.tsx`;
  - `MobileSharePanel`;
  - `ApplyBlueprintDialog`.
- Preserved behavior boundaries:
  - settings/share do not opt into Escape close or focus trap;
  - apply dialog keeps Escape/backdrop cancel, focus trap, initial cancel focus, and applying-state close guard.
- Added `components/share/MobileSharePanel.test.tsx`.
- Extended `BlueprintsPanel.test.tsx` for apply dialog ARIA, backdrop cancel, and applying-state Escape guard.

Deferred intentionally:

- Portal rendering.
- Adding new Escape/focus-trap behavior to settings/share.
- Agent thread menu and mobile viewer sheet.
- Native file dialogs.

Validation:

- Final verification completed successfully:
  - targeted modal tests: 3 test files passed, 25 tests passed
  - `npm run typecheck`
  - `npm run lint`
  - `npm test` with 38 test files passed, 3 skipped; 279 tests passed, 5 skipped
  - `npm run build`
