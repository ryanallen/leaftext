#!/usr/bin/env node
// Reading one wrapper result: the app's reply and the note beside it, kept apart.
//
// `scripts/mcp-leaftext.mjs --ask` reserves the output stream for the reply because that is what MCP reads, and says which copy answered on the error stream — so a build that launched its own copy with `just probe-copy` is told which window it is talking to. Joining the two before parsing turns every one of those answers into unreadable text: a valid reply plus one English sentence is not JSON, so the motion probe stopped before its first frame and printed both pieces as though the app had answered badly. That is the whole of the fault this file exists to remove.
//
// A pure function rather than a few lines inside the probe, because the probe needs a running copy and this is the half that can be read back with no app open at all — `scripts/check-driver.mjs` calls it directly, so the gate proves the parser the command really uses rather than a second copy of it.

/** What the wrapper's two streams mean, read apart. `unreadable` carries the note inside it, because there is no reply to print it beside; the other two hand it back for the caller to pass through. */
export function readProbeReply(stdout, stderr) {
  const said = String(stdout ?? '').trim();
  const note = String(stderr ?? '').trim();
  if (!said) return { unreadable: withNote('the app said nothing', note) };
  let reply;
  try {
    reply = JSON.parse(said);
  } catch {
    return { unreadable: withNote(said, note) };
  }
  if (!reply.ok) return { note, refusal: reply.error };
  return { note, answer: reply.answer };
}

// The note is what says which copy answered, so a refusal without it names no window — and the copy a probe run cares about is exactly the one that adds a note.
function withNote(reason, note) {
  return note ? `${reason}\n  beside it: ${note}` : reason;
}
