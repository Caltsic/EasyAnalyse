# EasyAnalyse Release Policy

Date: 2026-05-21

## Version Meaning

EasyAnalyse follows SemVer-style numbering with project-specific thresholds:

- Patch: hot update, crash fix, packaging repair, provider compatibility repair, typo/doc fix, no new user workflow.
- Minor: small feature, additive tool, additive document field, additive API endpoint, non-breaking UX improvement.
- Major: page-level redesign, storage migration, semantic document break, API/protocol break, permission/auth model change.

Examples:

- `1.1.1`: fixes a DeepSeek provider protocol bug or a packaging issue.
- `1.2.0`: adds a new agent read-only tool or a new blueprint panel action.
- `2.0.0`: rewrites the editor page layout, changes semantic JSON compatibility, or introduces account/cloud architecture.

Agent-only tags may use `agent1.1.0`. Main product tags should use `v1.1.0`.

## Branches

- `main`: stable product line.
- `agent`: active agent feature line.
- `release/*`: release stabilization branches when needed.
- `feat/*`, `fix/*`, `docs/*`: short-lived work branches.

## Release Checklist

1. Confirm scope and version bump.
2. Update these files when applicable:
   - `CHANGELOG.md`
   - `easyanalyse-desktop/package.json`
   - `easyanalyse-desktop/src-tauri/Cargo.toml`
   - `easyanalyse-desktop/src-tauri/tauri.conf.json`
   - `easyanalyse-desktop/src-tauri/crates/easyanalyse-core/Cargo.toml`
   - `easyanalyse-mobile-android/app/build.gradle.kts`
3. Run validation:
   - `npm run verify` from `easyanalyse-desktop`
   - Rust core `cargo test`
   - Android build when Android changed
   - Tauri build when packaging changed
4. Commit with a release commit message such as `chore: release v1.2.0`.
5. Tag:
   - Main product: `v1.2.0`
   - Agent-only: `agent1.2.0`
6. Push branch and tag.
7. Create GitHub Release with:
   - summary,
   - user-facing changes,
   - validation commands,
   - assets if packaged.

## Changelog Rules

- User-facing changes go in `CHANGELOG.md`.
- Internal-only refactors are listed only when they affect maintenance or stability.
- Breaking changes require a `Migration` section.
- Experimental features must be marked experimental and include stability expectations.

## Release Risk Rules

- Patch releases should be narrowly scoped.
- Minor releases can carry feature work but should not require user migration.
- Major releases need a design document and migration notes before implementation begins.
