// The page's own errors, on their way to the app's log file.
//
// First in the load order, and it has to be: a fragment that throws while loading is the failure with no other trace, and only a handler already installed sees it. Being first buys nothing against a *parse* error — that kills the whole script, this fragment with it — which is what check-shell.mjs is for.
//
// It cannot use `send` from dom.js: that is a const in its dead zone until dom.js runs, so a throw during load would throw again on the way to reporting itself. window.ipc is injected by the web view before any of our script runs.

// How many times each message has been seen, so a console.error inside a render loop does not fill the log file in seconds.
const journalCounts = new Map();
// Distinct messages tracked before the map is emptied and counting restarts.
const JOURNAL_DISTINCT_LIMIT = 200;

// Report the 1st, 2nd, 4th, 8th … time a message is seen, carrying the count. A loop firing ten thousand times costs fourteen lines instead of ten thousand, and every line still says how bad it got — with no timer to get wrong.
const journalIsWorthSending = (count) => (count & (count - 1)) === 0;

const journalReport = (text) => {
  try {
    if (!text) return;
    if (journalCounts.size > JOURNAL_DISTINCT_LIMIT) journalCounts.clear();
    const count = (journalCounts.get(text) || 0) + 1;
    journalCounts.set(text, count);
    if (!journalIsWorthSending(count)) return;
    window.ipc.postMessage(JSON.stringify({ command: 'logError', message: text, count }));
  } catch (_ignored) {
    // Instrumentation never gets to be the thing that breaks the page.
  }
};

// What was thrown, with its stack where there is one — the stack is most of the value, since without it a page error names a symptom and no place. Duck-typed rather than `instanceof Error`, which is false for an error thrown by a runtime loaded into its own scope.
const journalDescribe = (value) => {
  if (value && typeof value.stack === 'string') return value.stack;
  if (value && typeof value.message === 'string') return value.message;
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch (_circular) {
    return String(value);
  }
};

window.onerror = (message, source, line, column, error) => {
  const place = source ? ` (${source}:${line}:${column})` : '';
  journalReport(`${error ? journalDescribe(error) : message}${place}`);
  // Falsy: the web view still logs it to its own console.
  return false;
};

window.addEventListener('unhandledrejection', (event) => {
  journalReport(`unhandled rejection: ${journalDescribe(event && event.reason)}`);
});

const journalConsoleError = console.error.bind(console);
console.error = (...args) => {
  journalReport(args.map(journalDescribe).join(' '));
  journalConsoleError(...args);
};
