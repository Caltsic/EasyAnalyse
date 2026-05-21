# EasyAnalyse Code Management Standard

Date: 2026-05-21

## Purpose

EasyAnalyse is now large enough that feature velocity must be protected by engineering rules. This document defines the default code-management contract for desktop React/Vite, Tauri/Rust, Android, scripts, and any future service backend.

The reference projects used for this policy are PyTorch, Vite, and Vue core:

- PyTorch emphasizes small PRs, design discussion before broad changes, tests for risky changes, lint/type/test gates, and release criteria. Sources: [PyTorch contribution guide](https://docs.pytorch.org/docs/main/community/contribution_guide.html), [pytorch/CONTRIBUTING.md](https://github.com/pytorch/pytorch/blob/main/CONTRIBUTING.md), [pytorch/RELEASE.md](https://github.com/pytorch/pytorch/blob/main/RELEASE.md).
- Vite emphasizes dependency restraint, public type hygiene, CI split by lint/typecheck/unit/integration/docs, and SemVer release phases. Sources: [Vite contributing](https://github.com/vitejs/vite/blob/main/CONTRIBUTING.md), [Vite releases](https://vite.dev/releases), [Vite CI](https://github.com/vitejs/vite/blob/main/.github/workflows/ci.yml).
- Vue core emphasizes package boundaries, exported shared modules instead of deep relative imports, RFCs for broad API changes, type declaration tests, and scripted release flow. Sources: [Vue contributing](https://github.com/vuejs/core/blob/main/.github/contributing.md), [Vue release script](https://github.com/vuejs/core/blob/main/scripts/release.js).

## Current Repository Shape

EasyAnalyse is not a traditional frontend plus remote backend project.

- Desktop frontend: `easyanalyse-desktop/src`, React 19, Vite, TypeScript.
- Local backend: `easyanalyse-desktop/src-tauri`, Tauri commands plus Rust core crate.
- Mobile viewer: `easyanalyse-mobile-android`, Kotlin/Compose read-only Android viewer.
- Data today: semantic v4 JSON files, blueprint sidecar JSON, local settings, secret store, mobile snapshot JSON.
- No SQL database exists today. SQL governance below is a required standard for future project library, cloud sync, multi-user, or analytics services.

## Non-Negotiable Rules

### Pull Request Shape

- One PR addresses one root cause or one coherent feature slice.
- Large architecture, UI page rewrite, data model, provider protocol, or public format changes require a design note under `docs/plans/` before implementation.
- PRs must state validation commands. If no test was added, the PR must explain why.
- Pure formatting churn across unrelated files is not allowed.

### TypeScript

- Production TypeScript must not use `any`. Use `unknown` plus runtime guards at trust boundaries.
- Runtime JSON/provider/Tauri boundaries must have explicit parser or type guard functions.
- Public or cross-module data contracts live under `src/types` or a clearly named module export.
- Type assertions are allowed only at verified boundaries and should be local, not propagated through business logic.
- `npm run typecheck`, `npm run lint`, and `npm test` are required before merge.

### Frontend Components

- UI primitives that appear in more than two places must be extracted before the third copy.
- Reusable buttons, icon buttons, panels, dialogs, empty states, status badges, segmented controls, and form rows should live under `components/ui` once introduced.
- Feature components stay in feature folders such as `components/agent`, `components/blueprints`, `components/canvas`, `components/settings`.
- Components should receive typed props and emit typed callbacks; they should not import stores unless they are top-level feature containers.

### Styling

- Global resets and design tokens belong in `index.css`.
- Product layout and feature styles must be split out of the current monolithic `App.css` over time.
- New feature styles should use a feature prefix, for example `agent-*`, `blueprint-*`, `settings-*`.
- New colors, spacing, shadows, and typography should use CSS variables rather than one-off literals when reused.
- No hidden language mixing: user-visible text goes through the i18n layer unless it is a proper noun, protocol literal, or code token.

### Interfaces And Response Shapes

- Every agent/provider/tool response must use a discriminated union or a versioned envelope.
- New Tauri commands should return a structured response or structured error envelope; avoid plain `String` errors for new commands.
- External provider adapters must redact secrets in metadata, logs, exceptions, and tests.
- Mobile share HTTP endpoints stay under `/api/`; any future service API must use a single prefix such as `/api/v1`.

### Rust/Tauri Local Backend

- Business rules belong in `easyanalyse-core`, not in Tauri command glue.
- Tauri commands should be thin adapters: parse input, call core/service code, map result to response.
- New Rust errors should use typed errors (`thiserror`) and be mapped once at the command boundary.
- File and secret-store persistence is data access; keep it separate from semantic circuit validation and agent logic.
- Logging must be leveled. New backend code should prefer a logging/tracing abstraction over `println!` or `eprintln!`.

### Future SQL/Service Backend

When EasyAnalyse adds SQLite, cloud sync, accounts, or collaboration, these rules are mandatory from the first migration:

- Business services and data repositories are separate modules.
- SQL lives in migrations or repository files, not scattered inside controllers.
- Every table and column has a comment in migration/docs.
- APIs use one prefix, one auth pipeline, one permission model, one response envelope, and one error format.
- Global exception interception maps internal errors to public error codes.
- Logs are leveled and redact secrets by default.
- Interface documentation is generated or kept in sync with request/response schemas.

## Version Policy

EasyAnalyse uses SemVer-like release numbers with the project-specific interpretation below:

- Patch `x.y.z+1`: hotfixes, compatibility fixes, packaging fixes, small internal repairs, no behavior expansion.
- Minor `x.y+1.0`: small feature additions, new tools, new settings, additive protocol fields, non-breaking UX improvements.
- Major `x+1.0.0`: page-level redesign, document format break, storage migration requiring user action, provider protocol break, API/auth/data model break.

Agent-only releases may use tags such as `agent1.1.0`, but the same meaning applies.

## Quality Gates

Required locally before merge:

```powershell
cd easyanalyse-desktop
npm run typecheck
npm run lint
npm test
npm run build
```

Required for Rust core changes:

```powershell
cargo test --manifest-path easyanalyse-desktop/src-tauri/crates/easyanalyse-core/Cargo.toml
```

Required for release candidates:

- Desktop verification above.
- Rust core tests.
- Tauri build when desktop packaging changed.
- Android debug or release build when Android code changed.
- Changelog and release notes.

## Migration Roadmap

1. Add governance files, PR template, CI, editor config, typecheck/verify scripts.
2. Split `App.css` into feature styles and introduce shared UI primitives.
3. Extract shared utilities: `isRecord`, `safeText`, `compareText`, `getErrorMessage`, JSON clone helpers.
4. Introduce typed Tauri command result/error envelopes for new commands, then migrate old commands.
5. Add backend logging abstraction and replace ad hoc `console.error`/`eprintln!` in new code.
6. If a database is introduced, create migrations, repository layer, table/field docs, and API docs before feature code lands.
