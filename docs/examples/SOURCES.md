# EasyAnalyse Agent 示例来源说明

本目录记录内置 Agent 参考示例的来源策略。M7 首期示例目前以 `easyanalyse-desktop/src/lib/agentExampleLibrary.ts` 中的手工重建公共经典拓扑为准。

## 原则

- 不直接复制无许可的商业/网络原理图。
- 优先使用电路教材、datasheet 应用说明中常见的公共拓扑，并手工抽象为 EasyAnalyse semantic v4 JSON。
- 示例只用于帮助模型理解格式和典型连接方式，不作为仿真或生产设计保证。
- 每个示例必须遵守：连接事实只由 `terminal.label` 表达，`view.networkLines` 只作可读性辅助。

## M7 首期示例

1. **RC low-pass filter**
   - 公共经典无源 RC 滤波拓扑。
   - 目的：展示最小两端器件、共享节点 label、测试点。

2. **Inverting op-amp amplifier**
   - 公共经典运放反相放大拓扑。
   - 目的：展示反馈网络、虚地/反相节点、多端器件。

3. **MCU RS-485 interface node**
   - 公共经典 MCU + RS-485 收发器 + 终端电阻 + TVS + 接插件系统拓扑。
   - 目的：展示较高复杂度接口子系统、控制线、差分总线、电源去耦、保护器件。

后续扩展复杂示例时，应继续在本文件记录来源/许可/抽象说明。
