//! The `eval` ask's answer: what the page really did with a line, rather than what it came to.
//!
//! The engine hands back one value and no error, so a script that threw, a script it never read at all, and a script that honestly came to nothing all arrive as `null`. The caller's line therefore goes into a `try` with a numbered mark declared after it, and a second call reads that mark back: a script the page never read is told by the mark standing still, because there is no message to tell it by. A `try` block hands back its own body's value, and a declaration has no value of its own, so neither the wrapper nor the mark costs the answer anything.

use super::*;

use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};

/// One number per ask, so a mark left by an earlier one can never be read as this one's. Starts at 1, which `undefined` never matches.
static ASKS: AtomicU64 = AtomicU64::new(1);

/// The caller's script inside a `try`, with this ask's number marked on the window after it and tagged into the `catch`.
///
/// The newline before the mark is load-bearing: a script ending in a `//` comment would otherwise swallow it. The mark is a `const` rather than an assignment because a declaration produces no completion value, so a script ending in one still answers what it answered.
pub(crate) fn wrapped_script(script: &str, number: u64) -> String {
    format!(
        "try {{ {script}\n;const __leafMark = (window.__leafEvalRan = {number}); }} \
         catch (__leafError) {{ ({{ leafEvalError: {number}, \
         message: String((__leafError && __leafError.stack) || __leafError) }}) }}"
    )
}

/// The second call: the mark read back as a string, so a page that never set it answers `"undefined"` rather than nothing.
pub(crate) fn mark_probe() -> String {
    "String(window.__leafEvalRan)".to_string()
}

/// The three ways a wrapped script can end, told apart by the pair of answers.
///
/// A value that is itself an object carrying `leafEvalError` is only the wrapper's when the number matches — the caller cannot know this ask's number, so their own object falls through to the value.
pub(crate) fn outcome(answer: Value, mark: &Value, number: u64) -> Result<Value, String> {
    if let Some(message) = thrown_message(&answer, number) {
        return Err(message);
    }
    if mark.as_str() == Some(number.to_string().as_str()) {
        return Ok(answer);
    }
    Err(
        "the page never read the script, so nothing ran: it is a syntax error rather than an answer"
            .to_string(),
    )
}

/// The engine's own message and stack, when the answer is this ask's tagged error.
fn thrown_message(answer: &Value, number: u64) -> Option<String> {
    if answer.get("leafEvalError")?.as_u64()? != number {
        return None;
    }
    Some(
        answer
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("the script threw")
            .to_string(),
    )
}

/// What each callback has landed with so far. The two calls answer on whatever thread the web view picks and in either order, so the reply is filled by whichever arrives second and only once.
#[derive(Default)]
pub(super) struct Join {
    answer: Option<Value>,
    mark: Option<Value>,
    replied: bool,
}

impl Join {
    /// Put one callback's half away, and hand back the pair the first time both are in.
    ///
    /// Both halves are tested before either is taken. Reading them out to test them empties the first callback's own store on the way past, so the second one finds nothing waiting and the ask times out instead of answering.
    pub(super) fn fill(
        &mut self,
        answer: Option<Value>,
        mark: Option<Value>,
    ) -> Option<(Value, Value)> {
        if let Some(answer) = answer {
            self.answer = Some(answer);
        }
        if let Some(mark) = mark {
            self.mark = Some(mark);
        }
        if self.replied || self.answer.is_none() || self.mark.is_none() {
            return None;
        }
        self.replied = true;
        Some((self.answer.take()?, self.mark.take()?))
    }
}

/// Run the caller's script and read the mark back, then answer off the pair.
///
/// Both calls go out from the loop thread, which is where `evaluate_script_with_callback` must be called from, and the page runs them in the order they were sent — so the mark the second one reads is the one the first one left.
pub(crate) fn run(page: &WebView, script: &str, reply: PipeReply) {
    let number = ASKS.fetch_add(1, Ordering::Relaxed);
    let joined = Arc::new(Mutex::new(Join::default()));

    let landed = Arc::clone(&joined);
    let landed_reply = reply.clone();
    if let Err(error) =
        page.evaluate_script_with_callback(&wrapped_script(script, number), move |result| {
            settle(
                &landed,
                &landed_reply,
                number,
                Some(as_value(&result)),
                None,
            );
        })
    {
        let _ = reply.try_send(Err(format!("the page refused it: {error}")));
        return;
    }

    let landed = Arc::clone(&joined);
    let landed_reply = reply.clone();
    if let Err(error) = page.evaluate_script_with_callback(&mark_probe(), move |result| {
        settle(
            &landed,
            &landed_reply,
            number,
            None,
            Some(as_value(&result)),
        );
    }) {
        let _ = reply.try_send(Err(format!("the page refused it: {error}")));
    }
}

/// The web view answers a string; anything that is not JSON is the string itself.
fn as_value(result: &str) -> Value {
    serde_json::from_str(result).unwrap_or_else(|_| serde_json::json!(result))
}

/// Put one callback's half away, and answer once both are in.
fn settle(
    joined: &Arc<Mutex<Join>>,
    reply: &PipeReply,
    number: u64,
    answer: Option<Value>,
    mark: Option<Value>,
) {
    let Ok(mut held) = joined.lock() else { return };
    if let Some((answer, mark)) = held.fill(answer, mark) {
        let _ = reply.try_send(outcome(answer, &mark, number));
    }
}
