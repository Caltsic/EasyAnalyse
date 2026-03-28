use std::collections::BTreeMap;

use serde::Serialize;

use crate::{AnnotationEntity, ComponentEntity, DocumentFile, NodeEntity, PortEntity, WireEntity};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffBucket {
    pub added: usize,
    pub removed: usize,
    pub changed: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffSummary {
    pub components: DiffBucket,
    pub ports: DiffBucket,
    pub nodes: DiffBucket,
    pub wires: DiffBucket,
    pub annotations: DiffBucket,
    pub total_changes: usize,
}

pub fn summarize_document_diff(previous: &DocumentFile, next: &DocumentFile) -> DiffSummary {
    let components = summarize_bucket(&previous.components, &next.components);
    let ports = summarize_bucket(&previous.ports, &next.ports);
    let nodes = summarize_bucket(&previous.nodes, &next.nodes);
    let wires = summarize_bucket(&previous.wires, &next.wires);
    let annotations = summarize_bucket(&previous.annotations, &next.annotations);

    let total_changes = components.added
        + components.removed
        + components.changed
        + ports.added
        + ports.removed
        + ports.changed
        + nodes.added
        + nodes.removed
        + nodes.changed
        + wires.added
        + wires.removed
        + wires.changed
        + annotations.added
        + annotations.removed
        + annotations.changed;

    DiffSummary {
        components,
        ports,
        nodes,
        wires,
        annotations,
        total_changes,
    }
}

fn summarize_bucket<T>(previous: &[T], next: &[T]) -> DiffBucket
where
    T: EntityWithId + Serialize,
{
    let previous_map = previous
        .iter()
        .map(|entity| {
            (
                entity.id().to_string(),
                serde_json::to_string(entity).unwrap_or_default(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let next_map = next
        .iter()
        .map(|entity| {
            (
                entity.id().to_string(),
                serde_json::to_string(entity).unwrap_or_default(),
            )
        })
        .collect::<BTreeMap<_, _>>();

    let added = next_map
        .keys()
        .filter(|key| !previous_map.contains_key(*key))
        .count();
    let removed = previous_map
        .keys()
        .filter(|key| !next_map.contains_key(*key))
        .count();
    let changed = next_map
        .iter()
        .filter(|(key, value)| {
            previous_map
                .get(*key)
                .is_some_and(|previous| previous != *value)
        })
        .count();

    DiffBucket {
        added,
        removed,
        changed,
    }
}

trait EntityWithId {
    fn id(&self) -> &str;
}

impl EntityWithId for ComponentEntity {
    fn id(&self) -> &str {
        &self.id
    }
}

impl EntityWithId for PortEntity {
    fn id(&self) -> &str {
        &self.id
    }
}

impl EntityWithId for NodeEntity {
    fn id(&self) -> &str {
        &self.id
    }
}

impl EntityWithId for WireEntity {
    fn id(&self) -> &str {
        &self.id
    }
}

impl EntityWithId for AnnotationEntity {
    fn id(&self) -> &str {
        &self.id
    }
}
