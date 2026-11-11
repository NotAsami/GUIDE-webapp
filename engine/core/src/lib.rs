//! The Codex rules engine. Pure Rust: nothing here knows about WebAssembly, so
//! `cargo test` runs natively and the same crate can back a desktop build or a CLI.
//!
//! THIS IS A PORT. Every function mirrors a TypeScript original in `src/lib/` and
//! must give the same output for every input, including the outputs that look
//! wrong. Those are listed in `docs/engine-port-fixes.md`, not fixed here.
//!
//! The engine never panics: every failure is a `Result`. The lints below hold
//! that line outside tests.
#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::unreachable,
    clippy::todo,
    clippy::unimplemented
)]
#![cfg_attr(
    test,
    allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::indexing_slicing)
)]

pub mod dice;
pub mod expr;
pub mod js;
