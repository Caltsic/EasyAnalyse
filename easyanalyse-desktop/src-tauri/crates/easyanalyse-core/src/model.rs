use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub type Extensions = Map<String, Value>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentFile {
    pub schema_version: String,
    pub document: DocumentMeta,
    pub canvas: CanvasDefinition,
    pub components: Vec<ComponentEntity>,
    pub ports: Vec<PortEntity>,
    pub nodes: Vec<NodeEntity>,
    pub wires: Vec<WireEntity>,
    pub annotations: Vec<AnnotationEntity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extensions: Option<Extensions>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMeta {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<DocumentSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extensions: Option<Extensions>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DocumentSource {
    Human,
    Ai,
    Mixed,
    Imported,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CanvasDefinition {
    pub origin: Point,
    pub width: f64,
    pub height: f64,
    pub units: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grid: Option<GridDefinition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extensions: Option<Extensions>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GridDefinition {
    pub enabled: bool,
    pub size: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ComponentEntity {
    pub id: String,
    pub name: String,
    pub geometry: ComponentGeometry,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extensions: Option<Extensions>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum ComponentGeometry {
    #[serde(rename = "rectangle")]
    Rectangle {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
    #[serde(rename = "circle")]
    Circle { cx: f64, cy: f64, radius: f64 },
    #[serde(rename = "triangle")]
    Triangle { vertices: [Point; 3] },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PortEntity {
    pub id: String,
    pub component_id: String,
    pub name: String,
    pub direction: PortDirection,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pin_info: Option<PinInfo>,
    pub anchor: PortAnchor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extensions: Option<Extensions>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PortDirection {
    Input,
    Output,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PinInfo {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
pub enum PortAnchor {
    #[serde(rename = "rectangle-side")]
    RectangleSide { side: RectangleSide, offset: f64 },
    #[serde(rename = "circle-angle")]
    CircleAngle {
        #[serde(rename = "angleDeg")]
        angle_deg: f64,
    },
    #[serde(rename = "triangle-edge")]
    TriangleEdge {
        #[serde(rename = "edgeIndex")]
        edge_index: u8,
        offset: f64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RectangleSide {
    Top,
    Right,
    Bottom,
    Left,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NodeEntity {
    pub id: String,
    pub position: Point,
    pub connected_wire_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<NodeRole>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extensions: Option<Extensions>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NodeRole {
    Generic,
    Junction,
    Branch,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WireEntity {
    pub id: String,
    pub serial_number: String,
    pub source: EndpointRef,
    pub target: EndpointRef,
    pub route: WireRoute,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extensions: Option<Extensions>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EndpointRef {
    pub entity_type: EndpointType,
    pub ref_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum EndpointType {
    Port,
    Node,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
pub enum WireRoute {
    #[serde(rename = "straight")]
    Straight,
    #[serde(rename = "polyline")]
    Polyline {
        #[serde(rename = "bendPoints")]
        bend_points: Vec<Point>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AnnotationEntity {
    pub id: String,
    pub kind: AnnotationKind,
    pub target: AnnotationTarget,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<Point>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extensions: Option<Extensions>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AnnotationKind {
    Signal,
    Note,
    Label,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationTarget {
    pub entity_type: AnnotationEntityType,
    pub ref_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AnnotationEntityType {
    Component,
    Port,
    Node,
    Wire,
}
