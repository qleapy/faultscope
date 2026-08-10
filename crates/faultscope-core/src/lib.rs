//! Architecture- and deployment-independent analysis orchestration.

mod finding;

pub use finding::{
    AnalysisContext, FaultRegisterRule, IncidentRule, InvalidExecutionAddressRule, NullAddressRule,
    PcResolutionRule, StackPointerRangeRule, default_incident_rules, run_incident_rules,
};

use std::fmt;

use faultscope_model::{
    AnalysisResult, ArchitectureId, BuildInfo, CrashInfo, Event, EventId, EventKind, EventSource,
    ExecutionEnvironmentId, FaultDecode, Finding, LogDiagnostics, LogLineDiagnostic, LogSeverity,
    RegisterSchema, StackFrame, SymbolizedAddress, TargetAddress, TargetSnapshot,
};
use serde_json::json;

pub const MAX_RUNTIME_LOG_BYTES: usize = 500_000_000;

/// Supplies processor-specific normalization, register semantics, and exception decoding.
pub trait ArchitectureProvider: Send + Sync {
    type Error: std::error::Error + Send + Sync + 'static;

    fn id(&self) -> ArchitectureId;

    /// Normalizes an address according to its semantic role.
    ///
    /// # Errors
    ///
    /// Returns a provider-specific error when the address cannot be normalized.
    fn normalize_address(&self, address: TargetAddress) -> Result<TargetAddress, Self::Error>;

    /// Decodes architecture-specific exception state into deterministic facts.
    ///
    /// # Errors
    ///
    /// Returns a provider-specific error when a supplied fact is malformed.
    fn decode_exception(&self, snapshot: &TargetSnapshot) -> Result<FaultDecode, Self::Error>;

    /// Extracts only frames directly supported by snapshot evidence.
    ///
    /// # Errors
    ///
    /// Returns a provider-specific error when a supplied register is malformed.
    fn initial_frames(&self, snapshot: &TargetSnapshot) -> Result<Vec<StackFrame>, Self::Error>;

    fn register_schema(&self) -> RegisterSchema;
}

/// Supplies execution-environment-specific deterministic analysis.
pub trait EnvironmentProvider: Send + Sync {
    type Error: std::error::Error + Send + Sync + 'static;

    fn id(&self) -> ExecutionEnvironmentId;

    /// Produces findings supported by environment-specific evidence.
    ///
    /// # Errors
    ///
    /// Returns a provider-specific error when snapshot data is malformed.
    fn analyze(&self, snapshot: &TargetSnapshot) -> Result<Vec<Finding>, Self::Error>;
}

/// Resolves a target address without coupling analysis code to an artifact format.
pub trait SymbolProvider: Send + Sync {
    type Error: std::error::Error + Send + Sync + 'static;

    /// Resolves an address while preserving its target metadata.
    ///
    /// # Errors
    ///
    /// Returns a provider-specific error when artifact data cannot be read.
    fn resolve(&self, address: TargetAddress) -> Result<SymbolizedAddress, Self::Error>;
}

pub struct AnalysisRequest {
    pub crash: CrashInfo,
    pub runtime_log: Option<Vec<u8>>,
}

pub struct Analyzer<A, E, S> {
    architecture: A,
    environment: E,
    symbols: S,
}

#[derive(Debug, Eq, PartialEq)]
pub enum AnalysisError {
    ArchitectureMismatch { expected: String, actual: String },
    EnvironmentMismatch { expected: String, actual: String },
    Architecture(String),
    Environment(String),
    Symbol(String),
    RuntimeLog(String),
}

impl fmt::Display for AnalysisError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ArchitectureMismatch { expected, actual } => {
                write!(
                    formatter,
                    "architecture provider {expected} cannot analyze {actual}"
                )
            }
            Self::EnvironmentMismatch { expected, actual } => {
                write!(
                    formatter,
                    "environment provider {expected} cannot analyze {actual}"
                )
            }
            Self::Architecture(error) => write!(formatter, "architecture analysis failed: {error}"),
            Self::Environment(error) => write!(formatter, "environment analysis failed: {error}"),
            Self::Symbol(error) => write!(formatter, "symbolication failed: {error}"),
            Self::RuntimeLog(error) => write!(formatter, "runtime log failed: {error}"),
        }
    }
}

impl std::error::Error for AnalysisError {}

impl<A, E, S> Analyzer<A, E, S>
where
    A: ArchitectureProvider,
    E: EnvironmentProvider,
    S: SymbolProvider,
{
    pub fn new(architecture: A, environment: E, symbols: S) -> Self {
        Self {
            architecture,
            environment,
            symbols,
        }
    }

    /// Runs deterministic analysis using the selected providers.
    ///
    /// # Errors
    ///
    /// Returns an error for provider mismatches or malformed provider input.
    pub fn analyze(&self, request: AnalysisRequest) -> Result<AnalysisResult, AnalysisError> {
        let crash = request.crash;
        let architecture = self.architecture.id();
        if crash.target.architecture != architecture {
            return Err(AnalysisError::ArchitectureMismatch {
                expected: architecture.0,
                actual: crash.target.architecture.0,
            });
        }
        let environment = self.environment.id();
        if crash.target.execution_environment != environment {
            return Err(AnalysisError::EnvironmentMismatch {
                expected: environment.0,
                actual: crash.target.execution_environment.0,
            });
        }

        let frames = self
            .architecture
            .initial_frames(&crash.snapshot)
            .map_err(|error| AnalysisError::Architecture(error.to_string()))?
            .into_iter()
            .map(|frame| {
                let resolved = self
                    .symbols
                    .resolve(frame.address.clone())
                    .map_err(|error| AnalysisError::Symbol(error.to_string()))?;
                Ok(StackFrame {
                    symbol: resolved.symbol,
                    source: resolved.source,
                    ..frame
                })
            })
            .collect::<Result<Vec<StackFrame>, _>>()?;
        let fault = self
            .architecture
            .decode_exception(&crash.snapshot)
            .map_err(|error| AnalysisError::Architecture(error.to_string()))?;
        let register_schema = self.architecture.register_schema();
        let context = AnalysisContext {
            snapshot: &crash.snapshot,
            frames: &frames,
            fault: &fault,
            register_schema: &register_schema,
        };
        let rules = default_incident_rules();
        let mut findings = run_incident_rules(&context, &rules);
        findings.extend(
            self.environment
                .analyze(&crash.snapshot)
                .map_err(|error| AnalysisError::Environment(error.to_string()))?,
        );
        let log = request
            .runtime_log
            .as_deref()
            .map(parse_runtime_log)
            .transpose()
            .map_err(|error| AnalysisError::RuntimeLog(error.to_string()))?
            .unwrap_or_default();

        Ok(AnalysisResult {
            target: crash.target,
            timestamp: crash.timestamp,
            build: BuildInfo {
                id: crash.build_id,
                timestamp: None,
            },
            snapshot: crash.snapshot,
            frames,
            fault,
            events: log.events,
            log_diagnostics: log.diagnostics,
            findings,
        })
    }
}

#[derive(Debug, Default, PartialEq)]
pub struct ParsedRuntimeLog {
    pub events: Vec<Event>,
    pub diagnostics: LogDiagnostics,
}

#[derive(Debug, Eq, PartialEq)]
pub struct RuntimeLogError {
    size: usize,
}

impl fmt::Display for RuntimeLogError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "input is {} bytes; maximum is {MAX_RUNTIME_LOG_BYTES}",
            self.size
        )
    }
}

impl std::error::Error for RuntimeLogError {}

/// Converts canonical runtime-log lines into timeline events and diagnostics.
///
/// # Errors
///
/// Returns an error when the input exceeds [`MAX_RUNTIME_LOG_BYTES`]. Malformed lines are skipped.
pub fn parse_runtime_log(input: &[u8]) -> Result<ParsedRuntimeLog, RuntimeLogError> {
    if input.len() > MAX_RUNTIME_LOG_BYTES {
        return Err(RuntimeLogError { size: input.len() });
    }

    if input.is_empty() {
        return Ok(ParsedRuntimeLog::default());
    }
    let input = input.strip_suffix(b"\n").unwrap_or(input);
    let mut result = ParsedRuntimeLog::default();
    let lines = input.split(|byte| *byte == b'\n');
    for (index, bytes) in lines.enumerate() {
        let line_number = u64::try_from(index + 1).unwrap_or(u64::MAX);
        let bytes = bytes.strip_suffix(b"\r").unwrap_or(bytes);
        let Ok(line) = std::str::from_utf8(bytes) else {
            skip_line(&mut result, line_number, "line is not valid UTF-8", bytes);
            continue;
        };
        match parse_log_line(line) {
            Ok((timestamp_ns, severity, message)) => {
                result.events.push(Event {
                    id: EventId(format!("log.line.{line_number}")),
                    timestamp_ns,
                    source: EventSource("runtime.log".to_owned()),
                    kind: EventKind("log".to_owned()),
                    execution_entity: None,
                    address: None,
                    attributes: json!({
                        "severity": severity,
                        "message": message,
                        "text": line,
                    }),
                });
                result.diagnostics.parsed_lines += 1;
            }
            Err(reason) => skip_line(&mut result, line_number, reason, bytes),
        }
    }
    Ok(result)
}

fn parse_log_line(line: &str) -> Result<(u64, LogSeverity, &str), &'static str> {
    let (timestamp, rest) = line.split_once(' ').ok_or("missing timestamp separator")?;
    let timestamp_ns = parse_timestamp(timestamp)?;
    let rest = rest.strip_prefix('[').ok_or("missing severity")?;
    let (severity, message) = rest.split_once("] ").ok_or("invalid severity separator")?;
    if message.is_empty() {
        return Err("missing message");
    }
    let severity = match severity {
        "DEBUG" => LogSeverity::Debug,
        "INFO" => LogSeverity::Info,
        "WARN" => LogSeverity::Warn,
        "ERROR" => LogSeverity::Error,
        "FAULT" => LogSeverity::Fault,
        _ => return Err("unknown severity"),
    };
    Ok((timestamp_ns, severity, message))
}

fn parse_timestamp(timestamp: &str) -> Result<u64, &'static str> {
    let (seconds, fraction) = timestamp
        .split_once('.')
        .ok_or("timestamp must contain a decimal point")?;
    if seconds.is_empty()
        || fraction.is_empty()
        || fraction.len() > 9
        || !seconds.bytes().all(|byte| byte.is_ascii_digit())
        || !fraction.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err("invalid relative timestamp");
    }
    let seconds = seconds.parse::<u64>().map_err(|_| "timestamp overflow")?;
    let fraction_digits = fraction.len();
    let fraction = fraction.parse::<u64>().map_err(|_| "timestamp overflow")?;
    let scale = 10_u64.pow(u32::try_from(9 - fraction_digits).unwrap_or(0));
    seconds
        .checked_mul(1_000_000_000)
        .and_then(|value| value.checked_add(fraction * scale))
        .ok_or("timestamp overflow")
}

fn skip_line(result: &mut ParsedRuntimeLog, line: u64, reason: &str, text: &[u8]) {
    result.diagnostics.ignored_lines += 1;
    result.diagnostics.skipped.push(LogLineDiagnostic {
        line,
        reason: reason.to_owned(),
        text: String::from_utf8_lossy(text).into_owned(),
    });
}
