//! The Windows installer a policy cannot refuse.
//!
//! Every write the MSI makes is a file in the user's profile or a value under `HKCU`, so nothing about the install needs the Windows Installer service — and a machine whose policy blocks MSI packages blocks them whoever signed them. This produces the same install from the same plan: same folder, same values, same single Start Menu entry, same file associations. Only the delivery differs.
//!
//! It carries the app inside it, deflated, so the one file a person downloads is everything it installs.

#![cfg_attr(windows, windows_subsystem = "windows")]

mod args;
mod exit;
mod launch;
mod locations;
mod plan;

#[cfg(windows)]
mod apply;
#[cfg(windows)]
mod registry;
#[cfg(windows)]
mod shortcut;
#[cfg(windows)]
mod ui;

#[cfg(test)]
mod tests;

/// The app, deflated by `build.rs`. Empty when this was built without `LEAFTEXT_APP_EXE`, which the install refuses with a message rather than a half-written folder.
#[cfg(windows)]
const PAYLOAD: &[u8] = include_bytes!(env!("LEAFTEXT_PAYLOAD"));

/// The app's version, read out of its own `Cargo.toml` at build time. This is what goes in Installed Apps.
const VERSION: &str = env!("LEAFTEXT_VERSION");

#[cfg(not(windows))]
fn main() {
    eprintln!("leaftext-setup installs Leaftext on Windows; there is nothing for it to do here.");
}

#[cfg(windows)]
fn main() {
    std::process::exit(run());
}

#[cfg(windows)]
fn run() -> i32 {
    let request = match args::parse(std::env::args().skip(1)) {
        Ok(request) => request,
        Err(message) => {
            report(true, &exit::Failure::new(exit::BAD_ARGUMENTS, message));
            return exit::BAD_ARGUMENTS;
        }
    };

    let outcome = if request.uninstall {
        remove(&request)
    } else {
        add(&request)
    };

    match outcome {
        Ok(()) => exit::OK,
        Err(failure) => {
            report(request.silent, &failure);
            failure.code
        }
    }
}

/// Put the install on, then open the app for whoever ran this themselves.
///
/// A silent run takes the folder it was given; anything else asks first, on the one screen, and a canceled screen is a run that did nothing and says so by exiting cleanly.
#[cfg(windows)]
fn add(request: &args::Request) -> Result<(), exit::Failure> {
    let folder = match ui_folder(request) {
        Some(folder) => folder,
        None => return Ok(()),
    };
    let expected: usize = env!("LEAFTEXT_PAYLOAD_BYTES").parse().unwrap_or(0);
    let app = apply::unpack(PAYLOAD, expected)?;
    let running = std::env::current_exe().map_err(|error| {
        exit::Failure::failed(format!("could not find this installer: {error}"))
    })?;

    let plan = plan::plan(&folder, &locations::start_menu_folder(), VERSION);
    apply::install(
        &plan,
        &apply::Sources {
            app: &app,
            uninstaller: &running,
        },
        None,
    )?;

    if let Some(opening) = launch::after_install(request, &plan) {
        launch::start(&opening);
    }
    Ok(())
}

/// Take it back off.
///
/// A program cannot delete the folder it is running from, so the copy in the install folder puts itself in the temporary folder and runs again from there. That second run is what does the work.
#[cfg(windows)]
fn remove(request: &args::Request) -> Result<(), exit::Failure> {
    let folder = install_folder(request);
    let running = std::env::current_exe().map_err(|error| {
        exit::Failure::failed(format!("could not find this installer: {error}"))
    })?;

    if apply::uninstall_needs_relocation(&running, &folder) {
        let moved = apply::relocated_uninstaller();
        std::fs::copy(&running, &moved).map_err(|error| {
            exit::Failure::failed(format!("could not step out of the install folder: {error}"))
        })?;
        std::process::Command::new(&moved)
            .arg("--uninstall")
            .arg("--silent")
            .arg("--dir")
            .arg(&folder)
            .spawn()
            .map_err(|error| {
                exit::Failure::failed(format!("could not start the uninstaller: {error}"))
            })?;
        return Ok(());
    }

    apply::uninstall(
        &plan::plan(&folder, &locations::start_menu_folder(), VERSION),
        None,
    )
}

/// The folder this run installs to, after the reader has had their say. `None` means the screen was closed or canceled.
#[cfg(windows)]
fn ui_folder(request: &args::Request) -> Option<std::path::PathBuf> {
    let folder = install_folder(request);
    if request.silent {
        return Some(folder);
    }
    ui::choose_folder(folder)
}

/// Where this run installs to: what was asked for, then what the last install remembered, then the default. The remembered value is the one `wix/main.wxs` writes and reads, so a folder chosen through either installer is honored by both.
#[cfg(windows)]
fn install_folder(request: &args::Request) -> std::path::PathBuf {
    request
        .folder
        .clone()
        .or_else(|| {
            registry::read_string(None, plan::APP_KEY, plan::INSTALL_FOLDER_VALUE)
                .filter(|folder| !folder.trim().is_empty())
                .map(std::path::PathBuf::from)
        })
        .unwrap_or_else(locations::default_install_folder)
}

/// Say what went wrong, where there is anybody to say it to. A silent run has no window and no console: its exit code is the whole message, which is what `exit::meaning` reads back.
#[cfg(windows)]
fn report(silent: bool, failure: &exit::Failure) {
    if silent {
        return;
    }
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
    let text: Vec<u16> = failure
        .message
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let caption: Vec<u16> = "Leaftext Setup"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            caption.as_ptr(),
            MB_OK | MB_ICONERROR,
        )
    };
}
