//! What the page's window commands do: the drag, the shadow band's resize, minimize, maximize, the frame's color, and where a tab was left.
//!
//! Its own module because no other one owns the window. The arithmetic here is the Mac half of the resize: Windows hands a whole gesture to the platform on the press, and a Mac is refused that call, so the host holds the window as it stood and sets it from every move.
//!
//! `WindowClose` is not here. It reaches `shut_down` and the loop's own `control_flow`, so it stays where the loop can end.
//!
//! The startup place below is read here for the same reason: it decides how the window is shown, and no other module owns the window.

use super::*;
use tao::window::Fullscreen;

/// A monitor's rectangle in physical screen pixels — where it starts and how big it is. The same pixels a startup place is written in.
#[cfg(windows)]
pub(crate) type MonitorRect = (i32, i32, i32, i32);

/// Where this process was told to put its first window, or nothing when the launch carried no place at all. Windows keeps a startup place for the first overlapped window built with `CW_USEDEFAULT`, which is the window `main.rs` builds — nothing there asks for a position. A launcher that wants a copy off screen sets this rather than the builder, because a position asked for through the builder is matched against every monitor and thrown away when it matches none, which is exactly the off-screen case.
#[cfg(windows)]
pub(crate) fn startup_place() -> Option<(i32, i32)> {
    use windows_sys::Win32::System::Threading::{
        GetStartupInfoW, STARTF_USEPOSITION, STARTUPINFOW,
    };

    let mut info: STARTUPINFOW = unsafe { std::mem::zeroed() };
    info.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
    unsafe { GetStartupInfoW(&mut info) };
    if info.dwFlags & STARTF_USEPOSITION == 0 {
        return None;
    }
    Some((info.dwX as i32, info.dwY as i32))
}

/// Whether a place lies on none of these monitors. Half-open on the right and bottom, the way a monitor rectangle is: a window whose top-left corner sits one pixel past the last column is off it.
#[cfg(windows)]
pub(crate) fn place_is_off_every_monitor(place: (i32, i32), monitors: &[MonitorRect]) -> bool {
    !monitors.iter().any(|&(x, y, width, height)| {
        place.0 >= x && place.0 < x + width && place.1 >= y && place.1 < y + height
    })
}

/// Whether this copy was started where nobody can see it. True only for a launch carrying a startup place that lies on none of the monitors — which is how a build's own copy comes up. A window nobody can see must not hold the keys, whether a launcher put it out there or a monitor was unplugged from under a remembered place, so this is a rule about the app rather than a branch for a launcher. An ordinary launch carries no place, so it is false and the window comes up in front with the keyboard.
#[cfg(windows)]
pub(crate) fn started_off_every_monitor(monitors: &[MonitorRect]) -> bool {
    startup_place().is_some_and(|place| place_is_off_every_monitor(place, monitors))
}

/// The monitors as rectangles, in the physical screen pixels a place is written in. One reader for both callers: the window builder, which has only the event loop, and the loop itself, which has the window.
#[cfg(windows)]
pub(crate) fn monitor_rects(
    monitors: impl Iterator<Item = tao::monitor::MonitorHandle>,
) -> Vec<MonitorRect> {
    monitors
        .map(|monitor| {
            let at = monitor.position();
            let size = monitor.size();
            (at.x, at.y, size.width as i32, size.height as i32)
        })
        .collect()
}

/// Bring the window forward and out of the task bar, unless it stands where nobody can see it. Both places that surface it go through here — a second launch forwarding a document, and one carrying none — because a window off every monitor taking the keyboard is the owner typing into something they cannot find. Asked of where the window actually stands rather than of the place it was started at: by now there is a window to ask.
pub(crate) fn surface_window(window: &tao::window::Window) {
    #[cfg(windows)]
    if let Ok(at) = window.outer_position() {
        if place_is_off_every_monitor((at.x, at.y), &monitor_rects(window.available_monitors())) {
            return;
        }
    }
    window.set_minimized(false);
    window.set_focus();
}

/// The compass point the page grabbed, as the window library names it. Anything else is dropped rather than guessed at.
pub(crate) fn resize_direction(direction: &str) -> Option<tao::window::ResizeDirection> {
    use tao::window::ResizeDirection::*;
    Some(match direction {
        "n" => North,
        "ne" => NorthEast,
        "e" => East,
        "se" => SouthEast,
        "s" => South,
        "sw" => SouthWest,
        "w" => West,
        "nw" => NorthWest,
        _ => return None,
    })
}

/// A window's place and size in logical pixels, top-left origin — the numbers a page-driven resize works in.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct WindowRect {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

/// Where the window the drag started on ends up once the pointer has moved by this much. The edges named by the direction follow the pointer and the others stay put, so a drag from a corner moves two of them. Never smaller than the smallest window: setting the size directly goes around the limit the platform holds for us.
pub(crate) fn resized_window(start: WindowRect, direction: &str, dx: f64, dy: f64) -> WindowRect {
    let (min_width, min_height) = MIN_INNER_SIZE;
    let mut end = start;
    if direction.contains('e') {
        end.width = (start.width + dx).max(min_width);
    } else if direction.contains('w') {
        // The left edge follows the pointer, so hitting the smallest width pins it where that width leaves it rather than letting the window walk right.
        end.width = (start.width - dx).max(min_width);
        end.x = start.x + start.width - end.width;
    }
    if direction.contains('s') {
        end.height = (start.height + dy).max(min_height);
    } else if direction.contains('n') {
        end.height = (start.height - dy).max(min_height);
        end.y = start.y + start.height - end.height;
    }
    end
}

/// The window where it stands, in the same logical pixels the page reports a pointer in. The place is the frame's and the size is the drawable area's, which are one rectangle on a window whose page runs the full height of its frame.
fn window_rect(window: &tao::window::Window) -> Option<WindowRect> {
    let scale = window.scale_factor();
    let position = window.outer_position().ok()?.to_logical::<f64>(scale);
    let size = window.inner_size().to_logical::<f64>(scale);
    Some(WindowRect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

/// The window as it stood when a page-driven drag began, and where the pointer was on the screen. Held only between the press and the release.
pub(crate) struct ResizeDrag {
    pub(crate) direction: String,
    pub(crate) window: WindowRect,
    pub(crate) pointer: (f64, f64),
}

/// What one report of a page-driven window resize amounts to. Windows hands the whole gesture to the platform on the press and hears nothing more: that loop brings snapping, the size limits and the live redraw. A Mac is refused that call, so the host holds the window as it stood and sets it from every move.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum ResizeDragStep {
    /// Hand the platform this direction and let its own loop run the gesture.
    HandToPlatform(tao::window::ResizeDirection),
    /// Remember the window as it stands, against this direction and the pointer that grabbed it.
    HoldWindow {
        direction: String,
        pointer: (f64, f64),
    },
    /// Put the window here.
    SetWindow(WindowRect),
    /// The gesture is over, so forget what was held.
    Forget,
    /// Nothing to do.
    Nothing,
}

/// The step this phase of a resize drag is. `platform_drives_it` is the Windows path, where only the press is answered.
pub(crate) fn resize_drag_step(
    platform_drives_it: bool,
    direction: &str,
    phase: &str,
    x: f64,
    y: f64,
    held: Option<&ResizeDrag>,
) -> ResizeDragStep {
    if platform_drives_it {
        return match (phase, resize_direction(direction)) {
            ("start", Some(direction)) => ResizeDragStep::HandToPlatform(direction),
            _ => ResizeDragStep::Nothing,
        };
    }
    match phase {
        "start" => ResizeDragStep::HoldWindow {
            direction: direction.to_string(),
            pointer: (x, y),
        },
        "move" => match held {
            Some(drag) => ResizeDragStep::SetWindow(resized_window(
                drag.window,
                &drag.direction,
                x - drag.pointer.0,
                y - drag.pointer.1,
            )),
            None => ResizeDragStep::Nothing,
        },
        _ => ResizeDragStep::Forget,
    }
}

/// The two things about a window the page has to be told, both read off the window rather than off a gesture: the green button, the View menu and the shortcut all reach us as a resize and nothing else.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct WindowState {
    pub(crate) maximized: bool,
    pub(crate) fullscreen: bool,
}

/// The lines the page owes now the window has been resized, and none where neither of the two moved. The custom title bar's maximize/restore icon is one; the other is full screen, which takes Apple's three dots away with the rest of the chrome, so the room the app bar leaves for them goes too.
pub(crate) fn window_state_lines(was: WindowState, now: WindowState) -> Vec<String> {
    let mut lines = Vec::new();
    if now.maximized != was.maximized {
        lines.push(format!("window.leafSetWindowMaximized({});", now.maximized));
    }
    if now.fullscreen != was.fullscreen {
        lines.push(format!("window.leafSetFullscreen({});", now.fullscreen));
    }
    lines
}

/// The window moved by a press on the app bar.
pub(crate) fn drag(reader: &Reader) {
    let _ = reader.window.drag_window();
}

/// One report of a drag in the shadow band, which is the only edge the window has left.
pub(crate) fn resize(
    reader: &Reader,
    held: &mut Option<ResizeDrag>,
    direction: &str,
    phase: &str,
    x: f64,
    y: f64,
) {
    match resize_drag_step(cfg!(windows), direction, phase, x, y, held.as_ref()) {
        ResizeDragStep::HandToPlatform(direction) => {
            let _ = reader.window.drag_resize_window(direction);
        }
        ResizeDragStep::HoldWindow { direction, pointer } => {
            *held = window_rect(&reader.window).map(|window| ResizeDrag {
                direction,
                window,
                pointer,
            });
        }
        ResizeDragStep::SetWindow(end) => {
            // Size before place: the platform anchors a size change at the top-left, so a drag on the north or west edge sets the size it will end at and then moves that corner to where the pointer put it.
            reader
                .window
                .set_inner_size(LogicalSize::new(end.width, end.height));
            reader
                .window
                .set_outer_position(tao::dpi::LogicalPosition::new(end.x, end.y));
        }
        ResizeDragStep::Forget => *held = None,
        ResizeDragStep::Nothing => {}
    }
}

/// The window put away to the task bar.
pub(crate) fn minimize(reader: &Reader) {
    reader.window.set_minimized(true);
}

/// The window filled to the screen, or put back to the size it was.
pub(crate) fn toggle_maximize(reader: &Reader) {
    let maximized = reader.window.is_maximized();
    reader.window.set_maximized(!maximized);
}

/// What to ask the window for, given whether it is full screen now. Borderless on the monitor it is already on, which is the kind that takes a space of its own; the exclusive kind changes the display mode and is not what a reader means by full screen.
pub(crate) fn fullscreen_after(fullscreen: bool) -> Option<Fullscreen> {
    if fullscreen {
        None
    } else {
        Some(Fullscreen::Borderless(None))
    }
}

/// The window given a space of its own, or handed back to the desktop.
pub(crate) fn toggle_fullscreen(reader: &Reader) {
    let fullscreen = reader.window.fullscreen().is_some();
    reader.window.set_fullscreen(fullscreen_after(fullscreen));
}

/// Where the tab in front was left, so coming back to it lands in the same place.
pub(crate) fn save_place(
    reader: &mut Reader,
    scroll_anchor: Option<ScrollAnchor>,
    code_scroll: Option<f64>,
) {
    reader
        .workspace
        .save_active_position(scroll_anchor, code_scroll);
}

/// The native frame painted to the page color, reported by the web view on a theme change.
pub(crate) fn set_chrome(reader: &Reader, r: u8, g: u8, b: u8, dark: bool) {
    set_export_cover_color(r, g, b);
    apply_window_chrome(&reader.window, r, g, b, dark);
}
