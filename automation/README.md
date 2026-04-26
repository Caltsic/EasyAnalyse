# EasyAnalyse 自主施工控制层

本目录用于让 Hermes/模型以“fresh context + 持久化状态”的方式长期推进 `agent` 分支上的 EasyAnalyse 桌面版蓝图/Agent 功能。

## 目标

把已规划的桌面版蓝图系统与内置 Agent 能力按里程碑逐步落地：

1. **Milestone 1：Blueprint Core** — 无 Agent、无 Provider，先证明主文档与蓝图 sidecar 隔离。
2. **Milestone 2：Blueprint UI 闭环** — 只读预览、校验提示、diff、强确认应用、undo/redo。
3. **Milestone 3：Settings + Secrets** — 成熟设置中心、主题、Provider/Model 配置骨架、密钥存储。
4. **Milestone 4：Agent Protocol + Mock Agent** — 先用 mock provider 验证协议和 UI。
5. **Milestone 5：真实 Provider** — OpenAI-compatible、DeepSeek preset、Anthropic adapter。

## 最高优先级规则

每轮自主施工必须优先阅读：

- `automation/autonomous_supervisor.md`
- `automation/autonomous_handoff.md`
- `automation/autonomous_state.json`
- `automation/task_queue.md`
- `automation/decision_log.md`
- `docs/plans/2026-04-26-agent-blueprint-mvp-revision.md`
- `docs/plans/2026-04-26-blueprint-milestone-1-2-file-level-implementation-plan.md`

如果其他规划文档与 MVP 修订或文件级施工图冲突，**以后两者为准**。

## 运行方式

Hermes cronjob 会定期启动一个全新 Agent。每轮只推进一个小任务闭环：

```text
读取状态 -> 选择下一任务 -> 派实现子代理 -> 派验收子代理 -> 修复 -> 测试 -> 提交推送 -> 更新 handoff -> Telegram 汇报
```

## 安全边界

允许自动修改和推送 `agent` 分支；禁止 merge/main/force push；禁止把 API key 写进仓库；禁止修改 `exchange.md` 核心语义；禁止将 invalid 蓝图改成不可应用。
