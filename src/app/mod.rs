//! The application's guts. main.rs builds the window, the web view and the
//! protocol handlers, then hands control to the event loop here.

// Everything main.rs imports, so the submodules below inherit it via
// `use super::*` instead of each repeating the list.
use crate::*;

mod code_intel;
mod editing_cmds;
mod event_loop;
mod events;
mod fileops;
mod glossary;
mod history;
mod links;
mod render;
mod update_flow;
mod vault_git;
mod vaults;
mod watch;
mod workspace;

pub(crate) use code_intel::*;
pub(crate) use editing_cmds::*;
pub(crate) use event_loop::*;
pub(crate) use events::*;
pub(crate) use fileops::*;
pub(crate) use glossary::*;
pub(crate) use history::*;
pub(crate) use links::*;
pub(crate) use render::*;
pub(crate) use update_flow::*;
pub(crate) use vault_git::*;
pub(crate) use vaults::*;
pub(crate) use watch::*;
pub(crate) use workspace::*;

#[cfg(test)]
mod tests;
