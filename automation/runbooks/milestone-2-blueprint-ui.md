# Milestone 2 Runbook：Blueprint UI 闭环

目标是在已有 Blueprint Core 上实现只读预览、diff、校验提示、强确认应用和 undo/redo。核心风险是 Canvas 预览误写主文档，必须优先验证 mainDocumentHash 前后一致。
