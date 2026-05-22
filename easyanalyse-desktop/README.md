# EASYAnalyse Desktop

[中文](../README.zh-CN.md) | [English](../README.en-US.md)

Desktop editor for EASYAnalyse, built with `Tauri 2 + React + TypeScript + Rust`.

EASYAnalyse 桌面编辑器，基于 `Tauri 2 + React + TypeScript + Rust`。

## Responsibilities / 职责

- Open and save semantic circuit JSON.
- Edit devices, terminals, and network lines on the canvas.
- Run normalization and validation through the Rust core.
- Analyze network relations from terminal labels.
- Host the Agent panel and blueprint workspace.
- Generate read-only mobile snapshots.

## Development

```powershell
npm ci
npm run tauri:dev
```

## Validation

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Full desktop verification:

```powershell
npm run verify
npm run tauri:build
```

## Governance

Use the repository-level documents:

- [Contributing / 贡献指南](../CONTRIBUTING.md)
- [Code Management Standard](../docs/governance/code-management.md)
- [Release Policy](../docs/governance/release-policy.md)
- [Security Policy](../SECURITY.md)
