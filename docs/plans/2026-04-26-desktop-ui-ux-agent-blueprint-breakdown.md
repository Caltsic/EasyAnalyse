# EasyAnalyse 桌面 UI/UX 细化与可委派实施拆分

> **MVP 修订优先级说明（2026-04-26）**：最新施工顺序已压实为“先完成无 Agent 蓝图闭环，再接设置与 Agent”。若本文与 `docs/plans/2026-04-26-agent-blueprint-mvp-revision.md` 冲突，以后者为准。核心修订：invalid/有报错蓝图也允许用户强确认后应用到内存主文档；报错只提示，不作为应用门禁；`applied` 不再作为状态，改为 `appliedInfo` + runtime `isCurrentMainDocument`；Canvas 预览优先拆 `CircuitCanvasRenderer` 纯渲染层；API key 与普通设置分层。


> 本文补充主规划 `docs/plans/2026-04-26-agent-blueprint-plan.md`，聚焦成熟桌面软件体验：设置中心、夜间模式、Agent 面板、蓝图列表/预览/diff/应用确认，以及可逐任务交给子代理实施的阶段计划、验收标准和风险矩阵。

## 0. 当前代码结构观察

- `easyanalyse-desktop/src/App.tsx` 是顶层布局与快捷键入口：当前为顶部工具栏 + `workspace` 双栏布局，主区域渲染 `<CanvasView theme={theme} />`，右侧固定渲染 `<Inspector />`。
- `App.tsx` 已集中处理 `Ctrl/Cmd+N/O/S/Shift+S/Z/Y`、`Home/Ctrl+0`、`Space`、`Delete`、`Escape`。新增设置中心、Agent 面板与蓝图流程应复用该键盘入口，避免分散监听。
- `easyanalyse-desktop/src/App.css` 已有成熟的 panel/token 风格：`.topbar`、`.canvas-shell`、`.inspector-shell`、`.status-bar` 共享 `var(--panel)`、`var(--border)`、`var(--shadow)`；新增 Agent/Blueprint/Settings 组件应沿用这些类名模式或提炼通用面板样式。
- `easyanalyse-desktop/src/index.css` 已定义 CSS 变量与 `[data-theme='dark']` 暗色变量，当前暗色模式覆盖背景、面板、边框、文本、强调色、危险色、成功色和 canvas 背景。
- `easyanalyse-desktop/src/lib/theme.ts` 当前 `ThemeMode = 'light' | 'dark'`，通过 `localStorage easyanalyse.theme` 与 `documentElement.dataset.theme` 持久化/应用；成熟设置中心需要升级为 `'system' | 'light' | 'dark'`，并把设置来源从零散 localStorage 收敛到 App Settings。
- `easyanalyse-desktop/src/store/editorStore.ts` 是主文档权威来源，包含 `document/filePath/dirty/validationReport/selection/history/future/statusMessage` 和打开、保存、校验、编辑、撤销重做动作。应用蓝图应作为一次主文档替换动作进入此 store，而不是让 Agent 直接调用编辑动作。
- `easyanalyse-desktop/src/lib/tauri.ts` 目前仅封装文档打开/保存/校验和移动分享命令。设置、Provider 测试、Agent 请求、蓝图 sidecar 读写均应在此新增受控 wrapper。
- `CanvasView.tsx` 当前直接读取 `useEditorStore` 并执行拖拽/选择/移动/端子重排等写动作。蓝图预览若复用 Canvas，需要增加 `documentOverride`、`readOnly`、`selectionOverride` 或拆出只读渲染层，防止预览蓝图时误写主文档。
- `Inspector.tsx` 当前也直接读写 `editorStore`。MVP 不建议让 Inspector 编辑蓝图；蓝图预览时右侧可切换为 Agent/Blueprint 面板，不进入蓝图编辑态。

## 1. 信息架构 IA

### 1.1 顶层区域

1. **顶部工具栏 Topbar**
   - 文件操作：新建、打开、保存、另存为。
   - 校验与状态：重新校验、schema/semantic 状态 chip、dirty/saved 状态。
   - 视图/工具：主题入口应从“直接切换浅/深”升级为“设置/外观”；保留快速夜间模式按钮但由 App Settings 驱动。
   - Agent 入口：新增“Agent”按钮或右侧面板 tab；未配置模型时显示引导，不弹错误堆栈。
   - 设置入口：齿轮按钮“设置...”，菜单/快捷键可打开设置中心。

2. **主工作区 Workspace**
   - 左侧：Canvas 主画布，默认展示主文档；蓝图预览模式下展示蓝图只读画布并显示明显 banner：`正在预览蓝图，不会修改主文档`。
   - 右侧：从单一 Inspector 扩展为可切换面板 `Inspector | Agent | Blueprints`，建议新建 `RightSidebar` 管理 tabs。
   - 底部状态条：继续承载保存、校验、Agent 请求结果、蓝图保存结果等非阻塞反馈。

3. **设置中心 Settings Dialog**
   - Modal/dialog，而不是临时表单；左侧导航 + 右侧内容。
   - 导航项：基本配置、外观/夜间模式、供应商配置、模型配置。
   - 底部统一操作：保存、取消、应用、恢复默认；表单 dirty 时明确提示。

4. **确认/危险操作 Dialog**
   - `ApplyBlueprintDialog`：应用蓝图前必经。
   - `DeleteBlueprintDialog`：删除蓝图前确认，或提供撤销 toast。
   - `ProviderTestResultDialog` 可选；MVP 可内联显示。

### 1.2 右侧面板 IA

- **Inspector tab**：现有属性面板；仅编辑主文档。
- **Agent tab**：模型选择、上下文策略、对话流、快捷 prompt、发送/取消。
- **Blueprints tab**：蓝图列表、筛选/排序、选中蓝图详情、预览/校验/diff/应用。

建议 `Agent tab` 与 `Blueprints tab` 保持联动：Agent 返回蓝图后自动切到 Blueprints 或在 Agent 消息中嵌入“查看蓝图”按钮；Blueprints 选中项可作为 Agent 修改目标。

## 2. 设置中心 UI/UX 细化

### 2.1 基本配置

字段：
- 语言：跟随系统 / 简体中文 / English。现有 `editorStore.locale` 和 `lib/i18n` 可迁移到 App Settings；保存后即时影响 UI 文案。
- 蓝图 sidecar 自动保存：默认开启。关闭时，蓝图 store dirty 后在状态条与退出/打开文件前提示。
- 应用蓝图前强确认：默认开启；MVP 不建议允许完全关闭，只可选择“减少重复确认”，但 baseHash 冲突、invalid 蓝图、当前主文档 dirty 时仍必须确认。
- 未保存主文档的蓝图策略：内存暂存 / 保存主文档时询问是否写 sidecar。
- Agent 上下文策略默认值：发送完整文档 / 发送摘要 + 用户确认完整 JSON。

状态：
- 未保存更改：设置页顶部显示“有未保存设置”。
- 保存成功：inline success + 关闭时不再提醒。
- 保存失败：保留用户输入，显示错误原因和重试按钮。

### 2.2 外观 / 夜间模式

字段：
- 主题：跟随系统 / 浅色 / 深色。
- 强调色：MVP 可预留，不必实现完整自定义；先支持默认蓝色。
- Canvas 背景：跟随主题；深色时使用 `--canvas-bg`，网格线/器件线条需调用 `getCanvasTheme(theme)`。
- 动效：跟随系统减少动态效果；当前 CSS 已有 `prefers-reduced-motion`，新增 dialog/panel 动画也要遵守。

技术要求：
- 将 `ThemeMode` 扩展为 `ThemePreference = 'system' | 'light' | 'dark'` 与 `ResolvedTheme = 'light' | 'dark'`。
- `applyTheme` 只接收 resolved theme；监听 `matchMedia('(prefers-color-scheme: dark)')`，当 preference 为 `system` 时自动更新。
- 兼容现有 `easyanalyse.theme` localStorage：首次迁移到 App Settings 后可继续读取旧值作为默认。

验收关注：
- 深色模式即时生效，刷新/重启后保持。
- Modal、右侧面板、表单、状态 chip、validation issue、Agent 消息、Blueprint 卡片均无浅色残留。
- 不只用红/绿表达状态：valid/invalid 同时使用图标、文字、issue 数。

### 2.3 供应商配置

供应商列表卡片字段：
- 名称、类型、启用状态、默认 base URL、请求格式、默认模型、API key 状态（未设置/已设置 masked）、最近测试结果。
- 内置 preset：OpenAI、Anthropic、DeepSeek、自定义 OpenAI-compatible。

编辑表单字段：
- Provider 名称。
- 类型：OpenAI / Anthropic / DeepSeek / OpenAI-compatible / Custom。
- Base URL：DeepSeek 预填 `https://api.deepseek.com/v1`；OpenAI 预填 `https://api.openai.com/v1`；Anthropic 预填 `https://api.anthropic.com`。
- Request format：OpenAI Chat Completions / Anthropic Messages；DeepSeek 锁定或默认 OpenAI-compatible。
- API key：masked 输入、显示/隐藏、复制禁止可选、删除密钥。
- Timeout ms：默认 60s，可配置。
- 测试连接：发送最小请求，不上传当前电路；显示 HTTP、认证、模型不存在、协议不匹配等可读错误。

安全文案：
- “API key 不会写入主文档或蓝图 sidecar。”
- “Agent 请求可能会把当前文档或蓝图发送到所选供应商。”
- “请勿把敏感电路发送给不可信 Provider。”

### 2.4 模型配置

模型列表：
- 按 Provider 分组。
- 字段：显示名、模型 ID、context window、max output tokens、temperature、topP、supportsJsonMode。
- 默认模型：全局默认 + 为未来扩展预留“创建蓝图/修改蓝图/解释检查”任务默认模型。

空状态：
- 未启用 provider：提示先配置供应商，按钮跳转供应商页。
- provider 已启用但无模型：显示常用模型模板按钮。

错误状态：
- 默认模型引用失效：设置页顶部显示“默认模型不存在”，Agent 面板禁用发送并提供修复入口。

## 3. Agent 面板 UI/UX 细化

### 3.1 布局

Agent 面板建议分三段：
1. 顶部状态区：当前 Provider/Model、上下文策略、设置快捷入口、连接状态。
2. 对话区：用户消息、Agent 文本回复、蓝图生成结果卡片、错误/重试消息。
3. 输入区：prompt textarea、快捷 prompt chips、发送/取消按钮、是否包含当前主文档/选中蓝图的开关。

### 3.2 关键状态

- **未配置模型**：显示引导卡片“配置模型后使用 Agent 创建/修改蓝图”，按钮打开设置中心模型页。
- **配置无效**：显示 provider/model 缺失、API key 缺失、最近测试失败原因。
- **空对话**：显示能力说明和快捷 prompt：生成 3 个改进方案、创建 RC 低通、解释蓝图区别、修复校验问题。
- **请求中**：输入区禁用，显示 spinner、请求可取消；不允许重复发送污染状态。
- **返回蓝图**：消息中显示 `已创建 N 个蓝图`，并在蓝图列表新增卡片；部分 invalid 时明确显示。
- **格式错误**：不写入蓝图列表；显示“模型返回格式无法解析”，提供“复制原始响应/重试/让 Agent 修复一次”。
- **网络/鉴权错误**：显示可读错误，不吞掉用户 prompt。

### 3.3 Agent 行为边界

- Agent 永远只写 `blueprintStore`，不直接修改 `editorStore.document`。
- 修改蓝图默认创建派生蓝图，父蓝图保留。
- 对 invalid 蓝图可提供“让 Agent 修复”快捷 prompt，但应用按钮 disabled。
- Agent request 必须包含 semantic v4 硬约束，禁止 wires/nodes/junctions/signals/signalId。

## 4. 蓝图列表、预览、Diff、应用确认

### 4.1 蓝图列表

每张蓝图卡片：
- 标题、摘要、状态 chip：draft/valid/invalid/applied/archived。
- issue 数：`0 issue` / `3 issues`，点击展开校验报告。
- 元数据：创建/更新时间、来源、模型、baseHash 是否匹配当前主文档。
- 快捷操作：预览、校验、重命名、复制、派生修改、删除、应用。

列表状态：
- 空状态：`还没有蓝图`，提供“从当前文档创建蓝图快照”和“打开 Agent 生成蓝图”。
- 加载：打开主文件后加载 sidecar 时 skeleton。
- sidecar 读取失败：显示错误，提供重试、忽略并新建工作区、查看文件路径。
- dirty 未保存：列表顶部显示“蓝图工作区有未保存更改”。
- 筛选：MVP 可先提供全部/可应用/有问题/已应用。

### 4.2 只读预览

MVP 推荐改造 `CanvasView`：
```tsx
<CanvasView theme={theme} documentOverride={activeBlueprint.document} readOnly previewLabel="蓝图预览" />
```

必需行为：
- `readOnly` 下禁用：设备拖拽、端子重排、网络线移动、框选修改 selection、pending device placement。
- 允许：平移、缩放、聚焦、只读 hover、高亮 connection。
- Canvas header 显示“蓝图预览”与“返回主文档”。
- Inspector 不显示蓝图编辑表单；蓝图详情由 `BlueprintPanel` 展示。

若改造风险过大，可第二选择：抽出 `CircuitCanvasRenderer` 纯渲染组件，`CanvasView` 继续负责主文档交互，`BlueprintPreviewCanvas` 只传 document。

### 4.3 Diff 设计

MVP diff 为摘要 diff，不做 merge：
- 文档标题变化。
- device 数增删改：新增 device references、删除 device references、kind/reference/name 变化。
- terminal 数变化、label/net 集合变化。
- view networkLines 数变化。
- validation 状态与 issue count。
- baseHash 是否匹配当前主文档 hash。

后续结构化 diff：
- 左右 JSON diff 或树 diff。
- 按 device/terminal/network label 分组。
- 忽略 `document.updatedAt` 等 normalize 时间字段。

### 4.4 应用确认

`ApplyBlueprintDialog` 内容：
- 标题：`应用蓝图「xxx」？`
- 强警告：`应用后会用该蓝图整文档替换当前主文档；当前未保存修改可能被覆盖。`
- 可撤销说明：若实现 undo，写“可使用撤销返回”；否则写“请先保存当前文件或另存备份”。
- 摘要 diff：device/terminal/net/validation/baseHash。
- 风险提示：若当前主文档 dirty 或 baseHash 不匹配，显示二级警告，并要求勾选“我理解会替换当前主文档”。
- 按钮：取消、预览 diff、应用蓝图。invalid 蓝图按钮 disabled。

应用后：
- 调用 `editorStore.replaceDocumentFromBlueprint(document, { dirty: true, pushHistory: true })`。
- 清空 selection/pending placement/focus。
- 触发 validation。
- 蓝图状态标记 `applied`，保存 sidecar。
- 状态条显示“已应用蓝图 xxx，主文档有未保存更改”。

## 5. 可访问性、快捷键与菜单

### 5.1 可访问性

- 所有图标按钮必须有 `aria-label`；tab 使用 `role="tablist"/"tab"/"tabpanel"` 或等效语义。
- Dialog 打开后 focus trap，Esc 关闭非危险 dialog；危险确认 Esc 只取消。
- 表单错误需关联 `aria-describedby`，Provider 测试结果用 `role="status"` 或 `role="alert"`。
- 状态不只依赖颜色：valid/invalid/draft/applied 同时显示文字、图标、issue 数。
- 键盘可完成：打开设置、切换右侧 tab、选择蓝图、预览、打开确认、取消。
- 对 `prefers-reduced-motion` 保持尊重，新增动画可禁用。

### 5.2 快捷键

现有快捷键保留：
- `Ctrl/Cmd+N/O/S/Shift+S/Z/Y`、`Home/Ctrl+0`、`Space`、`Delete`、`Esc`。

新增建议：
- `Ctrl/Cmd+,`：打开设置中心。
- `Ctrl/Cmd+.`：切换/聚焦 Agent 面板。
- `Ctrl/Cmd+B`：切换 Blueprints 面板。
- `Ctrl/Cmd+Shift+P`：预留命令面板，MVP 可不做。
- Agent 输入框中：`Enter` 发送、`Shift+Enter` 换行；请求中 `Esc` 取消请求。
- 蓝图列表中：`Enter` 预览，`Delete` 删除需确认，`A` 应用需确认（仅列表聚焦且非输入目标）。

### 5.3 菜单

Tauri 桌面菜单建议后续补充：
- File：New/Open/Save/Save As。
- Edit：Undo/Redo/Delete。
- View：Light/Dark/System Theme、Reset View、Inspector/Agent/Blueprints。
- Tools：Validate、Settings、Test Provider。
- Agent：Create Blueprints、Modify Selected Blueprint、Clear Conversation。

MVP 可先在 React topbar 实现入口，后续接 Tauri menu。

## 6. 设置持久化与数据边界

### 6.1 App Settings

建议新增：
```ts
interface AppSettings {
  version: '1.0.0'
  general: {
    language: 'system' | 'zh-CN' | 'en-US'
    autosaveBlueprintWorkspace: boolean
    confirmBeforeApplyBlueprint: boolean
    unsavedBlueprintStrategy: 'memory' | 'ask-on-save-main'
  }
  appearance: {
    theme: 'system' | 'light' | 'dark'
    accentColor?: string
  }
  agent: {
    providers: AgentProviderConfig[]
    models: AgentModelConfig[]
    activeProviderId?: string
    activeModelId?: string
    sendFullDocumentByDefault: boolean
  }
}
```

### 6.2 存储规则

- App Settings 存 Tauri app config/app data，不存项目目录。
- API key 不写主文档、不写 sidecar；若暂不接 OS keychain，则存本机应用配置 secrets 区并在 UI 明确说明。
- 蓝图 workspace 存 `原文件名.easyanalyse-blueprints.json` sidecar，只包含蓝图元数据、文档、validation report、模型 id/name，不包含 API key。
- 主 `DocumentFile` 顶层不增加 `blueprints` 字段。
- 启动时 migration：读取旧 `easyanalyse.theme`、`easyanalyse.locale` 作为默认设置，保存后统一由 settings 驱动。

## 7. 分阶段实施任务清单（适合逐项交给子代理）

### Phase A：设置基础与主题迁移

#### Task A1：定义 App Settings 类型与默认值
- 目标：建立 settings 类型、默认值、migration skeleton。
- 涉及文件：新增 `src/types/settings.ts`、`src/lib/settingsDefaults.ts`、`src/lib/settingsDefaults.test.ts`。
- 验收：默认包含 general/appearance/agent；DeepSeek/OpenAI/Anthropic presets 可生成；旧 theme/locale localStorage 可迁移为初始值。
- 测试：`npm test -- settingsDefaults`；TypeScript 编译通过。

#### Task A2：Tauri settings 读写命令
- 目标：实现 `load_app_settings`、`save_app_settings`。
- 涉及文件：修改 `src-tauri/src/commands.rs`、`src-tauri/src/main.rs`、`src/lib/tauri.ts`。
- 验收：设置写入 app config/app data；不写项目目录；损坏配置返回可读错误并可恢复默认。
- 测试：Rust 单测覆盖配置路径/默认写入；前端 mock invoke 单测可选。

#### Task A3：settingsStore
- 目标：新增 Zustand store 管理 settings loading/saving/dirty/error。
- 涉及文件：新增 `src/store/settingsStore.ts`，修改 `src/App.tsx` 初始化流程。
- 验收：启动加载设置；保存/取消状态正确；保存失败不丢表单草稿。
- 测试：store 单测覆盖 load/save/update/reset。

#### Task A4：主题 system/light/dark 改造
- 目标：从当前二态 `ThemeMode` 升级为设置驱动三态 preference。
- 涉及文件：修改 `src/lib/theme.ts`、`src/lib/useTheme.ts`、`src/App.tsx`、`src/lib/canvasTheme.ts` 类型引用。
- 验收：跟随系统、浅色、深色均生效；系统主题变化时自动更新；旧 localStorage 兼容。
- 测试：theme 工具函数单测；手工切换 OS/mock matchMedia。

### Phase B：设置中心 UI

#### Task B1：SettingsDialog shell
- 目标：实现成熟设置中心外壳、导航、保存/取消/应用。
- 涉及文件：新增 `src/components/SettingsDialog.tsx`，修改 `src/App.tsx`，补充 `src/App.css` 或 `src/components/settings/*.css`。
- 验收：Topbar 齿轮与 `Ctrl/Cmd+,` 可打开；focus trap；Esc 关闭；dirty 提示。
- 测试：React 组件测试如项目已有测试基建则覆盖；否则人工验收 + build。

#### Task B2：基本配置 Pane
- 目标：语言、蓝图自动保存、确认策略、上下文默认策略。
- 涉及文件：新增 `src/components/settings/GeneralSettingsPane.tsx`，修改 `settingsStore`。
- 验收：修改语言后 UI 即时或保存后切换；取消能回滚；无效状态有提示。
- 测试：store 更新单测；手工切换语言。

#### Task B3：外观 Pane
- 目标：主题选择与夜间模式即时生效。
- 涉及文件：新增 `src/components/settings/AppearanceSettingsPane.tsx`，修改 theme hook 连接 settingsStore。
- 验收：system/light/dark radio/select 工作；深色下 SettingsDialog 自身无浅色残留。
- 测试：theme 单测 + visual smoke。

#### Task B4：供应商 Pane
- 目标：Provider 列表、编辑、API key masked、测试连接入口。
- 涉及文件：新增 `src/types/agent.ts`、`src/components/settings/ProviderSettingsPane.tsx`、修改 `src/lib/tauri.ts`。
- 验收：OpenAI/Anthropic/DeepSeek/custom 可新增/启用/禁用；API key 不出现在主文档/sidecar；测试错误可读。
- 测试：provider config validation 单测；mock `test_agent_provider`。

#### Task B5：模型 Pane
- 目标：模型按 provider 分组、新增/编辑、默认 Agent 模型。
- 涉及文件：新增 `src/components/settings/ModelSettingsPane.tsx`，修改 `src/store/settingsStore.ts`。
- 验收：默认模型引用有效；删除 provider/model 时给出依赖提示；Agent 面板能读取 active model。
- 测试：模型引用校验单测。

### Phase C：蓝图数据与 sidecar

#### Task C1：蓝图类型与 wrapper parse
- 目标：定义 `BlueprintWorkspaceFile`、`BlueprintRecord`、状态机类型。
- 涉及文件：新增 `src/types/blueprint.ts`、`src/lib/blueprintWorkspace.ts`、测试文件。
- 验收：wrapper version 校验；invalid 草稿可保存；不允许 API key 字段。
- 测试：parse/serialize/migration 单测。

#### Task C2：document hash 与 summary diff 工具
- 目标：稳定 hash、摘要统计、忽略 `document.updatedAt`。
- 涉及文件：新增 `src/lib/documentHash.ts`、`src/lib/documentSummary.ts`、测试文件。
- 验收：同内容不同 key 顺序 hash 一致；updatedAt 变化 hash 不变；device/terminal/net 统计正确。
- 测试：Vitest 覆盖示例 JSON。

#### Task C3：blueprintStore skeleton
- 目标：内存创建/选择/重命名/删除/dirty 状态。
- 涉及文件：新增 `src/store/blueprintStore.ts`。
- 验收：可从当前主文档创建蓝图快照；选择与删除不影响主文档。
- 测试：Zustand store 单测。

#### Task C4：sidecar Tauri 命令
- 目标：按主文件路径读写 `原文件名.easyanalyse-blueprints.json`。
- 涉及文件：修改 `src-tauri/src/commands.rs`、`src-tauri/src/main.rs`、`src/lib/tauri.ts`。
- 验收：打开主文档加载 sidecar；保存 sidecar 不改主 JSON；路径由后端推导。
- 测试：Rust 临时目录读写单测。

#### Task C5：App 生命周期接入
- 目标：打开/另存为/新建时处理蓝图 workspace。
- 涉及文件：修改 `src/App.tsx`、`src/store/editorStore.ts`、`src/store/blueprintStore.ts`。
- 验收：重新打开主文档蓝图恢复；未保存主文档蓝图内存暂存；另存为提示迁移 sidecar。
- 测试：store 集成单测；手工打开/保存回归。

### Phase D：右侧面板、蓝图 UI 与预览

#### Task D1：RightSidebar tabs
- 目标：把右侧从固定 Inspector 改为 `Inspector | Agent | Blueprints` tabs。
- 涉及文件：新增 `src/components/RightSidebar.tsx`，修改 `src/App.tsx`、`src/App.css`。
- 验收：默认 Inspector；快捷键可切换；窄屏布局不崩。
- 测试：build + 手工 keyboard smoke。

#### Task D2：BlueprintPanel/List
- 目标：蓝图列表卡片、空状态、错误状态、基础操作。
- 涉及文件：新增 `src/components/blueprints/BlueprintPanel.tsx`、`BlueprintList.tsx`、`BlueprintCard.tsx`。
- 验收：展示标题/摘要/状态/issue/model/time；可选择/重命名/删除；空状态有 CTA。
- 测试：组件纯函数/状态测试；手工创建蓝图。

#### Task D3：CanvasView readOnly/documentOverride
- 目标：支持只读蓝图预览。
- 涉及文件：修改 `src/components/CanvasView.tsx`，可新增 `src/components/blueprints/BlueprintPreviewBanner.tsx`。
- 验收：预览时不调用主文档 move/update/place/delete；仍可 pan/zoom；清晰显示预览状态。
- 测试：人工拖拽验证主 `editorStore.document` hash 不变；可补单测抽出交互 guard。

#### Task D4：蓝图详情与校验报告
- 目标：显示 rationale/tradeoffs/validation issues。
- 涉及文件：新增 `src/components/blueprints/BlueprintDetails.tsx`、`ValidationIssueList.tsx`。
- 验收：issue 按 schema/semantic 分组；invalid 状态明确；可复制 issue 给 Agent。
- 测试：issue render snapshot/单测。

### Phase E：蓝图校验、diff、应用

#### Task E1：validate_blueprint_document wrapper
- 目标：复用 Rust core 校验蓝图内部 DocumentFile。
- 涉及文件：修改 `src-tauri/src/commands.rs`、`src/lib/tauri.ts`、`src/store/blueprintStore.ts`。
- 验收：valid -> 可应用；invalid -> 显示 issue 且禁用应用。
- 测试：用 `testJson` valid/invalid 样例校验。

#### Task E2：摘要 diff 工具与 UI
- 目标：生成主文档 vs 蓝图摘要 diff。
- 涉及文件：新增 `src/lib/documentDiffSummary.ts`、`src/components/blueprints/BlueprintDiffSummary.tsx`。
- 验收：显示 device/terminal/net 增删改统计；baseHash mismatch 警告。
- 测试：diff 工具单测。

#### Task E3：ApplyBlueprintDialog
- 目标：应用前确认与风险提示。
- 涉及文件：新增 `src/components/blueprints/ApplyBlueprintDialog.tsx`，修改 `BlueprintPanel`。
- 验收：invalid 无法应用；dirty/baseHash mismatch 必须额外确认；取消无副作用。
- 测试：组件行为测试或手工验收。

#### Task E4：editorStore 替换动作
- 目标：蓝图整文档替换主文档，进入 undo history。
- 涉及文件：修改 `src/store/editorStore.ts`，修改 `blueprintStore.applyBlueprint`。
- 验收：应用后 dirty=true、selection/focus/pending 清空、validation 重新运行、undo 可回到之前主文档。
- 测试：store 单测覆盖 apply/undo。

### Phase F：Agent MVP

#### Task F1：Agent prompt 与 response schema
- 目标：生成强约束 prompt 与结构化 JSON parser。
- 涉及文件：新增 `src/lib/agentPrompt.ts`、`src/lib/agentResponseSchema.ts`、测试文件。
- 验收：prompt 包含 semantic v4 禁止项；非 JSON/旧格式拒绝入库。
- 测试：parser 单测覆盖 blueprints/error/question/message。

#### Task F2：send_agent_request 与 provider adapter
- 目标：Rust 或受控 Tauri 命令适配 OpenAI/Anthropic/DeepSeek。
- 涉及文件：修改 `src-tauri/src/commands.rs`，可能新增 Rust module；修改 `src/lib/tauri.ts`。
- 验收：测试连接不上传文档；Agent 请求统一超时/错误；DeepSeek 走 OpenAI-compatible。
- 测试：adapter payload 单测；mock HTTP。

#### Task F3：agentStore
- 目标：对话、running、cancel、错误、active model 状态。
- 涉及文件：新增 `src/store/agentStore.ts`。
- 验收：未配置模型时禁用发送；请求中可取消；失败保留 prompt。
- 测试：store 单测。

#### Task F4：AgentPanel UI
- 目标：对话界面、快捷 prompt、上下文开关、设置入口。
- 涉及文件：新增 `src/components/agent/AgentPanel.tsx`、`AgentMessageList.tsx`、`AgentPromptBox.tsx`。
- 验收：可用 mock provider 生成多个蓝图并入列表；错误不污染列表。
- 测试：mock agent response 集成测试。

#### Task F5：Agent 修改蓝图为派生蓝图
- 目标：选中蓝图后基于其 document 生成修改版，默认派生。
- 涉及文件：修改 `agentPrompt.ts`、`agentStore.ts`、`blueprintStore.ts`、`AgentPanel.tsx`。
- 验收：原蓝图不变；派生蓝图有 `parentBlueprintId`；自动校验。
- 测试：store + parser 集成测试。

### Phase G：回归、文档与打磨

#### Task G1：端到端验收脚本/清单
- 目标：建立手工回归清单与 mock 数据。
- 涉及文件：新增 `docs/testing/agent-blueprint-regression.md`。
- 验收：覆盖设置、深色、provider 测试、蓝图创建、预览、应用、undo。
- 测试：执行 `npm test`、`npm run build`；Rust 可用时执行 `cargo test`。

#### Task G2：文档更新
- 目标：README 增加 Agent/蓝图/设置说明。
- 涉及文件：修改 `easyanalyse-desktop/README.md`、可选根 README。
- 验收：用户能知道 API key 存储、数据上传、蓝图 sidecar 文件位置。
- 测试：文档链接检查。

## 8. 全局验收标准

- 设置中心具备四大页：基本配置、外观/夜间模式、供应商配置、模型配置。
- 夜间模式支持 system/light/dark，保存后即时生效且持久化。
- Provider 支持 OpenAI、Anthropic、DeepSeek、自定义 OpenAI-compatible；API key 不写入主文档/sidecar。
- 右侧有 Agent/Blueprints 入口，未配置模型时有友好引导。
- Agent 可用 mock 或真实 provider 一次创建多个蓝图；格式错误不污染蓝图列表。
- 蓝图列表支持选择、预览、校验、重命名、删除、应用。
- 蓝图预览只读，不修改主文档。
- invalid 蓝图可应用，但必须强提示；valid 蓝图应用前显示 diff/风险确认。
- 应用蓝图整文档替换主文档，dirty=true，重新校验，可撤销或至少有强确认。
- 主 semantic v4 文件不新增 `blueprints` 顶层字段。
- `npm test` 与 `npm run build` 通过；Rust 工具链可用时 `cargo test` 通过。

## 9. 风险矩阵

| 风险 | 概率 | 影响 | 触发场景 | 缓解 | 验收/监控 |
|---|---:|---:|---|---|---|
| Canvas 预览误写主文档 | 中 | 高 | `CanvasView` 直接使用 editorStore 写动作 | `readOnly` guard；预览前后 hash 对比；必要时拆纯渲染组件 | 预览拖拽后主文档 hash 不变 |
| API key 泄漏到项目文件 | 低-中 | 高 | settings/blueprint serialize 误包含 secret | secret 单独存储；sidecar schema 禁止 key 字段；测试扫描 | 保存主文档/sidecar 后搜索 key 不存在 |
| 模型生成旧 wire/node 格式 | 高 | 中-高 | Agent 输出不遵循 semantic v4 | prompt 硬约束 + forbidden field scan + Rust validation | 含 wires/nodes/signals 的 response 被拒绝 |
| 模型返回非 JSON/截断 | 高 | 中 | 大文档或 provider 不支持 JSON mode | parser fail 不入库；显示重试/修复；max tokens 设置 | 蓝图列表无污染，用户可重试 |
| 深色模式覆盖不完整 | 中 | 中 | 新组件写死颜色 | 全部使用 CSS variables；visual smoke | Settings/Agent/Blueprint/Dialog 无浅色残留 |
| system theme 与 settings 状态冲突 | 中 | 中 | localStorage 旧值和 App Settings 并存 | migration 后 settings 为单一来源；resolved theme 独立 | 刷新后主题一致 |
| baseHash 误报 | 中 | 中 | normalize 更新 `document.updatedAt` | hash 忽略 volatile 字段，稳定 stringify | updatedAt 变化 hash 不变 |
| 应用旧蓝图覆盖用户修改 | 中 | 高 | 主文档 dirty 或 baseHash mismatch | 强确认 + diff + 建议先保存 + undo | mismatch 时必须额外确认 |
| Provider 协议差异 | 中 | 中 | Anthropic/OpenAI payload 不同 | adapter 分层；DeepSeek preset 单测 | mock payload 符合各协议 |
| 大文档 token 超限/成本高 | 中 | 中 | 发送完整 JSON 给模型 | 上下文策略；摘要模式；用户确认完整发送 | Agent 面板显示将发送内容范围 |
| 设置损坏导致应用不可用 | 低 | 中 | 配置文件 JSON 损坏 | load fallback 默认设置 + 错误提示 + 备份损坏文件 | 损坏配置可恢复启动 |
| sidecar 与主文件迁移混乱 | 中 | 中 | 另存为/移动主文件 | 另存为提示复制/新建 sidecar；显示 sidecar 路径 | 另存为后蓝图策略明确 |
| UI 复杂度过高影响交付 | 中 | 中 | 同期做 settings/agent/diff | 阶段拆分；先 mock provider；MVP 摘要 diff | 每 Phase 独立可验收 |

## 10. 建议交付顺序

1. 先做 Settings 基础和主题迁移，统一成熟软件设置入口。
2. 做蓝图数据/sidecar/store，保证主文档隔离。
3. 做右侧 tabs、蓝图列表、只读预览。
4. 做校验、diff、应用确认，形成无 Agent 的完整蓝图闭环。
5. 接入 Agent mock，再接真实 provider。
6. 最后做 Agent 修改蓝图、设置/错误/可访问性打磨与回归。

该顺序能让每个子代理任务都有明确边界：类型/存储、UI shell、Canvas readOnly、validation/apply、Agent provider、测试文档互不强耦合，且任何阶段都不破坏现有主文档编辑能力。
