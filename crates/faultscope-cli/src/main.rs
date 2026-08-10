use std::{env, ffi::OsString, fs, path::PathBuf, process::ExitCode};

use faultscope_artifact_elf::ElfSymbolProvider;
use faultscope_core::SymbolProvider;
use faultscope_model::{AddressRole, AddressSpaceId, CrashInfo, TargetAddress};
use faultscope_registry::analyze_elf;
use serde_json::json;

fn main() -> ExitCode {
    let args = env::args_os().skip(1).collect::<Vec<_>>();
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("faultscope: {error}");
            ExitCode::from(2)
        }
    }
}

fn run(args: &[OsString]) -> Result<(), String> {
    match args.first().and_then(|arg| arg.to_str()) {
        Some("symbolicate") => symbolicate(args),
        Some("analyze") => analyze(args),
        _ => Err(usage()),
    }
}

fn symbolicate(args: &[OsString]) -> Result<(), String> {
    if args.len() != 4 || args[1] != "--elf" {
        return Err(usage());
    }

    let path = PathBuf::from(&args[2]);
    let address_text = args[3]
        .to_str()
        .ok_or_else(|| "address is not valid Unicode".to_owned())?;
    let digits = address_text
        .strip_prefix("0x")
        .or_else(|| address_text.strip_prefix("0X"))
        .unwrap_or(address_text);
    let value = u64::from_str_radix(digits, 16)
        .map_err(|_| format!("invalid hexadecimal address: {address_text}"))?;
    let bytes = fs::read(&path).map_err(|error| format!("{}: {error}", path.display()))?;
    let provider = ElfSymbolProvider::parse(bytes).map_err(|error| error.to_string())?;
    let result = provider
        .resolve(TargetAddress {
            value,
            address_space: AddressSpaceId("virtual".to_owned()),
            role: Some(AddressRole::InstructionPointer),
        })
        .map_err(|error| error.to_string())?;
    let output = json!({
        "address": format!("0x{value:016x}"),
        "symbol": result.symbol,
        "file": result.source.as_ref().map(|source| &source.file),
        "line": result.source.as_ref().map(|source| source.line),
        "column": result.source.as_ref().and_then(|source| source.column),
    });
    println!(
        "{}",
        serde_json::to_string(&output).map_err(|error| error.to_string())?
    );
    Ok(())
}

fn analyze(args: &[OsString]) -> Result<(), String> {
    if args.len() != 5 || args[1] != "--elf" || args[3] != "--crash" {
        return Err(usage());
    }
    let elf_path = PathBuf::from(&args[2]);
    let crash_path = PathBuf::from(&args[4]);
    let elf = fs::read(&elf_path).map_err(|error| format!("{}: {error}", elf_path.display()))?;
    let crash_bytes =
        fs::read(&crash_path).map_err(|error| format!("{}: {error}", crash_path.display()))?;
    let crash = serde_json::from_slice::<CrashInfo>(&crash_bytes)
        .map_err(|error| format!("{}: invalid crash JSON: {error}", crash_path.display()))?;
    let result = analyze_elf(crash, elf).map_err(|error| error.to_string())?;
    println!(
        "{}",
        serde_json::to_string_pretty(&result).map_err(|error| error.to_string())?
    );
    Ok(())
}

fn usage() -> String {
    "usage:\n  faultscope symbolicate --elf <firmware.elf> <address>\n  faultscope analyze --elf <firmware.elf> --crash <crash.json>".to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_address_without_reading_a_file() {
        let error = run(&[
            "symbolicate".into(),
            "--elf".into(),
            "missing.elf".into(),
            "not-an-address".into(),
        ])
        .unwrap_err();
        assert!(error.contains("invalid hexadecimal address"));
    }

    #[test]
    fn rejects_incomplete_analyze_command() {
        assert!(run(&["analyze".into()]).unwrap_err().contains("usage:"));
    }
}
