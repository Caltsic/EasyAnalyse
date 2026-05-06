# EasyAnalyse M1-M5 全面验收计划

> 分支：`agent`  
> 目标：对已完成的 M1-M5 全规划成果做发布前级别全面验收，找出遗漏、体验问题、数据安全问题、回归风险，并给出是否可进入 M6/发布准备的结论。  
> 原则：验收优先于继续开发；发现问题先分类、复现、定级，不立即大范围修复；所有大量文件读取、脚本运行、人工路径枚举优先分派子代理压缩回传。

## 0. 验收范围

### 已完成 Milestone

1. **M1 Blueprint Core**
   - 蓝图类型、canonical hash、workspace 工具、sidecar IO、blueprintStore。
2. **M2 Blueprint UI Loop**
   - 创建蓝图快照、sidecar 保存/加载、只读预览、校验、diff、应用、undo/redo。
3. **M3 Settings + Secrets**
   - 设置中心、主题、Provider/Model 配置骨架、SecretStore / API key 本机存储。
4. **M4 Agent Protocol + Mock Agent**
   - AgentResponse parser/schema、mock provider、Agent 面板基础流、候选蓝图入库。
5. **M5 Real Providers**
   - OpenAI-compatible / DeepSeek / Anthropic adapter、timeout/cancel/retry/context budget、真实 Provider 请求控制。

### 不在本轮范围

- 新增功能开发。
- 合并到 main。
- 修改 `exchange.md` / semantic v4 核心语义。
- 大量真实付费 API 压测。
- Android 端深度改造。

## 1. 验收方法总览

本次验收分 8 条独立检查线，并行派子代理执行。每个子代理只读或最小副作用；如需写临时文件，必须在 `/tmp` 或测试目录中完成，并在结论中说明。

| 编号 | 检查线 | 目标 | 主要输出 |
|---|---|---|---|
| A | 规划-实现覆盖矩阵 | 检查 M1-M5 任务是否都有实际代码/测试/文档对应 | 覆盖表、缺口列表 |
| B | 自动化测试与构建 | 跑完整测试、构建、lint、Rust test、Tauri build/启动 smoke | 命令结果、失败复现 |
| C | 蓝图数据安全与 UX | 深查 sidecar、Save/Save As、损坏 sidecar、dirty/undo、invalid apply | Critical/Warning 缺陷 |
| D | Canvas 只读预览与 UI 交互 | 检查预览是否可能改主文档、快捷键是否隔离、右侧面板体验 | 可复现 UI/逻辑问题 |
| E | Settings/Secrets 安全 | 检查 API key 不落仓库/主文档/sidecar/普通设置，SecretStore 异常路径 | 泄漏风险、异常路径 |
| F | Agent 协议与 Provider | 检查 AgentResponse、mock、OpenAI/DeepSeek/Anthropic adapter、取消/超时/上下文预算 | 协议/真实接入风险 |
| G | semantic v4 合规 | 检查 Agent/蓝图生成和保存流程是否尊重 exchange/schema 禁止字段与 label 语义 | 格式违规风险 |
| H | 安全/回归/维护性总审 | 跨模块代码质量、竞态、错误提示、自动化锁/cron 状态 | 最终阻塞项和建议 |

## 2. 子代理任务规格

### A. 规划-实现覆盖矩阵

**输入**：
- `automation/task_queue.md`
- `automation/autonomous_state.json`
- `automation/autonomous_handoff.md`
- `docs/plans/*.md`
- `easyanalyse-desktop/src/**`
- `easyanalyse-desktop/src-tauri/**`

**任务**：
- 将 M1-T1 到 M5-T4 每个任务映射到实际文件、测试文件、提交/功能证据。
- 找出“状态标记完成但实现/测试/文档证据不足”的条目。
- 检查旧规划冲突是否仍可能误导后续维护。

**输出格式**：
- PASS/FAIL
- 覆盖矩阵摘要
- 缺口列表，按 Critical / Important / Minor 分级。

### B. 自动化测试与构建

**命令**：
```bash
cd easyanalyse-desktop
npm test -- --run
npx tsc -b --pretty false
npm run lint
npx vite build
npm run tauri:build
cd src-tauri
cargo test
cd ../..
python3 automation/autonomous_lock_test.py
python3 -m py_compile automation/autonomous_lock.py ~/.hermes/scripts/easyanalyse_autonomous_preflight.py ~/.hermes/profiles/gpt-yolo/scripts/easyanalyse_autonomous_preflight.py
```

**可选 smoke**：
```bash
cd easyanalyse-desktop
timeout 20s xvfb-run -a src-tauri/target/release/easyanalyse-desktop
```

**输出格式**：
- 每条命令 exit code。
- 失败时给出首个根因、复现命令、是否已有已知解释。

### C. 蓝图数据安全与 UX

**重点路径**：
- 新建未保存主文档 → 创建蓝图 → 保存 workspace。
- 打开已有主文档 → 创建多个蓝图 → 保存/重载 sidecar。
- sidecar 损坏 → 打开主文档 → 尝试保存 workspace。
- Save As 后 sidecar 是否绑定新路径。
- 普通 Save 后 workspace mainDocument metadata 是否更新。
- dirty 主文档创建 snapshot base hash 是否当前。
- invalid/unknown/valid 蓝图是否都能强确认应用。
- apply 后 dirty/undo/redo/appliedInfo/isCurrentMainDocument 是否正确。

**输出格式**：
- 可复现步骤。
- 预期 vs 实际。
- 涉及文件/函数。
- 严重度。

### D. Canvas 只读预览与 UI 交互

**重点路径**：
- `CircuitCanvasRenderer` 是否纯渲染。
- `BlueprintPreviewCanvas` 是否不调用 editorStore mutation。
- Delete/Space/Ctrl+S/Ctrl+Z/拖拽/点击选择等在预览中是否修改主文档。
- Inspector / Agent / Blueprints tab 切换是否丢状态。
- 空状态、错误状态、加载状态是否可理解。

**输出格式**：
- PASS/FAIL
- 具体隐性写路径或 UX 痛点。

### E. Settings/Secrets 安全

**重点路径**：
- API key 不写 git tracked files。
- API key 不写主 `.easyanalyse` 文档。
- API key 不写 sidecar。
- 普通 app settings 只保存 `apiKeyRef`。
- Provider id 编辑只读。
- 替换 key 异常路径不删除新 key。
- metadata save 失败后 input 清空。
- DeepSeek 项目 key 文件 `/home/ubuntu/.config/EasyAnalyse/secrets/deepseek_api_key` 权限与引用方式。

**硬检查**：
- 对 git tracked files 搜索已知 DeepSeek key 明文。
- 检查 settings/secret 代码是否会 log key 或发到 Telegram。

### F. Agent 协议与 Provider

**重点路径**：
- `AgentResponse.schemaVersion` / `semanticVersion` 强制。
- 未知 kind / unknown schemaVersion / wrong semanticVersion 是否 reject。
- invalid candidate 是否可保留但带 issue。
- forbidden legacy fields scan 是否覆盖 wire/node/signalId 等。
- OpenAI-compatible / DeepSeek / Anthropic payload 映射是否正确。
- timeout/cancel/retry/context budget 是否不会重复扣费或污染蓝图。
- 首次上传当前文档是否有用户同意或明确控制。

### G. semantic v4 合规

**重点路径**：
- 主文档顶层没有 `blueprints`。
- sidecar wrapper 不被当作主 semantic 文档保存。
- Agent prompt / examples 强调 label 连通性、view 非真值、禁止 wire/junction/bend point。
- 蓝图应用到内存允许 invalid，但保存仍走现有门禁。
- provider / mock 示例输出 `schemaVersion: "4.0.0"`。

### H. 安全/回归/维护性总审

**重点路径**：
- 自动化 cron 当前是否暂停/无锁/不会误重启。
- 运行锁 owner-safe 是否仍有竞态。
- async store 是否存在 stale-result 覆盖、dirty 被错误清除、并发 save/load 丢更新。
- 错误提示是否可理解。
- 依赖/构建脚本跨平台。

## 3. 验收判定标准

### 必须修复后才能继续发布/合并的 Critical

- 数据丢失或写错文件：如 sidecar 错写、主文档被预览修改、undo 破坏。
- API key 泄漏到仓库/文档/日志。
- 主文档 schema 被污染。
- 自动化锁/cron 会导致并发写仓库。
- 核心测试/构建失败且非环境问题。
- 真实 Provider 会错误上传/重复请求/无法取消导致严重风险。

### 可进入后续优化的 Important

- UI 提示不清楚但不导致数据丢失。
- 某些边界状态需要手动刷新。
- provider 错误映射不够友好。
- 测试覆盖不足但实现逻辑看起来正确。

### 可记录为 backlog 的 Minor

- 文案、布局、细节交互、代码命名、文档小冲突。

## 4. 本轮主控执行顺序

1. 确认 git clean、cron paused/无锁。
2. 落盘本计划。
3. 派出 A-H 子代理，其中 B 可独立运行命令，C/D/E/F/G/H 以只读审查为主。
4. 汇总结果到 `docs/plans/2026-04-30-full-acceptance-report.md`。
5. 如有 Critical：不恢复自动化、不宣称可发布，先制定修复队列。
6. 如无 Critical：给出“可进入 M6 发布准备/人工体验验收”的结论，并建议下一步。

## 5. 当前状态备注

- M1-M5 状态文件显示 COMPLETE。
- 自动化 cron 已暂停，运行锁应为 absent。
- 最新已知提交：`262d9a1 chore: update autonomous handoff for m5 completion`。
