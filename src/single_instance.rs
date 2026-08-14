//! Single-instance guard with file hand-off.
//!
//! The first instance owns a named mutex and listens on a named pipe. A later launch detects the mutex, forwards its file path over the pipe (the primary opens it as a new tab), and exits before building any UI.
//!
//! Windows-only; elsewhere every launch is the primary.

use std::path::PathBuf;

/// Outcome of trying to claim the single-instance slot.
pub enum Acquire {
    /// This process owns the instance; keep the guard alive for its lifetime.
    Primary(InstanceGuard),
    /// Another instance is already running; the file (if any) was handed off to it and this process should exit without opening a window.
    // Matched everywhere, constructed only by the Windows hand-off — elsewhere every launch is the primary.
    #[cfg_attr(not(windows), allow(dead_code))]
    Forwarded,
}

#[cfg(windows)]
mod platform {
    use super::{Acquire, PathBuf};
    use std::ptr;
    use std::time::Duration;

    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE};
    use windows_sys::Win32::Storage::FileSystem::{CreateFileW, ReadFile, WriteFile};
    use windows_sys::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, WaitNamedPipeW,
    };
    use windows_sys::Win32::System::Threading::CreateMutexW;

    // Win32 constants used raw so we don't depend on their exact module path across windows-sys versions.
    const PIPE_ACCESS_INBOUND: u32 = 0x0000_0001;
    const PIPE_TYPE_MESSAGE: u32 = 0x0000_0004;
    const PIPE_READMODE_MESSAGE: u32 = 0x0000_0002;
    const PIPE_WAIT: u32 = 0x0000_0000;
    const PIPE_UNLIMITED_INSTANCES: u32 = 255;
    const GENERIC_WRITE: u32 = 0x4000_0000;
    const OPEN_EXISTING: u32 = 3;
    const ERROR_ALREADY_EXISTS: u32 = 183;
    const ERROR_PIPE_BUSY: u32 = 231;
    const ERROR_PIPE_CONNECTED: u32 = 535;

    /// Owns the process-lifetime mutex handle; releasing it (on exit) frees the single-instance slot for the next launch.
    pub struct InstanceGuard {
        mutex: HANDLE,
    }

    // The handle is only ever closed on drop from the thread that created it; it is not shared. Marking it Send lets the guard sit in the app state struct.
    unsafe impl Send for InstanceGuard {}

    impl Drop for InstanceGuard {
        fn drop(&mut self) {
            if !self.mutex.is_null() {
                unsafe { CloseHandle(self.mutex) };
            }
        }
    }

    fn is_invalid(handle: HANDLE) -> bool {
        handle.is_null() || handle as isize == -1
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Names are scoped per user so two logged-in users don't share one slot.
    fn user_suffix() -> String {
        std::env::var("USERNAME").unwrap_or_default()
    }

    fn mutex_name() -> String {
        format!("leaftext-single-instance-{}", user_suffix())
    }

    fn pipe_name() -> String {
        format!(r"\\.\pipe\leaftext-single-instance-{}", user_suffix())
    }

    /// Send one message to the running instance: a UTF-8 path, or empty to ask it only to focus. Retries briefly to cover the window where the primary holds the mutex but has not yet created the pipe, or the pipe is momentarily busy.
    fn forward(message: &str) -> bool {
        let name = wide(&pipe_name());
        for _ in 0..25 {
            let handle = unsafe {
                CreateFileW(
                    name.as_ptr(),
                    GENERIC_WRITE,
                    0,
                    ptr::null(),
                    OPEN_EXISTING,
                    0,
                    ptr::null_mut(),
                )
            };
            if !is_invalid(handle) {
                let bytes = message.as_bytes();
                let mut written: u32 = 0;
                unsafe {
                    WriteFile(
                        handle,
                        bytes.as_ptr(),
                        bytes.len() as u32,
                        &mut written,
                        ptr::null_mut(),
                    );
                    CloseHandle(handle);
                }
                return true;
            }
            if unsafe { GetLastError() } == ERROR_PIPE_BUSY {
                unsafe { WaitNamedPipeW(name.as_ptr(), 200) };
            } else {
                std::thread::sleep(Duration::from_millis(80));
            }
        }
        false
    }

    pub fn acquire(open_path: Option<&std::path::Path>) -> Acquire {
        let name = wide(&mutex_name());
        let mutex = unsafe { CreateMutexW(ptr::null(), 0, name.as_ptr()) };
        let already_running = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;

        // If the mutex could not be created at all, fail open: behave as the primary so a launch is never silently swallowed.
        if mutex.is_null() {
            return Acquire::Primary(InstanceGuard { mutex });
        }

        if already_running {
            let message = open_path
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            forward(&message);
            unsafe { CloseHandle(mutex) };
            return Acquire::Forwarded;
        }

        Acquire::Primary(InstanceGuard { mutex })
    }

    /// Spawn the pipe server. `on_message` is called for each later launch: `Some(path)` to open a file, `None` to just bring the window forward.
    pub fn serve<F>(on_message: F)
    where
        F: Fn(Option<PathBuf>) + Send + 'static,
    {
        std::thread::Builder::new()
            .name("leaf-single-instance".into())
            .spawn(move || {
                let name = wide(&pipe_name());
                loop {
                    let pipe = unsafe {
                        CreateNamedPipeW(
                            name.as_ptr(),
                            PIPE_ACCESS_INBOUND,
                            PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT,
                            PIPE_UNLIMITED_INSTANCES,
                            0,
                            4096,
                            0,
                            ptr::null(),
                        )
                    };
                    if is_invalid(pipe) {
                        // Can't serve; stop trying rather than spin.
                        return;
                    }

                    let connected = unsafe { ConnectNamedPipe(pipe, ptr::null_mut()) } != 0
                        || unsafe { GetLastError() } == ERROR_PIPE_CONNECTED;

                    if connected {
                        let mut message = Vec::new();
                        let mut buffer = [0u8; 4096];
                        loop {
                            let mut read: u32 = 0;
                            let ok = unsafe {
                                ReadFile(
                                    pipe,
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
                        let text = String::from_utf8_lossy(&message);
                        let trimmed = text.trim();
                        if trimmed.is_empty() {
                            on_message(None);
                        } else {
                            on_message(Some(PathBuf::from(trimmed)));
                        }
                    }

                    unsafe {
                        DisconnectNamedPipe(pipe);
                        CloseHandle(pipe);
                    }
                }
            })
            .ok();
    }
}

#[cfg(windows)]
pub use platform::{acquire, serve, InstanceGuard};

#[cfg(not(windows))]
mod platform {
    use super::{Acquire, PathBuf};

    /// No-op guard on non-Windows platforms.
    pub struct InstanceGuard;

    pub fn acquire(_open_path: Option<&std::path::Path>) -> Acquire {
        Acquire::Primary(InstanceGuard)
    }

    pub fn serve<F>(_on_message: F)
    where
        F: Fn(Option<PathBuf>) + Send + 'static,
    {
    }
}

#[cfg(not(windows))]
pub use platform::{acquire, serve, InstanceGuard};
