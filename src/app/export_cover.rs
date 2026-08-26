//! The native sheet laid over the web view while that view is rearranged for a page export.

use super::*;
use std::sync::atomic::{AtomicU32, Ordering};

static PAGE_COLOR: AtomicU32 = AtomicU32::new(0xff_ff_ff);

pub(crate) fn set_export_cover_color(r: u8, g: u8, b: u8) {
    PAGE_COLOR.store(
        (u32::from(r) << 16) | (u32::from(g) << 8) | u32::from(b),
        Ordering::Relaxed,
    );
}

fn export_cover_color() -> (u8, u8, u8) {
    let color = PAGE_COLOR.load(Ordering::Relaxed);
    (
        ((color >> 16) & 0xff) as u8,
        ((color >> 8) & 0xff) as u8,
        (color & 0xff) as u8,
    )
}

/// A native sibling above the web view. Dropping it always uncovers the reader.
pub(crate) struct ExportCover {
    native: NativeExportCover,
}

impl ExportCover {
    pub(crate) fn raise(page: &WebView) -> Result<Self, String> {
        NativeExportCover::raise(page, export_cover_color()).map(|native| Self { native })
    }
}

impl Drop for ExportCover {
    fn drop(&mut self) {
        self.native.remove();
    }
}

#[cfg(target_os = "windows")]
struct NativeExportCover {
    window: windows_sys::Win32::Foundation::HWND,
}

#[cfg(target_os = "windows")]
impl NativeExportCover {
    fn raise(page: &WebView, color: (u8, u8, u8)) -> Result<Self, String> {
        use windows::Win32::Foundation::{HWND as WebViewHwnd, RECT as WebViewRect};
        use windows_sys::Win32::Foundation::RECT;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, GetWindowLongPtrW, RegisterClassW, SetWindowPos, CREATESTRUCTW,
            GWLP_HINSTANCE, HWND_TOP, SWP_NOACTIVATE, SWP_SHOWWINDOW, WM_NCCREATE, WNDCLASSW,
            WS_CHILD, WS_VISIBLE,
        };
        use wry::WebViewExtWindows;

        unsafe extern "system" fn cover_window(
            window: windows_sys::Win32::Foundation::HWND,
            message: u32,
            word: usize,
            long: isize,
        ) -> isize {
            use windows_sys::Win32::Graphics::Gdi::{
                BeginPaint, CreateSolidBrush, DeleteObject, EndPaint, FillRect, PAINTSTRUCT,
            };
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                DefWindowProcW, GetClientRect, GetWindowLongPtrW, SetWindowLongPtrW, GWLP_USERDATA,
                WM_ERASEBKGND, WM_PAINT,
            };

            if message == WM_NCCREATE {
                let created = long as *const CREATESTRUCTW;
                if !created.is_null() {
                    SetWindowLongPtrW(window, GWLP_USERDATA, (*created).lpCreateParams as isize);
                }
            }
            if message == WM_PAINT {
                let mut paint: PAINTSTRUCT = std::mem::zeroed();
                let context = BeginPaint(window, &mut paint);
                let mut bounds: RECT = std::mem::zeroed();
                GetClientRect(window, &mut bounds);
                let brush = CreateSolidBrush(GetWindowLongPtrW(window, GWLP_USERDATA) as u32);
                FillRect(context, &bounds, brush);
                DeleteObject(brush);
                EndPaint(window, &paint);
                return 0;
            }
            if message == WM_ERASEBKGND {
                return 1;
            }
            DefWindowProcW(window, message, word, long)
        }

        let controller = page.controller();
        let mut parent = WebViewHwnd::default();
        let mut bounds = WebViewRect::default();
        unsafe {
            controller
                .ParentWindow(&mut parent)
                .and_then(|()| controller.Bounds(&mut bounds))
                .map_err(|error| error.to_string())?;
        }
        let class_name: Vec<u16> = "LeaftextExportCover\0".encode_utf16().collect();
        let instance = unsafe { GetWindowLongPtrW(parent.0 as _, GWLP_HINSTANCE) as _ };
        let class = WNDCLASSW {
            lpfnWndProc: Some(cover_window),
            hInstance: instance,
            lpszClassName: class_name.as_ptr(),
            ..unsafe { std::mem::zeroed() }
        };
        unsafe {
            RegisterClassW(&class);
        }
        let color_ref = u32::from(color.0) | (u32::from(color.1) << 8) | (u32::from(color.2) << 16);
        let window = unsafe {
            CreateWindowExW(
                0,
                class_name.as_ptr(),
                std::ptr::null(),
                WS_CHILD | WS_VISIBLE,
                bounds.left,
                bounds.top,
                bounds.right - bounds.left,
                bounds.bottom - bounds.top,
                parent.0 as _,
                std::ptr::null_mut(),
                instance,
                color_ref as usize as *const _,
            )
        };
        if window.is_null() {
            return Err("the export cover could not be raised".to_string());
        }
        unsafe {
            SetWindowPos(
                window,
                HWND_TOP,
                bounds.left,
                bounds.top,
                bounds.right - bounds.left,
                bounds.bottom - bounds.top,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
            windows_sys::Win32::Graphics::Gdi::UpdateWindow(window);
        }
        Ok(Self { window })
    }

    fn remove(&mut self) {
        unsafe {
            windows_sys::Win32::UI::WindowsAndMessaging::DestroyWindow(self.window);
        }
    }
}

#[cfg(target_os = "macos")]
struct NativeExportCover {
    view: objc2::rc::Retained<objc2_app_kit::NSBox>,
}

#[cfg(target_os = "macos")]
impl NativeExportCover {
    fn raise(page: &WebView, color: (u8, u8, u8)) -> Result<Self, String> {
    use objc2::{MainThreadMarker, MainThreadOnly};
        use objc2_app_kit::{NSAutoresizingMaskOptions, NSBox, NSBoxType, NSColor};
        use wry::WebViewExtMacOS;

        let main = MainThreadMarker::new()
            .ok_or_else(|| "the export cover belongs on the window thread".to_string())?;
        let webview = page.webview();
        let parent = unsafe { webview.superview() }
            .ok_or_else(|| "the export cover has no view to cover".to_string())?;
        let cover = NSBox::initWithFrame(NSBox::alloc(main), webview.frame());
        cover.setBoxType(NSBoxType::Custom);
        cover.setBorderWidth(0.0);
        cover.setFillColor(&NSColor::colorWithSRGBRed_green_blue_alpha(
            f64::from(color.0) / 255.0,
            f64::from(color.1) / 255.0,
            f64::from(color.2) / 255.0,
            1.0,
        ));
        cover.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable
                | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
        parent.addSubview(&cover);
        Ok(Self { view: cover })
    }

    fn remove(&mut self) {
        self.view.removeFromSuperview();
    }
}
