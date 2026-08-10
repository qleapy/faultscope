//! Architecture- and deployment-independent analysis orchestration.

use std::fmt;

use faultscope_model::{
    AnalysisResult, ArchitectureId, BuildInfo, CrashInfo, ExecutionEnvironmentId, FaultDecode,
    Finding, RegisterSchema, StackFrame, SymbolizedAddress, TargetAddress, TargetSnapshot,
};

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
            .collect::<Result<_, _>>()?;
        let fault = self
            .architecture
            .decode_exception(&crash.snapshot)
            .map_err(|error| AnalysisError::Architecture(error.to_string()))?;
        let findings = self
            .environment
            .analyze(&crash.snapshot)
            .map_err(|error| AnalysisError::Environment(error.to_string()))?;

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
            findings,
        })
    }
}
