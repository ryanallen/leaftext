// codeblocks.js
// ---------------------------------------------------------------------------
// Shared code-block enhancement for both readers — the root README reader
// (reader.js) and the /docs SPA (docs.js). Two things, matching the desktop
// app: syntax highlighting via the vendored highlight.js, and a "copy all"
// button on every fenced block. Both readers import this so they can never
// drift apart (the docs page once shipped without highlighting or copy because
// this logic lived only in reader.js).
//
// markdown.js renders a languaged fence as
//   <pre class="highlight" data-language="…"><code class="language-…">…</code></pre>
// The token colors (.hljs-*) and the .code-copy button are styled in
// site/styles.css, which both pages load.
// ---------------------------------------------------------------------------

// Load highlight.js once per page, keyed by src (the two pages reach the
// vendored file by different relative paths).
const scriptPromises = new Map();
function loadScript(src) {
  if (!scriptPromises.has(src)) {
    scriptPromises.set(
      src,
      new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = src;
        el.onload = () => resolve();
        el.onerror = () => reject(new Error('Failed to load ' + src));
        document.head.appendChild(el);
      })
    );
  }
  return scriptPromises.get(src);
}

// Colorize fenced code blocks inside `container`. highlight.js reads the
// language-<lang> class markdown.js puts on the <code>, tokenizes, and wraps
// tokens in <span class="hljs-…">. Mermaid fences are <pre class="mermaid">
// with no inner <code>, so they're left alone. Unknown languages are skipped
// quietly, leaving plain (already-escaped) code text. `hljsSrc` is the path to
// the vendored runtime, relative to the calling page.
export async function highlightCode(container, hljsSrc) {
  const nodes = Array.from(container.querySelectorAll('pre code[class*="language-"]'));
  if (!nodes.length) return;
  try {
    if (!window.hljs) await loadScript(hljsSrc);
    nodes.forEach((el) => {
      const lang = (el.className.match(/language-([\w-]+)/) || [])[1];
      if (!lang) return;
      const def = window.hljs.getLanguage(lang);
      // Only highlight languages the bundle actually knows; otherwise hljs would
      // guess (often wrong) and the code reads better plain.
      if (!def) return;
      window.hljs.highlightElement(el);
      // Upgrade the language label (set by markdown.js to the raw fence token) to
      // highlight.js's display name, e.g. "sh" -> "Bash", "md" -> "Markdown". The
      // name can carry aliases ("TOML, also INI"); keep just the primary name.
      const pre = el.closest('pre');
      if (pre && def.name) pre.dataset.language = def.name.split(',')[0].trim();
    });
  } catch (err) {
    // Leave the code as plain (already-escaped) text if the runtime can't load.
    console.error('highlight.js failed to load:', err);
  }
}

// Give every fenced code block (but not Mermaid diagrams) a "copy all" button,
// matching the desktop app. The button copies the code verbatim; code.textContent
// is the raw source whether or not highlight.js has wrapped it in token spans.
const CODE_COPY_ICON =
  '<svg class="code-copy-mark code-copy-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75"/></svg><svg class="code-copy-mark code-copy-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>';

export function decorateCodeBlocks(container) {
  container.querySelectorAll('pre:not(.mermaid)').forEach((pre) => {
    if (pre.querySelector(':scope > .code-copy')) return;
    const code = pre.querySelector('code');
    if (!code) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy';
    button.innerHTML = CODE_COPY_ICON;
    button.setAttribute('aria-label', 'Copy code');
    button.title = 'Copy code';
    button.addEventListener('click', () => copyCodeBlock(button, code.textContent || ''));
    pre.appendChild(button);
  });
}

// Copy via the async clipboard API, falling back to a hidden textarea +
// execCommand where the async API is unavailable (e.g. non-secure contexts).
function copyCodeBlock(button, text) {
  const ok = () => flashCodeCopied(button);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(ok, () => {
      if (legacyCopy(text)) ok();
    });
  } else if (legacyCopy(text)) {
    ok();
  }
}

function legacyCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('aria-hidden', 'true');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch (error) {
    copied = false;
  }
  document.body.removeChild(area);
  return copied;
}

// Briefly swap to a check mark after a successful copy, then revert.
function flashCodeCopied(button) {
  button.classList.add('is-copied');
  button.setAttribute('aria-label', 'Copied');
  button.title = 'Copied';
  window.clearTimeout(button.__copiedTimer);
  button.__copiedTimer = window.setTimeout(() => {
    button.classList.remove('is-copied');
    button.setAttribute('aria-label', 'Copy code');
    button.title = 'Copy code';
  }, 1400);
}
