# Governance Documentation Plan

Date: 2026-05-22

## Goal

Make project governance explicit and usable for contributors:

- README supports Chinese and English user-facing entry points.
- CONTRIBUTING supports Chinese and English.
- Branching uses trunk-based development.
- Commit messages follow one Conventional Commits style.
- Issues use structured bug, feature, and discussion templates with labels.
- Release flow is documented from version decision to GitHub Release.
- Maintainer and contributor permissions are separated clearly.
- Code of Conduct, MIT License, and Security Policy are present.

## Implementation Phases

1. Document inventory and plan: completed.
2. Multilingual README and CONTRIBUTING rewrite: completed.
3. Governance documents for branch policy, commits, issues, permissions, and releases: completed.
4. GitHub templates and label definitions: completed.
5. Code of Conduct, License, and Security Policy: completed.
6. Validation and final status: completed.

## Validation

- `git diff --check`: passed.
- `npm run verify` from `easyanalyse-desktop`: passed.

## Decisions

- `main` is the trunk. Short-lived branches are merged into `main` through PRs.
- `agent` is allowed only as a protected preview/integration mirror for agent work and must not become a long-lived divergent product branch.
- Commit format uses Conventional Commits: `type(scope): summary`.
- Required issue categories are `bug`, `feature`, and `discussion`.
- Maintainers can merge, release, manage labels, and change governance. Contributors propose work through issues and PRs.
