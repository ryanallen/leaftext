//! What opens when the install is over.
//!
//! A person who ran the installer themselves is installing the app in order to use it, so the install ends with the app rather than with a window that vanished. A silent run is the updater's, and that already reopens the app on its own — starting a second one here would race it, and the same silent path is what a scripted or managed install uses, which must start nothing at all.
//!
//! The decision is data: a function over the request and the plan, answering with what to open or with nothing. Nothing here starts a process, so the whole rule can be asserted on a machine that never runs it.

use crate::args;
use crate::plan;
use std::path::Path;

/// The app to open, and the folder to open it from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Launch<'a> {
    pub program: &'a Path,
    pub working_directory: &'a Path,
}

/// What this run opens once the install has been laid down. `None` is a silent run, which opens nothing.
///
/// Both paths come out of the plan's own Start Menu entry, so a launch from the installer is the same launch that entry makes rather than a second spelling of it.
pub fn after_install<'a>(request: &args::Request, plan: &'a plan::Plan) -> Option<Launch<'a>> {
    if request.silent {
        return None;
    }
    let shortcut = plan.shortcuts.first()?;
    Some(Launch {
        program: &shortcut.target,
        working_directory: &shortcut.working_directory,
    })
}

/// Open it, without waiting. The install has already succeeded, so a launch that will not start is not a failed install: the files are there and the Start Menu entry opens the same app.
#[cfg(windows)]
pub fn start(launch: &Launch) {
    let _ = std::process::Command::new(launch.program)
        .current_dir(launch.working_directory)
        .spawn();
}
