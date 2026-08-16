//! Bare-metal execution-environment provider.

use std::convert::Infallible;

use faultscope_core::EnvironmentProvider;
use faultscope_model::{ExecutionEnvironmentId, Finding, TargetSnapshot};

pub struct BareMetal;

impl EnvironmentProvider for BareMetal {
    type Error = Infallible;

    fn id(&self) -> ExecutionEnvironmentId {
        ExecutionEnvironmentId("baremetal".to_owned())
    }

    fn analyze(
        &self,
        _snapshot: &TargetSnapshot,
        _events: &[faultscope_model::Event],
    ) -> Result<Vec<Finding>, Self::Error> {
        Ok(Vec::new())
    }
}
