//! The Codex rules engine. Pure Rust: nothing here knows about WebAssembly, so
//! `cargo test` runs natively and the same crate can back a desktop build or a CLI.
//!
//! THIS WAS A PORT of a TypeScript engine, since deleted, and it reproduces that
//! engine's output for every input, including the outputs that look wrong. Those
//! are listed in `docs/engine-port-fixes.md` and get fixed as separate changes.
//! Comments citing `expr.ts`, `dice.ts`, `graph.ts` or `effects.ts` by line refer
//! to the originals as they stood at commit dde4217.
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

pub mod audit;
pub mod dice;
pub mod expr;
pub mod graph;
pub mod js;
pub mod sheet;
pub mod value;
