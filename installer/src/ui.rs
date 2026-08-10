//! The one screen: pick the folder, then install.
//!
//! Every position here is `wix/main.wxs`'s own — the dialog is 370 by 270 dialog units, the banner line sits at y=44, the path field is 320 wide at y=100, Install is 80 wide at x=212, the bottom line at y=234. MSI dialog units and Win32 dialog units are the same measurement (a quarter of the font's average character width across, an eighth of its height down), so the same numbers draw the same screen. It is Tahoma 8 for the same reason: the screen a person meets has to be the screen that already ships.
//!
//! No welcome screen, no license, no finish screen, and no elevation shield on Install, because nothing here is elevated. The window closes when the install ends.

use std::cell::RefCell;
use std::path::PathBuf;
use std::ptr;

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, SIZE, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    CreateFontW, DeleteObject, GetDC, GetTextExtentPoint32W, GetTextMetricsW, ReleaseDC,
    SelectObject, UpdateWindow, CLEARTYPE_QUALITY, CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET,
    DEFAULT_PITCH, FF_SWISS, FW_BOLD, FW_NORMAL, OUT_DEFAULT_PRECIS, TEXTMETRICW,
};
use windows_sys::Win32::System::Com::CoTaskMemFree;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::HiDpi::{
    GetDpiForSystem, SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};
use windows_sys::Win32::UI::Shell::{SHBrowseForFolderW, SHGetPathFromIDListW, BROWSEINFOW};
use windows_sys::Win32::UI::WindowsAndMessaging::*;

use crate::plan::PRODUCT_NAME;

/// Control ids. Only the three that answer a click need one.
const ID_INSTALL: usize = 1;
const ID_CANCEL: usize = 2;
const ID_CHANGE: usize = 3;
const ID_FOLDER: usize = 4;

/// The dialog, in `wix/main.wxs`'s units.
const DIALOG_WIDTH: i32 = 370;
const DIALOG_HEIGHT: i32 = 270;

// Constants windows-sys does not export from a module this build has, spelled out the way `platform.rs` spells out its own — so a windows-sys bump that reshuffles module paths cannot break the build over a number.
/// The dialog gray every stock installer screen is drawn on, as a background brush.
const BACKGROUND_BRUSH: isize = 16;
/// The sunken rule the stock dialogs draw under the heading and above the buttons.
const SS_ETCHEDHORZ: u32 = 0x10;
/// The folder picker: real folders only, the resizable frame with a New Folder button, and a typed path field.
const BIF_RETURNONLYFSDIRS: u32 = 0x0001;
const BIF_EDITBOX: u32 = 0x0010;
const BIF_NEWDIALOGSTYLE: u32 = 0x0040;

/// What the screen is holding while it is up. One window, one thread, so a cell is the whole of the state handling.
struct Screen {
    folder: PathBuf,
    accepted: bool,
}

thread_local! {
    static SCREEN: RefCell<Option<Screen>> = const { RefCell::new(None) };
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Show the screen. `Some(folder)` when Install was pressed, `None` when the window was closed or canceled.
pub fn choose_folder(initial: PathBuf) -> Option<PathBuf> {
    SCREEN.with(|screen| {
        *screen.borrow_mut() = Some(Screen {
            folder: initial,
            accepted: false,
        });
    });

    unsafe {
        // Per-monitor v2, so the text is drawn at the screen's own resolution rather than scaled up from 96 dots per inch and blurred. Windows 10 and later; an older one keeps the system's own scaling and loses nothing else.
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        build_and_pump();
    }

    SCREEN.with(|screen| {
        let screen = screen.borrow_mut().take()?;
        screen.accepted.then_some(screen.folder)
    })
}

/// A dialog unit in real pixels, across and down, for the font the screen is drawn in.
///
/// The measurement Windows itself uses: the average width of the 52 letters over 52, and the font's height — a quarter of the first is one unit across, an eighth of the second is one unit down.
unsafe fn dialog_units(font: isize) -> (i32, i32) {
    let screen = GetDC(ptr::null_mut());
    let previous = SelectObject(screen, font as _);
    let mut metrics: TEXTMETRICW = std::mem::zeroed();
    GetTextMetricsW(screen, &mut metrics);
    let alphabet = wide("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ");
    let mut size: SIZE = std::mem::zeroed();
    GetTextExtentPoint32W(screen, alphabet.as_ptr(), 52, &mut size);
    SelectObject(screen, previous);
    ReleaseDC(ptr::null_mut(), screen);
    (((size.cx / 26) + 1) / 2, metrics.tmHeight)
}

unsafe fn build_and_pump() {
    let class = wide("LeaftextSetupWindow");
    let mut window_class: WNDCLASSW = std::mem::zeroed();
    window_class.lpfnWndProc = Some(window_proc);
    window_class.hInstance = ptr::null_mut();
    window_class.lpszClassName = class.as_ptr();
    window_class.hCursor = LoadCursorW(ptr::null_mut(), IDC_ARROW);
    window_class.hbrBackground = BACKGROUND_BRUSH as _;
    // The leaf out of the executable's own resource. Explorer reads that resource by itself; a window has to be handed it.
    let icon_name = wide("app_icon");
    window_class.hIcon = LoadIconW(GetModuleHandleW(ptr::null()), icon_name.as_ptr());
    RegisterClassW(&window_class);

    let font = tahoma(8, false);
    let heading_font = tahoma(9, true);
    let (unit_x, unit_y) = dialog_units(font);
    let across = |units: i32| units * unit_x / 4;
    let down = |units: i32| units * unit_y / 8;

    let style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX;
    let mut frame = RECT {
        left: 0,
        top: 0,
        right: across(DIALOG_WIDTH),
        bottom: down(DIALOG_HEIGHT),
    };
    AdjustWindowRect(&mut frame, style, 0);

    let title = wide(&format!("{PRODUCT_NAME} Setup"));
    let window = CreateWindowExW(
        0,
        class.as_ptr(),
        title.as_ptr(),
        style,
        CW_USEDEFAULT,
        CW_USEDEFAULT,
        frame.right - frame.left,
        frame.bottom - frame.top,
        ptr::null_mut(),
        ptr::null_mut(),
        ptr::null_mut(),
        ptr::null_mut(),
    );
    if window.is_null() {
        return;
    }

    let child = |class: &str, text: &str, style: u32, x: i32, y: i32, w: i32, h: i32, id: usize| {
        let class = wide(class);
        let text = wide(text);
        let handle = CreateWindowExW(
            0,
            class.as_ptr(),
            text.as_ptr(),
            WS_CHILD | WS_VISIBLE | style,
            across(x),
            down(y),
            across(w),
            down(h),
            window,
            id as _,
            ptr::null_mut(),
            ptr::null_mut(),
        );
        SendMessageW(handle, WM_SETFONT, font as WPARAM, 1);
        handle
    };

    let heading = child("STATIC", "Destination Folder", 0, 15, 6, 200, 15, 0);
    SendMessageW(heading, WM_SETFONT, heading_font as WPARAM, 1);
    child(
        "STATIC",
        &format!("Choose where to install {PRODUCT_NAME}."),
        0,
        25,
        23,
        280,
        15,
        0,
    );
    child("STATIC", "", SS_ETCHEDHORZ, 0, 44, DIALOG_WIDTH, 1, 0);
    child(
        "STATIC",
        &format!("Install {PRODUCT_NAME} to:"),
        0,
        20,
        60,
        290,
        15,
        0,
    );

    let folder = SCREEN.with(|screen| {
        screen
            .borrow()
            .as_ref()
            .map(|screen| screen.folder.display().to_string())
            .unwrap_or_default()
    });
    child(
        "EDIT",
        &folder,
        WS_BORDER | WS_TABSTOP | ES_AUTOHSCROLL as u32,
        20,
        100,
        320,
        18,
        ID_FOLDER,
    );
    child(
        "BUTTON",
        "Change...",
        WS_TABSTOP | BS_PUSHBUTTON as u32,
        20,
        120,
        56,
        17,
        ID_CHANGE,
    );
    child("STATIC", "", SS_ETCHEDHORZ, 0, 234, DIALOG_WIDTH, 1, 0);
    // No elevation shield on Install: a per-user install raises no prompt, and a shield promising one would be a lie.
    let install = child(
        "BUTTON",
        "Install",
        WS_TABSTOP | BS_DEFPUSHBUTTON as u32,
        212,
        243,
        80,
        17,
        ID_INSTALL,
    );
    child(
        "BUTTON",
        "Cancel",
        WS_TABSTOP | BS_PUSHBUTTON as u32,
        304,
        243,
        56,
        17,
        ID_CANCEL,
    );

    ShowWindow(window, SW_SHOW);
    UpdateWindow(window);
    // The window is not a dialog, so nothing gives a control focus on its own; this is the message that does it and keeps the default button's ring where it belongs.
    SendMessageW(window, WM_NEXTDLGCTL, install as WPARAM, 1);

    let mut message: MSG = std::mem::zeroed();
    while GetMessageW(&mut message, ptr::null_mut(), 0, 0) > 0 {
        // Tab between controls, Enter on Install, Escape on Cancel — none of which a bare message loop does.
        if IsDialogMessageW(window, &message) == 0 {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }

    DeleteObject(font as _);
    DeleteObject(heading_font as _);
}

/// The MSI's own dialog fonts, so the two screens are the same screen: Tahoma 8 for everything, and Tahoma 9 bold for the heading, which is what `WixUI_Font_Title` is.
///
/// The size is asked for in points and converted against the display's own resolution, because the screen is drawn per-monitor aware — a height fixed in pixels would come out small on anything but a 96-dot display.
unsafe fn tahoma(points: i32, bold: bool) -> isize {
    let face = wide("Tahoma");
    let dpi = GetDpiForSystem() as i32;
    CreateFontW(
        -(points * dpi / 72),
        0,
        0,
        0,
        if bold { FW_BOLD } else { FW_NORMAL } as i32,
        0,
        0,
        0,
        DEFAULT_CHARSET as u32,
        OUT_DEFAULT_PRECIS as u32,
        CLIP_DEFAULT_PRECIS as u32,
        CLEARTYPE_QUALITY as u32,
        (FF_SWISS | DEFAULT_PITCH) as u32,
        face.as_ptr(),
    ) as isize
}

unsafe extern "system" fn window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        WM_COMMAND => {
            match (wparam & 0xffff) as usize {
                ID_INSTALL => {
                    remember_folder(window);
                    SCREEN.with(|screen| {
                        if let Some(screen) = screen.borrow_mut().as_mut() {
                            screen.accepted = true;
                        }
                    });
                    DestroyWindow(window);
                }
                ID_CANCEL => {
                    DestroyWindow(window);
                }
                ID_CHANGE => {
                    remember_folder(window);
                    if let Some(chosen) = browse(window) {
                        let text = wide(&chosen.display().to_string());
                        SetWindowTextW(GetDlgItem(window, ID_FOLDER as i32), text.as_ptr());
                    }
                }
                _ => {}
            }
            0
        }
        WM_CLOSE => {
            DestroyWindow(window);
            0
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            0
        }
        _ => DefWindowProcW(window, message, wparam, lparam),
    }
}

/// Take whatever is in the path field. It is an editable field, so what is typed there is the answer as much as what Change... put there.
unsafe fn remember_folder(window: HWND) {
    let field = GetDlgItem(window, ID_FOLDER as i32);
    let mut buffer = [0u16; 1024];
    let read = GetWindowTextW(field, buffer.as_mut_ptr(), buffer.len() as i32);
    if read <= 0 {
        return;
    }
    let text = String::from_utf16_lossy(&buffer[..read as usize]);
    let text = text.trim();
    if text.is_empty() {
        return;
    }
    SCREEN.with(|screen| {
        if let Some(screen) = screen.borrow_mut().as_mut() {
            screen.folder = PathBuf::from(text);
        }
    });
}

/// The system folder picker, opened on the path the field is showing.
unsafe fn browse(window: HWND) -> Option<PathBuf> {
    let start = SCREEN.with(|screen| {
        screen
            .borrow()
            .as_ref()
            .map(|screen| screen.folder.clone())
            .unwrap_or_default()
    });
    let start = wide(&start.display().to_string());
    let title = wide(&format!("Choose where to install {PRODUCT_NAME}."));
    let mut display = [0u16; 260];

    let mut info: BROWSEINFOW = std::mem::zeroed();
    info.hwndOwner = window;
    info.pszDisplayName = display.as_mut_ptr();
    info.lpszTitle = title.as_ptr();
    // The tree picker with a resizable frame, a New Folder button and a typed path field — the one every other app opens.
    info.ulFlags = BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE | BIF_EDITBOX;
    info.lpfn = Some(select_starting_folder);
    info.lParam = start.as_ptr() as LPARAM;

    let chosen = SHBrowseForFolderW(&info);
    if chosen.is_null() {
        return None;
    }
    let mut path = [0u16; 1024];
    let read = SHGetPathFromIDListW(chosen, path.as_mut_ptr());
    CoTaskMemFree(chosen.cast());
    if read == 0 {
        return None;
    }
    let end = path
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(path.len());
    Some(PathBuf::from(String::from_utf16_lossy(&path[..end])))
}

/// Point the picker at the current path the one moment it will listen: nothing else can preselect a folder that may not exist yet.
unsafe extern "system" fn select_starting_folder(
    window: HWND,
    message: u32,
    _lparam: LPARAM,
    data: LPARAM,
) -> i32 {
    const BFFM_INITIALIZED: u32 = 1;
    const BFFM_SETSELECTIONW: u32 = WM_USER + 103;
    if message == BFFM_INITIALIZED {
        SendMessageW(window, BFFM_SETSELECTIONW, 1, data);
    }
    0
}
