# EasyAnalyse Code Management Governance Plan

Date: 2026-05-21

## Goal

Move EasyAnalyse from ad hoc growth to explicit engineering governance before the codebase becomes hard to refactor.

## Research Inputs

External references:

- PyTorch: small PRs, design discussion before broad changes, layered lint/type/test gates, release criteria.
- Vite: strict TypeScript public-type hygiene, dependency restraint, CI split by typecheck/lint/unit/build/docs, SemVer release phases.
- Vue core: package boundaries, shared exports instead of deep imports, RFC for broad API changes, type declaration tests, scripted release.

Repository findings:

- Desktop is React/Vite/TypeScript with Tauri/Rust local backend.
- Android is a native Kotlin/Compose read-only viewer.
- No SQL database or remote backend exists yet.
- Production TypeScript has no obvious explicit `any`, but JSON/provider/Tauri boundaries use `unknown` and assertions.
- Styles are concentrated in `App.css`; shared component primitives are not yet formalized.
- Rust/Tauri commands often return `Result<_, String>`; Rust core already has typed errors.
- Logging is not unified.
- Encoding hygiene needs attention because some existing Chinese text appears garbled.

## Phase 1: Baseline Governance

Status: implemented in this pass.

- Add `docs/governance/code-management.md`.
- Add `docs/governance/release-policy.md`.
- Add root `CONTRIBUTING.md`.
- Add `.github/pull_request_template.md`.
- Add `.github/workflows/ci.yml`.
- Add `.editorconfig` and `.gitattributes`.
- Add desktop `typecheck` and `verify` scripts.
- Add ESLint `@typescript-eslint/no-explicit-any` as a hard rule.

## Phase 2: Frontend Structure Migration

Next.

- Split `App.css` into feature files.
- Introduce `components/ui` primitives.
- Extract repeated `safeText`, `compareText`, `isRecord`, `getErrorMessage`, clone helpers.
- Add type-aware ESLint once current code can pass it cleanly.
- Add optional format-check tooling.

## Phase 3: Local Backend Hardening

Next.

- Introduce typed Tauri error envelope for new commands.
- Keep Tauri commands thin and push business rules into `easyanalyse-core`.
- Add logging/tracing abstraction.
- Document Tauri command contracts.

## Phase 4: Future Data/API Layer

Only when needed.

- Add database migrations and repository layer before any SQL-backed feature.
- Require table/field docs and API docs.
- Use unified API prefix, response envelope, auth, permission, and global exception mapping.

## Acceptance Criteria

- New contributors can find code-management, contribution, and release rules.
- CI exists for desktop TypeScript/lint/test/build and Rust core tests.
- `any` is blocked by lint.
- Version bump rules are explicit.
- Backend/data/API rules are documented without pretending a SQL backend already exists.
