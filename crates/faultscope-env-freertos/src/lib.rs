//! `FreeRTOS` execution-environment provider.

use std::{collections::BTreeMap, convert::Infallible};

use faultscope_core::EnvironmentProvider;
use faultscope_model::{
    Event, ExecutionEntity, ExecutionEntityId, ExecutionEntityKind, ExecutionEnvironmentId,
    Finding, TargetSnapshot,
};
use serde_json::Value;

pub struct FreeRtos;

impl EnvironmentProvider for FreeRtos {
    type Error = Infallible;

    fn id(&self) -> ExecutionEnvironmentId {
        ExecutionEnvironmentId("freertos".to_owned())
    }

    fn reconstruct_entities(&self, events: &[Event]) -> Result<Vec<ExecutionEntity>, Self::Error> {
        let mut entities = BTreeMap::new();
        for id in events
            .iter()
            .filter_map(|event| event.execution_entity.as_ref())
        {
            entities.entry(id.0.clone()).or_insert_with(|| entity(id));
        }
        Ok(entities.into_values().collect())
    }

    fn analyze(
        &self,
        _snapshot: &TargetSnapshot,
        _events: &[Event],
    ) -> Result<Vec<Finding>, Self::Error> {
        Ok(Vec::new())
    }
}

fn entity(id: &ExecutionEntityId) -> ExecutionEntity {
    let (prefix, label) = id.0.split_once('.').unwrap_or(("context", &id.0));
    let kind = match prefix {
        "task" => "task",
        "isr" => "isr",
        _ => "context",
    };
    ExecutionEntity {
        id: id.clone(),
        kind: ExecutionEntityKind(kind.to_owned()),
        label: label.replace('_', " "),
        attributes: Value::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use faultscope_model::{EventId, EventKind, EventSource};

    #[test]
    fn reconstructs_only_entities_explicitly_referenced_by_events() {
        let event = |id: &str| Event {
            id: EventId(format!("event.{id}")),
            timestamp_ns: 1,
            source: EventSource("runtime.log".into()),
            kind: EventKind("task_switch".into()),
            execution_entity: Some(ExecutionEntityId(id.into())),
            address: None,
            attributes: Value::Null,
        };
        let entities = FreeRtos
            .reconstruct_entities(&[event("task.sensor"), event("isr.adc"), event("task.sensor")])
            .unwrap();

        assert_eq!(entities.len(), 2);
        assert_eq!(entities[0].kind.0, "isr");
        assert_eq!(entities[1].label, "sensor");
    }
}
