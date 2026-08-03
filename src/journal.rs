//! The app's log file.
//!
//! The Windows build opens no console (`main.rs:1`), so every `eprintln!` in the app prints into nothing there. This points stderr at a file beside the vault registry and sends a crash down the same path, so a bug report has something to quote instead of a description from memory.
//!
//! Two rules hold it in place. **Nothing here may take the app down** — every failure is swallowed, and an app that cannot write its journal still opens. **No document text**: a file path says which document, and that is the whole of what a diagnosis needs.

use crate::platform;
use leaftext::app_data_dir;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};

/// Move the journal aside at a megabyte, keeping one previous copy — so the journal is two files on disk and never more.
const ROLL_AT_BYTES: u64 = 1024 * 1024;

/// The journal itself.
pub fn log_path(data_dir: &Path) -> PathBuf {
    data_dir.join("journal.log")
}

/// The one copy kept behind it.
pub fn previous_log_path(data_dir: &Path) -> PathBuf {
    data_dir.join("journal.prev.log")
}

/// Send stderr and panics to the journal. Called once at launch, before the window exists: one size check and one handle swap, and nothing after that costs anything until something is actually printed.
pub fn start() {
    if let Some(data_dir) = app_data_dir() {
        start_in(&data_dir);
    }
}

/// The same, against a named folder. Split out so a test can point a journal at a temporary directory instead of the one the installed app uses.
pub fn start_in(data_dir: &Path) {
    if fs::create_dir_all(data_dir).is_err() {
        return;
    }
    roll(data_dir);
    let Ok(file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path(data_dir))
    else {
        // A read-only data folder: the app keeps the stderr it had and opens.
        return;
    };
    if platform::redirect_stderr(file) {
        install_panic_hook();
    }
}

/// The journal's text, or its last `lines` lines. Empty when there is no file yet, which is indistinguishable from a quiet run and does not need to be.
pub fn read(lines: Option<usize>) -> String {
    let Some(data_dir) = app_data_dir() else {
        return String::new();
    };
    tail(
        &fs::read_to_string(log_path(&data_dir)).unwrap_or_default(),
        lines,
    )
}

/// The last `lines` lines of `text`, still in the order they were written, or all of it when no count was asked for.
pub fn tail(text: &str, lines: Option<usize>) -> String {
    let Some(lines) = lines else {
        return text.to_string();
    };
    let mut kept: Vec<&str> = text.lines().rev().take(lines).collect();
    kept.reverse();
    kept.join("\n")
}

/// Rename the journal out of the way once it is full. Checked at launch, where the cost is paid once, rather than on every line written.
pub fn roll(data_dir: &Path) {
    let path = log_path(data_dir);
    if fs::metadata(&path).is_ok_and(|meta| meta.len() >= ROLL_AT_BYTES) {
        let _ = fs::rename(&path, previous_log_path(data_dir));
    }
}

/// Write a panic where everything else is written. Replaces the default hook rather than chaining to it, so a crash is one record and not two; the backtrace still rides along when `RUST_BACKTRACE` asks for one.
fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let place = match info.location() {
            Some(location) => format!("{}:{}", location.file(), location.line()),
            None => "an unknown place".to_string(),
        };
        eprintln!("panic at {place}: {}", panic_message(info));

        let backtrace = std::backtrace::Backtrace::capture();
        if backtrace.status() == std::backtrace::BacktraceStatus::Captured {
            eprintln!("{backtrace}");
        }
    }));
}

/// What was panicked with. The payload is `&str` for a literal and `String` once it has been formatted; nothing else is worth guessing at.
fn panic_message(info: &std::panic::PanicHookInfo<'_>) -> String {
    let payload = info.payload();
    if let Some(message) = payload.downcast_ref::<&str>() {
        (*message).to_string()
    } else if let Some(message) = payload.downcast_ref::<String>() {
        message.clone()
    } else {
        "no message".to_string()
    }
}
