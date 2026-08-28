//! The `gesture` ask's answer: a pointer gesture played into the page over the web view's own developer protocol.
//!
//! The protocol takes browser-level input with no cursor, no focus and no place on screen, and the page sees a trusted event carrying the delta it was sent — which is what reaches a copy standing off every monitor, where a real mouse gesture is refused because a point on no monitor is clamped onto the desktop.
//!
//! The ask carries the picture's own pixels — the client rectangle's — and the protocol wants the page's. They are the window's scale apart, so the conversion happens here, in the one place that knows the number. A drag is walked on a thread of its own, one loop event per step, because the protocol call must be made from the loop thread and a paced walk made there would hold the loop for its whole length.

use super::*;

use serde::Deserialize;
use std::time::Duration;

/// What an unpaced drag walks: twelve moves twenty-five milliseconds apart, the same walk `just drive` makes for a step written without the two numbers.
const DEFAULT_MOVES: u32 = 12;
const DEFAULT_GAP_MS: u64 = 25;

/// The pause between wheel notches, matching the driver's: the reader re-pins itself to its scroll anchor between events, and a burst lands somewhere else entirely.
const WHEEL_GAP_MS: u64 = 60;

/// What one notch scrolls, in the page's own pixels — measured: eight protocol wheels moved a page 800.
const NOTCH_DELTA: f64 = 100.0;

/// The longest walk an ask may name. The pipe waits with the walk, so a longer one is a wedged asker rather than a gesture.
const WALK_CEILING_MS: u64 = 30_000;

/// The pointer gestures the ask plays, spelled the way the driver's steps are. `type` and `key` are in the vocabulary so their refusal can name `eval` rather than reading as a typo.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(crate) enum Gesture {
    Move {
        x: f64,
        y: f64,
    },
    Click {
        x: f64,
        y: f64,
    },
    Rclick {
        x: f64,
        y: f64,
    },
    /// Negative notches scroll down, the way a mouse wheel's are signed.
    Wheel {
        x: f64,
        y: f64,
        notches: i64,
    },
    Drag {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        #[serde(default = "default_moves")]
        moves: u32,
        #[serde(default = "default_gap")]
        gap: u64,
    },
    /// A drag that keeps the button down, so a shot can catch the gesture in flight. [`Gesture::Release`] ends it.
    Hold {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        #[serde(default = "default_moves")]
        moves: u32,
        #[serde(default = "default_gap")]
        gap: u64,
    },
    Release {
        x: f64,
        y: f64,
    },
    Type,
    Key,
}

fn default_moves() -> u32 {
    DEFAULT_MOVES
}

fn default_gap() -> u64 {
    DEFAULT_GAP_MS
}

impl Gesture {
    /// How long the walk itself takes, so the pipe can wait past its usual two seconds for a drag walked at a hand's pace.
    pub(crate) fn walk(&self) -> Duration {
        match self {
            Gesture::Drag { moves, gap, .. } | Gesture::Hold { moves, gap, .. } => {
                Duration::from_millis(u64::from(*moves).saturating_add(2).saturating_mul(*gap))
            }
            Gesture::Wheel { notches, .. } => {
                Duration::from_millis(notches.unsigned_abs().saturating_mul(WHEEL_GAP_MS))
            }
            _ => Duration::ZERO,
        }
    }
}

/// A picture pixel taken to the page's own. The picture is the client rectangle, which is the page times the window's scale.
pub(crate) fn to_page(picture: f64, scale: f64) -> f64 {
    picture / scale.max(0.01)
}

/// The walk a gesture plays: the protocol calls in order, the gap between them, and the word the answer says was played.
#[derive(Debug)]
// Only the Windows route plays a walk. The other build still shapes one, so a bad ask is refused for what it is rather than for the platform, and then throws it away.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) struct Walk {
    pub(crate) label: &'static str,
    pub(crate) steps: Vec<String>,
    pub(crate) gap_ms: u64,
}

/// One `Input.dispatchMouseEvent` parameter block.
fn mouse_event(kind: &str, x: f64, y: f64, button: &str, buttons: u8, clicks: u8) -> String {
    serde_json::json!({
        "type": kind,
        "x": x,
        "y": y,
        "button": button,
        "buttons": buttons,
        "clickCount": clicks,
    })
    .to_string()
}

/// A press and its release, led by a move so the page's hover state is what a hand would have left it.
fn press_and_release(x: f64, y: f64, button: &str, held: u8) -> Vec<String> {
    vec![
        mouse_event("mouseMoved", x, y, "none", 0, 0),
        mouse_event("mousePressed", x, y, button, held, 1),
        mouse_event("mouseReleased", x, y, button, 0, 1),
    ]
}

/// The whole walk for one gesture, with every coordinate taken to the page's pixels — or the refusal, which never plays anything.
pub(crate) fn steps_for(gesture: &Gesture, scale: f64) -> Result<Walk, String> {
    let at = |value: f64| to_page(value, scale);
    match gesture {
        Gesture::Type | Gesture::Key => Err(
            "keys are not played here: the page's own eval ask presses anything a shortcut reaches, and the protocol spells keys differently from the driver"
                .to_string(),
        ),
        Gesture::Move { x, y } => Ok(Walk {
            label: "move",
            steps: vec![mouse_event("mouseMoved", at(*x), at(*y), "none", 0, 0)],
            gap_ms: 0,
        }),
        Gesture::Click { x, y } => Ok(Walk {
            label: "click",
            steps: press_and_release(at(*x), at(*y), "left", 1),
            gap_ms: 0,
        }),
        Gesture::Rclick { x, y } => Ok(Walk {
            label: "rclick",
            steps: press_and_release(at(*x), at(*y), "right", 2),
            gap_ms: 0,
        }),
        Gesture::Release { x, y } => Ok(Walk {
            label: "release",
            steps: vec![mouse_event("mouseReleased", at(*x), at(*y), "left", 0, 1)],
            gap_ms: 0,
        }),
        Gesture::Wheel { x, y, notches } => {
            if *notches == 0 {
                return Err("a wheel of no notches moves nothing".to_string());
            }
            // Positive protocol delta scrolls down, where a wheel notch's sign is the other way up.
            let delta = if *notches < 0 { NOTCH_DELTA } else { -NOTCH_DELTA };
            let steps = (0..notches.unsigned_abs())
                .map(|_| {
                    serde_json::json!({
                        "type": "mouseWheel",
                        "x": at(*x),
                        "y": at(*y),
                        "button": "none",
                        "buttons": 0,
                        "deltaX": 0,
                        "deltaY": delta,
                    })
                    .to_string()
                })
                .collect();
            Ok(Walk {
                label: "wheel",
                steps,
                gap_ms: WHEEL_GAP_MS,
            })
        }
        Gesture::Drag {
            x1,
            y1,
            x2,
            y2,
            moves,
            gap,
        }
        | Gesture::Hold {
            x1,
            y1,
            x2,
            y2,
            moves,
            gap,
        } => {
            // The same refusals the driver makes: no moves is a press and a teleport, which selects nothing, and no gap is a walk faster than a gesture means anything.
            if *moves == 0 {
                return Err("a drag of no moves is a press and a teleport, and a selection follows the moves".to_string());
            }
            if *gap == 0 {
                return Err("a drag with no gap between moves walks faster than a gesture means anything".to_string());
            }
            if gesture.walk() > Duration::from_millis(WALK_CEILING_MS) {
                return Err(format!(
                    "a walk of {} moves {gap} ms apart outlasts the {} seconds an ask may hold the pointer",
                    moves,
                    WALK_CEILING_MS / 1000
                ));
            }
            let mut steps = vec![
                mouse_event("mouseMoved", at(*x1), at(*y1), "none", 0, 0),
                mouse_event("mousePressed", at(*x1), at(*y1), "left", 1, 1),
            ];
            for step in 1..=*moves {
                let along = f64::from(step) / f64::from(*moves);
                steps.push(mouse_event(
                    "mouseMoved",
                    at(x1 + (x2 - x1) * along),
                    at(y1 + (y2 - y1) * along),
                    "left",
                    1,
                    0,
                ));
            }
            let held = matches!(gesture, Gesture::Hold { .. });
            if !held {
                steps.push(mouse_event("mouseReleased", at(*x2), at(*y2), "left", 0, 1));
            }
            Ok(Walk {
                label: if held { "hold" } else { "drag" },
                steps,
                gap_ms: *gap,
            })
        }
    }
}

/// Play the walk: a thread of its own paces it and posts one [`UserEvent::PipeGestureStep`] per step, so the loop dispatches each protocol call without ever holding the walk. The reply rides the last step and is filled when the engine takes it.
#[cfg(target_os = "windows")]
pub(crate) fn run(
    proxy: &tao::event_loop::EventLoopProxy<UserEvent>,
    scale: f64,
    gesture: &Gesture,
    reply: PipeReply,
) {
    let walk = match steps_for(gesture, scale) {
        Ok(walk) => walk,
        Err(reason) => {
            let _ = reply.try_send(Err(reason));
            return;
        }
    };
    let answer = serde_json::json!({ "played": walk.label, "steps": walk.steps.len() });
    let gap = Duration::from_millis(walk.gap_ms);
    let proxy = proxy.clone();
    std::thread::Builder::new()
        .name("leaf-gesture-walk".into())
        .spawn(move || {
            let started = std::time::Instant::now();
            let last = walk.steps.len().saturating_sub(1);
            for (number, params) in walk.steps.into_iter().enumerate() {
                if number > 0 {
                    wait_until(started + gap * number as u32);
                }
                let done = (number == last).then(|| (reply.clone(), answer.clone()));
                if proxy
                    .send_event(UserEvent::PipeGestureStep { params, done })
                    .is_err()
                {
                    let _ = reply.try_send(Err(
                        "the app is closing, so the gesture has nowhere to land".to_string(),
                    ));
                    return;
                }
            }
        })
        .ok();
}

/// The refusal where the app was not built for Windows. The protocol is the web view's, and only the Windows web view has one; the bad-ask refusals still come first, so a wrong ask is named for what it is on either platform.
#[cfg(not(target_os = "windows"))]
pub(crate) fn run(
    _proxy: &tao::event_loop::EventLoopProxy<UserEvent>,
    scale: f64,
    gesture: &Gesture,
    reply: PipeReply,
) {
    let refusal = match steps_for(gesture, scale) {
        Ok(_) => "the gesture ask plays through the web view's own developer protocol, and only the Windows web view has one — drive the page through eval here".to_string(),
        Err(reason) => reason,
    };
    let _ = reply.try_send(Err(refusal));
}

/// One step of the walk, dispatched from the loop thread — the only thread the protocol call may be made from. The call answers asynchronously on this same thread's message loop, so nothing here waits.
#[cfg(target_os = "windows")]
pub(crate) fn step(
    page: Option<&WebView>,
    params: &str,
    done: Option<(PipeReply, serde_json::Value)>,
) {
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use windows::core::HSTRING;
    use wry::WebViewExtWindows;

    let Some(page) = page else {
        if let Some((reply, _)) = done {
            let _ = reply.try_send(Err("there is no window to play it in".to_string()));
        }
        return;
    };
    let view = page.webview();
    let method = HSTRING::from("Input.dispatchMouseEvent");
    let asked = HSTRING::from(params);
    let landing = done.clone();
    let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
        move |sent: windows::core::Result<()>, _json: String| {
            if let Some((reply, answer)) = landing {
                let _ = reply.try_send(match sent {
                    Ok(()) => Ok(answer),
                    Err(error) => Err(format!("the page refused the gesture: {error}")),
                });
            }
            Ok(())
        },
    ));
    if let Err(error) = unsafe { view.CallDevToolsProtocolMethod(&method, &asked, &handler) } {
        if let Some((reply, _)) = done {
            let _ = reply.try_send(Err(format!("the page refused the gesture: {error}")));
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn step(
    _page: Option<&WebView>,
    _params: &str,
    done: Option<(PipeReply, serde_json::Value)>,
) {
    if let Some((reply, _)) = done {
        let _ = reply.try_send(Err(
            "the gesture ask plays through the web view's own developer protocol, and only the Windows web view has one".to_string(),
        ));
    }
}

/// Hold the walk to its clock. A plain sleep on this machine floors at about sixteen milliseconds and a fast hand's gap is eight, so the tail of every wait is spun on the stopwatch.
#[cfg(target_os = "windows")]
fn wait_until(deadline: std::time::Instant) {
    loop {
        let now = std::time::Instant::now();
        if now >= deadline {
            return;
        }
        let left = deadline - now;
        if left > Duration::from_millis(20) {
            std::thread::sleep(left - Duration::from_millis(20));
        } else {
            std::hint::spin_loop();
        }
    }
}
