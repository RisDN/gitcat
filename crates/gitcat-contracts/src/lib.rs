//! Transport-neutral contracts shared by the Git backend and a future Tauri IPC layer.

mod error;
mod git;
mod workspace;

pub use error::*;
pub use git::*;
pub use workspace::*;
