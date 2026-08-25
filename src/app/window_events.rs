//! What the window reports, and what the page is told about it.
//!
//! Two subjects that both start at the window rather than at a gesture: a page-driven resize, which one platform hands to itself and the other has to be driven through step by step, and a move, which the page is told the start and the end of and reads the rest of itself. The skip list lives here too, because what it is about is which window events an arm below answers.
//!
//! Split out of `event_loop.rs` when that file reached the tree's line ceiling.

use std::time::Instant;

use super::*;

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
pub(crate) fn window_rect(window: &tao::window::Window) -> Option<WindowRect> {
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

/// How long the window has to hold still before the move is over. Long enough that the pause between two shoves of the same drag does not end it, short enough that the frame loop is not left running after the hand let go.
pub(crate) const WINDOW_MOVE_SETTLE: Duration = Duration::from_millis(160);

/// The line that starts the page's own frame loop, and the one that ends it. Two of these per gesture and nothing in between: the page reads where the window is each frame itself, so a note per event would put the loop back on the flood path a shipped fix took it off.
pub(crate) fn window_move_line(moving: bool) -> &'static str {
    if moving {
        "window.leafWindowMoveStarted();"
    } else {
        "window.leafWindowMoveStopped();"
    }
}

/// Mark the window as moving and, the first time, tell the page to start reading where it is. Called per event and cheap on purpose: everything after the first is one clock read and one assignment.
pub(crate) fn note_window_moving(page: Option<&WebView>, moving_until: &mut Option<Instant>) {
    if moving_until.is_none() {
        run_page_script(
            page,
            window_move_line(true),
            "Failed to tell the page the window is moving",
        );
    }
    *moving_until = Some(Instant::now() + WINDOW_MOVE_SETTLE);
}

/// Whether an arm below could have answered this event, which is what says whether the tail after the match has anything left to do. A skip list rather than a list of what counts, so an event this does not recognize still runs the tail and nothing new is quietly dropped.
///
/// It is here because a window drag hands the loop four events per mouse move and no arm answers one of them, while the tail rebuilds the saved session out of every open tab: 1,015 rebuilds across a two-second drag, four fifths of what that gesture costs with ten tabs open.
///
/// A device event is one raw input packet — up to a thousand a second on a gaming mouse, delivered per hardware report while focused. It carries raw pointer deltas no arm reads, and letting it run the tail froze a twenty-tab window solid under a fast hand: 4 landed positions across a throw where skipping lands 204.
pub(crate) fn could_have_changed_anything(event: &Event<UserEvent>) -> bool {
    match event {
        Event::NewEvents(_)
        | Event::MainEventsCleared
        | Event::RedrawRequested(_)
        | Event::RedrawEventsCleared => false,
        Event::DeviceEvent { event, .. } => device_event_could_have_changed_anything(event),
        Event::WindowEvent { event, .. } => window_event_could_have_changed_anything(event),
        _ => true,
    }
}

/// See `could_have_changed_anything`. Its own function because a `WindowEvent` can be built in a test and the event that wraps it cannot.
pub(crate) fn window_event_could_have_changed_anything(event: &WindowEvent) -> bool {
    !matches!(event, WindowEvent::Moved(_))
}

/// See `could_have_changed_anything`. Its own function for the same reason as the window half: a `DeviceEvent` can be built in a test and the event that wraps it cannot. Always the skip — whatever the packet carries, no arm reads it.
pub(crate) fn device_event_could_have_changed_anything(_event: &tao::event::DeviceEvent) -> bool {
    false
}
