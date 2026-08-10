//! Architecture- and deployment-independent analysis orchestration.

use faultscope_model::{
    ArchitectureId, FaultDecode, RegisterSchema, StackFrame, SymbolizedAddress, TargetAddress,
    TargetSnapshot,
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

/// Resolves a target address without coupling analysis code to an artifact format.
pub trait SymbolProvider {
    type Error: std::error::Error + Send + Sync + 'static;

    /// Resolves an address while preserving its target metadata.
    ///
    /// # Errors
    ///
    /// Returns a provider-specific error when artifact data cannot be read.
    fn resolve(&self, address: TargetAddress) -> Result<SymbolizedAddress, Self::Error>;
}
