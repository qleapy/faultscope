use std::{fs, process::Command};

use faultscope_model::AnalysisResult;
use object::{
    Architecture, BinaryFormat, Endianness,
    write::{Object, StandardSection, Symbol, SymbolSection},
};

#[test]
fn analyze_command_emits_integrated_json() {
    let directory = std::env::temp_dir().join(format!("faultscope-cli-{}", std::process::id()));
    fs::create_dir_all(&directory).unwrap();
    let elf_path = directory.join("firmware.elf");
    let crash_path = directory.join("crash.json");
    let log_path = directory.join("runtime.log");
    fs::write(&elf_path, elf()).unwrap();
    fs::write(
        &crash_path,
        r#"{
            "format":"faultscope-crash-v1",
            "target":{
                "architecture":"arm.cortex-m",
                "execution_environment":"baremetal",
                "endian":"little",
                "pointer_width":32
            },
            "registers":[{"id":"arm.pc","value":"0x00000001"}],
            "facts":{"arch.arm.cortex_m.cfsr":"0x00008200"}
        }"#,
    )
    .unwrap();
    fs::write(
        &log_path,
        "0.000100 [INFO] system boot\nmalformed\n2.205000 [FAULT] hardfault\n",
    )
    .unwrap();

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
    let result: AnalysisResult = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(result.frames[0].symbol.as_deref(), Some("crash_here"));
    assert_eq!(result.fault.fault_classes[0].0, "bus_fault");
    assert_eq!(result.events.len(), 2);
    assert_eq!(result.events[1].timestamp_ns, 2_205_000_000);
    assert_eq!(result.log_diagnostics.parsed_lines, 2);
    assert_eq!(result.log_diagnostics.ignored_lines, 1);

    fs::remove_dir_all(directory).unwrap();
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
