//! Provider registration for `FaultScope`.

use std::fmt;

use faultscope_arch_cortex_m::CortexM;
use faultscope_artifact_elf::ElfSymbolProvider;
use faultscope_core::{AnalysisRequest, Analyzer};
use faultscope_env_baremetal::BareMetal;
use faultscope_model::{AnalysisResult, CrashInfo};

#[derive(Debug, Eq, PartialEq)]
pub enum RegistryError {
    UnsupportedCrashFormat(String),
    UnsupportedArchitecture(String),
    UnsupportedEnvironment(String),
    InvalidArtifact(String),
    Analysis(String),
}

impl fmt::Display for RegistryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsupportedCrashFormat(format) => {
                write!(formatter, "unsupported crash format: {format}")
            }
            Self::UnsupportedArchitecture(id) => {
                write!(formatter, "unsupported architecture: {id}")
            }
            Self::UnsupportedEnvironment(id) => {
                write!(formatter, "unsupported execution environment: {id}")
            }
            Self::InvalidArtifact(error) => write!(formatter, "invalid artifact: {error}"),
            Self::Analysis(error) => formatter.write_str(error),
        }
    }
}

impl std::error::Error for RegistryError {}

/// Selects the current reference providers and analyzes an ELF-backed crash.
///
/// # Errors
///
/// Returns an error for unsupported targets, invalid ELF data, or failed analysis.
pub fn analyze_elf(
    crash: CrashInfo,
    elf: Vec<u8>,
    runtime_log: Option<Vec<u8>>,
) -> Result<AnalysisResult, RegistryError> {
    if crash.format != "faultscope-crash-v1" {
        return Err(RegistryError::UnsupportedCrashFormat(crash.format));
    }
    if crash.target.architecture.0 != "arm.cortex-m" {
        return Err(RegistryError::UnsupportedArchitecture(
            crash.target.architecture.0.clone(),
        ));
    }
    if crash.target.execution_environment.0 != "baremetal" {
        return Err(RegistryError::UnsupportedEnvironment(
            crash.target.execution_environment.0.clone(),
        ));
    }
    let symbols = ElfSymbolProvider::parse(elf)
        .map_err(|error| RegistryError::InvalidArtifact(error.to_string()))?;
    Analyzer::new(CortexM, BareMetal, symbols)
        .analyze(AnalysisRequest { crash, runtime_log })
        .map_err(|error| RegistryError::Analysis(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use object::{
        Architecture, BinaryFormat, Endianness,
        write::{Object, StandardSection, Symbol, SymbolSection},
    };
    use serde_json::json;

    fn crash() -> CrashInfo {
        serde_json::from_value(json!({
            "format": "faultscope-crash-v1",
            "target": {
                "architecture": "arm.cortex-m",
                "execution_environment": "baremetal",
                "endian": "little",
                "pointer_width": 32
            },
            "registers": [
                { "id": "arm.pc", "value": "0x00000001" },
                { "id": "arm.lr", "value": "0xfffffff9" }
            ],
            "facts": {
                "arch.arm.cortex_m.cfsr": "0x00008200",
                "arch.arm.cortex_m.bfar": "0x00000004"
            }
        }))
        .unwrap()
    }

    fn elf() -> Vec<u8> {
        let mut object = Object::new(BinaryFormat::Elf, Architecture::Arm, Endianness::Little);
        let text = object.section_id(StandardSection::Text);
        let offset = object.append_section_data(text, &[0, 0, 0, 0], 1);
        object.add_symbol(Symbol {
            name: b"crash_here".to_vec(),
            value: offset,
            size: 4,
            kind: object::SymbolKind::Text,
            scope: object::SymbolScope::Linkage,
            weak: false,
            section: SymbolSection::Section(text),
            flags: object::SymbolFlags::None,
        });
        object.write().unwrap()
    }

    #[test]
    fn integrates_crash_symbol_and_fault_providers() {
        let result = analyze_elf(crash(), elf(), None).unwrap();
        assert_eq!(result.frames.len(), 1);
        assert_eq!(result.frames[0].symbol.as_deref(), Some("crash_here"));
        assert_eq!(result.frames[0].address.value, 0);
        assert_eq!(result.fault.fault_classes[0].0, "bus_fault");
        assert!(result.fault.facts.iter().any(|fact| {
            fact.id.0 == "arch.arm.cortex_m.bfar.address" && fact.value == json!("0x00000004")
        }));
        assert_eq!(
            result
                .findings
                .iter()
                .map(|finding| finding.id.0.as_str())
                .collect::<Vec<_>>(),
            [
                "finding.fault_register",
                "finding.possible_null_address",
                "finding.pc_resolved",
            ]
        );
        assert!(
            result
                .findings
                .iter()
                .all(|finding| !finding.evidence.as_slice().is_empty())
        );
    }

    #[test]
    fn rejects_unknown_target_before_parsing_artifact() {
        let mut crash = crash();
        crash.target.architecture.0 = "riscv32".to_owned();
        assert_eq!(
            analyze_elf(crash, b"invalid".to_vec(), None),
            Err(RegistryError::UnsupportedArchitecture("riscv32".to_owned()))
        );
    }

    #[test]
    fn rejects_unknown_crash_format() {
        let mut crash = crash();
        crash.format = "future-crash-v2".to_owned();
        assert_eq!(
            analyze_elf(crash, elf(), None),
            Err(RegistryError::UnsupportedCrashFormat(
                "future-crash-v2".to_owned()
            ))
        );
    }
}
