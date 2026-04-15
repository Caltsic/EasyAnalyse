# EASYAnalyse Desktop

这是 EASYAnalyse 的桌面编辑器，基于 `Tauri 2 + React + TypeScript + Rust`。

它负责：

- 打开和保存语义电路 JSON
- 在无限画布上编辑 device / terminal / network line
- 调用 Rust 核心完成归一化与校验
- 基于 terminal label 做网络聚焦与关系分析

仓库整体说明见上级目录 [README.md](../README.md)。

## 本地开发

```bash
npm install
npm run tauri:dev
```

## 常用命令

```bash
npm run build
npm run tauri:build
npm test
```
