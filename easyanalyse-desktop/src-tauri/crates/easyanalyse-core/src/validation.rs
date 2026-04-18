use std::collections::{BTreeMap, BTreeSet};

use chrono::Utc;
use once_cell::sync::Lazy;
use serde::Serialize;
use serde_json::Value;
use thiserror::Error;

use crate::{
    CanvasViewDefinition, DeviceDefinition, DocumentFile, DocumentMeta, DocumentSource,
    FocusDirection, FocusViewDefinition, GridDefinition, TerminalDefinition, TerminalDirection,
    TerminalSide, ViewDefinition,
};

static SCHEMA_JSON: Lazy<Value> = Lazy::new(|| {
    serde_json::from_str(include_str!(
        "../schema/ai-native-circuit-exchange.schema.json"
    ))
    .expect("bundled schema must be valid JSON")
});

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Schema compilation error: {0}")]
    Schema(String),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum IssueSeverity {
    Error,
    Warning,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub severity: IssueSeverity,
    pub code: String,
    pub message: String,
    pub entity_id: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DetectedDocumentFormat {
    SemanticV4,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub detected_format: DetectedDocumentFormat,
    pub schema_valid: bool,
    pub semantic_valid: bool,
    pub issue_count: usize,
    pub issues: Vec<ValidationIssue>,
    pub normalized_document: Option<DocumentFile>,
}

pub fn default_document(title: &str) -> DocumentFile {
    let timestamp = Utc::now().to_rfc3339();
    let normalized_title = if title.trim().is_empty() {
        "Untitled circuit"
    } else {
        title.trim()
    };

    DocumentFile {
        schema_version: "4.0.0".to_string(),
        document: DocumentMeta {
            id: make_id("doc"),
            title: normalized_title.to_string(),
            description: None,
            created_at: Some(timestamp.clone()),
            updated_at: Some(timestamp),
            source: Some(DocumentSource::Human),
            language: Some("zh-CN".to_string()),
            tags: Some(Vec::new()),
            extensions: None,
        },
        devices: Vec::new(),
        view: ViewDefinition {
            canvas: CanvasViewDefinition {
                units: "px".to_string(),
                grid: Some(GridDefinition {
                    enabled: true,
                    size: 36.0,
                    major_every: Some(5),
                }),
                background: Some("grid".to_string()),
                extensions: None,
            },
            devices: Some(BTreeMap::new()),
            network_lines: Some(BTreeMap::new()),
            focus: Some(FocusViewDefinition {
                default_device_id: None,
                preferred_direction: Some(FocusDirection::LeftToRight),
                extensions: None,
            }),
            extensions: None,
        },
        extensions: None,
    }
}

pub fn validate_value(value: Value) -> Result<ValidationReport, CoreError> {
    let schema_issues = validate_schema(&value)?;

    if let Ok(mut document) = serde_json::from_value::<DocumentFile>(value.clone()) {
        normalize_document(&mut document);
        let semantic_issues = validate_semantics(&document);
        let mut issues = schema_issues;
        issues.extend(semantic_issues);

        let schema_valid = issues
            .iter()
            .all(|issue| !issue.code.starts_with("schema."));
        let semantic_valid = issues
            .iter()
            .all(|issue| !issue.code.starts_with("semantic."));

        return Ok(ValidationReport {
            detected_format: DetectedDocumentFormat::SemanticV4,
            schema_valid,
            semantic_valid,
            issue_count: issues.len(),
            issues,
            normalized_document: Some(document),
        });
    }

    let mut issues = schema_issues;
    issues.push(ValidationIssue {
        severity: IssueSeverity::Error,
        code: "schema.parse".to_string(),
        message: "Document did not match the supported semantic v4 model".to_string(),
        entity_id: None,
        path: None,
    });

    Ok(ValidationReport {
        detected_format: DetectedDocumentFormat::Unknown,
        schema_valid: false,
        semantic_valid: false,
        issue_count: issues.len(),
        issues,
        normalized_document: None,
    })
}

pub fn normalize_document(document: &mut DocumentFile) {
    document.schema_version = "4.0.0".to_string();
    document.document.title = ensure_required_string(&document.document.title, "Untitled circuit");
    document.document.updated_at = Some(Utc::now().to_rfc3339());
    document.document.tags = Some(unique_non_empty(
        document.document.tags.take().unwrap_or_default(),
    ));

    document.devices = document
        .devices
        .drain(..)
        .map(|mut device| {
            device.name = ensure_required_string(&device.name, &device.id);
            device.kind = ensure_required_string(&device.kind, "module");
            device.category = clean_optional(device.category);
            device.description = clean_optional(device.description);
            device.reference = clean_optional(device.reference);
            device.tags = Some(unique_non_empty(device.tags.take().unwrap_or_default()));
            normalize_properties(&mut device.properties);

            let mut terminals = device
                .terminals
                .drain(..)
                .map(|mut terminal| {
                    terminal.name = ensure_required_string(&terminal.name, &terminal.id);
                    terminal.label = clean_optional(terminal.label);
                    terminal.role = clean_optional(terminal.role);
                    terminal.description = clean_optional(terminal.description);
                    let default_terminal_side = default_side_for_terminal(&terminal);
                    terminal.side = Some(terminal.side.unwrap_or(default_terminal_side));
                    terminal
                })
                .collect::<Vec<_>>();
            terminals.sort_by(|left, right| {
                left.order
                    .unwrap_or(i64::MAX)
                    .cmp(&right.order.unwrap_or(i64::MAX))
                    .then_with(|| left.name.cmp(&right.name))
                    .then_with(|| left.id.cmp(&right.id))
            });
            device.terminals = terminals;
            device
        })
        .collect();
    document.devices.sort_by(|left, right| left.id.cmp(&right.id));

    if document.view.devices.is_none() {
        document.view.devices = Some(BTreeMap::new());
    }
    if document.view.network_lines.is_none() {
        document.view.network_lines = Some(BTreeMap::new());
    }
    if let Some(view_devices) = document.view.devices.as_mut() {
        for view in view_devices.values_mut() {
            if let Some(rotation_deg) = view.rotation_deg {
                view.rotation_deg = Some(normalize_rotation_deg(rotation_deg));
            }
        }
    }
    if let Some(network_lines) = document.view.network_lines.as_mut() {
        for view in network_lines.values_mut() {
            view.label = view.label.trim().to_string();
            if let Some(length) = view.length {
                view.length = normalize_network_line_length(length);
            }
            view.orientation = Some(match view.orientation.clone() {
                Some(orientation) => orientation,
                None => crate::NetworkLineOrientation::Horizontal,
            });
        }
    }

    document.view.canvas.units = "px".to_string();
    document.view.canvas.background = Some("grid".to_string());
    let grid = document.view.canvas.grid.get_or_insert(GridDefinition {
        enabled: true,
        size: 36.0,
        major_every: Some(5),
    });
    grid.size = if grid.size.is_finite() && grid.size > 0.0 {
        grid.size
    } else {
        36.0
    };
    grid.major_every = Some(grid.major_every.unwrap_or(5).max(2));
}

fn validate_schema(value: &Value) -> Result<Vec<ValidationIssue>, CoreError> {
    let validator = jsonschema::validator_for(&SCHEMA_JSON)
        .map_err(|error| CoreError::Schema(error.to_string()))?;

    Ok(validator
        .iter_errors(value)
        .map(|error| ValidationIssue {
            severity: IssueSeverity::Error,
            code: "schema.validation".to_string(),
            message: error.to_string(),
            entity_id: None,
            path: Some(error.instance_path().to_string()),
        })
        .collect())
}

fn validate_semantics(document: &DocumentFile) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();
    let mut ids = BTreeSet::new();
    let mut label_usage = BTreeMap::<String, Vec<(&DeviceDefinition, &TerminalDefinition)>>::new();

    push_unique_id_issue(&mut issues, &mut ids, &document.document.id);

    for device in &document.devices {
        push_unique_id_issue(&mut issues, &mut ids, &device.id);

        if device.name.trim().is_empty() {
            issues.push(semantic_issue(
                "semantic.device.name",
                format!("Device {} must have a non-empty name", device.id),
                Some(device.id.clone()),
            ));
        }

        if device.kind.trim().is_empty() {
            issues.push(semantic_issue(
                "semantic.device.kind",
                format!("Device {} must have a non-empty kind", device.id),
                Some(device.id.clone()),
            ));
        }

        if device.terminals.is_empty() {
            issues.push(semantic_warning(
                "semantic.device.terminals.empty",
                format!("Device {} does not expose any terminals", device.id),
                Some(device.id.clone()),
            ));
        }

        validate_device_parameters(device, &mut issues);

        for terminal in &device.terminals {
            push_unique_id_issue(&mut issues, &mut ids, &terminal.id);

            if terminal.name.trim().is_empty() {
                issues.push(semantic_issue(
                    "semantic.terminal.name",
                    format!("Terminal {} must have a non-empty name", terminal.id),
                    Some(terminal.id.clone()),
                ));
            }

            if let Some(label) = normalize_label(terminal.label.as_deref()) {
                label_usage
                    .entry(label)
                    .or_default()
                    .push((device, terminal));
            } else if terminal.required.unwrap_or(false) {
                issues.push(semantic_warning(
                    "semantic.terminal.requiredUnlabeled",
                    format!("Required terminal {} is not assigned a connection label", terminal.id),
                    Some(terminal.id.clone()),
                ));
            }
        }
    }

    for (label, members) in &label_usage {
        validate_power_label(label, members, &mut issues);
    }

    if let Some(view_devices) = &document.view.devices {
        for device_id in view_devices.keys() {
            if !document.devices.iter().any(|device| &device.id == device_id) {
                issues.push(semantic_issue(
                    "semantic.view.deviceRef",
                    format!("View references missing device {}", device_id),
                    Some(device_id.clone()),
                ));
            }
        }
    }
    if let Some(network_lines) = &document.view.network_lines {
        let known_labels = document
            .devices
            .iter()
            .flat_map(|device| device.terminals.iter())
            .filter_map(|terminal| normalize_label(terminal.label.as_deref()))
            .collect::<BTreeSet<_>>();

        for (network_line_id, network_line) in network_lines {
            if network_line.label.trim().is_empty() {
                issues.push(semantic_warning(
                    "semantic.view.networkLine.label",
                    format!("Network line {} should reference a non-empty label", network_line_id),
                    Some(network_line_id.clone()),
                ));
                continue;
            }

            if !known_labels.contains(network_line.label.trim()) {
                issues.push(semantic_warning(
                    "semantic.view.networkLine.unusedLabel",
                    format!(
                        "Network line {} references label {} but no terminal currently uses it",
                        network_line_id, network_line.label
                    ),
                    Some(network_line_id.clone()),
                ));
            }
        }
    }

    if let Some(focus) = &document.view.focus {
        if let Some(default_device_id) = &focus.default_device_id {
            if !document
                .devices
                .iter()
                .any(|device| &device.id == default_device_id)
            {
                issues.push(semantic_issue(
                    "semantic.view.focus.defaultDevice",
                    format!("View focus references missing device {}", default_device_id),
                    Some(default_device_id.clone()),
                ));
            }
        }
    }

    issues
}

fn normalize_label(value: Option<&str>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn collapse_terminal_direction_value(direction: &TerminalDirection) -> Option<TerminalDirection> {
    match direction {
        TerminalDirection::Input | TerminalDirection::Ground | TerminalDirection::PowerIn => {
            Some(TerminalDirection::Input)
        }
        TerminalDirection::Output | TerminalDirection::PowerOut => Some(TerminalDirection::Output),
        TerminalDirection::Bidirectional
        | TerminalDirection::Passive
        | TerminalDirection::Shield
        | TerminalDirection::Unspecified => None,
    }
}

fn terminal_flow_direction(terminal: &TerminalDefinition) -> Option<TerminalDirection> {
    terminal
        .logical_direction
        .as_ref()
        .and_then(collapse_terminal_direction_value)
        .or_else(|| collapse_terminal_direction_value(&terminal.direction))
}

fn validate_device_parameters(device: &DeviceDefinition, issues: &mut Vec<ValidationIssue>) {
    if requires_device_value(device)
        && !has_non_empty_property(device, &["value", "resistance", "capacitance", "inductance"])
    {
        issues.push(semantic_issue(
            "semantic.device.value.missing",
            format!(
                "Device {} ({}) must declare a concrete electrical value",
                device.id, device.kind
            ),
            Some(device.id.clone()),
        ));
    }

    if requires_device_frequency(device) && !has_non_empty_property(device, &["frequency", "value"])
    {
        issues.push(semantic_issue(
            "semantic.device.frequency.missing",
            format!(
                "Device {} ({}) must declare a concrete frequency",
                device.id, device.kind
            ),
            Some(device.id.clone()),
        ));
    }
}

fn validate_power_label(
    label: &str,
    members: &[(&DeviceDefinition, &TerminalDefinition)],
    issues: &mut Vec<ValidationIssue>,
) {
    if !is_power_like_label(label, members) || is_ground_like_label(label) {
        return;
    }

    if is_explicit_voltage_label(label) || has_concrete_voltage_source(members) {
        return;
    }

    issues.push(semantic_issue(
        "semantic.label.powerVoltage.missing",
        format!(
            "Power label {} must resolve to a concrete voltage via the label itself or a sourcing device property",
            label
        ),
        None,
    ));
}

fn is_power_like_label(label: &str, members: &[(&DeviceDefinition, &TerminalDefinition)]) -> bool {
    let normalized = label.trim().to_ascii_uppercase();
    if normalized.is_empty() {
        return false;
    }

    is_ground_like_label(&normalized)
        || normalized == "VCC"
        || normalized == "VDD"
        || normalized == "VBAT"
        || normalized.contains("VREF")
        || (normalized == "VIN"
            && members.iter().any(|(device, _)| {
                has_non_empty_property(device, &["voltage", "outputVoltage", "nominalVoltage"])
                    || normalized_device_haystack(device).contains("power")
                    || normalized_device_haystack(device).contains("supply")
                    || normalized_device_haystack(device).contains("regulator")
                    || normalized_device_haystack(device).contains("battery")
            }))
        || is_explicit_voltage_label(&normalized)
}

fn is_ground_like_label(label: &str) -> bool {
    matches!(label.trim().to_ascii_uppercase().as_str(), "GND" | "AGND" | "DGND" | "PGND" | "VSS")
}

fn requires_device_value(device: &DeviceDefinition) -> bool {
    let kind = normalized_device_haystack(device);
    let reference = normalized_reference(device);

    reference.starts_with('R')
        || reference.starts_with('C')
        || reference.starts_with('L')
        || kind.contains("resistor")
        || kind.contains("capacitor")
        || kind.contains("inductor")
        || kind.contains("ferrite")
        || kind.contains("bead")
        || kind.contains("thermistor")
        || kind.contains("varistor")
}

fn requires_device_frequency(device: &DeviceDefinition) -> bool {
    let kind = normalized_device_haystack(device);
    let reference = normalized_reference(device);

    reference.starts_with('Y')
        || kind.contains("crystal")
        || kind.contains("oscillator")
        || kind.contains("resonator")
        || kind.contains("clock")
}

fn normalized_device_haystack(device: &DeviceDefinition) -> String {
    let mut parts = vec![
        device.kind.as_str(),
        device.name.as_str(),
        device.category.as_deref().unwrap_or(""),
        device.reference.as_deref().unwrap_or(""),
    ]
    .into_iter()
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .map(str::to_lowercase)
    .collect::<Vec<_>>();

    if let Some(tags) = &device.tags {
        parts.extend(
            tags.iter()
                .map(|tag| tag.trim().to_lowercase())
                .filter(|tag| !tag.is_empty()),
        );
    }

    parts.join(" ")
}

fn normalized_reference(device: &DeviceDefinition) -> String {
    device
        .reference
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_uppercase()
}

fn has_non_empty_property(device: &DeviceDefinition, keys: &[&str]) -> bool {
    let Some(properties) = &device.properties else {
        return false;
    };

    keys.iter().any(|key| {
        properties
            .get(*key)
            .and_then(|value| value.as_str())
            .map(|text| !text.trim().is_empty())
            .unwrap_or(false)
    })
}

fn has_concrete_voltage_source(members: &[(&DeviceDefinition, &TerminalDefinition)]) -> bool {
    members.iter().any(|(device, terminal)| {
        terminal_flow_direction(terminal) == Some(TerminalDirection::Output)
            && has_non_empty_property(device, &["voltage", "outputVoltage", "nominalVoltage"])
    })
}

fn is_explicit_voltage_label(label: &str) -> bool {
    let normalized = label.trim().to_uppercase();
    if normalized.is_empty() {
        return false;
    }

    let compact = normalized.replace('_', "").replace('-', "");
    if compact.starts_with('+') || compact.starts_with('-') {
        return compact[1..].contains('V') || compact.ends_with("V") || compact.ends_with("MV");
    }

    compact.chars().any(|ch| ch.is_ascii_digit()) && compact.contains('V')
}

fn ensure_required_string(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn normalize_properties(properties: &mut Option<crate::Properties>) {
    let Some(properties_map) = properties.as_mut() else {
        return;
    };

    properties_map.retain(|_, value| match value {
        Value::String(text) => {
            let trimmed = text.trim().to_string();
            if trimmed.is_empty() {
                return false;
            }

            *text = trimmed;
            true
        }
        _ => true,
    });

    if properties_map.is_empty() {
        *properties = None;
    }
}

fn unique_non_empty(values: Vec<String>) -> Vec<String> {
    let mut set = BTreeSet::new();
    for value in values {
        let trimmed = value.trim().to_string();
        if !trimmed.is_empty() {
            set.insert(trimmed);
        }
    }
    set.into_iter().collect()
}

fn default_side_for_terminal(terminal: &TerminalDefinition) -> TerminalSide {
    if terminal_flow_direction(terminal) == Some(TerminalDirection::Output) {
        TerminalSide::Right
    } else {
        TerminalSide::Left
    }
}

fn normalize_rotation_deg(value: f64) -> f64 {
    let normalized = value % 360.0;
    if normalized < 0.0 {
        normalized + 360.0
    } else {
        normalized
    }
}

fn normalize_network_line_length(value: f64) -> Option<f64> {
    if !value.is_finite() || value <= 0.0 {
        return None;
    }

    Some(value.clamp(120.0, 2400.0))
}

fn push_unique_id_issue(issues: &mut Vec<ValidationIssue>, ids: &mut BTreeSet<String>, id: &str) {
    if !ids.insert(id.to_string()) {
        issues.push(semantic_issue(
            "semantic.id.duplicate",
            format!("Duplicate id detected: {}", id),
            Some(id.to_string()),
        ));
    }
}

fn semantic_issue(code: &str, message: String, entity_id: Option<String>) -> ValidationIssue {
    ValidationIssue {
        severity: IssueSeverity::Error,
        code: code.to_string(),
        message,
        entity_id,
        path: None,
    }
}

fn semantic_warning(code: &str, message: String, entity_id: Option<String>) -> ValidationIssue {
    ValidationIssue {
        severity: IssueSeverity::Warning,
        code: code.to_string(),
        message,
        entity_id,
        path: None,
    }
}

fn make_id(prefix: &str) -> String {
    format!("{}.{}", prefix, Utc::now().timestamp_millis())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DeviceDefinition, DeviceShape, DeviceViewDefinition, Point, Size, TerminalDefinition};
    use serde_json::json;

    fn sample_document() -> DocumentFile {
        DocumentFile {
            schema_version: "4.0.0".into(),
            document: DocumentMeta {
                id: "doc.demo".into(),
                title: "Demo".into(),
                description: None,
                created_at: None,
                updated_at: None,
                source: Some(DocumentSource::Human),
                language: Some("zh-CN".into()),
                tags: Some(Vec::new()),
                extensions: None,
            },
            devices: vec![
                DeviceDefinition {
                    id: "device.mcu".into(),
                    name: "MCU".into(),
                    kind: "controller".into(),
                    category: Some("logic".into()),
                    description: None,
                    reference: Some("U1".into()),
                    tags: Some(Vec::new()),
                    terminals: vec![TerminalDefinition {
                        id: "terminal.mcu.scl".into(),
                        name: "I2C1_SCL".into(),
                        label: Some("SCL".into()),
                        direction: TerminalDirection::Output,
                        logical_direction: None,
                        role: None,
                        description: None,
                        pin: None,
                        required: Some(true),
                        side: Some(TerminalSide::Left),
                        order: Some(0),
                        extensions: None,
                    }],
                    properties: None,
                    extensions: None,
                },
                DeviceDefinition {
                    id: "device.sensor".into(),
                    name: "Temp Sensor".into(),
                    kind: "sensor".into(),
                    category: Some("input".into()),
                    description: None,
                    reference: Some("U2".into()),
                    tags: Some(Vec::new()),
                    terminals: vec![TerminalDefinition {
                        id: "terminal.sensor.scl".into(),
                        name: "SCL".into(),
                        label: Some("SCL".into()),
                        direction: TerminalDirection::Input,
                        logical_direction: None,
                        role: None,
                        description: None,
                        pin: None,
                        required: Some(true),
                        side: Some(TerminalSide::Left),
                        order: Some(0),
                        extensions: None,
                    }],
                    properties: None,
                    extensions: None,
                },
            ],
            view: ViewDefinition {
                canvas: CanvasViewDefinition {
                    units: "px".into(),
                    grid: Some(GridDefinition {
                        enabled: true,
                        size: 36.0,
                        major_every: Some(5),
                    }),
                    background: Some("grid".into()),
                    extensions: None,
                },
                devices: Some(BTreeMap::from([(
                    "device.mcu".into(),
                    DeviceViewDefinition {
                        position: Some(Point { x: 160.0, y: 180.0 }),
                        size: Some(Size {
                            width: 220.0,
                            height: 136.0,
                        }),
                        rotation_deg: None,
                        shape: Some(DeviceShape::Rectangle),
                        locked: None,
                        collapsed: None,
                        group_id: None,
                        extensions: None,
                    },
                )])),
                network_lines: Some(BTreeMap::new()),
                focus: Some(FocusViewDefinition {
                    default_device_id: Some("device.mcu".into()),
                    preferred_direction: Some(FocusDirection::LeftToRight),
                    extensions: None,
                }),
                extensions: None,
            },
            extensions: None,
        }
    }

    #[test]
    fn normalizes_terminal_side_and_tags() {
        let mut document = sample_document();
        document.document.tags = Some(vec![" logic ".into(), "logic".into(), "".into()]);
        document.devices[0].terminals[0].side = None;

        normalize_document(&mut document);

        assert_eq!(document.document.tags.unwrap(), vec!["logic"]);
        assert!(matches!(
            document.devices[0].terminals[0].side,
            Some(TerminalSide::Right)
        ));
    }

    #[test]
    fn warns_required_terminal_without_label() {
        let mut document = sample_document();
        document.devices[0].terminals[0].label = None;

        let issues = validate_semantics(&document);

        assert!(issues
            .iter()
            .any(|issue| issue.code == "semantic.terminal.requiredUnlabeled"));
    }

    #[test]
    fn errors_when_component_value_is_missing() {
        let mut document = sample_document();
        document.devices.push(DeviceDefinition {
            id: "device.r1".into(),
            name: "Pull-up".into(),
            kind: "resistor".into(),
            category: None,
            description: None,
            reference: Some("R1".into()),
            tags: Some(Vec::new()),
            terminals: vec![],
            properties: None,
            extensions: None,
        });

        let issues = validate_semantics(&document);

        assert!(issues
            .iter()
            .any(|issue| issue.code == "semantic.device.value.missing"));
    }

    #[test]
    fn errors_when_power_label_has_no_concrete_voltage() {
        let value = json!({
            "schemaVersion": "4.0.0",
            "document": {
                "id": "doc.power-demo",
                "title": "Power Demo"
            },
            "devices": [{
                "id": "device.source",
                "name": "Power Header",
                "kind": "connector",
                "reference": "J1",
                "terminals": [{
                    "id": "terminal.source.vcc",
                    "name": "POWER_OUT_1_J1",
                    "label": "VCC",
                    "direction": "output"
                }]
            }, {
                "id": "device.load",
                "name": "Amplifier",
                "kind": "op-amp",
                "reference": "U1",
                "terminals": [{
                    "id": "terminal.load.vcc",
                    "name": "POWER_IN_1_U1",
                    "label": "VCC",
                    "direction": "input"
                }]
            }],
            "view": {
                "canvas": {
                    "units": "px",
                    "grid": { "enabled": true, "size": 36, "majorEvery": 5 },
                    "background": "grid"
                }
            }
        });

        let document = serde_json::from_value::<DocumentFile>(value).expect("document should parse");

        let issues = validate_semantics(&document);

        assert!(issues
            .iter()
            .any(|issue| issue.code == "semantic.label.powerVoltage.missing"));
    }

    #[test]
    fn parses_semantic_v4_document() {
        let value = json!({
            "schemaVersion": "4.0.0",
            "document": {
                "id": "doc.demo",
                "title": "Demo"
            },
            "devices": [{
                "id": "device.mcu",
                "name": "MCU",
                "kind": "controller",
                "terminals": [{
                    "id": "terminal.mcu.scl",
                    "name": "SCL",
                    "label": "SCL",
                    "direction": "output"
                }]
            }],
            "view": {
                "canvas": {
                    "units": "px",
                    "grid": { "enabled": true, "size": 36, "majorEvery": 5 },
                    "background": "grid"
                }
            }
        });

        let report = validate_value(value).expect("validation should not fail");

        assert!(matches!(report.detected_format, DetectedDocumentFormat::SemanticV4));
        assert!(report.schema_valid);
        assert!(report.semantic_valid);
        assert!(report.normalized_document.is_some());
    }

    #[test]
    fn preserves_extended_terminal_directions_and_logical_direction() {
        let value = json!({
            "schemaVersion": "4.0.0",
            "document": {
                "id": "doc.legacy",
                "title": "Legacy"
            },
            "devices": [{
                "id": "device.r1",
                "name": "Divider Resistor",
                "kind": "resistor",
                "reference": "R1",
                "terminals": [{
                    "id": "terminal.r1.a",
                    "name": "PASSIVE_1_R1",
                    "label": "VIN",
                    "direction": "passive",
                    "logicalDirection": "input",
                    "order": 0
                }, {
                    "id": "terminal.r1.b",
                    "name": "PASSIVE_2_R1",
                    "label": "DIV_OUT",
                    "direction": "passive",
                    "logicalDirection": "output",
                    "order": 1
                }, {
                    "id": "terminal.r1.sda",
                    "name": "SDA",
                    "label": "SDA",
                    "direction": "bidirectional",
                    "logicalDirection": "output",
                    "side": "top",
                    "order": 2
                }],
                "properties": {
                    "value": "10k"
                }
            }],
            "view": {
                "canvas": {
                    "units": "px",
                    "grid": { "enabled": true, "size": 36, "majorEvery": 5 },
                    "background": "grid"
                }
            }
        });

        let mut document = serde_json::from_value::<DocumentFile>(value).expect("legacy document should parse");
        normalize_document(&mut document);

        let terminals = &document.devices[0].terminals;
        assert_eq!(terminals[0].direction, TerminalDirection::Passive);
        assert_eq!(terminals[0].logical_direction, Some(TerminalDirection::Input));
        assert_eq!(terminals[0].side, Some(TerminalSide::Left));
        assert_eq!(terminals[1].direction, TerminalDirection::Passive);
        assert_eq!(terminals[1].logical_direction, Some(TerminalDirection::Output));
        assert_eq!(terminals[1].side, Some(TerminalSide::Right));
        assert_eq!(terminals[2].direction, TerminalDirection::Bidirectional);
        assert_eq!(terminals[2].logical_direction, Some(TerminalDirection::Output));
        assert_eq!(terminals[2].side, Some(TerminalSide::Right));
    }

    #[test]
    fn bundled_examples_validate() {
        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repo_root = manifest_dir
            .ancestors()
            .nth(4)
            .expect("repo root should exist");

        for relative in [
            "testJson/semantic-v4-demo.json",
            "testJson/butterworth-4th-order-lowpass.json",
            "testJson/lm358-noninverting-amplifier.json",
            "testJson/rc-low-pass-filter.json",
            "testJson/resistor-voltage-divider.json",
            "testJson/ripple-carry-adder-4bit.json",
            "testJson/stm32f103c8t6-minimum-system.json",
            "testJson/stm32f103-pwm-motor-driver-18v.json",
        ] {
            let path = repo_root.join(relative);
            let content =
                std::fs::read_to_string(&path).unwrap_or_else(|_| panic!("failed to read {:?}", path));
            let value: Value =
                serde_json::from_str(&content).unwrap_or_else(|_| panic!("invalid JSON in {:?}", path));
            let report =
                validate_value(value).unwrap_or_else(|_| panic!("validation failed for {:?}", path));

            assert!(
                matches!(report.detected_format, DetectedDocumentFormat::SemanticV4),
                "unexpected format for {:?}",
                path
            );
            assert!(report.schema_valid, "schema invalid for {:?}: {:?}", path, report.issues);
            assert!(
                report.semantic_valid,
                "semantic validation failed for {:?}: {:?}",
                path,
                report.issues
            );
            assert!(
                report.normalized_document.is_some(),
                "normalized document missing for {:?}",
                path
            );
        }
    }
}
