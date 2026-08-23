//! Hosting-service integration: avatar resolution and the credentials it uses.

mod avatar;
mod cache;
mod github;
mod token;

pub use avatar::*;
pub use cache::*;
pub use github::*;
pub use token::*;
