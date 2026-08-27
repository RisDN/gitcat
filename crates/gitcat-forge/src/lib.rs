//! Hosting-service integration: sign-in, avatars, pull requests, checks and
//! the credentials they use.

mod avatar;
mod cache;
mod github;
mod oauth;
mod status;
mod token;

pub use avatar::*;
pub use cache::*;
pub use github::*;
pub use oauth::*;
pub use status::*;
pub use token::*;
