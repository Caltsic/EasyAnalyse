# 2026-04-28 已知问题修复计划

## 背景

用户要求在恢复 EasyAnalyse 自动化推进前，对额外核查发现的所有已知问题进行规划、修复、审核和测试。自动化 cron 当前保持 paused，避免与本轮修复冲突。

## 修复范围

### A. 蓝图 sidecar / workspace 数据安全

1. Save As 后重新绑定蓝图 sidecar 到新主文档路径。
2. sidecar 加载失败后，禁止 Save workspace 静默覆盖损坏 sidecar。
3. 未保存主文档时，Save workspace 不应假装成功或清除 dirty。
4. 从 dirty 主文档创建蓝图快照时，`baseMainDocumentHash` 必须使用当前传入文档 hash。

### B. AgentResponse 协议安全

1. `semanticVersion` 必填。
2. 只接受 `easyanalyse-semantic-v4`。
3. Mock provider 使用同一 semantic version。
4. parser 对候选文档做最小 `view.canvas.units === 'px'` 检查，并以 issue 形式保留候选。

### C. Provider settings / secret 安全

1. 编辑已有 provider 时 provider id 只读。
2. 替换 API key 后旧 secret 删除失败时，不得删除已持久化的新 secret。
3. 提交失败或 metadata rejected 后清空明文 API key 输入。

### D. 自动化运行锁 owner-safe

1. lock payload 增加 `runId`。
2. acquire 输出 `runId=...`。
3. release 必须使用匹配 `--run-id`，默认禁止无 owner release。
4. stale reclaim 使用单独原子 reclaim mutex，避免多个 reclaimer 删除新锁。
5. preflight 输出 `EASYANALYSE_PREFLIGHT_RUN_ID`；若 acquired 但无 runId，fail closed。
6. 同步 live/profile preflight 脚本与 automation 文档、cron prompt。

## 执行顺序

1. 保持 cron paused，确认 lock absent。
2. 先修复代码和测试，不恢复 stash 中自动化 WIP。
3. 针对 A/B/C/D 分别补 regression tests。
4. 跑 targeted tests。
5. 派 Spec Reviewer 与 Quality Reviewer 复核。
6. 跑完整验证：`npm test -- --run`、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`、`cargo test`，以及 `automation/autonomous_lock.py` 自测。
7. 提交并推送修复。
8. 清理 stale lock，更新 cron prompt/script，恢复 cron。

## 非目标

- 不继续推进新 M4/M5 功能。
- 不恢复或应用 stash 中的 M4-T3 WIP，除非确认它是恢复自动化必须的一部分。
- 不修改 semantic v4 / exchange.md 核心语义。
