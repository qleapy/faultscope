//! ARM Cortex-M architecture provider.

use std::fmt;

use faultscope_core::ArchitectureProvider;
use faultscope_model::{
    AddressRole, AddressSpaceId, ArchitectureId, FactId, FactValue, FaultClass, FaultDecode,
    FaultFact, FrameOrigin, RegisterDefinition, RegisterId, RegisterRole, RegisterSchema,
    SourceLocation, StackFrame, TargetAddress, TargetSnapshot,
};

const CFSR: &str = "arch.arm.cortex_m.cfsr";
const HFSR: &str = "arch.arm.cortex_m.hfsr";
const MMFAR: &str = "arch.arm.cortex_m.mmfar";
const BFAR: &str = "arch.arm.cortex_m.bfar";

pub struct CortexM;

#[derive(Debug, Eq, PartialEq)]
pub enum CortexMError {
    InvalidFact(String),
    InvalidRegister(String),
}

impl fmt::Display for CortexMError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidFact(id) => write!(formatter, "invalid Cortex-M fact: {id}"),
            Self::InvalidRegister(id) => write!(formatter, "invalid Cortex-M register: {id}"),
        }
    }
}

impl std::error::Error for CortexMError {}

impl CortexM {
    fn value(snapshot: &TargetSnapshot, id: &str) -> Result<Option<u32>, CortexMError> {
        let Some(value) = snapshot.facts.0.get(&FactId(id.to_owned())) else {
            return Ok(None);
        };
        parse_u32(value)
            .map(Some)
            .ok_or_else(|| CortexMError::InvalidFact(id.to_owned()))
    }

    fn register(snapshot: &TargetSnapshot, id: &str) -> Result<Option<u32>, CortexMError> {
        let Some(register) = snapshot
            .registers
            .0
            .iter()
            .find(|register| register.register.0 == id)
        else {
            return Ok(None);
        };
        parse_text_u32(register.value.as_str())
            .map(Some)
            .ok_or_else(|| CortexMError::InvalidRegister(id.to_owned()))
    }

    fn fact(id: &str, description: &str, value: FactValue) -> FaultFact {
        FaultFact {
            id: FactId(id.to_owned()),
            description: description.to_owned(),
            value,
            address: None,
        }
    }

    fn fault_address_fact(id: &str, description: &str, value: u32) -> FaultFact {
        FaultFact {
            id: FactId(id.to_owned()),
            description: description.to_owned(),
            value: FactValue::String(format!("0x{value:08x}")),
            address: Some(TargetAddress {
                value: u64::from(value),
                address_space: AddressSpaceId("memory".to_owned()),
                role: Some(AddressRole::FaultAddress),
            }),
        }
    }
}

impl ArchitectureProvider for CortexM {
    type Error = CortexMError;

    fn id(&self) -> ArchitectureId {
        ArchitectureId("arm.cortex-m".to_owned())
    }

    fn normalize_address(&self, mut address: TargetAddress) -> Result<TargetAddress, Self::Error> {
        if matches!(
            address.role,
            Some(AddressRole::InstructionPointer | AddressRole::ReturnAddress)
        ) {
            address.value &= !1;
        }
        Ok(address)
    }

    fn decode_exception(&self, snapshot: &TargetSnapshot) -> Result<FaultDecode, Self::Error> {
        let cfsr = Self::value(snapshot, CFSR)?.unwrap_or(0);
        let hfsr = Self::value(snapshot, HFSR)?.unwrap_or(0);
        let mut decode = FaultDecode::default();

        for (mask, class) in [
            (0xff, "memory_management"),
            (0xff00, "bus_fault"),
            (0xffff_0000, "usage_fault"),
        ] {
            if cfsr & mask != 0 {
                decode.fault_classes.push(FaultClass(class.to_owned()));
            }
        }
        if hfsr != 0 {
            decode
                .fault_classes
                .push(FaultClass("hard_fault".to_owned()));
        }

        if cfsr != 0 {
            decode.facts.push(Self::fact(
                CFSR,
                "Configurable Fault Status Register",
                FactValue::String(format!("0x{cfsr:08x}")),
            ));
        }
        if hfsr != 0 {
            decode.facts.push(Self::fact(
                HFSR,
                "HardFault Status Register",
                FactValue::String(format!("0x{hfsr:08x}")),
            ));
        }

        for (mask, id, description) in CFSR_FLAGS {
            if cfsr & mask != 0 {
                decode
                    .facts
                    .push(Self::fact(id, description, FactValue::Bool(true)));
            }
        }
        for (mask, id, description) in HFSR_FLAGS {
            if hfsr & mask != 0 {
                decode
                    .facts
                    .push(Self::fact(id, description, FactValue::Bool(true)));
            }
        }

        if cfsr & (1 << 7) != 0
            && let Some(address) = Self::value(snapshot, MMFAR)?
        {
            decode.facts.push(Self::fault_address_fact(
                "arch.arm.cortex_m.mmfar.address",
                "Valid MemManage fault address",
                address,
            ));
        }
        if cfsr & (1 << 15) != 0
            && let Some(address) = Self::value(snapshot, BFAR)?
        {
            decode.facts.push(Self::fault_address_fact(
                "arch.arm.cortex_m.bfar.address",
                "Valid BusFault address",
                address,
            ));
        }

        Ok(decode)
    }

    fn initial_frames(&self, snapshot: &TargetSnapshot) -> Result<Vec<StackFrame>, Self::Error> {
        let mut frames = Vec::new();
        if let Some(pc) = Self::register(snapshot, "arm.pc")? {
            frames.push(frame(
                pc,
                AddressRole::InstructionPointer,
                FrameOrigin::ExceptionFrame,
                1.0,
            ));
        }
        if let Some(lr) = Self::register(snapshot, "arm.lr")?
            && lr & 0xffff_ff00 != 0xffff_ff00
        {
            frames.push(frame(
                lr,
                AddressRole::ReturnAddress,
                FrameOrigin::LinkRegister,
                0.5,
            ));
        }
        frames
            .into_iter()
            .map(|frame| {
                let address = self.normalize_address(frame.address)?;
                Ok(StackFrame { address, ..frame })
            })
            .collect()
    }

    fn register_schema(&self) -> RegisterSchema {
        RegisterSchema(
            [
                ("arm.pc", "PC", RegisterRole::InstructionPointer),
                ("arm.lr", "LR", RegisterRole::ReturnAddress),
                ("arm.sp", "SP", RegisterRole::StackPointer),
                ("arm.xpsr", "xPSR", RegisterRole::Status),
            ]
            .into_iter()
            .map(|(id, label, role)| RegisterDefinition {
                id: RegisterId(id.to_owned()),
                label: label.to_owned(),
                role,
            })
            .collect(),
        )
    }
}

fn parse_u32(value: &FactValue) -> Option<u32> {
    match value {
        FactValue::String(value) => parse_text_u32(value),
        FactValue::Number(value) => value.as_u64().and_then(|value| value.try_into().ok()),
        _ => None,
    }
}

fn parse_text_u32(value: &str) -> Option<u32> {
    value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
        .map_or_else(
            || value.parse().ok(),
            |digits| u32::from_str_radix(digits, 16).ok(),
        )
}

fn frame(value: u32, role: AddressRole, origin: FrameOrigin, confidence: f32) -> StackFrame {
    StackFrame {
        address: TargetAddress {
            value: u64::from(value),
            address_space: AddressSpaceId("code".to_owned()),
            role: Some(role),
        },
        symbol: None,
        source: None::<SourceLocation>,
        origin,
        confidence,
    }
}

const CFSR_FLAGS: &[(u32, &str, &str)] = &[
    (
        1 << 0,
        "arch.arm.cortex_m.cfsr.iaccviol",
        "Instruction access violation",
    ),
    (
        1 << 1,
        "arch.arm.cortex_m.cfsr.daccviol",
        "Data access violation",
    ),
    (
        1 << 3,
        "arch.arm.cortex_m.cfsr.munstkerr",
        "MemManage unstacking error",
    ),
    (
        1 << 4,
        "arch.arm.cortex_m.cfsr.mstkerr",
        "MemManage stacking error",
    ),
    (
        1 << 5,
        "arch.arm.cortex_m.cfsr.mlsperr",
        "MemManage lazy state preservation error",
    ),
    (
        1 << 7,
        "arch.arm.cortex_m.cfsr.mmarvalid",
        "MMFAR contains a valid address",
    ),
    (
        1 << 8,
        "arch.arm.cortex_m.cfsr.ibuserr",
        "Instruction bus error",
    ),
    (
        1 << 9,
        "arch.arm.cortex_m.cfsr.preciserr",
        "Precise data bus error",
    ),
    (
        1 << 10,
        "arch.arm.cortex_m.cfsr.impreciserr",
        "Imprecise data bus error",
    ),
    (
        1 << 11,
        "arch.arm.cortex_m.cfsr.unstkerr",
        "BusFault unstacking error",
    ),
    (
        1 << 12,
        "arch.arm.cortex_m.cfsr.stkerr",
        "BusFault stacking error",
    ),
    (
        1 << 13,
        "arch.arm.cortex_m.cfsr.lsperr",
        "BusFault lazy state preservation error",
    ),
    (
        1 << 15,
        "arch.arm.cortex_m.cfsr.bfarvalid",
        "BFAR contains a valid address",
    ),
    (
        1 << 16,
        "arch.arm.cortex_m.cfsr.undefinstr",
        "Undefined instruction",
    ),
    (
        1 << 17,
        "arch.arm.cortex_m.cfsr.invstate",
        "Invalid execution state",
    ),
    (
        1 << 18,
        "arch.arm.cortex_m.cfsr.invpc",
        "Invalid exception return",
    ),
    (
        1 << 19,
        "arch.arm.cortex_m.cfsr.nocp",
        "Coprocessor access error",
    ),
    (1 << 20, "arch.arm.cortex_m.cfsr.stkof", "Stack overflow"),
    (
        1 << 24,
        "arch.arm.cortex_m.cfsr.unaligned",
        "Unaligned access",
    ),
    (
        1 << 25,
        "arch.arm.cortex_m.cfsr.divbyzero",
        "Division by zero",
    ),
];

const HFSR_FLAGS: &[(u32, &str, &str)] = &[
    (
        1 << 1,
        "arch.arm.cortex_m.hfsr.vecttbl",
        "Bus fault on vector table read",
    ),
    (
        1 << 30,
        "arch.arm.cortex_m.hfsr.forced",
        "Escalated configurable fault",
    ),
    (
        1 << 31,
        "arch.arm.cortex_m.hfsr.debugevt",
        "Debug event caused HardFault",
    ),
];

#[cfg(test)]
mod tests {
    use super::*;
    use faultscope_model::{FactSet, RegisterSet, RegisterValue};
    use std::collections::BTreeMap;

    fn snapshot(facts: &[(&str, FactValue)]) -> TargetSnapshot {
        TargetSnapshot {
            registers: RegisterSet::default(),
            facts: FactSet(
                facts
                    .iter()
                    .map(|(id, value)| (FactId((*id).to_owned()), value.clone()))
                    .collect::<BTreeMap<_, _>>(),
            ),
        }
    }

    #[test]
    fn decodes_precise_bus_fault_and_valid_address() {
        let snapshot = snapshot(&[
            (CFSR, FactValue::String("0x00008200".to_owned())),
            (BFAR, FactValue::String("0x00000004".to_owned())),
        ]);
        let decode = CortexM.decode_exception(&snapshot).unwrap();

        assert_eq!(decode.fault_classes, [FaultClass("bus_fault".to_owned())]);
        assert!(decode.facts.iter().any(|fact| {
            fact.id.0 == "arch.arm.cortex_m.cfsr.preciserr" && fact.value == FactValue::Bool(true)
        }));
        assert!(decode.facts.iter().any(|fact| {
            fact.id.0 == "arch.arm.cortex_m.bfar.address"
                && fact.value == FactValue::String("0x00000004".to_owned())
                && fact.address.as_ref().is_some_and(|address| {
                    address.value == 4 && address.role == Some(AddressRole::FaultAddress)
                })
        }));
    }

    #[test]
    fn classifies_all_fault_status_groups() {
        let snapshot = snapshot(&[
            (CFSR, FactValue::Number(0x0101_0101_u32.into())),
            (HFSR, FactValue::Number((1_u32 << 30).into())),
        ]);
        let decode = CortexM.decode_exception(&snapshot).unwrap();
        assert_eq!(
            decode.fault_classes,
            [
                FaultClass("memory_management".to_owned()),
                FaultClass("bus_fault".to_owned()),
                FaultClass("usage_fault".to_owned()),
                FaultClass("hard_fault".to_owned()),
            ]
        );
    }

    #[test]
    fn rejects_malformed_fault_fact() {
        let snapshot = snapshot(&[(CFSR, FactValue::String("not-a-number".to_owned()))]);
        assert_eq!(
            CortexM.decode_exception(&snapshot),
            Err(CortexMError::InvalidFact(CFSR.to_owned()))
        );
    }

    #[test]
    fn extracts_and_normalizes_pc_and_lr_but_skips_exception_return() {
        let mut snapshot = snapshot(&[]);
        snapshot.registers = RegisterSet(vec![
            register("arm.pc", "0x08004567"),
            register("arm.lr", "0xfffffff9"),
        ]);
        let frames = CortexM.initial_frames(&snapshot).unwrap();
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].address.value, 0x0800_4566);
        assert_eq!(frames[0].origin, FrameOrigin::ExceptionFrame);

        snapshot.registers.0[1] = register("arm.lr", "0x08001235");
        let frames = CortexM.initial_frames(&snapshot).unwrap();
        assert_eq!(frames[1].address.value, 0x0800_1234);
        assert_eq!(frames[1].origin, FrameOrigin::LinkRegister);
    }

    #[test]
    fn exposes_cortex_m_register_roles() {
        let schema = CortexM.register_schema();
        assert_eq!(schema.0.len(), 4);
        assert_eq!(schema.0[0].role, RegisterRole::InstructionPointer);
        assert_eq!(schema.0[2].role, RegisterRole::StackPointer);
    }

    fn register(id: &str, value: &str) -> RegisterValue {
        RegisterValue {
            register: RegisterId(id.to_owned()),
            value: serde_json::from_value(FactValue::String(value.to_owned())).unwrap(),
        }
    }
}
