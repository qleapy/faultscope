//! Architecture- and deployment-independent analysis orchestration.

use faultscope_model::{SymbolizedAddress, TargetAddress};

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
