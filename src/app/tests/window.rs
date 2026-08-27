//! The window, its frame, the shadow band, and the tail of the event loop.

use super::*;

#[test]
fn startup_failure_message_includes_recovery_hint() {
    let error = io::Error::new(io::ErrorKind::NotFound, "webview runtime missing");
    let message = startup_failure_message(&error);

    assert!(message.contains("Leaftext could not start."));
    assert!(message.contains("webview runtime missing"));
    assert!(message.contains("Microsoft Edge WebView2 Runtime"));
}

#[test]
fn startup_failure_message_identifies_webview_access_denied() {
    let error = io::Error::new(io::ErrorKind::PermissionDenied, "Access is denied.");
    let message = startup_failure_message(&error);

    assert!(message.contains("Leaftext could not start."));
    assert!(message.contains("Access is denied."));
    assert!(message.contains("per-user browser data folder"));
    assert!(message.contains("webview2"));
    assert!(!message.contains("Microsoft Edge WebView2 Runtime"));
}

#[test]
fn the_mac_window_is_the_app_bar_with_our_own_three_dots() {
    // Four builder calls make the Mac shell, and each alone is broken: without the fullsize content view the page starts below a gray strip, without the transparent bar the strip is still painted, without the hidden title "Leaftext" sits over the tabs, and without the buttons hidden Apple's dots sit on top of the three the page now draws. `with_decorations(false)` must never join them — tao overwrites every title-bar property when it is set, and the see-through strip goes with it.
    //
    // Held as source because a `WindowBuilder` chain is not a value: nothing here can build the window it makes, so the calls are the whole of the claim.
    let source = include_str!("../../main.rs");
    let mac_arm = source
        .split("#[cfg(target_os = \"macos\")]")
        .find(|arm| arm.contains("with_titlebar_buttons_hidden"))
        .expect("main.rs has a macOS window arm");
    // Nothing insets Apple's dots: there are none to inset — the page's own fold into the chevron menu, which a native view pinned to the window never could.
    assert!(
        !source.contains("with_traffic_light_inset"),
        "the dots are ours now, so there is nothing to inset"
    );
    for call in [
        "with_fullsize_content_view(true)",
        "with_titlebar_transparent(true)",
        "with_title_hidden(true)",
        "with_titlebar_buttons_hidden(true)",
        // The window's own shadow goes, because the app draws it: the dot lattice over the strip of page the app is held off the window by. `false` and not left out — AppKit's shadow is on unless something says otherwise, which is the same trap tao's Windows flag sets.
        "with_has_shadow(false)",
    ] {
        assert_eq!(
            source.matches(call).count(),
            1,
            "{call} belongs once, in the macOS window arm"
        );
    }
    assert!(
        !mac_arm.contains("with_decorations"),
        "dropping the decorations on macOS takes Apple's three dots with them"
    );

    // The Windows arm is a different shell — no native frame at all — and this change leaves it alone.
    assert_eq!(source.matches("with_decorations(false)").count(), 1);
    // The dock and app-switcher icon is not the strip, so macOS keeps taking it.
    assert!(source.contains("#[cfg(not(windows))]"));
}

#[test]
fn the_window_asks_for_no_platform_shadow_and_shows_what_is_behind_it() {
    // The app throws its own shadow — the dot lattice, over the outer strip of the page — so the platform's smooth one has to go and the window has to be see-through for the app's to land anywhere. Both halves, or the window has two shadows or none.
    //
    // `false` and not merely left out: tao's flag is on unless something says otherwise, so a build with the call removed keeps the halo, keeps the frame insets that make the window bigger than the page it holds, and keeps a hit test that finds only the top edge.
    //
    // Held as source for the same reason: a `WindowBuilder` chain is not a value.
    let source = include_str!("../../main.rs");
    let windows_arm = source
        .split("#[cfg(windows)]")
        .find(|arm| arm.contains("with_decorations(false)"))
        .expect("main.rs has a Windows window arm");
    assert!(
        windows_arm.contains("with_undecorated_shadow(false)"),
        "the platform shadow is still on, so the app draws a second one inside it"
    );
    assert!(
        !source.contains("with_undecorated_shadow(true)"),
        "the platform shadow was asked for again"
    );
    assert!(
        windows_arm.contains("with_transparent(true)"),
        "an opaque window paints the app's own shadow band in the page color"
    );
    // Three asks in all: one per window arm, because an opaque window has nothing for the band to fall on, and one for the web view, because a see-through window over an opaque web view shows nothing.
    assert_eq!(
        source.matches("with_transparent(true)").count(),
        3,
        "a window arm or the web view is still opaque, so the app's own shadow lands on a page color there"
    );
    let mac_arm = source
        .split("#[cfg(target_os = \"macos\")]")
        .find(|arm| arm.contains("with_titlebar_buttons_hidden"))
        .expect("main.rs has a macOS window arm");
    assert!(
        mac_arm.contains("with_has_shadow(false)"),
        "the Mac window keeps AppKit's own shadow, so the app draws a second one inside it"
    );
    // And the web view with it: a see-through window over an opaque web view shows nothing.
    assert!(
        source.contains(
            "WebViewBuilder::new_with_web_context(&mut web_context)\n        // See-through"
        ),
        "the web view is built opaque, so the window's transparency reaches nothing"
    );
    // The frame draws no line of its own. With the client area running out to the window's own edge, a border would trace the outside of the shadow band rather than the app — and the app carries its own edge now, so nothing is lost.
    assert!(
        source.contains("const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;")
            && source.contains("let border = DWMWA_COLOR_NONE;"),
        "the window frame still takes a border color"
    );
    assert!(
        !source.contains("border_r"),
        "the divider color is still being sent to a frame that draws nothing with it"
    );
    // The smallest window grows by the band, so the smallest readable page is the size it was pinned at rather than 40px narrower. Read off the value itself: a resize the host drives clamps to the same pair, and the two have to be one number.
    assert_eq!(
        MIN_INNER_SIZE,
        (380.0 + 40.0, 480.0 + 23.0),
        "the smallest window lost the band out of its readable page"
    );
    assert!(
        source.contains("with_min_inner_size(LogicalSize::new(MIN_INNER_SIZE.0, MIN_INNER_SIZE.1))"),
        "the window is built with a smallest size of its own rather than the one the host clamps to"
    );
    // Asking the web view to be see-through is a no-op on a Mac unless the manifest names the crate feature that compiles that call in — which is how the band shipped as a solid gray slab on every Mac while every assert above passed.
    let manifest = include_str!("../../../Cargo.toml");
    assert!(
        manifest.contains(r#"wry = { version = "0.55.1", optional = true, features = ["transparent"] }"#),
        "the web view's see-through ask is compiled out on macOS, so the band is a solid slab there"
    );
}

#[test]
fn a_press_in_the_shadow_band_resizes_the_window() {
    // With the platform shadow off, the window is exactly the page it holds and the web view covers every pixel of it, so the window's own edge test is correct and never reached. The page takes the press instead and this arm hands the window to the platform's own resize loop, beside the arm that answers the app bar's window move the same way.
    use tao::window::ResizeDirection::*;
    for (name, direction) in [
        ("n", North),
        ("ne", NorthEast),
        ("e", East),
        ("se", SouthEast),
        ("s", South),
        ("sw", SouthWest),
        ("w", West),
        ("nw", NorthWest),
    ] {
        assert_eq!(
            resize_direction(name),
            Some(direction),
            "the band's {name} edge asks for a resize the window library does not recognize"
        );
    }
    // Anything else is dropped rather than guessed at: a wrong guess resizes the wrong edge under the pointer.
    assert_eq!(resize_direction("north"), None);
    assert_eq!(resize_direction(""), None);

    // The press is the whole of it on Windows: the platform's own loop runs the gesture and reports nothing back.
    assert_eq!(
        resize_drag_step(true, "se", "start", 10.0, 20.0, None),
        ResizeDragStep::HandToPlatform(SouthEast)
    );
    for phase in ["move", "end"] {
        assert_eq!(
            resize_drag_step(true, "se", phase, 10.0, 20.0, None),
            ResizeDragStep::Nothing
        );
    }
    assert_eq!(
        resize_drag_step(true, "north", "start", 0.0, 0.0, None),
        ResizeDragStep::Nothing
    );

    // A Mac is refused that call, so the host holds the window as it stood and sets it from every move.
    let held = ResizeDrag {
        direction: "e".to_string(),
        window: WindowRect {
            x: 100.0,
            y: 200.0,
            width: 900.0,
            height: 700.0,
        },
        pointer: (500.0, 500.0),
    };
    assert_eq!(
        resize_drag_step(false, "e", "start", 500.0, 500.0, None),
        ResizeDragStep::HoldWindow {
            direction: "e".to_string(),
            pointer: (500.0, 500.0)
        }
    );
    assert_eq!(
        resize_drag_step(false, "e", "move", 540.0, 500.0, Some(&held)),
        ResizeDragStep::SetWindow(WindowRect {
            width: 940.0,
            ..held.window
        })
    );
    // A move with nothing held is a drag that never started.
    assert_eq!(
        resize_drag_step(false, "e", "move", 540.0, 500.0, None),
        ResizeDragStep::Nothing
    );
    assert_eq!(
        resize_drag_step(false, "e", "end", 0.0, 0.0, Some(&held)),
        ResizeDragStep::Forget
    );

    // The one thing about this handler no value can answer: the direction reaches a window library call, on a window no test can build.
    let source = include_str!("../window_cmds.rs");
    assert!(
        source.contains("reader.window.drag_resize_window(direction)"),
        "the resize command reaches no window call, so the band takes the press and nothing moves"
    );
}

#[test]
fn the_band_below_a_mac_frames_own_edge_moves_the_window_it_was_grabbed_by() {
    // A Mac is refused the call Windows hands its resize loop to, so without this the only thing that resizes there is the window frame's own edge, at the band's outer rim. The host drives it instead, off the window as it stood and how far the pointer has come — this is that arithmetic.
    let start = WindowRect {
        x: 100.0,
        y: 200.0,
        width: 900.0,
        height: 700.0,
    };
    // The edges the direction names follow the pointer; the others stay where they were.
    assert_eq!(
        resized_window(start, "e", 40.0, 99.0),
        WindowRect {
            width: 940.0,
            ..start
        }
    );
    assert_eq!(
        resized_window(start, "s", 99.0, 30.0),
        WindowRect {
            height: 730.0,
            ..start
        }
    );
    // Dragging the left edge out moves the window's own left with it, so the right stays put.
    assert_eq!(
        resized_window(start, "w", -50.0, 0.0),
        WindowRect {
            x: 50.0,
            width: 950.0,
            ..start
        }
    );
    // A corner moves two edges at once.
    assert_eq!(
        resized_window(start, "nw", -50.0, -25.0),
        WindowRect {
            x: 50.0,
            y: 175.0,
            width: 950.0,
            height: 725.0,
        }
    );
    // Setting the size directly goes around the smallest window the platform is holding for us, so the clamp is the host's.
    let (min_width, min_height) = MIN_INNER_SIZE;
    let squashed = resized_window(start, "se", -5000.0, -5000.0);
    assert_eq!(squashed.width, min_width);
    assert_eq!(squashed.height, min_height);
    assert_eq!((squashed.x, squashed.y), (start.x, start.y));
    // And a north-west drag past it pins the corner the smallest window leaves, rather than walking the window across the screen.
    let pinned = resized_window(start, "nw", 5000.0, 5000.0);
    assert_eq!((pinned.width, pinned.height), (min_width, min_height));
    assert_eq!(pinned.x, start.x + start.width - min_width);
    assert_eq!(pinned.y, start.y + start.height - min_height);
}

#[test]
fn full_screen_is_read_off_the_window_not_off_a_gesture() {
    // Full screen is reachable from the green dot's menu, the View menu and a shortcut, and only one of the three is a click the page ever sees. The resize every one of them causes is what the loop reads, so the bar's room for the dots cannot be left behind by whichever route was taken — which is why the answer is a comparison of two window states rather than of two gestures.
    let plain = WindowState {
        maximized: false,
        fullscreen: false,
    };

    assert!(
        window_state_lines(plain, plain).is_empty(),
        "a resize that moved neither says nothing"
    );
    assert_eq!(
        window_state_lines(
            plain,
            WindowState {
                fullscreen: true,
                ..plain
            }
        ),
        vec!["window.leafSetFullscreen(true);".to_string()],
        "the page is told when it changes"
    );
    assert_eq!(
        window_state_lines(
            WindowState {
                fullscreen: true,
                ..plain
            },
            plain
        ),
        vec!["window.leafSetFullscreen(false);".to_string()],
        "and told again when it goes back"
    );
    assert_eq!(
        window_state_lines(
            plain,
            WindowState {
                maximized: true,
                ..plain
            }
        ),
        vec!["window.leafSetWindowMaximized(true);".to_string()],
        "the custom title bar's own icon is the other half"
    );
}

/// The tail below the match persists the session and re-points the watcher, so it must run after anything an arm answered and after nothing else. Written as a skip list on purpose: an event this test does not name still reaches the tail, which is what keeps a new one from being dropped in silence. A drag is the gesture that made it matter — four of these a mouse move, each rebuilding the session from every open tab.
#[test]
fn only_an_event_an_arm_could_answer_reaches_the_tail_of_the_loop() {
    use tao::dpi::{PhysicalPosition, PhysicalSize};
    use tao::event::{DeviceEvent, ElementState, RawKeyEvent, StartCause};
    use tao::keyboard::KeyCode;
    use tao::window::WindowId;

    for event in [
        Event::NewEvents(StartCause::Poll),
        Event::MainEventsCleared,
        Event::RedrawEventsCleared,
        Event::RedrawRequested(unsafe { WindowId::dummy() }),
    ] {
        assert!(
            !could_have_changed_anything(&event),
            "{event:?} is answered by no arm, so the tail has nothing to do"
        );
    }

    for event in [
        Event::UserEvent(UserEvent::WebviewReady),
        Event::Suspended,
        Event::Resumed,
        Event::LoopDestroyed,
    ] {
        assert!(
            could_have_changed_anything(&event),
            "{event:?} is not on the skip list, so the tail still runs"
        );
    }

    // The device half is asked on its own for the same reason as the window half below: one raw input packet — the mouse hands the loop up to a thousand a second while focused — and no arm reads one, mouse or keyboard alike.
    for event in [
        DeviceEvent::Added,
        DeviceEvent::Key(RawKeyEvent {
            physical_key: KeyCode::KeyA,
            state: ElementState::Pressed,
        }),
    ] {
        assert!(
            !device_event_could_have_changed_anything(&event),
            "{event:?} is a raw input packet no arm reads, so the tail has nothing to do"
        );
    }

    // The window half is asked on its own because the event that wraps it cannot be built outside the window library.
    assert!(!window_event_could_have_changed_anything(
        &WindowEvent::Moved(PhysicalPosition::new(0, 0))
    ));
    for event in [
        WindowEvent::Resized(PhysicalSize::new(800, 600)),
        WindowEvent::CloseRequested,
        WindowEvent::Focused(true),
    ] {
        assert!(
            window_event_could_have_changed_anything(&event),
            "{event:?} has an arm, so the tail still runs"
        );
    }
}
