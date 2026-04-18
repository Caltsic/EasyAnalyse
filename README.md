# EASYAnalyse

EASYAnalyse 是一个面向 AI 与工程师协作的语义电路表达项目。仓库当前包含两部分核心内容：

- 根目录交换格式文档与 schema
- `easyanalyse-desktop/` 桌面编辑器

项目当前只承认 `semantic v4`，也就是 `schemaVersion: "4.0.0"` 这一套模型。

## 当前有效入口

规范与行为的优先级如下：

1. [exchange.md](./exchange.md)
2. [AI原生电路交换格式.schema.json](./AI原生电路交换格式.schema.json)
3. `easyanalyse-desktop/src-tauri/crates/easyanalyse-core/` 中的归一化与校验实现

[AI原生电路交换格式设计.md](./AI原生电路交换格式设计.md) 与 [AI原生电路表达与还原工具 PRD.md](./AI原生电路表达与还原工具 PRD.md) 只负责解释设计取舍与产品边界，不额外定义第二套字段语义。

## 模型原则

EASYAnalyse 不是传统导线拓扑编辑器。当前模型的核心规则只有几条：

- `devices` 表示器件或模块
- `terminals` 表示器件接口
- 多个 terminal 共享同一个非空 `label`，就视为连通
- `view` 只保存布局与可读性信息，不表达电气真值
- 端子坐标、端子标签坐标、导线折点都不是持久化字段

这意味着 AI 不需要伪造 wires、junctions、signals 或 signalId，工程师也不用通过几何布线去反推电路语义。

## 有意义电路的最低要求

当前项目已经把下面这些内容视为“不能省略”的信息：

- 电阻、电容、电感等非模块器件要有明确 `properties.value`
- 晶振、时钟、谐振器要有明确 `properties.frequency`
- 供电网络不能只写泛化 `VCC`、`VIN` 却不给具体电压；要么标签本身写成 `3V3`、`5V`，要么由供电器件属性给出电压
- 运放、稳压器、电源类器件的供电值应可从标签或器件属性中直接看出来
- 每个端子在当前电路上下文里只建模为 `input` 或 `output`
- 主从、控制和阅读方向直接体现在 `direction` 本身，不再额外持久化第二个方向字段

例如：

- I2C `SCL`、`SDA` 在当前模型里都直接按主从关系建模，MCU 侧写 `output`，外设侧写 `input`
- UART 的 `TX` / `RX` 也按当前电路里的控制流向建模，不再保留双向或逻辑方向附加字段

## 保存与校验

保存流程不是“有问题也照样落盘”。当前实现会先做 schema 校验和语义校验，只有两者都通过才允许写盘。

当前语义校验重点覆盖：

- ID 唯一性
- 必填端子是否缺少标签
- 器件值、频率、电压是否缺失
- 电源标签是否能解析出具体电压
- 视图中是否存在失配的 device / network line 引用

在当前后端实现里，只要还存在 `semantic.*` 问题，`semanticValid` 就会是 `false`，保存会被拒绝。

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
    |-- src/
    |-- src-tauri/
    |   `-- crates/easyanalyse-core/
    `-- package.json
```

重点目录：

- `easyanalyse-desktop/src/`：React 端编辑器、画布与状态
- `easyanalyse-desktop/src/components/CanvasView.tsx`：主画布交互
- `easyanalyse-desktop/src/store/editorStore.ts`：编辑器状态与命令
- `easyanalyse-desktop/src-tauri/src/commands.rs`：打开、保存、校验命令
- `easyanalyse-desktop/src-tauri/crates/easyanalyse-core/src/validation.rs`：语义校验规则
- `testJson/`：可直接打开的示例文档

## 样例文件

当前仓库内的语义 v4 样例包括：

- `testJson/semantic-v4-demo.json`
- `testJson/butterworth-4th-order-lowpass.json`
- `testJson/ripple-carry-adder-4bit.json`
- `testJson/stm32f103c8t6-minimum-system.json`
- `testJson/stm32f103-pwm-motor-driver-18v.json`
- `testJson/lm358-noninverting-amplifier.json`
- `testJson/rc-low-pass-filter.json`
- `testJson/resistor-voltage-divider.json`

这些文件既是回归输入，也是 AI few-shot 参考。示例应优先展示“有具体电气意义”的电路，而不是仅有器件名、没有参数的空壳。

## 本地开发

### 前置环境

- Node.js 20+
- npm 10+
- Rust stable
- Tauri 2 构建依赖
- Windows 下可用的 WebView2

### 常用命令

```bash
cd easyanalyse-desktop
npm install
npm run tauri:dev
npm run build
npm run tauri:build
npm test
```

## 当前定位

这个仓库当前是“格式 + 桌面编辑器”的组合体，不是完整 EDA。

它要解决的是：

- AI 如何稳定生成有实际意义的电路 JSON
- 工程师如何在桌面端审阅、修正并继续编辑
- 如何把值、方向、供电、电源网络和阅读布局沉淀成可验证、可保存的数据
