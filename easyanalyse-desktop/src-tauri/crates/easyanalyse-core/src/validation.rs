use std::collections::{BTreeMap, BTreeSet};

use chrono::Utc;
use once_cell::sync::Lazy;
use serde::Serialize;
use serde_json::Value;
use thiserror::Error;

use crate::{
    AnnotationEntityType, CanvasDefinition, ComponentEntity, ComponentGeometry, DocumentFile,
    DocumentMeta, DocumentSource, EndpointRef, EndpointType, GridDefinition, NodeEntity, Point,
    PortAnchor, RectangleSide, WireEntity, WireRoute,
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
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub schema_valid: bool,
    pub semantic_valid: bool,
    pub issue_count: usize,
    pub issues: Vec<ValidationIssue>,
    pub normalized_document: Option<DocumentFile>,
}

pub fn default_document(title: &str) -> DocumentFile {
    let timestamp = Utc::now().to_rfc3339();

    DocumentFile {
        schema_version: "1.0.0".to_string(),
        document: DocumentMeta {
            id: make_id("doc"),
            title: title.to_string(),
            description: None,
            created_at: Some(timestamp.clone()),
            updated_at: Some(timestamp),
            source: Some(DocumentSource::Human),
            extensions: None,
        },
        canvas: CanvasDefinition {
            origin: Point { x: 0.0, y: 0.0 },
            width: 2400.0,
            height: 1600.0,
            units: "px".to_string(),
            grid: Some(GridDefinition {
                enabled: true,
                size: 40.0,
            }),
            extensions: None,
        },
        components: Vec::new(),
        ports: Vec::new(),
        nodes: Vec::new(),
        wires: Vec::new(),
        annotations: Vec::new(),
        extensions: None,
    }
}

pub fn validate_value(value: Value) -> Result<ValidationReport, CoreError> {
    let schema_issues = validate_schema(&value)?;

    match serde_json::from_value::<DocumentFile>(value) {
        Ok(mut document) => {
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

            Ok(ValidationReport {
                schema_valid,
                semantic_valid,
                issue_count: issues.len(),
                issues,
                normalized_document: Some(document),
            })
        }
        Err(error) => {
            let mut issues = schema_issues;
            issues.push(ValidationIssue {
                severity: IssueSeverity::Error,
                code: "schema.parse".to_string(),
                message: error.to_string(),
                entity_id: None,
                path: None,
            });

            Ok(ValidationReport {
                schema_valid: false,
                semantic_valid: false,
                issue_count: issues.len(),
                issues,
                normalized_document: None,
            })
        }
    }
}

pub fn normalize_document(document: &mut DocumentFile) {
    let mut connected: BTreeMap<String, Vec<String>> = document
        .nodes
        .iter()
        .map(|node| (node.id.clone(), Vec::new()))
        .collect();

    for wire in &document.wires {
        if let EndpointType::Node = wire.source.entity_type {
            if let Some(entry) = connected.get_mut(&wire.source.ref_id) {
                entry.push(wire.id.clone());
            }
        }

        if let EndpointType::Node = wire.target.entity_type {
            if let Some(entry) = connected.get_mut(&wire.target.ref_id) {
                entry.push(wire.id.clone());
            }
        }
    }

    for node in &mut document.nodes {
        if let Some(ids) = connected.get_mut(&node.id) {
            ids.sort();
            node.connected_wire_ids = ids.clone();
        }
    }

    document
        .components
        .sort_by(|left, right| left.id.cmp(&right.id));
    document.ports.sort_by(|left, right| left.id.cmp(&right.id));
    document.nodes.sort_by(|left, right| left.id.cmp(&right.id));
    document.wires.sort_by(|left, right| left.id.cmp(&right.id));
    document
        .annotations
        .sort_by(|left, right| left.id.cmp(&right.id));
    document.document.updated_at = Some(Utc::now().to_rfc3339());
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

    push_unique_id_issue(&mut issues, &mut ids, &document.document.id);

    for component in &document.components {
        push_unique_id_issue(&mut issues, &mut ids, &component.id);
    }
    for port in &document.ports {
        push_unique_id_issue(&mut issues, &mut ids, &port.id);
    }
    for node in &document.nodes {
        push_unique_id_issue(&mut issues, &mut ids, &node.id);
    }
    for wire in &document.wires {
        push_unique_id_issue(&mut issues, &mut ids, &wire.id);
    }
    for annotation in &document.annotations {
        push_unique_id_issue(&mut issues, &mut ids, &annotation.id);
    }

    let component_lookup = document
        .components
        .iter()
        .map(|item| (item.id.as_str(), item))
        .collect::<BTreeMap<_, _>>();
    let port_lookup = document
        .ports
        .iter()
        .map(|item| (item.id.as_str(), item))
        .collect::<BTreeMap<_, _>>();
    let node_lookup = document
        .nodes
        .iter()
        .map(|item| (item.id.as_str(), item))
        .collect::<BTreeMap<_, _>>();
    let wire_lookup = document
        .wires
        .iter()
        .map(|item| (item.id.as_str(), item))
        .collect::<BTreeMap<_, _>>();

    for port in &document.ports {
        let component = component_lookup.get(port.component_id.as_str());
        if component.is_none() {
            issues.push(semantic_issue(
                "semantic.port.component",
                format!(
                    "Port {} references missing component {}",
                    port.id, port.component_id
                ),
                Some(port.id.clone()),
            ));
            continue;
        }

        if let Some(component) = component {
            if !anchor_matches_geometry(&port.anchor, &component.geometry) {
                issues.push(semantic_issue(
                    "semantic.port.anchor",
                    format!(
                        "Port {} uses an anchor incompatible with component {} geometry",
                        port.id, component.id
                    ),
                    Some(port.id.clone()),
                ));
            }
        }
    }

    for wire in &document.wires {
        for endpoint in [&wire.source, &wire.target] {
            if !endpoint_exists(endpoint, &port_lookup, &node_lookup) {
                issues.push(semantic_issue(
                    "semantic.wire.endpoint",
                    format!(
                        "Wire {} references missing endpoint {}",
                        wire.id, endpoint.ref_id
                    ),
                    Some(wire.id.clone()),
                ));
            }
        }

        if let WireRoute::Polyline { bend_points } = &wire.route {
            let source = endpoint_point(document, &wire.source);
            let target = endpoint_point(document, &wire.target);

            if let (Some(source), Some(target)) = (source, target) {
                for point in bend_points {
                    if points_equal(point, &source) || points_equal(point, &target) {
                        issues.push(semantic_issue(
                            "semantic.wire.polyline",
                            format!("Wire {} repeats an endpoint inside bendPoints", wire.id),
                            Some(wire.id.clone()),
                        ));
                        break;
                    }
                }
            }
        }
    }

    for node in &document.nodes {
        let actual = actual_node_wire_ids(node, &document.wires);
        let expected = node.connected_wire_ids.clone();
        if actual != expected {
            issues.push(semantic_issue(
                "semantic.node.connectedWireIds",
                format!("Node {} has inconsistent connectedWireIds", node.id),
                Some(node.id.clone()),
            ));
        }
    }

    for annotation in &document.annotations {
        let target_exists = match annotation.target.entity_type {
            AnnotationEntityType::Component => {
                component_lookup.contains_key(annotation.target.ref_id.as_str())
            }
            AnnotationEntityType::Port => {
                port_lookup.contains_key(annotation.target.ref_id.as_str())
            }
            AnnotationEntityType::Node => {
                node_lookup.contains_key(annotation.target.ref_id.as_str())
            }
            AnnotationEntityType::Wire => {
                wire_lookup.contains_key(annotation.target.ref_id.as_str())
            }
        };

        if !target_exists {
            issues.push(semantic_issue(
                "semantic.annotation.target",
                format!(
                    "Annotation {} references missing target {}",
                    annotation.id, annotation.target.ref_id
                ),
                Some(annotation.id.clone()),
            ));
        }
    }

    issues
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

fn endpoint_exists<'a>(
    endpoint: &EndpointRef,
    ports: &BTreeMap<&'a str, &'a crate::PortEntity>,
    nodes: &BTreeMap<&'a str, &'a NodeEntity>,
) -> bool {
    match endpoint.entity_type {
        EndpointType::Port => ports.contains_key(endpoint.ref_id.as_str()),
        EndpointType::Node => nodes.contains_key(endpoint.ref_id.as_str()),
    }
}

fn endpoint_point(document: &DocumentFile, endpoint: &EndpointRef) -> Option<Point> {
    match endpoint.entity_type {
        EndpointType::Node => document
            .nodes
            .iter()
            .find(|node| node.id == endpoint.ref_id)
            .map(|node| node.position.clone()),
        EndpointType::Port => {
            let port = document
                .ports
                .iter()
                .find(|port| port.id == endpoint.ref_id)?;
            let component = document
                .components
                .iter()
                .find(|component| component.id == port.component_id)?;
            Some(port_anchor_point(component, &port.anchor))
        }
    }
}

fn port_anchor_point(component: &ComponentEntity, anchor: &PortAnchor) -> Point {
    let base = match (&component.geometry, anchor) {
        (
            ComponentGeometry::Rectangle {
                x,
                y,
                width,
                height,
            },
            PortAnchor::RectangleSide { side, offset },
        ) => match side {
            RectangleSide::Top => Point {
                x: x + width * offset,
                y: *y,
            },
            RectangleSide::Right => Point {
                x: x + width,
                y: y + height * offset,
            },
            RectangleSide::Bottom => Point {
                x: x + width * offset,
                y: y + height,
            },
            RectangleSide::Left => Point {
                x: *x,
                y: y + height * offset,
            },
        },
        (ComponentGeometry::Circle { cx, cy, radius }, PortAnchor::CircleAngle { angle_deg }) => {
            let radians = angle_deg.to_radians();
            Point {
                x: cx + radians.cos() * radius,
                y: cy + radians.sin() * radius,
            }
        }
        (
            ComponentGeometry::Triangle { vertices },
            PortAnchor::TriangleEdge { edge_index, offset },
        ) => {
            let start = &vertices[*edge_index as usize];
            let end = &vertices[((*edge_index as usize) + 1) % 3];
            Point {
                x: start.x + (end.x - start.x) * offset,
                y: start.y + (end.y - start.y) * offset,
            }
        }
        (geometry, _) => geometry_center(geometry),
    };

    rotate_point(
        &base,
        &geometry_center(&component.geometry),
        component_rotation_deg(component),
    )
}

fn geometry_center(geometry: &ComponentGeometry) -> Point {
    match geometry {
        ComponentGeometry::Rectangle {
            x,
            y,
            width,
            height,
        } => Point {
            x: x + width / 2.0,
            y: y + height / 2.0,
        },
        ComponentGeometry::Circle { cx, cy, .. } => Point { x: *cx, y: *cy },
        ComponentGeometry::Triangle { vertices } => Point {
            x: (vertices[0].x + vertices[1].x + vertices[2].x) / 3.0,
            y: (vertices[0].y + vertices[1].y + vertices[2].y) / 3.0,
        },
    }
}

fn rotate_point(point: &Point, center: &Point, angle_deg: f64) -> Point {
    if angle_deg.abs() < f64::EPSILON {
        return point.clone();
    }

    let radians = angle_deg.to_radians();
    let cos = radians.cos();
    let sin = radians.sin();
    let dx = point.x - center.x;
    let dy = point.y - center.y;

    Point {
        x: center.x + dx * cos - dy * sin,
        y: center.y + dx * sin + dy * cos,
    }
}

fn component_rotation_deg(component: &ComponentEntity) -> f64 {
    component
        .extensions
        .as_ref()
        .and_then(|extensions| extensions.get("easyanalyse"))
        .and_then(Value::as_object)
        .and_then(|extension| extension.get("rotationDeg"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
}

fn anchor_matches_geometry(anchor: &PortAnchor, geometry: &ComponentGeometry) -> bool {
    matches!(
        (anchor, geometry),
        (
            PortAnchor::RectangleSide { .. },
            ComponentGeometry::Rectangle { .. }
        ) | (
            PortAnchor::CircleAngle { .. },
            ComponentGeometry::Circle { .. }
        ) | (
            PortAnchor::TriangleEdge { .. },
            ComponentGeometry::Triangle { .. }
        )
    )
}

fn actual_node_wire_ids(node: &NodeEntity, wires: &[WireEntity]) -> Vec<String> {
    let mut ids = wires
        .iter()
        .filter(|wire| {
            matches!(wire.source.entity_type, EndpointType::Node) && wire.source.ref_id == node.id
                || matches!(wire.target.entity_type, EndpointType::Node)
                    && wire.target.ref_id == node.id
        })
        .map(|wire| wire.id.clone())
        .collect::<Vec<_>>();
    ids.sort();
    ids
}

fn points_equal(left: &Point, right: &Point) -> bool {
    (left.x - right.x).abs() < 0.001 && (left.y - right.y).abs() < 0.001
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

fn make_id(prefix: &str) -> String {
    format!("{}.{}", prefix, Utc::now().timestamp_millis())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AnnotationEntityType, AnnotationKind, AnnotationTarget, EndpointType, NodeRole,
        PortDirection,
    };
    use serde_json::json;

    fn sample_document() -> DocumentFile {
        DocumentFile {
            schema_version: "1.0.0".into(),
            document: DocumentMeta {
                id: "doc.demo".into(),
                title: "Demo".into(),
                description: None,
                created_at: None,
                updated_at: None,
                source: Some(DocumentSource::Human),
                extensions: None,
            },
            canvas: CanvasDefinition {
                origin: Point { x: 0.0, y: 0.0 },
                width: 1600.0,
                height: 900.0,
                units: "px".into(),
                grid: Some(GridDefinition {
                    enabled: true,
                    size: 40.0,
                }),
                extensions: None,
            },
            components: vec![ComponentEntity {
                id: "component.mcu".into(),
                name: "MCU".into(),
                geometry: ComponentGeometry::Rectangle {
                    x: 120.0,
                    y: 120.0,
                    width: 220.0,
                    height: 140.0,
                },
                description: None,
                tags: None,
                extensions: None,
            }],
            ports: vec![crate::PortEntity {
                id: "port.mcu.out".into(),
                component_id: "component.mcu".into(),
                name: "OUT".into(),
                direction: PortDirection::Output,
                pin_info: None,
                anchor: PortAnchor::RectangleSide {
                    side: RectangleSide::Right,
                    offset: 0.5,
                },
                description: None,
                extensions: None,
            }],
            nodes: vec![NodeEntity {
                id: "node.mid".into(),
                position: Point { x: 480.0, y: 190.0 },
                connected_wire_ids: vec!["wire.1".into()],
                role: Some(NodeRole::Junction),
                description: None,
                extensions: None,
            }],
            wires: vec![WireEntity {
                id: "wire.1".into(),
                serial_number: "W1".into(),
                source: EndpointRef {
                    entity_type: EndpointType::Port,
                    ref_id: "port.mcu.out".into(),
                },
                target: EndpointRef {
                    entity_type: EndpointType::Node,
                    ref_id: "node.mid".into(),
                },
                route: WireRoute::Straight,
                description: None,
                extensions: None,
            }],
            annotations: vec![crate::AnnotationEntity {
                id: "annotation.1".into(),
                kind: AnnotationKind::Signal,
                target: AnnotationTarget {
                    entity_type: AnnotationEntityType::Port,
                    ref_id: "port.mcu.out".into(),
                },
                text: "3.3V PWM".into(),
                position: None,
                extensions: None,
            }],
            extensions: None,
        }
    }

    #[test]
    fn normalizes_connected_wire_ids() {
        let mut document = sample_document();
        document.nodes[0].connected_wire_ids.clear();

        normalize_document(&mut document);

        assert_eq!(document.nodes[0].connected_wire_ids, vec!["wire.1"]);
    }

    #[test]
    fn detects_duplicate_ids() {
        let mut document = sample_document();
        document.nodes[0].id = "port.mcu.out".into();

        let issues = validate_semantics(&document);

        assert!(
            issues
                .iter()
                .any(|issue| issue.code == "semantic.id.duplicate")
        );
    }

    #[test]
    fn detects_incompatible_port_anchor() {
        let mut document = sample_document();
        document.ports[0].anchor = PortAnchor::CircleAngle { angle_deg: 45.0 };

        let issues = validate_semantics(&document);

        assert!(
            issues
                .iter()
                .any(|issue| issue.code == "semantic.port.anchor")
        );
    }

    #[test]
    fn parses_frontend_circle_anchor_fields() {
        let value = json!({
            "schemaVersion": "1.0.0",
            "document": {
                "id": "doc.demo",
                "title": "Demo"
            },
            "canvas": {
                "origin": { "x": 0.0, "y": 0.0 },
                "width": 1200.0,
                "height": 800.0,
                "units": "px"
            },
            "components": [{
                "id": "component.round",
                "name": "Round",
                "geometry": {
                    "type": "circle",
                    "cx": 200.0,
                    "cy": 200.0,
                    "radius": 48.0
                }
            }],
            "ports": [{
                "id": "port.round.out",
                "componentId": "component.round",
                "name": "OUT",
                "direction": "output",
                "anchor": {
                    "kind": "circle-angle",
                    "angleDeg": 45.0
                }
            }],
            "nodes": [],
            "wires": [],
            "annotations": []
        });

        let report = validate_value(value).expect("validation should not fail");

        assert!(report.normalized_document.is_some());
    }

    #[test]
    fn parses_frontend_polyline_bend_points() {
        let value = json!({
            "schemaVersion": "1.0.0",
            "document": {
                "id": "doc.demo",
                "title": "Demo"
            },
            "canvas": {
                "origin": { "x": 0.0, "y": 0.0 },
                "width": 1200.0,
                "height": 800.0,
                "units": "px"
            },
            "components": [{
                "id": "component.rect",
                "name": "Rect",
                "geometry": {
                    "type": "rectangle",
                    "x": 100.0,
                    "y": 100.0,
                    "width": 200.0,
                    "height": 120.0
                }
            }],
            "ports": [{
                "id": "port.rect.out",
                "componentId": "component.rect",
                "name": "OUT",
                "direction": "output",
                "anchor": {
                    "kind": "rectangle-side",
                    "side": "right",
                    "offset": 0.5
                }
            }],
            "nodes": [{
                "id": "node.mid",
                "position": { "x": 420.0, "y": 160.0 },
                "connectedWireIds": ["wire.1", "wire.2"]
            }],
            "wires": [{
                "id": "wire.1",
                "serialNumber": "W1",
                "source": { "entityType": "port", "refId": "port.rect.out" },
                "target": { "entityType": "node", "refId": "node.mid" },
                "route": {
                    "kind": "polyline",
                    "bendPoints": [
                        { "x": 320.0, "y": 160.0 },
                        { "x": 360.0, "y": 220.0 }
                    ]
                }
            }],
            "annotations": []
        });

        let report = validate_value(value).expect("validation should not fail");

        assert!(report.normalized_document.is_some());
    }
}
