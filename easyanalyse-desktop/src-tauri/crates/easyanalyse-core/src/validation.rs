use std::collections::{BTreeMap, BTreeSet};

use chrono::Utc;
use once_cell::sync::Lazy;
use serde::Serialize;
use serde_json::Value;
use thiserror::Error;

use crate::{
    CanvasViewDefinition, DocumentFile, DocumentMeta, DocumentSource, FocusDirection,
    FocusViewDefinition, GridDefinition, TerminalDirection, TerminalSide, ViewDefinition,
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

            let mut terminals = device
                .terminals
                .drain(..)
                .map(|mut terminal| {
                    terminal.name = ensure_required_string(&terminal.name, &terminal.id);
                    terminal.label = clean_optional(terminal.label);
                    terminal.role = clean_optional(terminal.role);
                    terminal.description = clean_optional(terminal.description);
                    terminal.side =
                        Some(terminal.side.unwrap_or_else(|| default_side(&terminal.direction)));
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
    let mut label_usage = BTreeMap::<String, Vec<(String, TerminalDirection)>>::new();

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
                    .push((terminal.id.clone(), terminal.direction.clone()));
            } else if terminal.required.unwrap_or(false) {
                issues.push(semantic_warning(
                    "semantic.terminal.requiredUnlabeled",
                    format!("Required terminal {} is not assigned a connection label", terminal.id),
                    Some(terminal.id.clone()),
                ));
            }
        }
    }

    for (label, members) in label_usage {
        let output_like_count = members
            .iter()
            .filter(|(_, direction)| {
                matches!(direction, TerminalDirection::Output | TerminalDirection::PowerOut)
            })
            .count();

        if output_like_count > 1 {
            issues.push(semantic_warning(
                "semantic.label.direction.multipleOutputs",
                format!("Connection label {} contains multiple output-like terminals", label),
                None,
            ));
        }
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

fn default_side(direction: &TerminalDirection) -> TerminalSide {
    match direction {
        TerminalDirection::Input | TerminalDirection::PowerIn | TerminalDirection::Ground => {
            TerminalSide::Left
        }
        TerminalDirection::Output | TerminalDirection::PowerOut => TerminalSide::Right,
        TerminalDirection::Bidirectional => TerminalSide::Top,
        TerminalDirection::Passive
        | TerminalDirection::Shield
        | TerminalDirection::Unspecified => TerminalSide::Bottom,
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
                        direction: TerminalDirection::Bidirectional,
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
            Some(TerminalSide::Top)
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
                    "direction": "bidirectional"
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
    fn bundled_examples_validate() {
        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repo_root = manifest_dir
            .ancestors()
            .nth(4)
            .expect("repo root should exist");

        for relative in [
            "testJson/semantic-v4-demo.json",
            "testJson/butterworth-4th-order-lowpass.json",
            "testJson/ripple-carry-adder-4bit.json",
            "testJson/stm32f103c8t6-minimum-system.json",
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
