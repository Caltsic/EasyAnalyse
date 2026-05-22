# EASYAnalyse

Languages: [中文](README.zh-CN.md) | [English](README.en-US.md)

EASYAnalyse is a hardware circuit construction, review, and AI-assisted analysis workspace. It focuses on semantic circuit JSON rather than PCB layout or SPICE simulation: devices, terminals, network labels, parameters, and canvas layout are stored in a format that humans, software, and AI agents can read and validate.

EASYAnalyse 是一款面向硬件工程与 AI 协作的电路搭建、审阅和分析软件。它关注语义电路 JSON，而不是传统 PCB Layout 或 SPICE 仿真：器件、端子、网络标签、参数和画布布局都会保存为人、软件和 AI Agent 都能读取与校验的结构。

## What You Can Do

- Build semantic circuit diagrams for power, MCU, filters, op-amp blocks, interfaces, drivers, and mixed analog/digital modules.
- Ask the Agent to design blueprint candidates, inspect the current circuit, explain topology, or diagnose display and format problems.
- Keep generated circuits in the blueprint workspace before applying them to the main document.
- Validate whether JSON can be opened and rendered, while treating semantic issues as engineering hints rather than hard blockers.
- Share read-only mobile snapshots on the local network.
- Switch the app UI between Chinese and English.

## 用户可以做什么

- 搭建电源、MCU、滤波器、运放、接口、驱动和基础模拟/数字模块等语义电路图。
- 让 Agent 生成蓝图候选、检查当前电路、解释拓扑，或排查显示与格式问题。
- 在应用蓝图前，把 AI 生成的候选先保存在蓝图工作区中预览、校验和比较。
- 校验 JSON 是否能被打开和渲染，同时把语义 issue 作为工程提示而不是强制阻断。
- 在局域网内分享只读手机快照。
- 在中文和英文界面之间切换。

## Guides

- [中文用户指南](README.zh-CN.md)
- [English User Guide](README.en-US.md)
- [Contributing / 贡献指南](CONTRIBUTING.md)
- [Code Management Standard](docs/governance/code-management.md)
- [Release Policy](docs/governance/release-policy.md)
- [Branching and Permissions](docs/governance/branching-and-permissions.md)
- [Issue and Commit Policy](docs/governance/issue-and-commit-policy.md)
- [Security Policy](SECURITY.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)

## License

EASYAnalyse is released under the [MIT License](LICENSE).
