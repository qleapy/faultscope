//! Shared deterministic domain types for `FaultScope`.

use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

macro_rules! string_id {
    ($name:ident) => {
        #[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
        #[serde(transparent)]
        pub struct $name(pub String);
    };
}

string_id!(IncidentId);
string_id!(ArchitectureId);
string_id!(ExecutionEnvironmentId);
string_id!(AbiId);
string_id!(AddressSpaceId);
string_id!(RegisterId);
string_id!(ExecutionEntityId);
string_id!(ExecutionEntityKind);
string_id!(EventId);
string_id!(EventSource);
string_id!(EventKind);
string_id!(FindingId);
string_id!(FindingKind);
string_id!(EvidenceId);
string_id!(FactId);

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Endianness {
    Little,
    Big,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TargetDescriptor {
    pub architecture: ArchitectureId,
    pub execution_environment: ExecutionEnvironmentId,
    pub endian: Endianness,
    pub pointer_width: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub abi: Option<AbiId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub machine: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(transparent)]
pub struct RegisterBits(String);

impl RegisterBits {
    /// Returns the validated hexadecimal representation, including its `0x` prefix.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for RegisterBits {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        let digits = value
            .strip_prefix("0x")
            .or_else(|| value.strip_prefix("0X"))
            .ok_or_else(|| serde::de::Error::custom("register value must start with 0x"))?;

        if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(serde::de::Error::custom(
                "register value must contain hexadecimal digits",
            ));
        }

        Ok(Self(value))
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RegisterValue {
    #[serde(rename = "id")]
    pub register: RegisterId,
    pub value: RegisterBits,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(transparent)]
pub struct RegisterSet(pub Vec<RegisterValue>);

pub type FactValue = Value;

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(transparent)]
pub struct FactSet(pub BTreeMap<FactId, FactValue>);

/// Provider-neutral storage for namespaced fault-register facts.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(transparent)]
pub struct FaultRegisters(pub FactSet);

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct TargetSnapshot {
    #[serde(default)]
    pub registers: RegisterSet,
    #[serde(default)]
    pub facts: FactSet,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct CrashInfo {
    pub format: String,
    pub target: TargetDescriptor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub build_id: Option<String>,
    #[serde(flatten)]
    pub snapshot: TargetSnapshot,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct BuildInfo {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ExecutionEntity {
    pub id: ExecutionEntityId,
    pub kind: ExecutionEntityKind,
    pub label: String,
    #[serde(default)]
    pub attributes: Value,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AddressRole {
    InstructionPointer,
    StackPointer,
    FramePointer,
    ReturnAddress,
    FaultAddress,
    Other,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TargetAddress {
    pub value: u64,
    pub address_space: AddressSpaceId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<AddressRole>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Event {
    pub id: EventId,
    /// Nanoseconds relative to the incident origin.
    pub timestamp_ns: u64,
    pub source: EventSource,
    pub kind: EventKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_entity: Option<ExecutionEntityId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub address: Option<TargetAddress>,
    #[serde(default)]
    pub attributes: Value,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Info,
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Evidence {
    pub id: EvidenceId,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fact: Option<FactId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event: Option<EventId>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(transparent)]
pub struct EvidenceSet(Vec<Evidence>);

impl EvidenceSet {
    #[must_use]
    pub fn new(evidence: Evidence) -> Self {
        Self(vec![evidence])
    }

    #[must_use]
    pub fn as_slice(&self) -> &[Evidence] {
        &self.0
    }
}

impl<'de> Deserialize<'de> for EvidenceSet {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let evidence = Vec::deserialize(deserializer)?;
        if evidence.is_empty() {
            return Err(serde::de::Error::custom(
                "a finding must reference at least one item of evidence",
            ));
        }
        Ok(Self(evidence))
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Finding {
    pub id: FindingId,
    pub severity: Severity,
    pub confidence: f32,
    pub kind: FindingKind,
    pub title: String,
    pub description: String,
    pub evidence: EvidenceSet,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SourceLocation {
    pub file: String,
    pub line: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column: Option<u32>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FrameOrigin {
    ExceptionFrame,
    LinkRegister,
    DwarfCfi,
    ArmExidx,
    FramePointer,
    Heuristic,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct StackFrame {
    pub address: TargetAddress,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<SourceLocation>,
    pub origin: FrameOrigin,
    pub confidence: f32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct SymbolizedAddress {
    pub address: TargetAddress,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<SourceLocation>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Incident {
    pub id: IncidentId,
    pub target: TargetDescriptor,
    pub build: BuildInfo,
    pub snapshot: TargetSnapshot,
    #[serde(default)]
    pub execution_entities: Vec<ExecutionEntity>,
    #[serde(default)]
    pub events: Vec<Event>,
    #[serde(default)]
    pub findings: Vec<Finding>,
}
