# EASYAnalyse

[中文用户指南](README.zh-CN.md) | [English User Guide](README.en-US.md)

[![CI](https://github.com/Caltsic/EasyAnalyse/actions/workflows/ci.yml/badge.svg)](https://github.com/Caltsic/EasyAnalyse/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/Caltsic/EasyAnalyse?label=release)](https://github.com/Caltsic/EasyAnalyse/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Caltsic/EasyAnalyse/total?label=downloads)](https://github.com/Caltsic/EasyAnalyse/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

![EASYAnalyse workspace](docs/assets/readme/en-US/01-main-workspace.png)

## 快速开始

### 1. 安装并启动

1. 打开 [GitHub Releases](https://github.com/Caltsic/EasyAnalyse/releases/latest)。
2. 下载 Windows 安装包 `EASYAnalyse.Desktop_<version>_x64-setup.exe`。
3. 安装并启动 EASYAnalyse Desktop。

### 2. 配置 AI Provider

1. 点击顶部工具栏的模型设置入口。
2. 选择 DeepSeek 预设，或添加 OpenAI-compatible Provider。
3. 填写 Base URL、模型名，并保存 API key。
4. 在 Agent 使用的模型下拉框中选择当前模型。

API key 会保存到本地 SecretStore，普通配置中只保存不可读引用。`Context` 勾选后会把当前电路 JSON 一起发给模型，适合让 Agent 检查或修改当前画布。

### 3. 使用 Agent 生成并应用蓝图

1. 打开右侧 Agent 面板。
2. 输入需求，例如：`帮我生成一个截止频率 5kHz 的一阶 RC 低通滤波器，并带仿真预览。`
3. 等待 Agent 调用工具并生成蓝图候选；工具调用记录默认可折叠查看。
4. 进入蓝图工作区，选择候选并查看预览、校验结果和说明。
5. 点击应用蓝图，将候选写入主画布。

生成过程中如果出现格式或显示诊断，Agent 分支的目标是把详细错误回传给模型继续修复，而不是直接终止为 Provider error。当前该能力仍处于 Preview。

## Quick Start

### 1. Install And Launch

1. Open [GitHub Releases](https://github.com/Caltsic/EasyAnalyse/releases/latest).
2. Download the Windows installer named `EASYAnalyse.Desktop_<version>_x64-setup.exe`.
3. Install and start EASYAnalyse Desktop.

### 2. Configure An AI Provider

1. Open model settings from the top toolbar.
2. Choose the DeepSeek preset or add an OpenAI-compatible Provider.
3. Fill in the Base URL, model names, and save the API key.
4. Select the active Agent model.

API keys are stored in the local SecretStore. Enabling `Context` sends the current circuit JSON with your message, which is useful when the Agent should inspect or modify the current canvas.

### 3. Generate And Apply A Blueprint

1. Open the right-side Agent panel.
2. Ask for a circuit, for example: `Generate a first-order RC low-pass filter with a 5 kHz cutoff and a simulation preview.`
3. Wait for the Agent to call tools and produce blueprint candidates. Tool-call details are available as collapsible records.
4. Open the blueprint workspace, then review the preview, validation result, and explanation.
5. Apply the selected blueprint to write it into the main canvas.

When a generated blueprint has format or display diagnostics, the Agent preview branch aims to send detailed diagnostics back to the model for repair instead of ending immediately as a Provider error. This behavior is still Preview.

## Documentation

- [中文用户指南](README.zh-CN.md): 安装、Provider 配置、Agent 蓝图生成、手动搭建、端子规则、校验、移动分享和开发环境。
- [English User Guide](README.en-US.md): installation, Provider setup, Agent blueprint generation, manual editing, terminal rules, validation, mobile sharing, and development.
- [Contributing](CONTRIBUTING.md): branch policy, issue rules, commit format, PR flow, release process, and maintainer/contributor responsibilities.
- [Security Policy](SECURITY.md): responsible disclosure and supported versions.
- [Agent Preview Status](docs/plans/2026-06-02-agent-live-blueprint-soft-validation-status.md): current Agent branch goal, completed work, pending work, debugging notes, and known issues.

## Development

```powershell
cd easyanalyse-desktop
npm install
npm run dev
npm run verify
npm run tauri:build
```

`main` follows trunk-based development. The `agent` branch is an experimental integration branch for Agent-related work before it is reviewed and promoted.
