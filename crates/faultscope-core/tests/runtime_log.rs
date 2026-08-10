use faultscope_core::parse_runtime_log;
use serde_json::json;

const VALID_LOG: &[u8] = include_bytes!("../../../fixtures/logs/valid.log");

#[test]
fn parses_relative_timestamps_severity_and_original_text() {
    let result = parse_runtime_log(VALID_LOG).unwrap();
    assert_eq!(result.events.len(), 5);
    assert_eq!(result.events[0].timestamp_ns, 100_000);
    assert_eq!(result.events[1].timestamp_ns, 101_200_000);
    assert_eq!(result.events[2].timestamp_ns, 2_203_100_000);
    assert_eq!(result.events[2].attributes["severity"], json!("warn"));
    assert_eq!(
        result.events[2].attributes["text"],
        json!("2.203100 [WARN] sensor timeout")
    );
    assert_eq!(result.diagnostics.parsed_lines, 5);
    assert_eq!(result.diagnostics.ignored_lines, 0);
}

#[test]
fn skips_malformed_lines_and_continues() {
    let input = b"bad\n0.1 [INFO] ok\n0.2 [NOPE] unknown\n\xff\n0.3 [ERROR] recovered";
    let result = parse_runtime_log(input).unwrap();
    assert_eq!(result.events.len(), 2);
    assert_eq!(result.events[0].timestamp_ns, 100_000_000);
    assert_eq!(result.events[1].attributes["message"], json!("recovered"));
    assert_eq!(result.diagnostics.ignored_lines, 3);
    assert_eq!(result.diagnostics.skipped[0].line, 1);
    assert_eq!(result.diagnostics.skipped[2].line, 4);
}

#[test]
fn rejects_timestamp_overflow_as_one_bad_line() {
    let result = parse_runtime_log(b"18446744074.0 [INFO] too late").unwrap();
    assert!(result.events.is_empty());
    assert_eq!(result.diagnostics.ignored_lines, 1);
    assert_eq!(result.diagnostics.skipped[0].reason, "timestamp overflow");
}
