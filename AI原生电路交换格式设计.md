# AI 原生电路交换格式设计

文档版本：v1.0.0-draft  
对应产品：[AI原生电路表达与还原工具 PRD.md](F:\WORKSPACE\obsidian_files\Myimage\Myimage\应道\AI原生电路表达与还原工具 PRD.md)  
正式 schema：[AI原生电路交换格式.schema.json](F:\WORKSPACE\obsidian_files\Myimage\Myimage\应道\AI原生电路交换格式.schema.json)

## 1. 设计目标

该交换格式用于承载“AI 原生电路表达与还原工具”的电路结构表达结果，目标是同时满足以下三点：

1. 人工搭建后的电路可被无损导出。
2. AI 可直接阅读、修改、补充并保持结构正确。
3. 系统可根据该格式无损还原出完整画布。

## 2. 建模原则

### 2.1 采用归一化顶层结构

正式格式不将 `ports` 内嵌在 `components` 中，而是将其提升为顶层实体集合：

- `components`
- `ports`
- `nodes`
- `wires`
- `annotations`

这样做有三个原因：

1. AI 修改时更容易单点编辑，不需要同时维护嵌套结构。
2. 连线天然引用 `port` 和 `node`，顶层实体更利于建立索引。
3. 便于应用层做一致性校验与差异比较。

### 2.2 几何即位置

正式格式中，器件的 `geometry` 直接承载绝对几何信息，不再单独保留一个会与几何重复的 `position` 字段。这样可以避免“双重数据源”导致的不一致。

### 2.3 结构优先于视觉

该格式首先描述“拓扑结构和几何关系”，其次才描述界面表现。任何字段只要不影响无损还原，就不应成为首版必填项。

### 2.4 区分规范字段与派生字段

- 规范字段：导入导出的主数据源，必须被严格维护。
- 派生字段：为 AI 可读性或校验便利保留，可由系统重算。

在首版中，`node.connectedWireIds` 视为派生字段，但允许保留在文件中作为可读性与校验辅助。

## 3. 顶层对象结构

```json
{
  "schemaVersion": "1.0.0",
  "document": {},
  "canvas": {},
  "components": [],
  "ports": [],
  "nodes": [],
  "wires": [],
  "annotations": []
}
```

## 4. 顶层字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `schemaVersion` | `string` | 是 | 当前交换格式版本，首版固定为 `1.0.0` |
| `document` | `object` | 是 | 文档元数据 |
| `canvas` | `object` | 是 | 画布定义 |
| `components` | `array` | 是 | 器件集合 |
| `ports` | `array` | 是 | 端点集合 |
| `nodes` | `array` | 是 | 节点集合 |
| `wires` | `array` | 是 | 连线集合 |
| `annotations` | `array` | 是 | 注释与信号描述集合 |

## 5. 实体结构草案

### 5.1 Document

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | `string` | 是 | 文档唯一标识 |
| `title` | `string` | 是 | 文档标题 |
| `description` | `string` | 否 | 文档说明 |
| `createdAt` | `string` | 否 | 创建时间，建议 `date-time` |
| `updatedAt` | `string` | 否 | 更新时间，建议 `date-time` |
| `source` | `string` | 否 | 建议值：`human` / `ai` / `mixed` / `imported` |

### 5.2 Canvas

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `origin` | `Point` | 是 | 画布原点 |
| `width` | `number` | 是 | 画布宽度 |
| `height` | `number` | 是 | 画布高度 |
| `units` | `string` | 是 | 首版固定为 `px` |
| `grid` | `object` | 否 | 网格显示参数 |

### 5.3 Component

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | `string` | 是 | 器件唯一标识 |
| `name` | `string` | 是 | 器件名称 |
| `geometry` | `Geometry` | 是 | 器件几何信息 |
| `description` | `string` | 否 | 器件说明 |
| `tags` | `string[]` | 否 | 器件标签 |

`Geometry` 取值范围：

1. 矩形：`{ "type": "rectangle", "x": 100, "y": 80, "width": 120, "height": 80 }`
2. 圆：`{ "type": "circle", "cx": 400, "cy": 220, "radius": 48 }`
3. 三角形：`{ "type": "triangle", "vertices": [Point, Point, Point] }`

### 5.4 Port

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | `string` | 是 | 端点唯一标识 |
| `componentId` | `string` | 是 | 所属器件 `id` |
| `name` | `string` | 是 | 端点名称 |
| `direction` | `string` | 是 | 首版限定为 `input` 或 `output` |
| `pinInfo` | `object` | 否 | 引脚信息 |
| `anchor` | `PortAnchor` | 是 | 端点在器件边界上的定位方式 |
| `description` | `string` | 否 | 端点说明 |

`PortAnchor` 取值范围：

1. 矩形边定位：`{ "kind": "rectangle-side", "side": "right", "offset": 0.5 }`
2. 圆周角定位：`{ "kind": "circle-angle", "angleDeg": 90 }`
3. 三角边定位：`{ "kind": "triangle-edge", "edgeIndex": 1, "offset": 0.25 }`

### 5.5 Node

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | `string` | 是 | 节点唯一标识 |
| `position` | `Point` | 是 | 节点坐标 |
| `connectedWireIds` | `string[]` | 是 | 连接到该节点的线条列表 |
| `role` | `string` | 否 | 建议值：`generic` / `junction` / `branch` |
| `description` | `string` | 否 | 节点说明 |

### 5.6 Wire

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | `string` | 是 | 连线唯一标识 |
| `serialNumber` | `string` | 是 | 用户可见编号，如 `W1` |
| `source` | `EndpointRef` | 是 | 起点引用 |
| `target` | `EndpointRef` | 是 | 终点引用 |
| `route` | `Route` | 是 | 路径定义 |
| `description` | `string` | 否 | 连线说明 |

说明：

1. `source` 和 `target` 只允许引用 `port` 或 `node`。
2. `route.kind = "straight"` 时，不需要折点。
3. `route.kind = "polyline"` 时，`bendPoints` 只存储中间折点，不重复存起点和终点。

### 5.7 Annotation

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | `string` | 是 | 注释唯一标识 |
| `kind` | `string` | 是 | 建议值：`signal` / `note` / `label` |
| `target` | `AnnotationTarget` | 是 | 注释绑定目标 |
| `text` | `string` | 是 | 注释文本 |
| `position` | `Point` | 否 | 标签显示位置提示 |

## 6. 引用模型

### 6.1 EndpointRef

```json
{
  "entityType": "port",
  "refId": "port.mcu.pwm_out"
}
```

或：

```json
{
  "entityType": "node",
  "refId": "node.split.1"
}
```

### 6.2 AnnotationTarget

注释目标可以绑定到：

1. `component`
2. `port`
3. `node`
4. `wire`

## 7. 语义约束

以下约束不完全依赖 JSON Schema，需要应用层校验器补充：

1. 所有 `id` 必须全局唯一。
2. `port.componentId` 必须能找到对应的 `component.id`。
3. `wire.source.refId` 和 `wire.target.refId` 必须存在。
4. `node.connectedWireIds` 必须与实际引用该节点的线条集合一致。
5. `port.anchor.kind` 必须与目标器件的 `geometry.type` 相匹配。
6. `triangle-edge` 的 `edgeIndex` 仅允许 `0`、`1`、`2`。
7. `polyline` 的 `bendPoints` 应按路径顺序给出。

## 8. 归一化与导出建议

### 8.1 导出建议

1. 顶层数组建议按 `id` 排序，降低 diff 噪音。
2. 所有缺省可选字段建议直接省略，不输出空字符串。
3. 派生字段若输出，必须与主结构一致。

### 8.2 导入建议

1. 先做 JSON Schema 校验。
2. 再做引用完整性和语义完整性校验。
3. 若派生字段缺失，可在导入阶段补算。
4. 若派生字段存在但冲突，应以主结构重算并提示冲突。

## 9. 最小示例

```json
{
  "schemaVersion": "1.0.0",
  "document": {
    "id": "doc.demo",
    "title": "PWM Driver Demo",
    "source": "human"
  },
  "canvas": {
    "origin": { "x": 0, "y": 0 },
    "width": 1600,
    "height": 900,
    "units": "px"
  },
  "components": [
    {
      "id": "component.mcu",
      "name": "MCU",
      "geometry": { "type": "rectangle", "x": 120, "y": 120, "width": 220, "height": 140 }
    },
    {
      "id": "component.driver",
      "name": "Driver",
      "geometry": { "type": "rectangle", "x": 520, "y": 120, "width": 200, "height": 140 }
    }
  ],
  "ports": [
    {
      "id": "port.mcu.pwm_out",
      "componentId": "component.mcu",
      "name": "PWM_OUT",
      "direction": "output",
      "anchor": { "kind": "rectangle-side", "side": "right", "offset": 0.5 }
    },
    {
      "id": "port.driver.in",
      "componentId": "component.driver",
      "name": "IN",
      "direction": "input",
      "anchor": { "kind": "rectangle-side", "side": "left", "offset": 0.5 }
    }
  ],
  "nodes": [
    {
      "id": "node.mid.1",
      "position": { "x": 430, "y": 190 },
      "connectedWireIds": ["wire.1", "wire.2"],
      "role": "junction"
    }
  ],
  "wires": [
    {
      "id": "wire.1",
      "serialNumber": "W1",
      "source": { "entityType": "port", "refId": "port.mcu.pwm_out" },
      "target": { "entityType": "node", "refId": "node.mid.1" },
      "route": { "kind": "straight" }
    },
    {
      "id": "wire.2",
      "serialNumber": "W2",
      "source": { "entityType": "node", "refId": "node.mid.1" },
      "target": { "entityType": "port", "refId": "port.driver.in" },
      "route": { "kind": "polyline", "bendPoints": [{ "x": 470, "y": 190 }] },
      "description": "PWM control path"
    }
  ],
  "annotations": [
    {
      "id": "annotation.signal.1",
      "kind": "signal",
      "target": { "entityType": "port", "refId": "port.mcu.pwm_out" },
      "text": "3.3V PWM, 20kHz"
    }
  ]
}
```

## 10. 与 PRD 的关系

PRD 第 9 章定义的是产品层需求；本文件定义的是实现层数据模型。若二者存在差异，以以下原则解释：

1. 不改变 PRD 的业务目标。
2. 为避免重复和歧义，允许在实现层合并冗余字段。
3. 为便于 AI 编辑，优先选择引用明确、关系稳定的归一化结构。
