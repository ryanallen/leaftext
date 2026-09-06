//! The application's guts. main.rs builds the window, the web view and the protocol handlers, then hands control to the event loop here.

// Everything main.rs imports, so the submodules below inherit it via `use super::*` instead of each repeating the list.
use crate::*;

mod code_intel;
mod editing_cmds;
mod eval_ask;
mod event_loop;
mod events;
mod export_cover;
mod file_cmds;
mod fileops;
mod gesture_ask;
mod glossary;
mod history;
mod link_preview;
mod links;
mod picture_clipboard;
mod pipe_asks;
mod render;
mod update_flow;
mod vault_auth;
mod vault_git;
mod vault_remote;
mod vault_search;
mod vaults;
mod view_cmds;
mod watch;
mod window_cmds;
mod workspace;

pub(crate) use code_intel::*;
pub(crate) use editing_cmds::*;
pub(crate) use event_loop::*;
pub(crate) use events::*;
pub(crate) use export_cover::*;
pub(crate) use fileops::*;
pub(crate) use gesture_ask::*;
pub(crate) use glossary::*;
pub(crate) use history::*;
pub(crate) use link_preview::*;
pub(crate) use links::*;
pub(crate) use render::*;
pub(crate) use update_flow::*;
pub(crate) use vault_auth::*;
pub(crate) use vault_git::*;
pub(crate) use vault_remote::*;
pub(crate) use vault_search::*;
pub(crate) use vaults::*;
pub(crate) use watch::*;
pub(crate) use window_cmds::*;
pub(crate) use workspace::*;

#[cfg(test)]
mod tests;
