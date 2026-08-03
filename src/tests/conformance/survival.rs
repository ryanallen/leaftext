//! Property 2: no case in any suite panics, hangs, or overflows the stack.
//!
//! Out of process, because that is the only way the property can be a verdict. A
//! panic fails one test, but a stack overflow or a hang ends the whole
//! `cargo test` run and takes every other test with it — and these corpora were
//! built to cause exactly that. So the parent never parses anything: it re-runs
//! this same test binary with a batch of cases named in an environment variable,
//! and reads back what survived.
//!
//! The child prints each case's name before reading it, so a batch that dies
//! names its own culprit — the last line printed — and the parent resumes at the
//! case after it. That is why a batch can hold hundreds of cases and still cost
//! one child per failure: ten thousand child processes would be minutes of
//! process startup and nothing else.
//!
//! The child being this same binary is also what keeps the four readers
//! `pub(crate)`. A separate test binary under `tests/` is another crate and could
//! not call any of them.

use super::*;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// The batch the child is to read: `<suite> <start> <count>`.
const BATCH_VAR: &str = "LEAFTEXT_CONFORMANCE_BATCH";

/// What the child prints before reading a case, so the parent knows where it got
/// to when it never came back.
const CASE_MARKER: &str = "conformance-case ";

const BATCH_SIZE: usize = 250;

/// Generous: a batch that takes this long has hung, and the cost of being wrong
/// is one false failure naming the exact case to look at.
const BATCH_TIMEOUT: Duration = Duration::from_secs(120);

#[test]
fn no_case_in_any_suite_panics_hangs_or_overflows() {
    if std::env::var(BATCH_VAR).is_ok() {
        // A child, selected by name. Nothing to do here.
        return;
    }
    for suite in Suite::ALL {
        let all = cases(suite);
        if all.is_empty() {
            continue;
        }
        let mut report = Report::new(suite, Property::Survival);
        let mut index = 0;
        while index < all.len() {
            let count = BATCH_SIZE.min(all.len() - index);
            match run_batch(suite, index, count) {
                Ok(()) => {
                    for case in &all[index..index + count] {
                        report.record(&case.name, None);
                    }
                    index += count;
                }
                Err(failure) => {
                    for case in &all[index..failure.at] {
                        report.record(&case.name, None);
                    }
                    report.record(&all[failure.at].name, Some(failure.detail));
                    index = failure.at + 1;
                }
            }
        }
        report.finish();
    }
}

#[test]
fn one_batch_of_cases() {
    // The child half. A normal `cargo test` leaves the variable unset, so this
    // costs nothing and never touches a corpus.
    let Ok(batch) = std::env::var(BATCH_VAR) else {
        return;
    };
    let mut fields = batch.split(' ');
    let suite = fields
        .next()
        .and_then(Suite::from_id)
        .expect("the batch names a suite");
    let start: usize = fields.next().and_then(|n| n.parse().ok()).unwrap_or(0);
    let count: usize = fields.next().and_then(|n| n.parse().ok()).unwrap_or(0);

    for case in cases(suite).iter().skip(start).take(count) {
        println!("{CASE_MARKER}{}", case.name);
        // Unbuffered, or a crash loses the name of the case that caused it.
        let _ = std::io::Write::flush(&mut std::io::stdout());
        read_case(suite, case);
    }
}

struct BatchFailure {
    /// Index into the suite's cases of the one that did not come back.
    at: usize,
    detail: String,
}

fn run_batch(suite: Suite, start: usize, count: usize) -> Result<(), BatchFailure> {
    let log = std::env::temp_dir().join(format!("leaftext-conformance-{}.log", suite.id()));
    let file = std::fs::File::create(&log).expect("a scratch file for the child's output");
    let binary = std::env::current_exe().expect("this test binary");
    let mut child = Command::new(binary)
        .args([
            "--exact",
            &worker_test_name(),
            "--nocapture",
            "--test-threads=1",
        ])
        .env(BATCH_VAR, format!("{} {start} {count}", suite.id()))
        .stdout(Stdio::from(file))
        // A stack overflow writes its own notice to stderr; the parent's verdict
        // comes from the exit status, so drop it rather than interleave it.
        .stderr(Stdio::null())
        .spawn()
        .expect("re-running this test binary");

    let outcome = wait_with_timeout(&mut child, BATCH_TIMEOUT);
    let printed = std::fs::read_to_string(&log).unwrap_or_default();
    // Counted anywhere in the text, not per line: libtest's own "test … " header
    // carries no newline, so the first marker lands on the end of it.
    let reached = printed.matches(CASE_MARKER).count();
    let _ = std::fs::remove_file(&log);

    let detail = match outcome {
        Outcome::Exited(status) if status.success() => {
            assert_eq!(
                reached,
                count,
                "the child read {reached} of {count} cases and exited cleanly — \
                 is `{}` still the name of the worker test?",
                worker_test_name()
            );
            return Ok(());
        }
        Outcome::Exited(status) => match status.code() {
            Some(code) => format!("the reader died (exit {code})"),
            None => "the reader was killed by a signal".to_string(),
        },
        Outcome::TimedOut => format!("no answer in {} seconds", BATCH_TIMEOUT.as_secs()),
    };
    assert!(
        reached > 0,
        "the child died before reading anything from {} at case {start}: {detail}",
        suite.label()
    );
    Err(BatchFailure {
        at: start + reached - 1,
        detail,
    })
}

enum Outcome {
    Exited(std::process::ExitStatus),
    TimedOut,
}

/// Wait for the child, killing it once the deadline passes. Polling rather than a
/// watchdog thread: `wait` and `kill` both want the handle, and `std` has no way
/// to hand one to two threads.
fn wait_with_timeout(child: &mut Child, limit: Duration) -> Outcome {
    let deadline = Instant::now() + limit;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Outcome::Exited(status),
            Ok(None) => {}
            Err(_) => return Outcome::TimedOut,
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Outcome::TimedOut;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

/// What `--exact` has to be given to select the worker: the test's path inside
/// the binary, which is this module's path without the crate name. Moving the
/// module is safe; renaming the worker is caught by the count check above.
fn worker_test_name() -> String {
    let path = module_path!();
    let module = path.split_once("::").map(|(_, rest)| rest).unwrap_or(path);
    format!("{module}::one_batch_of_cases")
}
