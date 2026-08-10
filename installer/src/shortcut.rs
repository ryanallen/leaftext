//! Writing the Start Menu entry, which is the one part of the install that is not a file copy or a registry write.
//!
//! A `.lnk` is a COM object saved to a file, and `windows-sys` ships COM functions and class ids but no interface definitions at all — so `IShellLinkW` and `IPersistFile` are their vtables, written out here. That is a page of declarations against a crate that would bring its own macro tree, for two interfaces.
//!
//! The entry is not optional. v0.1.365 shipped without one and the install was unreachable: the executable sits in a folder nobody browses to, with nothing to click and nothing for Windows search to match.

use std::ffi::c_void;
use std::path::Path;
use std::ptr;

use windows_sys::core::GUID;
use windows_sys::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
};
use windows_sys::Win32::UI::Shell::ShellLink;

use crate::plan::Shortcut;

const IID_ISHELLLINKW: GUID = GUID::from_u128(0x000214F9_0000_0000_c000_000000000046);
const IID_IPERSISTFILE: GUID = GUID::from_u128(0x0000010b_0000_0000_c000_000000000046);

/// Single-threaded apartment: the shell's link object is an in-process server and this is the only thread that touches it.
const COINIT_APARTMENTTHREADED: u32 = 0x2;

#[repr(C)]
struct IUnknownVtbl {
    query_interface: unsafe extern "system" fn(*mut c_void, *const GUID, *mut *mut c_void) -> i32,
    add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
    release: unsafe extern "system" fn(*mut c_void) -> u32,
}

/// `IShellLinkW`, in declaration order. Every method above the ones used has to be here anyway: a vtable is positional, so a missing entry silently calls the wrong function.
#[repr(C)]
struct IShellLinkWVtbl {
    base: IUnknownVtbl,
    get_path: unsafe extern "system" fn(*mut c_void, *mut u16, i32, *mut c_void, u32) -> i32,
    get_id_list: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> i32,
    set_id_list: unsafe extern "system" fn(*mut c_void, *const c_void) -> i32,
    get_description: unsafe extern "system" fn(*mut c_void, *mut u16, i32) -> i32,
    set_description: unsafe extern "system" fn(*mut c_void, *const u16) -> i32,
    get_working_directory: unsafe extern "system" fn(*mut c_void, *mut u16, i32) -> i32,
    set_working_directory: unsafe extern "system" fn(*mut c_void, *const u16) -> i32,
    get_arguments: unsafe extern "system" fn(*mut c_void, *mut u16, i32) -> i32,
    set_arguments: unsafe extern "system" fn(*mut c_void, *const u16) -> i32,
    get_hotkey: unsafe extern "system" fn(*mut c_void, *mut u16) -> i32,
    set_hotkey: unsafe extern "system" fn(*mut c_void, u16) -> i32,
    get_show_cmd: unsafe extern "system" fn(*mut c_void, *mut i32) -> i32,
    set_show_cmd: unsafe extern "system" fn(*mut c_void, i32) -> i32,
    get_icon_location: unsafe extern "system" fn(*mut c_void, *mut u16, i32, *mut i32) -> i32,
    set_icon_location: unsafe extern "system" fn(*mut c_void, *const u16, i32) -> i32,
    set_relative_path: unsafe extern "system" fn(*mut c_void, *const u16, u32) -> i32,
    resolve: unsafe extern "system" fn(*mut c_void, *mut c_void, u32) -> i32,
    set_path: unsafe extern "system" fn(*mut c_void, *const u16) -> i32,
}

#[repr(C)]
struct IPersistFileVtbl {
    base: IUnknownVtbl,
    get_class_id: unsafe extern "system" fn(*mut c_void, *mut GUID) -> i32,
    is_dirty: unsafe extern "system" fn(*mut c_void) -> i32,
    load: unsafe extern "system" fn(*mut c_void, *const u16, u32) -> i32,
    save: unsafe extern "system" fn(*mut c_void, *const u16, i32) -> i32,
    save_completed: unsafe extern "system" fn(*mut c_void, *const u16) -> i32,
    get_cur_file: unsafe extern "system" fn(*mut c_void, *mut *mut u16) -> i32,
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn wide_path(path: &Path) -> Vec<u16> {
    wide(&path.to_string_lossy())
}

fn checked(result: i32, operation: &str) -> Result<(), String> {
    if result >= 0 {
        Ok(())
    } else {
        Err(format!("{operation} failed with 0x{result:08x}"))
    }
}

/// Write the shortcut, creating its folder if the Start Menu has none.
pub fn write(shortcut: &Shortcut) -> Result<(), String> {
    if let Some(parent) = shortcut.path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("could not reach the Start Menu folder: {error}"))?;
    }

    unsafe {
        // An already-initialized apartment answers `S_FALSE`, which is a success and still owes an uninitialize.
        let started = CoInitializeEx(ptr::null(), COINIT_APARTMENTTHREADED);
        let outcome = build(shortcut);
        if started >= 0 {
            CoUninitialize();
        }
        outcome
    }
}

unsafe fn build(shortcut: &Shortcut) -> Result<(), String> {
    let mut link: *mut c_void = ptr::null_mut();
    checked(
        CoCreateInstance(
            &ShellLink,
            ptr::null_mut(),
            CLSCTX_INPROC_SERVER,
            &IID_ISHELLLINKW,
            &mut link,
        ),
        "creating the shortcut",
    )?;

    let vtbl = *(link as *mut *mut IShellLinkWVtbl);
    let written = write_through(link, vtbl, shortcut);
    ((*vtbl).base.release)(link);
    written
}

unsafe fn write_through(
    link: *mut c_void,
    vtbl: *mut IShellLinkWVtbl,
    shortcut: &Shortcut,
) -> Result<(), String> {
    checked(
        ((*vtbl).set_path)(link, wide_path(&shortcut.target).as_ptr()),
        "pointing the shortcut at the app",
    )?;
    checked(
        ((*vtbl).set_working_directory)(link, wide_path(&shortcut.working_directory).as_ptr()),
        "setting the shortcut's folder",
    )?;
    checked(
        ((*vtbl).set_description)(link, wide(&shortcut.description).as_ptr()),
        "describing the shortcut",
    )?;

    let mut persist: *mut c_void = ptr::null_mut();
    checked(
        ((*vtbl).base.query_interface)(link, &IID_IPERSISTFILE, &mut persist),
        "asking the shortcut to save itself",
    )?;
    let persist_vtbl = *(persist as *mut *mut IPersistFileVtbl);
    // 1 is `fRemember`: the object keeps the name it was saved under.
    let saved = ((*persist_vtbl).save)(persist, wide_path(&shortcut.path).as_ptr(), 1);
    ((*persist_vtbl).base.release)(persist);
    checked(saved, "writing the Start Menu entry")
}
