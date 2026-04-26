# EasyAnalyse 自主施工交接

## 当前目标

在 `agent` 分支上落地 EasyAnalyse 桌面版蓝图系统，并在蓝图闭环稳定后再接入内置 Agent。

当前阶段只授权自动推进：

- Milestone 1：Blueprint Core
- Milestone 2：Blueprint UI 闭环

Milestone 3/4/5 暂不自动实施，除非 M1/M2 稳定或用户明确扩权。

## 最高优先文档

必须优先遵守：

1. `automation/autonomous_supervisor.md`
2. `docs/plans/2026-04-26-agent-blueprint-mvp-revision.md`
3. `docs/plans/2026-04-26-blueprint-milestone-1-2-file-level-implementation-plan.md`
4. `automation/decision_log.md`
5. `automation/task_queue.md`

旧规划如有冲突，以以上文件为准。

## 当前状态

- 当前分支：`agent`
- 当前远端：`origin/agent`
- 最近已知提交：`2088f21 docs: add blueprint file-level implementation plan`
- 当前任务：`M1-T2 Blueprint workspace 工具`
- 当前阻塞：无；但 `npm run build` 在 Linux 环境有既有 icon 脚本路径问题，M1-T1 已用 `npx tsc -b` + `npx vite build` 替代验证。

## 最近完成

- 已落盘完整自主施工控制层。
- 已把任务队列转成 Milestone 1/2 的可执行任务。
- 已记录关键产品决策与禁止事项。
- M1-T1 已完成：新增蓝图核心类型与 canonical hash 工具/测试。
  - `DOCUMENT_HASH_ALGORITHM = easyanalyse-document-canonical-sha256-v1`
  - hash 忽略 `document.updatedAt`，object key 稳定排序，array 顺序保留。
  - 测试覆盖 updatedAt 不变、语义/view 变化改变 hash、Node fallback、算法前缀。
  - 验证通过：`npm test`、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。


## 下一轮建议

执行 `M1-T2`：新增 Blueprint workspace 工具。

建议派子代理：

1. Implementer：阅读文件级施工图中 M1-T2，新增 workspace 创建/迁移/序列化/反序列化工具与测试。
2. Spec Reviewer：检查 lifecycleStatus/validationState/appliedInfo 是否符合新版规划。
3. Quality Reviewer：检查 invalid 未被写死为不可应用、sidecar wrapper schemaVersion 清晰、主文档格式未污染。

## 重要提醒

- 报错不阻止蓝图应用；应用确认只提示风险。
- 保存到磁盘仍走现有严格校验。
- 不要实现 Agent/Provider/API key，直到 M1/M2 完成。
- 不要把蓝图写进主 document。
- 不要使用旧的 `status='applied'` 模型。

## 自主施工 cronjob

- Job ID：`02e4bfaf3360`
- 名称：`EasyAnalyse Agent Branch Autonomous Builder`
- 频率：`every 2h`
- deliver：`origin`
- 每轮仍会主动发送 Telegram 开始/结束通知。
