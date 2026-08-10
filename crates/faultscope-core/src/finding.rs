use faultscope_model::{
    AddressRole, Evidence, EvidenceId, EvidenceSet, FactId, FaultDecode, Finding, FindingId,
    FindingKind, RegisterRole, RegisterSchema, Severity, StackFrame, TargetSnapshot,
};

const STACK_START: &str = "memory.stack.start";
const STACK_END: &str = "memory.stack.end";

pub struct AnalysisContext<'a> {
    pub snapshot: &'a TargetSnapshot,
    pub frames: &'a [StackFrame],
    pub fault: &'a FaultDecode,
    pub register_schema: &'a RegisterSchema,
}

pub trait IncidentRule: Send + Sync {
    fn analyze(&self, context: &AnalysisContext<'_>) -> Vec<Finding>;
}

pub struct FaultRegisterRule;
pub struct NullAddressRule;
pub struct PcResolutionRule;
pub struct InvalidExecutionAddressRule;
pub struct StackPointerRangeRule;

static FAULT_REGISTER_RULE: FaultRegisterRule = FaultRegisterRule;
static NULL_ADDRESS_RULE: NullAddressRule = NullAddressRule;
static PC_RESOLUTION_RULE: PcResolutionRule = PcResolutionRule;
static INVALID_EXECUTION_ADDRESS_RULE: InvalidExecutionAddressRule = InvalidExecutionAddressRule;
static STACK_POINTER_RANGE_RULE: StackPointerRangeRule = StackPointerRangeRule;

#[must_use]
pub fn default_incident_rules() -> [&'static dyn IncidentRule; 5] {
    [
        &FAULT_REGISTER_RULE,
        &NULL_ADDRESS_RULE,
        &PC_RESOLUTION_RULE,
        &INVALID_EXECUTION_ADDRESS_RULE,
        &STACK_POINTER_RANGE_RULE,
    ]
}

#[must_use]
pub fn run_incident_rules(
    context: &AnalysisContext<'_>,
    rules: &[&dyn IncidentRule],
) -> Vec<Finding> {
    rules
        .iter()
        .flat_map(|rule| rule.analyze(context))
        .collect()
}

impl IncidentRule for FaultRegisterRule {
    fn analyze(&self, context: &AnalysisContext<'_>) -> Vec<Finding> {
        let Some(evidence) = evidence_set(context.fault.facts.iter().enumerate().map(
            |(index, fact)| Evidence {
                id: EvidenceId(format!("evidence.fault_register.{index}")),
                description: fact.description.clone(),
                fact: Some(fact.id.clone()),
                event: None,
                register: None,
                frame: None,
            },
        )) else {
            return Vec::new();
        };
        vec![Finding {
            id: FindingId("finding.fault_register".to_owned()),
            severity: Severity::High,
            confidence: 1.0,
            kind: FindingKind("fault_register".to_owned()),
            title: "Processor fault state decoded".to_owned(),
            description: format!(
                "The architecture provider decoded {} recorded fault fact(s).",
                context.fault.facts.len()
            ),
            evidence,
        }]
    }
}

impl IncidentRule for NullAddressRule {
    fn analyze(&self, context: &AnalysisContext<'_>) -> Vec<Finding> {
        let Some(fact) = context.fault.facts.iter().find(|fact| {
            fact.address.as_ref().is_some_and(|address| {
                address.role == Some(AddressRole::FaultAddress) && address.value < 0x100
            })
        }) else {
            return Vec::new();
        };
        vec![Finding {
            id: FindingId("finding.possible_null_address".to_owned()),
            severity: Severity::High,
            confidence: 0.9,
            kind: FindingKind("possible_null_address".to_owned()),
            title: "Possible null pointer access".to_owned(),
            description: "The recorded fault address is in the first 256 bytes of memory; this is consistent with a null-based access but does not prove pointer origin.".to_owned(),
            evidence: EvidenceSet::new(Evidence {
                id: EvidenceId("evidence.possible_null_address.fault_address".to_owned()),
                description: fact.description.clone(),
                fact: Some(fact.id.clone()),
                event: None,
                register: None,
                frame: None,
            }),
        }]
    }
}

impl IncidentRule for PcResolutionRule {
    fn analyze(&self, context: &AnalysisContext<'_>) -> Vec<Finding> {
        let Some((index, frame)) = instruction_frame(context.frames) else {
            return Vec::new();
        };
        if frame.symbol.is_none() && frame.source.is_none() {
            return Vec::new();
        }
        vec![Finding {
            id: FindingId("finding.pc_resolved".to_owned()),
            severity: Severity::Info,
            confidence: 1.0,
            kind: FindingKind("pc_resolution".to_owned()),
            title: "Instruction pointer resolved".to_owned(),
            description: format!(
                "The crash instruction address 0x{:016x} resolved in the supplied artifact.",
                frame.address.value
            ),
            evidence: EvidenceSet::new(frame_evidence(
                "evidence.pc_resolved.frame",
                "Resolved instruction-pointer frame",
                index,
            )),
        }]
    }
}

impl IncidentRule for InvalidExecutionAddressRule {
    fn analyze(&self, context: &AnalysisContext<'_>) -> Vec<Finding> {
        let Some((index, frame)) = instruction_frame(context.frames) else {
            return Vec::new();
        };
        if frame.symbol.is_some() || frame.source.is_some() {
            return Vec::new();
        }
        vec![Finding {
            id: FindingId("finding.invalid_execution_address".to_owned()),
            severity: Severity::Medium,
            confidence: 0.7,
            kind: FindingKind("invalid_execution_address".to_owned()),
            title: "Instruction pointer is unresolved".to_owned(),
            description: "The crash instruction address did not resolve to a symbol or source location in the supplied artifact. Check that the firmware artifact matches the crash.".to_owned(),
            evidence: EvidenceSet::new(frame_evidence(
                "evidence.invalid_execution_address.frame",
                "Unresolved instruction-pointer frame",
                index,
            )),
        }]
    }
}

impl IncidentRule for StackPointerRangeRule {
    fn analyze(&self, context: &AnalysisContext<'_>) -> Vec<Finding> {
        let Some(start) = snapshot_fact(context.snapshot, STACK_START) else {
            return Vec::new();
        };
        let Some(end) = snapshot_fact(context.snapshot, STACK_END) else {
            return Vec::new();
        };
        if start > end {
            return Vec::new();
        }
        let Some(definition) = context
            .register_schema
            .0
            .iter()
            .find(|definition| definition.role == RegisterRole::StackPointer)
        else {
            return Vec::new();
        };
        let Some(register) = context
            .snapshot
            .registers
            .0
            .iter()
            .find(|register| register.register == definition.id)
        else {
            return Vec::new();
        };
        let Some(value) = parse_integer(register.value.as_str()) else {
            return Vec::new();
        };
        if (start..=end).contains(&value) {
            return Vec::new();
        }

        let mut evidence = EvidenceSet::new(Evidence {
            id: EvidenceId("evidence.stack_pointer.register".to_owned()),
            description: format!("{} = 0x{value:016x}", definition.label),
            fact: None,
            event: None,
            register: Some(definition.id.clone()),
            frame: None,
        });
        for (id, description) in [
            (
                STACK_START,
                format!("Expected stack start = 0x{start:016x}"),
            ),
            (STACK_END, format!("Expected stack end = 0x{end:016x}")),
        ] {
            evidence.push(Evidence {
                id: EvidenceId(format!("evidence.stack_pointer.{id}")),
                description,
                fact: Some(FactId(id.to_owned())),
                event: None,
                register: None,
                frame: None,
            });
        }
        vec![Finding {
            id: FindingId("finding.stack_pointer_range".to_owned()),
            severity: Severity::High,
            confidence: 1.0,
            kind: FindingKind("stack_pointer_range".to_owned()),
            title: "Stack pointer is outside the recorded stack range".to_owned(),
            description: format!(
                "The stack pointer 0x{value:016x} is outside 0x{start:016x}..=0x{end:016x}."
            ),
            evidence,
        }]
    }
}

fn instruction_frame(frames: &[StackFrame]) -> Option<(usize, &StackFrame)> {
    frames
        .iter()
        .enumerate()
        .find(|(_, frame)| frame.address.role == Some(AddressRole::InstructionPointer))
}

fn frame_evidence(id: &str, description: &str, index: usize) -> Evidence {
    Evidence {
        id: EvidenceId(id.to_owned()),
        description: description.to_owned(),
        fact: None,
        event: None,
        register: None,
        frame: u32::try_from(index).ok(),
    }
}

fn snapshot_fact(snapshot: &TargetSnapshot, id: &str) -> Option<u64> {
    let value = snapshot.facts.0.get(&FactId(id.to_owned()))?;
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(parse_integer))
}

fn parse_integer(value: &str) -> Option<u64> {
    value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
        .map_or_else(
            || value.parse().ok(),
            |digits| u64::from_str_radix(digits, 16).ok(),
        )
}

fn evidence_set(evidence: impl IntoIterator<Item = Evidence>) -> Option<EvidenceSet> {
    let mut evidence = evidence.into_iter();
    let mut set = EvidenceSet::new(evidence.next()?);
    for item in evidence {
        set.push(item);
    }
    Some(set)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use faultscope_model::{
        AddressSpaceId, FactSet, FactValue, FaultFact, FrameOrigin, RegisterDefinition, RegisterId,
        RegisterSet, RegisterValue, SourceLocation, TargetAddress,
    };

    use super::*;

    #[test]
    fn fault_register_rule_references_decoded_facts() {
        let fault = FaultDecode {
            fault_classes: Vec::new(),
            facts: vec![fault_fact("arch.test.status", None)],
        };
        let snapshot = TargetSnapshot::default();
        let schema = RegisterSchema::default();
        let context = analysis_context(&snapshot, &[], &fault, &schema);
        let findings = FaultRegisterRule.analyze(&context);
        assert_eq!(findings.len(), 1);
        assert_eq!(
            findings[0].evidence.as_slice()[0].fact,
            Some(FactId("arch.test.status".into()))
        );
    }

    #[test]
    fn null_address_rule_requires_a_low_semantic_fault_address() {
        let mut fact = fault_fact("arch.test.fault_address", Some(4));
        let fault = FaultDecode {
            fault_classes: Vec::new(),
            facts: vec![fact.clone()],
        };
        let snapshot = TargetSnapshot::default();
        let schema = RegisterSchema::default();
        let context = analysis_context(&snapshot, &[], &fault, &schema);
        assert_eq!(
            NullAddressRule.analyze(&context)[0].kind.0,
            "possible_null_address"
        );

        fact.address.as_mut().unwrap().value = 0x100;
        let fault = FaultDecode {
            fault_classes: Vec::new(),
            facts: vec![fact],
        };
        let context = analysis_context(&snapshot, &[], &fault, &schema);
        assert!(NullAddressRule.analyze(&context).is_empty());
    }

    #[test]
    fn pc_resolution_rule_reports_a_resolved_instruction_frame() {
        let frames = [frame(Some("crash_here"), None)];
        let snapshot = TargetSnapshot::default();
        let fault = FaultDecode::default();
        let schema = RegisterSchema::default();
        let context = analysis_context(&snapshot, &frames, &fault, &schema);
        let findings = PcResolutionRule.analyze(&context);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].evidence.as_slice()[0].frame, Some(0));
    }

    #[test]
    fn invalid_execution_address_rule_reports_only_an_unresolved_instruction_frame() {
        let unresolved = [frame(None, None)];
        let snapshot = TargetSnapshot::default();
        let fault = FaultDecode::default();
        let schema = RegisterSchema::default();
        let context = analysis_context(&snapshot, &unresolved, &fault, &schema);
        assert_eq!(InvalidExecutionAddressRule.analyze(&context).len(), 1);

        let resolved = [frame(
            None,
            Some(SourceLocation {
                file: "main.c".into(),
                line: 7,
                column: None,
            }),
        )];
        let context = analysis_context(&snapshot, &resolved, &fault, &schema);
        assert!(InvalidExecutionAddressRule.analyze(&context).is_empty());
    }

    #[test]
    fn stack_pointer_range_rule_uses_only_an_explicit_recorded_range() {
        let snapshot = snapshot_with_stack("0x1000", 0x2000, 0x2fff);
        let schema = stack_schema();
        let fault = FaultDecode::default();
        let context = analysis_context(&snapshot, &[], &fault, &schema);
        let findings = StackPointerRangeRule.analyze(&context);
        assert_eq!(findings.len(), 1);
        assert_eq!(
            findings[0].evidence.as_slice()[0].register,
            Some(RegisterId("test.sp".into()))
        );

        let snapshot = TargetSnapshot {
            registers: snapshot.registers,
            facts: FactSet::default(),
        };
        let context = analysis_context(&snapshot, &[], &fault, &schema);
        assert!(StackPointerRangeRule.analyze(&context).is_empty());
    }

    fn analysis_context<'a>(
        snapshot: &'a TargetSnapshot,
        frames: &'a [StackFrame],
        fault: &'a FaultDecode,
        register_schema: &'a RegisterSchema,
    ) -> AnalysisContext<'a> {
        AnalysisContext {
            snapshot,
            frames,
            fault,
            register_schema,
        }
    }

    fn fault_fact(id: &str, address: Option<u64>) -> FaultFact {
        FaultFact {
            id: FactId(id.into()),
            description: "Recorded fault fact".into(),
            value: FactValue::String("0x00000004".into()),
            address: address.map(|value| TargetAddress {
                value,
                address_space: AddressSpaceId("memory".into()),
                role: Some(AddressRole::FaultAddress),
            }),
        }
    }

    fn frame(symbol: Option<&str>, source: Option<SourceLocation>) -> StackFrame {
        StackFrame {
            address: TargetAddress {
                value: 0x1000,
                address_space: AddressSpaceId("code".into()),
                role: Some(AddressRole::InstructionPointer),
            },
            symbol: symbol.map(str::to_owned),
            source,
            origin: FrameOrigin::ExceptionFrame,
            confidence: 1.0,
        }
    }

    fn snapshot_with_stack(value: &str, start: u64, end: u64) -> TargetSnapshot {
        TargetSnapshot {
            registers: RegisterSet(vec![RegisterValue {
                register: RegisterId("test.sp".into()),
                value: serde_json::from_value(FactValue::String(value.into())).unwrap(),
            }]),
            facts: FactSet(BTreeMap::from([
                (FactId(STACK_START.into()), FactValue::Number(start.into())),
                (FactId(STACK_END.into()), FactValue::Number(end.into())),
            ])),
        }
    }

    fn stack_schema() -> RegisterSchema {
        RegisterSchema(vec![RegisterDefinition {
            id: RegisterId("test.sp".into()),
            label: "SP".into(),
            role: RegisterRole::StackPointer,
        }])
    }
}
