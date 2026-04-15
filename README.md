# EASYAnalyse

EASYAnalyse 是一个面向 AI 与工程师协作的语义电路表达项目。仓库当前包含两部分核心内容：

- `exchange.md` 与 `AI原生电路交换格式.schema.json`：定义语义优先的电路交换格式
- `easyanalyse-desktop/`：基于 Tauri + React + Rust 的桌面编辑器

项目当前采用 `semantic v4` 作为唯一规范格式。它不再依赖 wire、junction node 或拓扑重建，而是通过 terminal 的 `label` 直接表达连接关系。

## 核心思路

传统电路图编辑器把“线”当成一等公民，AI 在生成这类结构时很容易产生伪几何、错误连线或不稳定拓扑。EASYAnalyse 反过来把“语义连接”作为主数据：

- `devices` 表示器件或功能块
- `terminals` 表示器件接口
- 多个 terminal 只要共享相同的非空 `label`，就视为连通
- `view` 只保存可视化与可读性信息，不定义电路真值

这样可以让 AI 直接生成可验证、可保存、可编辑的电路 JSON，同时保留桌面编辑器对结构化视图、焦点分析和布局优化的支持。

## 当前能力

桌面编辑器当前已经覆盖以下主流程：

- 新建、打开、保存语义电路文档
- 自动规范化并校验文档
- 在无限画布上编辑 device、terminal 与独立 network line
- 基于 terminal label 自动形成网络分组与颜色分配
- 支持 device focus / network focus，用语义关系重排视图
- 支持常见样例文档作为回归输入

当前格式与行为以 [exchange.md](./exchange.md) 为准。

## 仓库结构

```text
.
|-- README.md
|-- exchange.md
|-- AI原生电路交换格式.schema.json
|-- AI原生电路交换格式设计.md
|-- AI原生电路表达与还原工具 PRD.md
|-- testJson/
`-- easyanalyse-desktop/
    |-- src/                         # React 前端与编辑器状态
    |-- src-tauri/                   # Tauri 宿主与 Rust 命令
    |   `-- crates/easyanalyse-core/ # 语义模型与校验核心
    `-- package.json
```

重点目录说明：

- `easyanalyse-desktop/src/`：编辑器界面、画布交互、Inspector、状态管理
- `easyanalyse-desktop/src-tauri/src/commands.rs`：前端调用的打开、保存、校验命令
- `easyanalyse-desktop/src-tauri/crates/easyanalyse-core/`：文档模型、归一化、校验逻辑
- `testJson/`：语义 v4 样例文件，可直接作为编辑器输入

## 数据模型摘要

顶层结构如下：

```json
{
  "schemaVersion": "4.0.0",
  "document": {},
  "devices": [],
  "view": {},
  "extensions": {}
}
```

其中：

- `document`：标题、描述、来源、语言、标签等元数据
- `devices`：器件列表，每个器件内部包含 `terminals`
- `terminals`：连接语义的唯一来源
- `view.devices`：器件位置、尺寸、旋转、形状
- `view.networkLines`：对 `VCC`、`GND` 等共用网络的独立语义视图表达

格式详细约束见：

- [exchange.md](./exchange.md)
- [AI原生电路交换格式.schema.json](./AI原生电路交换格式.schema.json)
- [AI原生电路交换格式设计.md](./AI原生电路交换格式设计.md)

## 样例文档

仓库内已提供多份可直接打开的样例：

- `testJson/semantic-v4-demo.json`
- `testJson/butterworth-4th-order-lowpass.json`
- `testJson/ripple-carry-adder-4bit.json`
- `testJson/stm32f103c8t6-minimum-system.json`
- `testJson/lm358-noninverting-amplifier.json`
- `testJson/rc-low-pass-filter.json`
- `testJson/resistor-voltage-divider.json`

这些文件既可用于 UI 回归，也适合作为 AI 提示词中的 few-shot 参考。

## 本地开发

### 前置环境

建议环境：

- Node.js 20+
- npm 10+
- Rust stable
- Tauri 2 构建依赖
- Windows 下建议确认 WebView2 已可用

### 安装依赖

```bash
cd easyanalyse-desktop
npm install
```

### 启动桌面开发环境

```bash
npm run tauri:dev
```

### 构建前端

```bash
npm run build
```

### 打包桌面应用

```bash
npm run tauri:build
```

### 运行测试

```bash
npm test
```

## 开发说明

- 前端状态管理使用 `zustand`
- 画布渲染使用 `react-konva`
- 桌面宿主使用 `Tauri 2`
- 文档校验与规范化由 Rust `easyanalyse-core` 负责
- 保存流程会先做校验，再把归一化后的 JSON 写回磁盘

## 当前定位

这个仓库当前更接近“格式 + 编辑器原型”的结合体，而不是完整 EDA 工具。它解决的是：

- AI 如何稳定表达电路结构
- 工程师如何在桌面端审阅、修正与继续编辑
- 如何把共用网络、焦点关系和布局语义沉淀为可保存的规范数据

如果后续继续扩展，优先级通常会落在：

- 更多格式迁移与兼容
- 更完整的校验报告与错误修复建议
- 更强的 focus 布局与关系分析
- AI 生成与编辑工作流整合
