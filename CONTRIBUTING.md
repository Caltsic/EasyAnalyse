# Contributing To EasyAnalyse

This repository contains the EasyAnalyse desktop app, a Tauri/Rust local backend, and a native Android viewer. Keep changes small, typed, and verifiable.

## Before Coding

- Use an issue or `docs/plans/` design note for broad changes.
- Keep one PR focused on one feature slice or one root cause.
- Avoid unrelated formatting or drive-by refactors.
- Read [docs/governance/code-management.md](docs/governance/code-management.md) for architecture and code management rules.

## Local Setup

Desktop:

```powershell
cd easyanalyse-desktop
npm ci
npm run dev
```

Validation:

```powershell
cd easyanalyse-desktop
npm run typecheck
npm run lint
npm test
npm run build
```

Rust core:

```powershell
cargo test --manifest-path easyanalyse-desktop/src-tauri/crates/easyanalyse-core/Cargo.toml
```

## TypeScript Rules

- Do not add `any` to production TypeScript.
- Use `unknown` plus runtime guards at provider, JSON, Tauri, and network boundaries.
- Put shared contracts in `src/types` or a clearly exported module.
- Add or update tests for parser, schema, provider, and agent-tool changes.

## UI Rules

- Reuse components before copying markup.
- Extract a component before the third duplicated use.
- Route user-visible strings through i18n unless they are code/protocol literals or proper nouns.
- Keep feature styles prefixed and move reusable values into CSS variables.

## Backend Rules

- Keep Rust business rules in `easyanalyse-core`.
- Keep Tauri command functions thin.
- New backend errors should be structured and mapped at command boundaries.
- Do not introduce SQL inline in controllers or UI code. Future SQL must live in migrations/repositories.

## Pull Request Checklist

- Scope is focused.
- Tests or explicit manual verification are included.
- `npm run typecheck`, `npm run lint`, `npm test`, and relevant builds pass.
- Public response/document/API changes update docs and examples.
- Screenshots are included for visible UI changes.
- Release impact is stated: patch, minor, major, or none.

## Release Policy

See [docs/governance/release-policy.md](docs/governance/release-policy.md).
