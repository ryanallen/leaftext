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
    // Not at the builder: the launch window is smaller than this, so a limit asked for there would clamp it straight back up and there would be no small window at all. It is applied in the step that grows the window instead, which is the test below.
    assert!(
        !source.contains("with_min_inner_size("),
        "the window is built with a smallest size again, which clamps the launch window away"
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

/// The one line the native focus event hands the page, and the only signal that can carry it: a browser's own blur fires when the reader clicks another tab, so a page-level guess would gray a published site's chrome for somebody else's product.
#[test]
fn the_page_is_told_the_native_window_lost_focus_and_told_again_when_it_comes_back() {
    assert_eq!(
        window_active_line(false),
        "window.leafSetWindowActive(false);",
        "the chrome goes quiet when another app takes the window"
    );
    assert_eq!(
        window_active_line(true),
        "window.leafSetWindowActive(true);",
        "and comes back the moment the window does"
    );
    // A window that came up behind another app gets the same line at startup, since the event only fires on a change — so the two spellings above are every state the page is ever handed.
    assert_ne!(window_active_line(true), window_active_line(false));
}

/// What a launch reads to decide the first state. `Window::is_focused` cannot answer it: tao gives `is_active && is_focused`, and the web view takes the second half inside a window that is plainly the one in front, so a first launch draws its whole chrome as if another app had it and stays that way until the window is clicked.
#[cfg(windows)]
#[test]
fn a_launch_asks_which_window_is_in_front_rather_than_which_one_holds_the_keyboard() {
    assert!(
        handle_is_frontmost(42, 42),
        "the window holding the front is this one"
    );
    assert!(
        !handle_is_frontmost(42, 43),
        "another app has it, so the chrome steps back"
    );
    // Windows answers zero when no window at all holds the front. That is never this one, and a window with no handle yet is not either — without both halves the two zeros would agree and a handleless window would read as the front.
    assert!(!handle_is_frontmost(42, 0));
    assert!(!handle_is_frontmost(0, 0));

    let source = include_str!("../event_loop.rs");
    assert!(
        source.contains("&window_active_line(window_is_frontmost(&reader.window))"),
        "the ready arm sends the first state off which window is in front"
    );
    assert!(
        !source.contains("window_active_line(reader.window.is_focused())"),
        "and never off the window's own keyboard focus, which the web view holds"
    );
}

/// The green dot's own command, which is not zoom: a Mac gives full screen a space of its own, and zoom only fills the room the menu bar and the Dock leave over.
#[test]
fn the_green_dot_asks_for_the_kind_of_full_screen_that_takes_a_space_of_its_own() {
    use tao::window::Fullscreen;

    assert_eq!(
        fullscreen_after(false),
        Some(Fullscreen::Borderless(None)),
        "a windowed press goes to full screen on the monitor it is already on"
    );
    assert_eq!(
        fullscreen_after(true),
        None,
        "and the next press is the way back out, or the dot enters and never leaves"
    );

    // The one thing about this no value can answer: the decision reaches a window library call, on a window no test can build.
    let source = include_str!("../window_cmds.rs");
    assert!(
        source.contains("reader.window.set_fullscreen(fullscreen_after(fullscreen))"),
        "the command reaches no window call, so the dot is pressed and nothing moves"
    );
    assert!(
        !source.contains("set_simple_fullscreen"),
        "the pre-Lion kind makes no space of its own, so swiping sideways would still do nothing"
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
        Event::UserEvent(UserEvent::FocusWindow),
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
        // Losing the window has an arm of its own: the page is told, so the tail has to run for this one too.
        WindowEvent::Focused(false),
    ] {
        assert!(
            window_event_could_have_changed_anything(&event),
            "{event:?} has an arm, so the tail still runs"
        );
    }
}

#[cfg(windows)]
#[test]
fn a_window_started_where_nobody_can_see_it_comes_up_without_the_keyboard() {
    // A build launches its own copy so the owner's window, tabs and place survive it, and the copy is started at a place off every monitor so it never lands over what they are reading. The other half is the keyboard: a window nobody can see must not hold it, or their typing goes into a window they cannot find.
    //
    // Two monitors side by side, the second one shorter, so the gap under it is inside the pair's bounding box and on neither screen.
    let monitors = [(0, 0, 1920, 1080), (1920, 0, 1280, 720)];

    for place in [(0, 0), (960, 540), (1919, 1079), (1920, 0), (3199, 719)] {
        assert!(
            !place_is_off_every_monitor(place, &monitors),
            "{place:?} is on a monitor, so a window there is a window somebody can see"
        );
    }
    for place in [
        // Where the launcher puts a copy: past the top-left corner of every monitor at once.
        (-10000, -10000),
        // One pixel past the right and bottom edges, which a monitor rectangle does not include.
        (3200, 0),
        (0, 1080),
        // Under the shorter monitor: inside the bounding box the pair makes and on neither of them, which is why the answer is asked of each monitor rather than of the box around them.
        (2000, 900),
    ] {
        assert!(
            place_is_off_every_monitor(place, &monitors),
            "{place:?} is on none of them, so a window there is one nobody can see"
        );
    }
    // With no monitors listed at all, every place is off screen. A window with nowhere to be seen is exactly the case that must not take the keys.
    assert!(place_is_off_every_monitor((0, 0), &[]));

    // The launch this test itself runs under carried no startup place, which is every launch but a probe's — so nothing takes the keyboard away from an ordinary copy.
    assert_eq!(startup_place(), None);
    assert!(!started_off_every_monitor(&monitors));

    // And the builder asks for no focus on that answer alone, twice: the window itself, and the web view, which moves focus into itself as it is created unless told not to and so activates the window the first call just kept quiet. Held as source because neither builder chain is a value — nothing here can build the window it makes, so the calls are the whole of the claim.
    let source = include_str!("../../main.rs");
    assert_eq!(
        source.matches("with_focused(false)").count(),
        2,
        "the window and the web view are the two things that take the keyboard, and one of them no longer asks for none"
    );
    // The answer is read once, off the place this copy was started at against the monitors the window library lists, so unplugging one is answered the same way a launcher's own place is.
    assert!(
        source
            .contains("started_off_every_monitor(&monitor_rects(event_loop.available_monitors()))"),
        "the answer is no longer read off the place this copy was started at"
    );
    for chain in [
        "window_builder = window_builder.with_focused(false)",
        "builder.with_focused(false)",
    ] {
        let arm = source
            .split("#[cfg(windows)]")
            .find(|arm| arm.contains(chain))
            .unwrap_or_else(|| panic!("main.rs builds with `{chain}`"));
        assert!(
            arm.contains("if comes_up_unseen"),
            "`{chain}` runs on something other than whether this copy came up where nobody can see it"
        );
    }
    // And nothing pulls such a window forward later. Both places that surface one — a second launch forwarding a document, and the document this copy was launched with, which arrives down the same arm — go through the one call that leaves it where it stands.
    let loop_source = include_str!("../event_loop.rs");
    assert_eq!(
        loop_source.matches("set_focus()").count(),
        0,
        "the event loop pulls the window forward without asking whether anybody can see it"
    );
    assert_eq!(
        loop_source
            .matches("surface_window(&reader.window)")
            .count(),
        2
    );
    // Nothing asks for a position through the builder: tao matches one against every monitor and throws it away when it matches none, which is the one case this needs. The place rides on the process instead.
    assert!(
        !source.contains("with_position"),
        "a position asked for through the builder is dropped for exactly the off-screen case"
    );
}

#[test]
fn a_launch_puts_up_the_small_window_and_grows_it_once_the_page_has_drawn() {
    // What the reader met before this: a full-size window with nothing in it for the whole of the wait, which reads as broken rather than as a wait. The window exists a few hundred milliseconds before the web view has drawn a pixel, so it is built small and holding the startup card and becomes theirs afterwards.
    assert_eq!(
        STARTUP_INNER_SIZE,
        (256.0, 256.0),
        "the launch window is no longer the small square the card is drawn in"
    );
    // Smaller than the smallest window a reader may drag to, which is the whole reason that limit cannot be asked for at the builder: the platform would clamp the launch window straight back up to it.
    assert!(STARTUP_INNER_SIZE.0 < MIN_INNER_SIZE.0 && STARTUP_INNER_SIZE.1 < MIN_INNER_SIZE.1);

    // The reader's own window, in the order it has to be asked for: the limit, then the size, then the maximize.
    let mut startup = StartupWindow {
        size: LogicalSize::new(1080.0, 820.0),
        maximized: true,
        grown: false,
    };
    let growth = startup_growth(&mut startup).expect("the first ask grows the window");
    assert_eq!(
        (growth.min_size.width, growth.min_size.height),
        MIN_INNER_SIZE,
        "the smallest window a reader may drag to arrives with the growth or never"
    );
    assert_eq!((growth.size.width, growth.size.height), (1080.0, 820.0));
    assert!(growth.maximized);
    // Both ways in ask, and the second one must change nothing: by then the reader may have moved the window themselves.
    assert!(
        startup_growth(&mut startup).is_none(),
        "the window is grown twice, so whichever of the page and the deadline came second resized a window the reader may already have moved"
    );

    // A window left windowed comes back windowed, at the size it was left at.
    let mut windowed = StartupWindow {
        size: LogicalSize::new(900.0, 640.0),
        maximized: false,
        grown: false,
    };
    let growth = startup_growth(&mut windowed).expect("the first ask grows the window");
    assert!(!growth.maximized);
    assert_eq!((growth.size.width, growth.size.height), (900.0, 640.0));

    // The page is told which window it now has, rather than left to work it out from the resize: the launch window has already told it it is not maximized.
    assert_eq!(
        window_maximized_line(true),
        "window.leafSetWindowMaximized(true);"
    );
    assert!(startup_done_script().contains("leafStartupDone"));

    // The launch size is not a size anybody chose, so it must never be what the next launch comes back at, and nor is a maximized or a minimized one.
    assert!(!remembers_windowed_size(false, false, false, 1080, 820));
    assert!(remembers_windowed_size(true, false, false, 1080, 820));
    assert!(!remembers_windowed_size(true, true, false, 1080, 820));
    assert!(!remembers_windowed_size(true, false, true, 1080, 820));
    assert!(!remembers_windowed_size(true, false, false, 0, 820));

    // Two ways in, because a page that threw while it loaded says nothing at all and there is nothing in a 256-pixel window for a reader to press.
    let said: IpcCommand = serde_json::from_str(r#"{"command":"startupReady"}"#)
        .expect("the page can say it has drawn");
    assert!(matches!(said, IpcCommand::StartupReady));
    assert!(matches!(
        UserEvent::StartupGrowDue,
        UserEvent::StartupGrowDue
    ));
    // Long enough that a slow disk is not cut off, short enough that a broken page is not something anybody sits through.
    assert_eq!(STARTUP_GROW_DEADLINE, Duration::from_secs(4));

    // The page comes up holding the card, in markup rather than built by a script that has not run yet. Named through the library because the binary reaches the page through `front_end_asset`, which is a launch's environment rather than this test's.
    let page = leaftext::app_shell_html();
    assert!(
        page.contains("id=\"startupCard\""),
        "the page comes up without the startup card"
    );
    assert!(
        page.contains("startup-card-spinner"),
        "the startup card comes up without its ring"
    );
}

#[test]
fn only_the_word_the_launcher_writes_asks_for_the_measured_front_end() {
    // Every copy anybody downloads is served the ordinary join, and one variable set by one launcher is the whole of what changes that. A variable left behind empty, or holding anything else, is a reader's launch — otherwise a stale name in somebody's environment would quietly serve them a front end that times itself.
    assert_eq!(front_end_asset_for(None), leaftext::APP_SHELL_SCRIPT_ASSET);
    assert_eq!(
        front_end_asset_for(Some("")),
        leaftext::APP_SHELL_SCRIPT_ASSET
    );
    assert_eq!(
        front_end_asset_for(Some("0")),
        leaftext::APP_SHELL_SCRIPT_ASSET
    );
    assert_eq!(
        front_end_asset_for(Some("true")),
        leaftext::APP_SHELL_SCRIPT_ASSET
    );
    assert_eq!(
        front_end_asset_for(Some("1")),
        leaftext::APP_SHELL_EVALUATION_SCRIPT_ASSET
    );
}

/// The page's own boot word is its own command, and not the one the window grows on. They are two different promises made at two different moments — every fragment has run, and a screen a reader could use has been drawn — and a launch opening a file withholds the second until that file arrives, so a host that released the file on it would be waiting for itself.
#[test]
fn the_page_says_it_has_booted_and_says_it_has_drawn_with_two_different_words() {
    let booted: IpcCommand = serde_json::from_str(r#"{"command":"frontEndReady"}"#)
        .expect("the page's boot word parses");
    assert!(
        matches!(booted, IpcCommand::FrontEndReady),
        "the boot word parsed as something else, so the launch's files are released by whatever that is"
    );

    let drawn: IpcCommand =
        serde_json::from_str(r#"{"command":"startupReady"}"#).expect("the drawn word still parses");
    assert!(
        matches!(drawn, IpcCommand::StartupReady),
        "the drawn word has been taken over by the boot word, so the window grows on the wrong one"
    );
}

/// A file the launch was asked for waits for that word and is then handed over exactly once. Twice would reopen a document the reader may have closed in between.
#[test]
fn a_file_the_launch_was_asked_for_waits_for_the_page_and_is_handed_over_once() {
    let mut queue = LaunchOpenQueue::with_launch_path(Some(PathBuf::from("/docs/one.md")));

    assert_eq!(
        queue.front_end_ready(),
        LaunchOpen::Open(vec![PathBuf::from("/docs/one.md")]),
        "the launch's file was not released when the page said it could take one"
    );
    assert_eq!(
        queue.front_end_ready(),
        LaunchOpen::Nothing,
        "a second boot word opened the file again, over whatever the reader had done with that tab"
    );
}

/// A Finder double-click before the page has booted. Nothing may touch the tabs yet: opening one there changes the tab strip and then calls a render hook the delayed script has not defined, which is the file whose name sits on a tab over the home screen.
#[test]
fn a_finder_file_arriving_before_the_page_has_booted_opens_nothing_until_it_has() {
    let mut queue = LaunchOpenQueue::default();

    assert_eq!(
        queue.deliver(vec![PathBuf::from("/docs/one.md")]),
        LaunchOpen::Nothing,
        "the file was opened into a page with no hooks to draw it, which is the whole fault"
    );
    assert_eq!(
        queue.front_end_ready(),
        LaunchOpen::Open(vec![PathBuf::from("/docs/one.md")]),
        "the page said it could take a document and the file that was waiting never arrived"
    );
}

/// One Apple Event carries every file that was selected, and a drop always can. They are released together, in the order they were handed over, so the strip is filled once and the last one is what the reader lands on.
#[test]
fn a_batch_delivered_before_the_boot_word_comes_back_whole_and_in_order() {
    let mut queue = LaunchOpenQueue::default();
    let delivered = vec![
        PathBuf::from("/docs/one.md"),
        PathBuf::from("/docs/two.md"),
        PathBuf::from("/docs/three.md"),
    ];

    assert_eq!(queue.deliver(delivered.clone()), LaunchOpen::Nothing);
    assert_eq!(
        queue.front_end_ready(),
        LaunchOpen::Open(delivered.clone()),
        "the batch came back short or out of order, so a three-file selection opens as one file or as the wrong one"
    );

    // What the loop then does with it: one tab each, and the last delivered is the one in front — which is what makes the single render at the end the document the reader asked for.
    let mut workspace = Workspace::default();
    for path in delivered {
        workspace.open_path(path);
    }
    assert_eq!(
        workspace.tabs.len(),
        3,
        "three files were delivered and the strip does not hold three"
    );
    assert_eq!(
        workspace.active,
        Some(2),
        "the reader lands on something other than the last file of the batch"
    );
}

/// After the boot word every route is immediate, and every route waits before it. The Windows handoff is the one that has never been reported: its forwarding server starts before the web view is built, so a second launch during startup can reach the same race a Finder double-click does.
#[test]
fn after_the_boot_word_a_file_opens_at_once_and_before_it_every_route_waits() {
    let mut queue = LaunchOpenQueue::default();
    queue.front_end_ready();

    assert_eq!(
        queue.deliver(vec![PathBuf::from("/docs/later.md")]),
        LaunchOpen::Open(vec![PathBuf::from("/docs/later.md")]),
        "a file opened once the page is up was held, so the app went quiet on a double-click"
    );
    assert_eq!(
        queue.deliver(Vec::new()),
        LaunchOpen::Nothing,
        "an empty delivery asked for a render of nothing"
    );
    // The same file delivered again is still a release, because a double-click on a file already open is a reader asking to be taken to it. What the workspace then does is bring that tab forward rather than open a second one, and the release renders either way.
    let mut workspace = Workspace::default();
    workspace.open_path(PathBuf::from("/docs/later.md"));
    workspace.open_path(PathBuf::from("/docs/other.md"));
    assert_eq!(
        queue.deliver(vec![PathBuf::from("/docs/later.md")]),
        LaunchOpen::Open(vec![PathBuf::from("/docs/later.md")]),
        "a file already open was swallowed, so double-clicking it in Finder does nothing at all"
    );
    workspace.open_path(PathBuf::from("/docs/later.md"));
    assert_eq!(workspace.tabs.len(), 2, "the same file opened a second tab");
    assert_eq!(
        workspace.active,
        Some(0),
        "the tab already showing that file was not brought forward"
    );

    // The same value, reached the other way round: a second launch forwarding its file during startup is held exactly as a Finder batch is.
    let mut starting = LaunchOpenQueue::with_launch_path(Some(PathBuf::from("/docs/first.md")));
    assert_eq!(
        starting.deliver(vec![PathBuf::from("/docs/forwarded.md")]),
        LaunchOpen::Nothing,
        "a second launch's file rendered into a page that had not booted"
    );
    assert_eq!(
        starting.front_end_ready(),
        LaunchOpen::Open(vec![
            PathBuf::from("/docs/first.md"),
            PathBuf::from("/docs/forwarded.md"),
        ]),
        "the command line's file and the forwarded one were not released together, in that order"
    );
}
