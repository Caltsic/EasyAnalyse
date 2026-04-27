# EasyAnalyse 决策记录

## 2026-04-26：蓝图与 Agent 核心产品决策

- 当前工作分支为 `agent`，所有相关改动推送到 `origin/agent`。
- 蓝图 sidecar 文件名使用：`原文件名.easyanalyse-blueprints.json`。
- 主 semantic v4 文档不得新增 `blueprints` 字段，避免破坏 schema 与格式边界。
- MVP 应用蓝图采用整文档替换主文件，不做 merge。
- 蓝图允许多个候选，未来 Agent 可以一次返回多个蓝图表示不同搭建思路。
- invalid/unknown/valid 蓝图都允许用户强确认后应用到内存主文档。
- schema/semantic 报错只作为参考提示，不阻止应用；因为 EasyAnalyse 面向用户和 AI 阅读辅助，不是仿真器。
- 保存主文档到磁盘仍走现有保存校验门禁；应用与保存是两个不同动作。
- Agent 修改蓝图时默认创建派生蓝图，不覆盖原蓝图。
- 蓝图状态不使用旧的 `draft | valid | invalid | applied | archived` 单字段模型；使用：
  - `lifecycleStatus: active | archived | deleted`
  - `validationState: unknown | valid | invalid`
  - `appliedInfo?: { appliedAt, appliedToMainDocumentHash, ... }`
  - `isCurrentMainDocument` 运行时 hash 计算，不落库。
- `appliedInfo` 表示历史上应用过，不表示当前主文档仍等于该蓝图。
- Canvas 预览优先拆 `CircuitCanvasRenderer` 纯渲染层；不能只靠 readOnly guard 造成隐性写路径。
- API key 首期存本机配置/secret store，不进入项目文件、主文档、sidecar、prompt 或普通导出设置。
- Provider 首期支持 OpenAI 格式、Anthropic 格式、DeepSeek preset；但这些属于 M5，M1/M2 不碰真实 Provider。

## 2026-04-26：自主施工策略

- 使用 fresh-context cronjob 长期推进，而不是一个无限上下文。
- 每轮只做一个小任务，必要时自动拆分。
- 大量读文件/写代码/跑脚本/验收必须派子代理。
- 每轮必须测试、提交、推送、更新 handoff、Telegram 汇报。
- 初始自动范围曾限制为 Milestone 1/2；2026-04-27 用户已纠正并明确要求自动完成所有规划任务，因此当前授权范围扩展为 M1-M5 顺序推进。
- 2026-04-27：用户提供该项目专用 DeepSeek API key，并授权真实 Provider 阶段优先接入 DeepSeek。明文 key 已存放在仓库外本机 secret 文件 `/home/ubuntu/.config/EasyAnalyse/secrets/deepseek_api_key`；仓库内只记录路径/引用，不记录密钥值。
- 2026-04-28：用户确认将自动施工从固定每 2 小时改为“每 30 分钟短周期轮询 + 仓库运行锁”模式。每轮开始检查 `automation/.autonomous_run.lock`，未过期则跳过，超过 6 小时按 stale lock 处理；目的是任务完成后更快进入下一轮且避免并发。
