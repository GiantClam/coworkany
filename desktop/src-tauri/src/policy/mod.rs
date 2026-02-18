//! Policy Gate for effect approval and audit.
//! This module is intentionally standalone so it can be reviewed and tested in isolation.

mod audit;
pub mod commands;
mod engine;
mod types;

pub use audit::ConsoleAuditSink;
pub use commands::PolicyEngineState;
pub use types::{
    EffectContext, EffectPayload, EffectRequest,
    EffectResponse, EffectScope, EffectSource, EffectType,
};
