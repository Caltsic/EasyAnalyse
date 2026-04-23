package cn.easyanalyse.mobile.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class MobileRenderSnapshot(
    val schemaVersion: String,
    val generatedAt: String,
    val orientation: String,
    val sourceSchemaVersion: String,
    val document: SnapshotDocument,
    val canvas: SnapshotCanvas,
    val devices: List<SnapshotDevice> = emptyList(),
    val networkLines: List<SnapshotNetworkLine> = emptyList(),
    val connectionGroups: List<SnapshotConnectionGroup> = emptyList(),
    val relations: List<SnapshotRelation> = emptyList(),
    val searchIndex: List<SnapshotSearchItem> = emptyList(),
    val validation: SnapshotValidation,
)

@Serializable
data class SnapshotDocument(
    val id: String,
    val title: String,
    val description: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
)

@Serializable
data class SnapshotCanvas(
    val units: String,
    val background: String? = null,
    val grid: SnapshotGrid? = null,
    val worldBounds: SnapshotBounds,
)

@Serializable
data class SnapshotGrid(
    val enabled: Boolean,
    val size: Float,
    val majorEvery: Int? = null,
)

@Serializable
data class SnapshotDevice(
    val id: String,
    val reference: String,
    val title: String,
    val name: String,
    val kind: String,
    val visualKind: String,
    val shape: String,
    val rotationDeg: Float = 0f,
    val bounds: SnapshotBounds,
    val center: SnapshotPoint,
    val description: String? = null,
    val properties: Map<String, JsonElement>? = null,
    val symbolAccent: String? = null,
    val symbolPrimitives: List<SnapshotSymbolPrimitive> = emptyList(),
    val terminals: List<SnapshotTerminal> = emptyList(),
)

@Serializable
data class SnapshotSymbolPrimitive(
    val type: String,
    val points: List<Float> = emptyList(),
    val stroke: String? = null,
    val strokeWidth: Float? = null,
    val closed: Boolean? = null,
    val fill: String? = null,
    val dash: List<Float>? = null,
    val tension: Float? = null,
    val x: Float? = null,
    val y: Float? = null,
    val width: Float? = null,
    val height: Float? = null,
    val radius: Float? = null,
    val text: String? = null,
    val fontSize: Float? = null,
    val bold: Boolean? = null,
)

@Serializable
data class SnapshotTerminal(
    val id: String,
    val deviceId: String,
    val name: String,
    val displayLabel: String,
    val connectionLabel: String? = null,
    val direction: String,
    val flowDirection: String,
    val side: String,
    val point: SnapshotPoint,
    val role: String? = null,
    val description: String? = null,
    val pin: SnapshotPin? = null,
    val color: SnapshotColor,
)

@Serializable
data class SnapshotPin(
    val number: String? = null,
    val name: String? = null,
    val bank: String? = null,
)

@Serializable
data class SnapshotColor(
    val fill: String,
    val stroke: String,
    val text: String,
)

@Serializable
data class SnapshotNetworkLine(
    val id: String,
    val label: String,
    val labelKey: String,
    val position: SnapshotPoint,
    val start: SnapshotPoint,
    val end: SnapshotPoint,
    val length: Float,
    val orientation: String,
)

@Serializable
data class SnapshotConnectionGroup(
    val key: String,
    val label: String,
    val terminalIds: List<String> = emptyList(),
    val deviceIds: List<String> = emptyList(),
    val point: SnapshotPoint,
)

@Serializable
data class SnapshotRelation(
    val deviceId: String,
    val title: String,
    val upstreamDeviceIds: List<String> = emptyList(),
    val downstreamDeviceIds: List<String> = emptyList(),
    val relatedTerminalIds: List<String> = emptyList(),
    val connectionKeys: List<String> = emptyList(),
    val connectionLabels: List<String> = emptyList(),
    val upstreamLabels: List<String> = emptyList(),
    val downstreamLabels: List<String> = emptyList(),
)

@Serializable
data class SnapshotSearchItem(
    val id: String,
    val type: String,
    val label: String,
    val subtitle: String? = null,
    val targetId: String,
)

@Serializable
data class SnapshotValidation(
    val schemaValid: Boolean,
    val semanticValid: Boolean,
    val issueCount: Int,
    val issues: List<SnapshotValidationIssue> = emptyList(),
)

@Serializable
data class SnapshotValidationIssue(
    val severity: String,
    val code: String,
    val message: String,
    val entityId: String? = null,
    val path: String? = null,
)

@Serializable
data class SnapshotBounds(
    val x: Float,
    val y: Float,
    val width: Float,
    val height: Float,
)

@Serializable
data class SnapshotPoint(
    val x: Float,
    val y: Float,
)
