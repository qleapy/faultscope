use faultscope_model::{
    ArchitectureId, BuildInfo, CrashInfo, Event, EventId, EventKind, EventSource, Evidence,
    EvidenceId, EvidenceSet, ExecutionEntity, ExecutionEntityId, ExecutionEntityKind,
    ExecutionEnvironmentId, FactId, Finding, FindingId, FindingKind, Incident, IncidentId,
    RegisterId, Severity, TargetDescriptor,
};
use serde_json::json;

const VALID_CRASH: &str = include_str!("../../../fixtures/crashes/valid.json");

#[test]
fn crash_json_round_trips() {
    let crash: CrashInfo = serde_json::from_str(VALID_CRASH).expect("valid crash JSON");
    let encoded = serde_json::to_string(&crash).expect("serializable crash");
    let decoded: CrashInfo = serde_json::from_str(&encoded).expect("round-trip crash");

    assert_eq!(decoded, crash);
}

#[test]
fn missing_pc_is_valid() {
    let json = VALID_CRASH.replace("arm.pc", "arm.other");

    let crash: CrashInfo = serde_json::from_str(&json).expect("PC is not universal or required");
    assert!(
        crash
            .snapshot
            .registers
            .0
            .iter()
            .all(|register| register.register.0 != "arm.pc")
    );
}

#[test]
fn rejects_invalid_hexadecimal_register() {
    let json = VALID_CRASH.replace("0x08004567", "08004xyz");
    let error = serde_json::from_str::<CrashInfo>(&json).expect_err("invalid register must fail");

    assert!(error.to_string().contains("register value"));
}

#[test]
fn accepts_unknown_architecture_and_extra_fields() {
    let json = VALID_CRASH
        .replace("arm.cortex-m", "future.quantum")
        .replace(
            r#""build_id": "example-build-001""#,
            r#""build_id": "example-build-001", "vendor_extension": true"#,
        );
    let crash: CrashInfo = serde_json::from_str(&json).expect("forward-compatible crash");

    assert_eq!(crash.target.architecture.0, "future.quantum");
}

#[test]
fn serializes_synthetic_target_combinations_without_schema_changes() {
    let targets = [
        ("arm.cortex-m", "baremetal"),
        ("arm.cortex-m", "freertos"),
        ("aarch64", "linux"),
        ("riscv32", "baremetal"),
        ("riscv64", "zephyr"),
        ("x86_64", "linux"),
    ];

    for (architecture, environment) in targets {
        let mut crash: CrashInfo = serde_json::from_str(VALID_CRASH).expect("valid fixture");
        crash.target = TargetDescriptor {
            architecture: ArchitectureId(architecture.into()),
            execution_environment: ExecutionEnvironmentId(environment.into()),
            ..crash.target
        };

        serde_json::to_string(&crash).expect("generic target must serialize");
    }
}

#[test]
fn incident_round_trips_generic_entities_events_and_evidence() {
    let crash: CrashInfo = serde_json::from_str(VALID_CRASH).expect("valid fixture");
    let entity_id = ExecutionEntityId("cpu.0".into());
    let event_id = EventId("event.1".into());
    let incident = Incident {
        id: IncidentId("incident.1".into()),
        target: crash.target,
        build: BuildInfo {
            id: crash.build_id,
            timestamp: crash.timestamp,
        },
        snapshot: crash.snapshot,
        execution_entities: vec![ExecutionEntity {
            id: entity_id.clone(),
            kind: ExecutionEntityKind("cpu".into()),
            label: "CPU 0".into(),
            attributes: json!({}),
        }],
        events: vec![Event {
            id: event_id.clone(),
            timestamp_ns: 10,
            source: EventSource("fixture".into()),
            kind: EventKind("vendor.future_event".into()),
            execution_entity: Some(entity_id),
            address: None,
            attributes: json!({ "message": "before crash" }),
        }],
        findings: vec![Finding {
            id: FindingId("finding.1".into()),
            severity: Severity::High,
            confidence: 0.9,
            kind: FindingKind("possible_fault".into()),
            title: "Possible fault".into(),
            description: "Evidence-backed interpretation".into(),
            evidence: EvidenceSet::new(Evidence {
                id: EvidenceId("evidence.1".into()),
                description: "Observed event and fault fact".into(),
                fact: Some(FactId("arch.example.cause".into())),
                event: Some(event_id),
                register: Some(RegisterId("example.pc".into())),
                frame: Some(0),
            }),
        }],
    };

    let value = serde_json::to_value(&incident).expect("serializable incident");
    let decoded: Incident = serde_json::from_value(value).expect("round-trip incident");

    assert_eq!(decoded, incident);
    assert_eq!(decoded.findings[0].evidence.as_slice().len(), 1);
}

#[test]
fn evidence_set_can_be_extended_without_becoming_empty() {
    let evidence = |id: &str| Evidence {
        id: EvidenceId(id.into()),
        description: "Observed evidence".into(),
        fact: None,
        event: None,
        register: None,
        frame: None,
    };
    let mut set = EvidenceSet::new(evidence("evidence.1"));
    set.push(evidence("evidence.2"));
    assert_eq!(set.as_slice().len(), 2);
}

#[test]
fn finding_rejects_empty_evidence() {
    let value = json!({
        "id": "finding.1",
        "severity": "high",
        "confidence": 0.5,
        "kind": "possible_fault",
        "title": "Possible fault",
        "description": "No supporting evidence",
        "evidence": []
    });

    let error = serde_json::from_value::<Finding>(value).expect_err("evidence is mandatory");
    assert!(error.to_string().contains("at least one"));
}
