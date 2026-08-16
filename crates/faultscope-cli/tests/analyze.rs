use std::{fs, process::Command};

use faultscope_model::AnalysisResult;
use object::{
    Architecture, BinaryFormat, Endianness,
    write::{Object, StandardSection, Symbol, SymbolSection},
};

#[test]
fn analyze_command_emits_integrated_json() {
    let result = run_analysis(
        "baremetal",
        "0.000100 [INFO] system boot\nmalformed\n2.205000 [FAULT] hardfault\n",
        "baremetal",
    );
    assert_eq!(result.frames[0].symbol.as_deref(), Some("crash_here"));
    assert_eq!(result.fault.fault_classes[0].0, "bus_fault");
    assert_eq!(result.events.len(), 2);
    assert_eq!(result.events[1].timestamp_ns, 2_205_000_000);
    assert_eq!(result.log_diagnostics.parsed_lines, 2);
    assert_eq!(result.log_diagnostics.ignored_lines, 1);
    assert_eq!(
        result
            .findings
            .iter()
            .map(|finding| finding.id.0.as_str())
            .collect::<Vec<_>>(),
        ["finding.fault_register", "finding.pc_resolved"]
    );
    assert!(
        result
            .findings
            .iter()
            .all(|finding| !finding.evidence.as_slice().is_empty())
    );
}

#[test]
fn analyze_command_emits_freertos_execution_lanes() {
    let result = run_analysis(
        "freertos",
        include_str!("../../../fixtures/logs/freertos.log"),
        "freertos",
    );

    assert_eq!(result.execution_entities.len(), 4);
    assert!(
        result
            .events
            .iter()
            .any(|event| event.kind.0 == "task_switch")
    );
    assert!(
        result
            .events
            .iter()
            .any(|event| event.kind.0 == "isr_enter")
    );
    assert!(
        result
            .events
            .iter()
            .any(|event| event.kind.0 == "mutex_wait")
    );
}

fn run_analysis(environment: &str, log: &str, suffix: &str) -> AnalysisResult {
    let directory =
        std::env::temp_dir().join(format!("faultscope-cli-{}-{suffix}", std::process::id()));
    fs::create_dir_all(&directory).unwrap();
    let elf_path = directory.join("firmware.elf");
    let crash_path = directory.join("crash.json");
    let log_path = directory.join("runtime.log");
    fs::write(&elf_path, elf()).unwrap();
    fs::write(
        &crash_path,
        format!(
            r#"{{
                "format":"faultscope-crash-v1",
                "target":{{
                    "architecture":"arm.cortex-m",
                    "execution_environment":"{environment}",
                    "endian":"little",
                    "pointer_width":32
                }},
                "registers":[{{"id":"arm.pc","value":"0x00000001"}}],
                "facts":{{"arch.arm.cortex_m.cfsr":"0x00008200"}}
            }}"#
        ),
    )
    .unwrap();
    fs::write(&log_path, log).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_faultscope"))
        .args(["analyze", "--elf"])
        .arg(&elf_path)
        .arg("--crash")
        .arg(&crash_path)
        .arg("--log")
        .arg(&log_path)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let result = serde_json::from_slice(&output.stdout).unwrap();
    fs::remove_dir_all(directory).unwrap();
    result
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
