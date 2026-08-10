//! What the installer exits with.
//!
//! The silent path has no window and no console, so the number it exits with is everything the app that ran it will ever learn. Each one is a separate thing that can go wrong and a separate thing to tell somebody; a single non-zero would make "close Leaftext and try again" indistinguishable from "this file is broken".
//!
//! Reading a code back is the app's job and lives in the app, next to the call that waits on this process — `installer_exit_code_meaning` in `src/platform.rs`, held to this list by a test that reads it.

/// The install finished.
pub const OK: i32 = 0;
/// Something failed and the message says what. Nothing more specific fits.
pub const FAILED: i32 = 1;
/// Leaftext is open and its file could not be replaced. Nothing was changed.
pub const IN_USE: i32 = 2;
/// This installer was built without the app inside it.
pub const NO_PAYLOAD: i32 = 3;
/// The command line was not one this understands.
pub const BAD_ARGUMENTS: i32 = 4;

/// A failure and the code it exits with, so the two are decided together rather than at the place that happens to catch it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failure {
    pub code: i32,
    pub message: String,
}

impl Failure {
    pub fn new(code: i32, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn failed(message: impl Into<String>) -> Self {
        Self::new(FAILED, message)
    }
}
