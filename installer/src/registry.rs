//! The four registry calls the install needs, under `HKEY_CURRENT_USER` and nowhere else.
//!
//! `prefix` on every call is what lets a test drive the whole install into a scratch key and delete it afterwards; the installer itself always passes `None`.

use std::ffi::c_void;
use std::ptr;

use windows_sys::Win32::Foundation::{ERROR_SUCCESS, WIN32_ERROR};
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteKeyW, RegDeleteTreeW, RegDeleteValueW, RegGetValueW,
    RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_WRITE, REG_DWORD, REG_OPTION_NON_VOLATILE, REG_SZ,
    RRF_RT_REG_SZ,
};

use crate::plan::{Data, Value};

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

/// The key a value lands in, with the scratch prefix in front of it when there is one.
fn full_key(prefix: Option<&str>, key: &str) -> String {
    match prefix {
        Some(prefix) => format!(r"{prefix}\{key}"),
        None => key.to_string(),
    }
}

fn win32(result: WIN32_ERROR, operation: &str) -> Result<(), String> {
    if result == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(format!("{operation} failed with code {result}"))
    }
}

/// Write one value, creating every key above it.
pub fn set(prefix: Option<&str>, value: &Value) -> Result<(), String> {
    let key = wide(&full_key(prefix, &value.key));
    let mut handle: HKEY = ptr::null_mut();
    let opened = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            0,
            ptr::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE,
            ptr::null(),
            &mut handle,
            ptr::null_mut(),
        )
    };
    win32(opened, &format!("creating {}", value.key))?;

    // The name pointer is null for a key's default value, which is a different thing from an empty name.
    let name = value.name.as_deref().map(wide);
    let name_ptr = name.as_ref().map_or(ptr::null(), |name| name.as_ptr());

    let written = match &value.data {
        Data::String(text) => {
            let text = wide(text);
            unsafe {
                RegSetValueExW(
                    handle,
                    name_ptr,
                    0,
                    REG_SZ,
                    text.as_ptr().cast::<u8>(),
                    (text.len() * std::mem::size_of::<u16>()) as u32,
                )
            }
        }
        Data::Dword(number) => unsafe {
            RegSetValueExW(
                handle,
                name_ptr,
                0,
                REG_DWORD,
                ptr::addr_of!(*number).cast::<u8>(),
                std::mem::size_of::<u32>() as u32,
            )
        },
    };
    unsafe { RegCloseKey(handle) };
    win32(written, &format!("writing {}", value.key))
}

/// Remove one value, leaving its key. Missing is not a failure: uninstall runs over a plan, not over what is actually there.
pub fn remove_value(prefix: Option<&str>, value: &Value) -> Result<(), String> {
    let key = wide(&full_key(prefix, &value.key));
    let mut handle: HKEY = ptr::null_mut();
    let opened = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            0,
            ptr::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE,
            ptr::null(),
            &mut handle,
            ptr::null_mut(),
        )
    };
    if opened != ERROR_SUCCESS {
        return Ok(());
    }
    let name = value.name.as_deref().map(wide);
    let name_ptr = name.as_ref().map_or(ptr::null(), |name| name.as_ptr());
    unsafe {
        RegDeleteValueW(handle, name_ptr);
        RegCloseKey(handle);
    }
    Ok(())
}

/// Remove a key and everything under it. Only for keys this install owns outright — never for one like `Software\Classes\.md`, which may have been there before the app.
pub fn remove_tree(prefix: Option<&str>, key: &str) {
    let key = wide(&full_key(prefix, key));
    unsafe {
        // RegDeleteTreeW empties a key without removing it, so the key itself goes with a second call.
        RegDeleteTreeW(HKEY_CURRENT_USER, key.as_ptr());
        RegDeleteKeyW(HKEY_CURRENT_USER, key.as_ptr());
    }
}

/// Whether a key is there at all. Nothing in the install asks; the uninstall test does, because a key emptied and left standing is something left behind.
#[cfg(test)]
pub fn key_exists(prefix: Option<&str>, key: &str) -> bool {
    use windows_sys::Win32::System::Registry::{RegOpenKeyExW, KEY_READ};

    let key = wide(&full_key(prefix, key));
    let mut handle: HKEY = ptr::null_mut();
    let opened =
        unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, key.as_ptr(), 0, KEY_READ, &mut handle) };
    if opened == ERROR_SUCCESS {
        unsafe { RegCloseKey(handle) };
        return true;
    }
    false
}

/// Read a string value, or `None` when the key or the value is not there.
pub fn read_string(prefix: Option<&str>, key: &str, name: &str) -> Option<String> {
    let key = wide(&full_key(prefix, key));
    let name = wide(name);
    let mut bytes: u32 = 0;
    let sized = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_SZ,
            ptr::null_mut(),
            ptr::null_mut(),
            &mut bytes,
        )
    };
    if sized != ERROR_SUCCESS || bytes == 0 {
        return None;
    }
    let mut buffer = vec![0u16; bytes as usize / 2 + 1];
    let mut bytes = (buffer.len() * 2) as u32;
    let read = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_SZ,
            ptr::null_mut(),
            buffer.as_mut_ptr().cast::<c_void>(),
            &mut bytes,
        )
    };
    if read != ERROR_SUCCESS {
        return None;
    }
    let text: Vec<u16> = buffer
        .into_iter()
        .take(bytes as usize / 2)
        .take_while(|unit| *unit != 0)
        .collect();
    Some(String::from_utf16_lossy(&text))
}
