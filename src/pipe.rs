//! The ask pipe: a local channel the running app answers questions on.
//!
//! Reading the journal tells you what the app did. This tells you what it is doing — so a bug can be looked into while it is happening rather than reconstructed afterwards.
//!
//! One ask in, one reply out, both JSON, then the connection closes. A named pipe on Windows and a Unix socket elsewhere; neither needs a crate, and neither is reachable from outside this account.

use crate::app::UserEvent;
use crate::journal;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::mpsc;
use std::time::Duration;
use tao::event_loop::EventLoopProxy;

/// How long the pipe waits on the window thread before answering that it did not reply. A hung app is a fair question to ask, so this has to end.
const REPLY_TIMEOUT: Duration = Duration::from_secs(2);

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
    /// What is open right now.
    #[serde(rename = "state")]
    State,
    /// Run a line of JavaScript in the page and hand back what it came to.
    ///
    /// This is arbitrary code inside the app, reachable by anything running as this user — the same bar as the single-instance pipe, which accepts only a file path where this accepts anything. It is also the whole reason the pipe beats reading the journal: without it you have a log reader, with it a live app can be inspected on both platforms.
    #[serde(rename = "eval")]
    Eval { script: String },
    /// The running build.
    #[serde(rename = "version")]
    Version,
}

fn answered(value: Value) -> String {
    json!({ "ok": true, "answer": value }).to_string()
}

/// An ask that is not in the enum comes back saying so. Deliberately unlike the page's IPC, which drops what it cannot parse: a page typo is a bug in our own code, while a typo here is a person or a tool waiting for an answer.
fn refused(reason: impl std::fmt::Display) -> String {
    json!({ "ok": false, "error": reason.to_string() }).to_string()
}

/// One ask in, one reply out. The transport sits above this and the app below it, so the vocabulary can be tested without either.
///
/// `from_window` is asked only for what the window alone knows. The journal and the version are answered right here, because a hung app is exactly when they are wanted and going through the window would lose them.
pub(crate) fn answer<F>(request: &str, from_window: F) -> String
where
    F: FnOnce(Ask) -> Option<Result<Value, String>>,
{
    let ask = match serde_json::from_str::<Ask>(request.trim()) {
        Ok(ask) => ask,
        Err(error) => {
            return refused(format!(
                "not an ask this app knows ({error}). It answers: \
                 {{\"ask\":\"log\"}}, {{\"ask\":\"log\",\"lines\":50}}, \
                 {{\"ask\":\"state\"}}, {{\"ask\":\"eval\",\"script\":\"1+1\"}}, \
                 {{\"ask\":\"version\"}}"
            ))
        }
    };

    match ask {
        Ask::Version => answered(json!(env!("CARGO_PKG_VERSION"))),
        Ask::Log { lines } => answered(json!(journal::read(lines))),
        window_ask => match from_window(window_ask) {
            Some(Ok(value)) => answered(value),
            Some(Err(reason)) => refused(reason),
            None => refused("the app did not answer in time — its window thread is busy or stuck"),
        },
    }
}

/// Put the ask to the event loop and wait for the reply it fills in.
///
/// This is [`crate::app::off_loop`] run backwards: that takes work off the window thread and posts the answer back as an event, this takes an answer off it.
fn from_window(proxy: &EventLoopProxy<UserEvent>, ask: Ask) -> Option<Result<Value, String>> {
    let (reply, answers) = mpsc::sync_channel(1);
    let event = match ask {
        Ask::State => UserEvent::PipeState { reply },
        Ask::Eval { script } => UserEvent::PipeEval { script, reply },
        // Answered before this is reached.
        _ => return None,
    };
    proxy.send_event(event).ok()?;
    answers.recv_timeout(REPLY_TIMEOUT).ok()
}

/// Start answering. Silent on failure: the app opens whether or not anything can ask it questions.
pub(crate) fn serve(proxy: EventLoopProxy<UserEvent>) {
    let Some(address) = address() else { return };
    listen(address, move |request| {
        answer(request, |ask| from_window(&proxy, ask))
    });
}

#[cfg(windows)]
pub(crate) fn address() -> Option<String> {
    // Per user, so two logged-in accounts do not share one pipe — the same scoping the single-instance pipe uses.
    let user = std::env::var("USERNAME").unwrap_or_default();
    Some(format!(r"\\.\pipe\leaftext-journal-{user}"))
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

    pub(crate) fn listen<F>(address: String, reply: F)
    where
        F: Fn(&str) -> String + Send + 'static,
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
                    if connected {
                        let request = read_message(pipe);
                        write_message(pipe, &reply(&request));
                        // Wait for the asker to take the reply: closing throws away whatever is still in the pipe.
                        unsafe { FlushFileBuffers(pipe) };
                    }

                    // Closed, not disconnected: a disconnect tells the asker the pipe was taken away, which node reports as a failure after a perfectly good reply. Each turn makes its own pipe, so there is nothing to disconnect for.
                    unsafe { CloseHandle(pipe) };
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

    pub(crate) fn listen<F>(address: String, reply: F)
    where
        F: Fn(&str) -> String + Send + 'static,
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
                    // The asker closes its writing half, which ends the read.
                    if stream.read_to_string(&mut request).is_ok() {
                        let _ = stream.write_all(reply(&request).as_bytes());
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
