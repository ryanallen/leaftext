//! The ask pipe: a local channel the running app answers questions on.
//!
//! Reading the journal tells you what the app did. This tells you what it is doing — so a bug can be looked into while it is happening rather than reconstructed afterwards.
//!
//! One ask in, one reply out, both JSON, then the connection closes. A named pipe on Windows and a Unix socket elsewhere; neither needs a crate, and neither is reachable from outside this account.

use crate::app::UserEvent;
use crate::journal;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tao::event_loop::EventLoopProxy;

/// How long the pipe waits on the window thread before answering that it did not reply. A hung app is a fair question to ask, so this has to end.
const REPLY_TIMEOUT: Duration = Duration::from_secs(2);

/// What the asker is told when the window never filled the reply in.
const NO_REPLY: &str = "the app did not answer in time — its window thread is busy or stuck";

/// How long an export gets instead. Rendering a twenty-screen document to paper is real work and the loop is inside it, so the wait every other ask gets would report a stuck app over a file that was about to be written.
const EXPORT_TIMEOUT: Duration = Duration::from_secs(60);

/// The page's own account of what the reader can see. A function in the shell rather than a line of JavaScript here, so `check-shell` calls it against its fake page and a renamed element fails the suite instead of the next ask.
const READER_STATE: &str = "window.leafReaderState()";

/// How long `idle` keeps asking the page whether it has finished rendering. Inside [`REPLY_TIMEOUT`]: the pipe stops waiting on the window at two seconds, so a wait that outlasted it would be cut off by the thing it runs inside.
const IDLE_BUDGET: Duration = Duration::from_millis(1200);

/// The gap between those asks. Short enough that the answer is about now, long enough that the window thread is not being asked in a spin.
const IDLE_POLL: Duration = Duration::from_millis(60);

/// What can be asked. One enum, written the way `IpcCommand` is: one variant, one arm, and never a second list of the things it accepts.
#[derive(Debug, Deserialize)]
#[serde(tag = "ask")]
pub(crate) enum Ask {
    /// The journal, or its last `lines` lines.
    #[serde(rename = "log")]
    Log {
        #[serde(default)]
        lines: Option<usize>,
    },
    /// What is open right now. With `reader` set it also carries what the page can see — where somebody is scrolled to, which panels are up, what is selected — which the workspace does not hold: a visit's anchor is `None` until the reader leaves the document, so the app's own record is always one navigation behind.
    ///
    /// Opt-in rather than always, because the whole point of `state` is that it answers an app that is stuck, and a page too stuck to reply would otherwise take the tab list down with it.
    #[serde(rename = "state")]
    State {
        #[serde(default)]
        reader: bool,
    },
    /// Run a line of JavaScript in the page and hand back what it came to. A line that failed comes back refused rather than answered: one that threw carries the message and stack the engine gave it, and one the page never read at all says so, so `null` means the line really did evaluate to nothing.
    ///
    /// This is arbitrary code inside the app, reachable by anything running as this user — the same bar as the single-instance pipe, which accepts only a file path where this accepts anything. It is also the whole reason the pipe beats reading the journal: without it you have a log reader, with it a live app can be inspected on both platforms.
    #[serde(rename = "eval")]
    Eval { script: String },
    /// A document's source as the app holds it. The file is opened, or brought to the front if it is already open, so the window always shows what is being worked on. Answers the text, how the file is spelled, whether it has edits nobody has saved, and a fingerprint.
    ///
    /// This is the read half of the one path that writes a document without going through the page: the buffer keeps the file's encoding and its byte order mark, which is what a rewrite through a terminal cannot do.
    #[serde(rename = "doc")]
    Doc { path: PathBuf },
    /// Splice `text` over the byte range `[start, end)` of the document at the front, as one undo step, so the owner can take it back the way they take back their own edits. The offsets count bytes of the UTF-8 text [`Ask::Doc`] answered; a whole-document replace is `0` to its length.
    ///
    /// `expect` is the fingerprint that answer carried. A document that has moved on since — the reader typed, the file was reloaded — refuses the write and says what its fingerprint is now, so nothing is written over an edit nobody has seen. There is no session behind this: each ask stands alone, and the fingerprint is the whole of what makes a write safe.
    #[serde(rename = "edit")]
    Edit {
        path: PathBuf,
        start: usize,
        end: usize,
        text: String,
        expect: String,
    },
    /// Check or clear one task of the document at the front, and write it at once — the same action the reader's own checkbox is, which is why it needs no separate save.
    ///
    /// `index` is the task's place in the `tasks` list [`Ask::Doc`] answered, counting from zero, so nothing here computes a byte offset. `expect` is that answer's fingerprint, and everything the guard refuses — a document that is not at the front, a fingerprint that has moved, a document with no tasks, an index naming none — is refused before a byte is written.
    #[serde(rename = "task")]
    Task {
        path: PathBuf,
        index: usize,
        expect: String,
    },
    /// Write the document at the front to its file, the way the page's own Save does — through the host, so the file is written back the way it was spelled. Guarded by the same fingerprint as [`Ask::Edit`].
    ///
    /// Refused for a document that has never been named: naming one opens a dialog, and that is the owner's to answer.
    #[serde(rename = "save")]
    Save { path: PathBuf, expect: String },
    /// Write the page at the front out as a PDF at `path`, with no save dialog in the way.
    ///
    /// The one file the app makes that nothing here could ever read: the Export button opens a dialog, and no session can answer one. So the sheet it produces — how tall it came out against how tall the page said the document was — had never been seen by anything but a person. `width` and `height` are the page's own measurement; `eval` `pageExportSize()` for them rather than working them out, or the reading is of somebody's arithmetic instead of the app's.
    #[serde(rename = "export")]
    Export {
        path: PathBuf,
        width: f64,
        height: f64,
    },
    /// Wait for the page to finish rendering, then answer. What a driven pass asks instead of guessing a sleep: guessing costs three seconds a command for a render that takes a fraction of that.
    #[serde(rename = "idle")]
    Idle,
    /// The running build.
    #[serde(rename = "version")]
    Version,
    /// Close the app, through its own close rather than beside it: the window's size, place and maximized state are saved, the page is dropped, and the loop stops. A kill from the shell is the one exit that skips all of that.
    ///
    /// The loop only answers here. Closing is a second event, sent by the pipe thread once the asker has taken the reply — see [`AfterReply`].
    #[serde(rename = "quit")]
    Quit,
}

/// One reply, and whatever has to happen once its bytes are out of the pipe.
pub(crate) struct Reply {
    pub(crate) text: String,
    pub(crate) after: Option<AfterReply>,
}

/// What the transport does once the asker has taken the reply. A name rather than a closure: the transport must not learn how to reach the event loop, and `serve` is the only place that knows what closing means.
///
/// It exists because stopping the loop ends the process and every thread with it, so a reply still in the pipe at that moment is thrown away — the same lost answer the Windows half waits for the asker to avoid.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum AfterReply {
    /// Close the app.
    Close,
}

fn answered(value: Value) -> Reply {
    Reply {
        text: json!({ "ok": true, "answer": value }).to_string(),
        after: None,
    }
}

/// An ask that is not in the enum comes back saying so. Deliberately unlike the page's IPC, which drops what it cannot parse: a page typo is a bug in our own code, while a typo here is a person or a tool waiting for an answer.
fn refused(reason: impl std::fmt::Display) -> Reply {
    Reply {
        text: json!({ "ok": false, "error": reason.to_string() }).to_string(),
        after: None,
    }
}

/// One ask in, one reply out. The transport sits above this and the app below it, so the vocabulary can be tested without either.
///
/// `from_window` is asked only for what the window alone knows. The journal and the version are answered right here, because a hung app is exactly when they are wanted and going through the window would lose them.
pub(crate) fn answer<F>(request: &str, from_window: F) -> Reply
where
    F: Fn(Ask) -> Option<Result<Value, String>>,
{
    let ask = match serde_json::from_str::<Ask>(request.trim()) {
        Ok(ask) => ask,
        Err(error) => {
            return refused(format!(
                "not an ask this app knows ({error}). It answers: \
                 {{\"ask\":\"log\"}}, {{\"ask\":\"log\",\"lines\":50}}, \
                 {{\"ask\":\"state\"}}, {{\"ask\":\"state\",\"reader\":true}}, \
                 {{\"ask\":\"eval\",\"script\":\"1+1\"}}, \
                 {{\"ask\":\"doc\",\"path\":\"notes/a.md\"}}, \
                 {{\"ask\":\"edit\",\"path\":\"notes/a.md\",\"start\":0,\"end\":0,\
                 \"text\":\"new\",\"expect\":\"the fingerprint doc answered\"}}, \
                 {{\"ask\":\"task\",\"path\":\"notes/a.md\",\"index\":0,\
                 \"expect\":\"the fingerprint doc answered\"}}, \
                 {{\"ask\":\"save\",\"path\":\"notes/a.md\",\
                 \"expect\":\"the fingerprint doc answered\"}}, \
                 {{\"ask\":\"export\",\"path\":\"page.pdf\",\"width\":1280,\"height\":5819}}, \
                 {{\"ask\":\"idle\"}}, \
                 {{\"ask\":\"version\"}}, {{\"ask\":\"quit\"}}"
            ))
        }
    };

    match ask {
        Ask::Version => answered(json!(env!("CARGO_PKG_VERSION"))),
        Ask::Log { lines } => answered(json!(journal::read(lines))),
        // The workspace half first and on its own, so a page that cannot answer costs the reader half and nothing else — the tabs, the paths and the vault still come back from an app whose window is wedged.
        Ask::State { reader } => match from_window(Ask::State { reader: false }) {
            Some(Ok(mut value)) => {
                if reader {
                    let seen = from_window(Ask::Eval {
                        script: READER_STATE.to_string(),
                    });
                    if let Some(fields) = value.as_object_mut() {
                        fields.insert("reader".to_string(), reader_half(seen));
                    }
                }
                answered(value)
            }
            Some(Err(reason)) => refused(reason),
            None => refused(NO_REPLY),
        },
        Ask::Idle => idle(from_window),
        // Answered and no more: the reply is still in the pipe, and stopping the loop now would throw it away. The transport closes the app once the asker has taken it.
        Ask::Quit => match from_window(Ask::Quit) {
            Some(Ok(value)) => Reply {
                after: Some(AfterReply::Close),
                ..answered(value)
            },
            Some(Err(reason)) => refused(reason),
            None => refused(NO_REPLY),
        },
        window_ask => match from_window(window_ask) {
            Some(Ok(value)) => answered(value),
            Some(Err(reason)) => refused(reason),
            None => refused(NO_REPLY),
        },
    }
}

/// The reader half, or why it is missing. Never an absent field: an asker that cannot tell "the page says nothing is selected" from "the page never answered" would read the first as the second.
fn reader_half(seen: Option<Result<Value, String>>) -> Value {
    match seen {
        Some(Ok(value)) => value,
        Some(Err(reason)) => json!({ "error": reason }),
        None => json!({ "error": NO_REPLY }),
    }
}

/// Ask the page whether it is still rendering until it says it is not, or until the budget runs out. Answers which of the two it hit, so a driven pass never reads a timeout as a settled page.
fn idle<F>(from_window: F) -> Reply
where
    F: Fn(Ask) -> Option<Result<Value, String>>,
{
    let started = Instant::now();
    loop {
        let seen = from_window(Ask::Eval {
            script: READER_STATE.to_string(),
        });
        let value = match seen {
            Some(Ok(value)) => value,
            Some(Err(reason)) => return refused(reason),
            None => return refused(NO_REPLY),
        };
        let waited = started.elapsed();
        let rendering = value.get("renderInFlight") == Some(&Value::Bool(true));
        if !rendering {
            return answered(json!({
                "idle": true,
                "waitedMs": waited.as_millis(),
                "reader": value,
            }));
        }
        if waited >= IDLE_BUDGET {
            return answered(json!({
                "idle": false,
                "waitedMs": waited.as_millis(),
                "why": format!("the page was still rendering after {} ms", waited.as_millis()),
                "reader": value,
            }));
        }
        std::thread::sleep(IDLE_POLL);
    }
}

/// Put the ask to the event loop and wait for the reply it fills in.
///
/// This is [`crate::app::off_loop`] run backwards: that takes work off the window thread and posts the answer back as an event, this takes an answer off it.
fn from_window(proxy: &EventLoopProxy<UserEvent>, ask: Ask) -> Option<Result<Value, String>> {
    let (reply, answers) = mpsc::sync_channel(1);
    // Read before the ask is spent building the event: an export is the one that takes real time on the loop.
    let budget = match ask {
        Ask::Export { .. } => EXPORT_TIMEOUT,
        _ => REPLY_TIMEOUT,
    };
    let event = match ask {
        // The reader flag is answered above this, by a second ask through the page: the loop only ever builds the workspace half.
        Ask::State { .. } => UserEvent::PipeState { reply },
        Ask::Eval { script } => UserEvent::PipeEval { script, reply },
        Ask::Doc { path } => UserEvent::PipeDoc { path, reply },
        Ask::Edit {
            path,
            start,
            end,
            text,
            expect,
        } => UserEvent::PipeEdit {
            path,
            start,
            end,
            text,
            expect,
            reply,
        },
        Ask::Task {
            path,
            index,
            expect,
        } => UserEvent::PipeTask {
            path,
            index,
            expect,
            reply,
        },
        Ask::Save { path, expect } => UserEvent::PipeSave {
            path,
            expect,
            reply,
        },
        Ask::Export {
            path,
            width,
            height,
        } => UserEvent::PipeExport {
            path,
            width,
            height,
            reply,
        },
        // Whether the loop heard, and nothing else: the closing itself is [`UserEvent::PipeCloseNow`], sent after the reply is out.
        Ask::Quit => UserEvent::PipeQuit { reply },
        // Answered before this is reached.
        _ => return None,
    };
    proxy.send_event(event).ok()?;
    answers.recv_timeout(budget).ok()
}

/// Start answering. Silent on failure: the app opens whether or not anything can ask it questions.
pub(crate) fn serve(proxy: EventLoopProxy<UserEvent>) {
    let Some(address) = address() else { return };
    let closer = proxy.clone();
    listen(
        address,
        move |request| answer(request, |ask| from_window(&proxy, ask)),
        // The only place that knows what an after-reply action means. Sent from the pipe thread, which is the one thing that can see the answer was delivered.
        move |after| match after {
            AfterReply::Close => {
                let _ = closer.send_event(UserEvent::PipeCloseNow);
            }
        },
    );
}

#[cfg(windows)]
pub(crate) fn address() -> Option<String> {
    let user = std::env::var("USERNAME").unwrap_or_default();
    Some(ask_pipe_name(&user))
}

/// Where a copy answers what it has open and takes an edit. Scoped per user so two logged-in accounts do not share one pipe, the same way the single-instance pipe is.
#[cfg(windows)]
pub(crate) fn ask_pipe_name(user: &str) -> String {
    format!(r"\\.\pipe\leaftext-journal-{user}")
}

#[cfg(unix)]
pub(crate) fn address() -> Option<String> {
    // In the app's own data folder, which is already inside the user's home, so the folder's permissions are the socket's.
    Some(
        leaftext::app_data_dir()?
            .join("journal.sock")
            .to_string_lossy()
            .to_string(),
    )
}

#[cfg(windows)]
mod transport {
    use std::ptr;
    use std::time::Duration;

    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE};
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FlushFileBuffers, ReadFile, WriteFile,
    };
    use windows_sys::Win32::System::Pipes::{ConnectNamedPipe, CreateNamedPipeW, WaitNamedPipeW};

    // Raw rather than imported, so the exact windows-sys module path for each is not a thing this file depends on — the same choice single_instance.rs made. DUPLEX, not INBOUND: this pipe answers, and that one only ever listens.
    const PIPE_ACCESS_DUPLEX: u32 = 0x0000_0003;
    const PIPE_TYPE_MESSAGE: u32 = 0x0000_0004;
    const PIPE_READMODE_MESSAGE: u32 = 0x0000_0002;
    const PIPE_WAIT: u32 = 0x0000_0000;
    const PIPE_UNLIMITED_INSTANCES: u32 = 255;
    const GENERIC_READ: u32 = 0x8000_0000;
    const GENERIC_WRITE: u32 = 0x4000_0000;
    const OPEN_EXISTING: u32 = 3;
    const ERROR_PIPE_BUSY: u32 = 231;
    const ERROR_PIPE_CONNECTED: u32 = 535;
    const BUFFER_BYTES: u32 = 64 * 1024;

    fn is_invalid(handle: HANDLE) -> bool {
        handle.is_null() || handle as isize == -1
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn read_message(handle: HANDLE) -> String {
        let mut message = Vec::new();
        let mut buffer = [0u8; 8192];
        loop {
            let mut read: u32 = 0;
            let ok = unsafe {
                ReadFile(
                    handle,
                    buffer.as_mut_ptr(),
                    buffer.len() as u32,
                    &mut read,
                    ptr::null_mut(),
                )
            };
            if ok == 0 || read == 0 {
                break;
            }
            message.extend_from_slice(&buffer[..read as usize]);
            if (read as usize) < buffer.len() {
                break;
            }
        }
        String::from_utf8_lossy(&message).into_owned()
    }

    fn write_message(handle: HANDLE, text: &str) {
        let bytes = text.as_bytes();
        let mut written: u32 = 0;
        unsafe {
            WriteFile(
                handle,
                bytes.as_ptr(),
                bytes.len() as u32,
                &mut written,
                ptr::null_mut(),
            );
        }
    }

    pub(crate) fn listen<F, A>(address: String, reply: F, then: A)
    where
        F: Fn(&str) -> super::Reply + Send + 'static,
        A: Fn(super::AfterReply) + Send + 'static,
    {
        std::thread::Builder::new()
            .name("leaf-ask-pipe".into())
            .spawn(move || {
                let name = wide(&address);
                loop {
                    let pipe = unsafe {
                        CreateNamedPipeW(
                            name.as_ptr(),
                            PIPE_ACCESS_DUPLEX,
                            PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT,
                            PIPE_UNLIMITED_INSTANCES,
                            BUFFER_BYTES,
                            BUFFER_BYTES,
                            0,
                            ptr::null(),
                        )
                    };
                    if is_invalid(pipe) {
                        // Cannot serve at all; stop rather than spin.
                        return;
                    }

                    let connected = unsafe { ConnectNamedPipe(pipe, ptr::null_mut()) } != 0
                        || unsafe { GetLastError() } == ERROR_PIPE_CONNECTED;
                    let mut after = None;
                    if connected {
                        let request = read_message(pipe);
                        let answer = reply(&request);
                        write_message(pipe, &answer.text);
                        // Wait for the asker to take the reply: closing throws away whatever is still in the pipe.
                        unsafe { FlushFileBuffers(pipe) };
                        after = answer.after;
                    }

                    // Closed, not disconnected: a disconnect tells the asker the pipe was taken away, which node reports as a failure after a perfectly good reply. Each turn makes its own pipe, so there is nothing to disconnect for.
                    unsafe { CloseHandle(pipe) };

                    // Only now, with the bytes taken and the handle closed: nothing this does can take the answer back.
                    if let Some(after) = after {
                        then(after);
                    }
                }
            })
            .ok();
    }

    /// The other end. The app answers rather than asks, so only the tests call this — but it belongs beside the half it talks to.
    #[allow(dead_code)]
    pub(crate) fn ask(address: &str, request: &str) -> Option<String> {
        let name = wide(address);
        for _ in 0..25 {
            let handle = unsafe {
                CreateFileW(
                    name.as_ptr(),
                    GENERIC_READ | GENERIC_WRITE,
                    0,
                    ptr::null(),
                    OPEN_EXISTING,
                    0,
                    ptr::null_mut(),
                )
            };
            if !is_invalid(handle) {
                write_message(handle, request);
                let reply = read_message(handle);
                unsafe { CloseHandle(handle) };
                return Some(reply);
            }
            if unsafe { GetLastError() } == ERROR_PIPE_BUSY {
                unsafe { WaitNamedPipeW(name.as_ptr(), 200) };
            } else {
                std::thread::sleep(Duration::from_millis(80));
            }
        }
        None
    }

    /// Ask, read the reply, then read once more and report what ending the server gave. Only a test wants this: what an asker is told *after* a good reply is the whole of the bug that made every question fail.
    #[cfg(test)]
    pub(crate) fn ask_then_ending(address: &str, request: &str) -> Option<(String, u32)> {
        let name = wide(address);
        // The same wait `ask` does: the listener's thread may not have made the pipe yet, and a test that raced it would fail for the wrong reason.
        let mut handle = 0 as HANDLE;
        for _ in 0..25 {
            handle = unsafe {
                CreateFileW(
                    name.as_ptr(),
                    GENERIC_READ | GENERIC_WRITE,
                    0,
                    ptr::null(),
                    OPEN_EXISTING,
                    0,
                    ptr::null_mut(),
                )
            };
            if !is_invalid(handle) {
                break;
            }
            std::thread::sleep(Duration::from_millis(80));
        }
        if is_invalid(handle) {
            return None;
        }
        write_message(handle, request);
        let reply = read_message(handle);

        let mut buffer = [0u8; 16];
        let mut read: u32 = 0;
        unsafe {
            ReadFile(
                handle,
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                &mut read,
                ptr::null_mut(),
            )
        };
        let ending = unsafe { GetLastError() };
        unsafe { CloseHandle(handle) };
        Some((reply, ending))
    }
}

#[cfg(unix)]
mod transport {
    use std::io::{Read, Write};
    use std::os::unix::net::{UnixListener, UnixStream};

    pub(crate) fn listen<F, A>(address: String, reply: F, then: A)
    where
        F: Fn(&str) -> super::Reply + Send + 'static,
        A: Fn(super::AfterReply) + Send + 'static,
    {
        // A socket file left by a crash would refuse the bind, and it names nothing but this app's own pipe.
        let _ = std::fs::remove_file(&address);
        let Ok(listener) = UnixListener::bind(&address) else {
            return;
        };
        std::thread::Builder::new()
            .name("leaf-ask-pipe".into())
            .spawn(move || {
                for stream in listener.incoming().flatten() {
                    let mut stream = stream;
                    let mut request = String::new();
                    let mut after = None;
                    // The asker closes its writing half, which ends the read.
                    if stream.read_to_string(&mut request).is_ok() {
                        let answer = reply(&request);
                        let _ = stream.write_all(answer.text.as_bytes());
                        after = answer.after;
                    }

                    // The asker reads until the stream ends, so the reply is only theirs once this is dropped — and only then is there anything safe to do about it.
                    drop(stream);
                    if let Some(after) = after {
                        then(after);
                    }
                }
            })
            .ok();
    }

    /// The other end. The app answers rather than asks, so only the tests call this — but it belongs beside the half it talks to.
    #[allow(dead_code)]
    pub(crate) fn ask(address: &str, request: &str) -> Option<String> {
        let mut stream = UnixStream::connect(address).ok()?;
        stream.write_all(request.as_bytes()).ok()?;
        stream.shutdown(std::net::Shutdown::Write).ok()?;
        let mut reply = String::new();
        stream.read_to_string(&mut reply).ok()?;
        Some(reply)
    }
}

#[cfg(all(test, windows))]
pub(crate) use transport::ask_then_ending;
/// The transport, whichever one this platform has. Both halves take an address and a function from one ask to one reply, so everything above them is shared.
// `ask` is the client half: the tests call it, the app does not.
#[allow(unused_imports)]
pub(crate) use transport::{ask, listen};
