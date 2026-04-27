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
- 最近已知提交：待本轮提交后回填
- 当前任务：`M2-T1 editorStore.applyBlueprintDocument`
- 当前阻塞：无。M1-T5 已通过 `npm test -- --run`、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。

## 最近完成

- 已落盘完整自主施工控制层。
- 已把任务队列转成 Milestone 1/2 的可执行任务。
- 已记录关键产品决策与禁止事项。
- M1-T1 已完成：新增蓝图核心类型与 canonical hash 工具/测试。
  - `DOCUMENT_HASH_ALGORITHM = easyanalyse-document-canonical-sha256-v1`
  - hash 忽略 `document.updatedAt`，object key 稳定排序，array 顺序保留。
  - 测试覆盖 updatedAt 不变、语义/view 变化改变 hash、Node fallback、算法前缀。
  - 验证通过：`npm test`、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
- M1-T2 已完成：新增 Blueprint workspace 工具与测试。
  - `blueprintWorkspaceVersion = '1.0.0'` wrapper 明确；支持 create/normalize/serialize/deserialize。
  - 支持 `active | archived | deleted` lifecycle 与 `unknown | valid | invalid` validationState。
  - `invalid` 可正常创建、归一化、序列化/反序列化；未写死为不可应用。
  - `appliedInfo` 仅作为历史信息；runtime `isCurrentMainDocument` 只按 hash 计算。
  - `createBlueprintFromDocument` 会深拷贝主文档形成蓝图快照，避免源对象后续 mutation 污染蓝图。
  - 验证通过：`npm test -- --run`、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
- M1-T3 已完成：新增 Tauri sidecar IO。
  - Rust commands：`get_blueprint_sidecar_path`、`load_blueprint_workspace_from_path`、`save_blueprint_workspace_to_path`。
  - TS wrappers：`getBlueprintSidecarPathCommand`、`loadBlueprintWorkspaceFromPath`、`saveBlueprintWorkspaceToPath`。
  - `loadBlueprintWorkspaceFromPath` 返回 `unknown | null`，避免把未归一化磁盘 JSON 过早信任为 `BlueprintWorkspaceFile`。
  - sidecar 缺失返回 `None/null`，损坏 JSON 返回可读 parse error，非 `.easyanalyse-blueprints.json` 路径拒绝 IO，保存使用 pretty JSON，不做 semantic v4 蓝图内容门禁。
  - 验证通过：`npm test -- --run`、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
  - 替代验证：Rust 单元测试已新增，但当前环境 `cargo: command not found`，未能执行 `cargo test`。
- M1-T4 已完成：新增 `blueprintStore` 与竞态安全测试。
  - `easyanalyse-desktop/src/store/blueprintStore.ts` 导出 `useBlueprintStore` / `BlueprintState`。
  - 支持 load/save workspace、未保存主文档 in-memory workspace、创建主文档快照、选择/归档/软删除、validateBlueprint、markApplied。
  - `blueprintStore.dirty` 与 `editorStore.dirty` 隔离；实现不 import `editorStore`。
  - sidecar 加载失败记录 `loadError` 并创建可继续使用的空 workspace；save/validation 错误分别记录 `saveError` / `validationError`。
  - invalid 校验只写 `validationState='invalid'` 与 report，不丢弃蓝图；没有 `status='applied'`。
  - 测试覆盖 async 竞态：overlapping load、save while mutating、validation stale result、concurrent createSnapshot lost update。
  - 验证通过：`npm test -- --run`、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。
- M1-T5 已完成：新增 M1 蓝图核心集成验收。
  - 新增 `easyanalyse-desktop/src/store/blueprintCoreIntegration.test.ts`。
  - `editorStore.openDocument` 在主文档打开后加载对应 sidecar workspace；`editorStore.newDocument` 初始化未保存文档空 workspace。
  - `blueprintStore.loadForMainDocument(null)` 改为创建全新空 workspace，避免新文档继承旧 sidecar 蓝图。
  - 覆盖：重新打开恢复蓝图列表、创建 manual snapshot 并保存 sidecar、主文档不出现 `blueprints`、dirty 隔离、损坏 sidecar 可恢复、normalized hash metadata、overlapping open stale result 防护。
  - Spec Reviewer：PASS；Quality Reviewer：APPROVED。
  - 验证通过：`npm test -- --run`、`npx tsc -b --pretty false`、`npm run lint`、`npx vite build`。

## 下一轮建议

执行 `M2-T1`：`editorStore.applyBlueprintDocument`。

建议派子代理：

1. Implementer：按 TDD 为 `editorStore.applyBlueprintDocument(document: DocumentFile)` 增加测试与实现，要求整文档替换、history 增加、future 清空、dirty=true、触发 validation，不写磁盘、不阻止 invalid。
2. Spec Reviewer：检查 M2-T1 是否满足应用后 undo/redo 可恢复、保存仍走现有门禁、应用阶段不阻止 invalid。
3. Quality Reviewer：检查 async validation stale token、history/future 语义、selection/pending/focus 状态清理，不要污染 blueprintStore。

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

## 最近任务提交

- M1-T1 任务提交：`c4a435d feat: add blueprint document hashing types`
- M1-T2 任务提交：`a343374 feat: add blueprint workspace utilities`
- M1-T3 任务提交：`633efde`
- M1-T3 handoff 更新提交：`ea75624`
- M1-T4 任务提交：`b1a984f`
- M1-T5 任务提交：待提交
