// fetches.js
// ---------------------------------------------------------------------------
// One deadline under every fetch a page waits on.
//
// A connection that stalls neither finishes nor fails: the promise never settles, so a `catch` never runs and a page waiting on it waits for ever. That is what left both published sites sitting on a Loading… line nobody could get past without a refresh — and the refresh loaded instantly, off bytes the browser already had.
//
// **The deadline is on silence, not on total time.** The renderer module is nearly three megabytes, so any total deadline short enough to help a stalled reader also cuts a slow one who is still receiving. Silence is the thing a stall actually is: no byte for ten seconds, while waiting for the answer's head and while its body streams.
//
// A wait that dies retries once on a fresh connection, and a run out of tries throws — which lands in the failure sentences both readers already carry. Only the wait itself is retried: an answer the server actually gave, and anything the caller then throws over it, is a decision, not a stall.
// ---------------------------------------------------------------------------

/** No byte for this long and the wait is dead. */
const SILENCE_MS = 10000;

/** The first connection, then one more. A stall is usually one dead socket, and the second one is answered off the same edge the refresh was. */
const TRIES = 2;

let silenceMs = SILENCE_MS;

/** The site boot check sets this so it does not sit through ten real seconds, and calls it with nothing to put the real limit back. Nothing the browser runs calls it. */
export function setSilenceLimit(ms) {
  silenceMs = typeof ms === 'number' ? ms : SILENCE_MS;
}

const decoder = new TextDecoder();

/** The error a dead wait throws, marked as the one kind worth trying again. */
function wentQuiet(url) {
  const error = new Error(`nothing arrived from ${url}, so this page stopped waiting for it`);
  error.leafRetry = true;
  return error;
}

/** A connection that failed rather than answered: the same kind, so it retries too. */
function connectionFailed(error, url) {
  if (error && error.leafRetry) return error;
  const failed = new Error(`could not reach ${url} (${error && error.message ? error.message : error})`);
  failed.leafRetry = true;
  return failed;
}

/** Whichever comes first: the work, or the silence limit running out. */
function raceSilence(work, url) {
  let timer = null;
  const stall = new Promise((_, reject) => {
    timer = setTimeout(() => reject(wentQuiet(url)), silenceMs);
  });
  return Promise.race([work, stall]).finally(() => clearTimeout(timer));
}

/** The answer's head, under the deadline. The abort frees the socket; the race is what ends the wait, because a host that ignores the signal would otherwise hold it open for ever. */
async function head(url, options) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const asked = fetch(url, controller ? { ...options, signal: controller.signal } : options);
  if (asked && typeof asked.catch === 'function') asked.catch(() => {});
  try {
    return await raceSilence(asked, url);
  } catch (error) {
    if (controller) controller.abort();
    throw connectionFailed(error, url);
  }
}

/** The same deadline over the body, bumped by every chunk that arrives — so a slow download runs as long as it needs to and a stalled one dies. A host handing the whole body over at once has no stream to watch, and is already complete. */
function watchBody(response, url) {
  const body = response && response.body;
  if (!body || typeof body.getReader !== 'function' || typeof ReadableStream !== 'function' || typeof Response !== 'function') return response;
  const reader = body.getReader();
  let timer = null;
  const stream = new ReadableStream({
    start(controller) {
      const stop = () => {
        if (timer) clearTimeout(timer);
        timer = null;
      };
      const bump = () => {
        stop();
        timer = setTimeout(() => {
          reader.cancel().catch(() => {});
          controller.error(wentQuiet(url));
        }, silenceMs);
      };
      const pump = () =>
        reader.read().then(({ done, value }) => {
          if (done) {
            stop();
            controller.close();
            return;
          }
          bump();
          controller.enqueue(value);
          return pump();
        });
      bump();
      pump().catch((error) => {
        stop();
        controller.error(connectionFailed(error, url));
      });
    },
    cancel(reason) {
      if (timer) clearTimeout(timer);
      return reader.cancel(reason);
    },
  });
  return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/** Run one attempt, and run it again on a fresh connection when the wait died rather than answered. */
async function retrying(run) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= TRIES || !error || !error.leafRetry) throw error;
    }
  }
}

/**
 * Fetch, and hand the answer's stream to `use` before the attempt is over — so a body that stalls halfway is retried from the start rather than half-read.
 *
 * A body that goes quiet inside `use` is a dead wait and retries; anything else `use` throws is the caller reading an answer that did arrive, and is never retried — an HTTP status the server really sent is a decision, not a stall.
 */
export function fetchWatchedStream(url, use, options = {}) {
  return retrying(async () => use(watchBody(await head(url, options), url)));
}

/**
 * Fetch and read the whole answer under the deadline: `{ ok, status, headers, bytes(), text(), json() }`, which is what every page fetch here wanted from a `Response` anyway.
 *
 * `bytes()` hands out the array already read rather than fetching again — a Word, Excel, PowerPoint or OpenDocument file is a zip, and decoding one to text loses it. The decode stays for the callers that want words.
 *
 * Whole rather than streamed because the retry has to cover the body: a document read halfway and then stalled is the same blank page as one that never started.
 */
export function fetchWatched(url, options = {}) {
  return fetchWatchedStream(
    url,
    async (response) => {
      const buffer = response.body ? await response.arrayBuffer() : await raceSilence(response.arrayBuffer(), url);
      const bytes = new Uint8Array(buffer);
      const text = () => decoder.decode(bytes);
      return { ok: response.ok, status: response.status, headers: response.headers, bytes: async () => bytes, text: async () => text(), json: async () => JSON.parse(text()) };
    },
    options,
  );
}
