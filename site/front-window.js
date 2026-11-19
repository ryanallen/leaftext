// front-window.js
// ---------------------------------------------------------------------------
// Try the app on leaftext.com, on the owner's word of 18 November 2026, 8:01pm: a smaller window over the marketing page that loads in the way the app starts, where the visitor picks files and each opens in a tab, beside an agent that is plainly a scripted demo.
//
// Every tab is the real app: the site's own page for that file in a frame of its own, so what the visitor reads, scrolls, edits and turns to Source or Graph is Leaftext's renderer and not a picture of it. The page inside wears `front-windowed`, under which `front-page.css` takes off its own bar, pane and starting card, so the one window chrome is this one; the theme bootstrap reads the family and mode of the page around it off `data-app-window` on the frame. Tabs switched away from stay alive, so going back is instant and keeps the place.
//
// The agent is a script and says so three times — a Demo badge, a standing note and its input's placeholder — because nothing about it may pass for a real agent: no AI runs, nothing typed leaves the page.
//
// A page without scripts never reaches this file, and its Try the app links go on to the quickstart.
// ---------------------------------------------------------------------------

/** What the frame says to the page inside it, read by `src/assets/theme-bootstrap.js`. */
export const APP_WINDOW_ATTRIBUTE = 'data-app-window';

/** The class the page inside a tab wears: its own chrome off, the window's chrome around it. */
export const WINDOWED_CLASS = 'front-windowed';

/** The demo folder the files pane lists, in the order it lists them. Markdown has a published page of its own; anything else is the site's root with its path after `#`, the address the site host reads (`web/preview/host.js` `addressFor`). */
export const DEMO_FILES = [
  { path: 'docs/03-quickstart.md', kind: 'Markdown' },
  { path: 'docs/08-examples/le-morte-darthur/le-morte-darthur.epub', kind: 'Book' },
  { path: 'docs/01-features/08-relational-tables.md', kind: 'Markdown' },
  { path: 'docs/01-features/04-minimap.md', kind: 'Markdown' },
  { path: 'docs/01-features/10-agents.md', kind: 'Markdown' },
  { path: 'docs/05-compare.md', kind: 'Markdown' },
  { path: 'docs/GLOSSARY.md', kind: 'Markdown' },
];

const BOOK = DEMO_FILES[1].path;

/** No drawn page for this long and the window says so, by the site's rule that nothing waits without a deadline. */
const DEADLINE_MS = 10000;

/** What the demo agent answers, first match wins; a reply naming a file opens it. Nothing here is an AI. */
const REPLIES = [
  { match: /book|morte|arthur|epub|read/i, say: 'Opening Le Morte d’Arthur in a new tab. It is an EPUB — Leaftext reads books as well as notes, in the same window.', open: BOOK },
  { match: /table|relation|row/i, say: 'Here are relational tables: rows in one file that link to rows in another. Opening the page in a tab.', open: 'docs/01-features/08-relational-tables.md' },
  { match: /minimap|map|scroll|jump/i, say: 'The minimap is the real page drawn small down the side — drag it to move. Opening the page about it.', open: 'docs/01-features/04-minimap.md' },
  { match: /compare|obsidian|notion|typora|versus|\bvs\b/i, say: 'Here is how Leaftext compares, feature by feature.', open: 'docs/05-compare.md' },
  { match: /agent|claude|codex|antigravity|\bai\b|what can/i, say: 'In the real app, Claude Code, Codex and Antigravity run in consoles like this one, beside your files: they read what you read, and open, edit and check documents with you. I am only a script, so here is the page about the real thing.', open: 'docs/01-features/10-agents.md' },
  { match: /download|install|get it|mac|windows/i, say: 'Close this window and press Download — free, for Windows and macOS. A real agent can sit right here then.' },
  { match: /^\s*(hi|hello|hey|yo)\b/i, say: 'Hello! I am the demo agent — a script, not an AI. Try “open the book” or “show me a table”.' },
];

const FALLBACK = 'I am a scripted demo, so I cannot really answer that — no AI is running here. Download Leaftext to talk to a real agent beside your files. Meanwhile, try “open the book” or “show me a table”.';
const GREETING = 'Hi — I am a pretend agent, here to show where a real one sits. Pick a file on the left, or ask me to open something.';
const ASKS = ['Open the book', 'Show me a table', 'What can agents do?'];

/** The file name a tab is called by. */
function nameOf(path) {
  return path.split('/').pop();
}

/** Where a file's page is, from the site's root. */
function addressOf(path, root) {
  return /\.md$/i.test(path) ? new URL(path.replace(/\.md$/i, '.html'), root).href : `${new URL('./', root).href}#${path}`;
}

/** Which file a page inside a tab is showing now, read off its address, so a link followed inside renames the tab. */
function pathAt(view, root) {
  let url;
  try {
    url = new URL(view.location.href);
  } catch {
    return '';
  }
  const hash = decodeURIComponent(url.hash.replace(/^#/, ''));
  const base = new URL('./', root).pathname;
  const page = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname.replace(/^\//, '');
  if (!page && hash && !hash.startsWith('try')) return hash.split('#')[0];
  if (!page) return 'README.md';
  return page.replace(/\.html$/i, '.md');
}

function element(tag, className, text) {
  const made = document.createElement(tag);
  if (className) made.className = className;
  if (text) made.textContent = text;
  return made;
}

function icon(name) {
  const mark = element('span', `lt-icon lt-icon-${name}`);
  mark.setAttribute('aria-hidden', 'true');
  return mark;
}

function iconButton(className, name, label) {
  const button = element('button', className);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.appendChild(icon(name));
  return button;
}

/** A duration from the stylesheet's tokens, so the window moves at the app's own pace. */
function duration(token, fallback) {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token));
  return Number.isFinite(value) ? value : fallback;
}

let shown = null;

/** Build the window once, the first time it is asked for. */
function buildWindow(root, marketing) {
  const scrim = element('div', 'front-window-scrim');
  const win = element('section', 'front-window');
  win.setAttribute('role', 'dialog');
  win.setAttribute('aria-modal', 'true');
  win.setAttribute('aria-label', 'Leaftext, running in your browser');
  win.tabIndex = -1;

  const bar = element('header', 'front-window-bar');
  const brand = element('span', 'front-window-brand');
  brand.append(icon('leaf'), document.createTextNode('leaftext'));
  const tabs = element('div', 'front-window-tabs');
  tabs.setAttribute('role', 'tablist');
  const add = iconButton('front-window-new', 'new', 'Open a file');
  const close = iconButton('front-window-close', 'window-close', 'Close the demo');
  bar.append(brand, tabs, add, close);

  const body = element('div', 'front-window-body');
  const rail = element('nav', 'front-window-rail');
  rail.setAttribute('aria-label', 'Panes');
  const filesButton = iconButton('front-window-rail-button', 'folder', 'Files');
  const agentButton = iconButton('front-window-rail-button', 'comment', 'Demo agent');
  rail.append(filesButton, agentButton);

  const files = element('aside', 'front-window-files');
  files.setAttribute('aria-label', 'Files');
  files.appendChild(element('p', 'front-window-folder', 'leaftext-demo'));
  const list = element('ul', 'front-window-list');
  const fileButtons = new Map();
  for (const file of DEMO_FILES) {
    const item = element('li');
    const pick = element('button', 'front-window-file');
    pick.type = 'button';
    pick.title = `${nameOf(file.path)} — ${file.kind}`;
    pick.append(icon(file.kind === 'Book' ? 'library' : 'document'), element('span', 'front-window-file-name', nameOf(file.path)), element('small', 'front-window-file-kind', file.kind === 'Book' ? 'Book' : 'md'));
    item.appendChild(pick);
    list.appendChild(item);
    fileButtons.set(file.path, pick);
  }
  files.appendChild(list);

  const agent = element('aside', 'front-window-agent');
  agent.setAttribute('aria-label', 'Demo agent');
  const agentHead = element('p', 'front-window-agent-head');
  agentHead.append(icon('wand'), element('span', 'front-window-agent-name', 'Demo agent'), element('span', 'front-window-demo', 'Demo'));
  const note = element('p', 'front-window-note', 'A scripted demo, not a real agent: no AI is running, and nothing you type leaves this page. In the app, Claude Code, Codex or Antigravity sit here.');
  const chat = element('ol', 'front-window-chat');
  chat.setAttribute('aria-live', 'polite');
  const asks = element('p', 'front-window-asks');
  for (const words of ASKS) {
    const ask = element('button', 'front-window-ask', words);
    ask.type = 'button';
    asks.appendChild(ask);
  }
  const say = element('form', 'front-window-say');
  const input = element('input', 'front-window-input');
  input.type = 'text';
  input.placeholder = 'Message the demo agent (scripted)';
  input.setAttribute('aria-label', 'Message the demo agent, which is a script');
  const send = iconButton('front-window-send', 'forward-long', 'Send');
  send.type = 'submit';
  say.append(input, send);
  agent.append(agentHead, note, chat, asks, say);

  const pages = element('div', 'front-window-pages');
  const launch = element('div', 'front-window-launch');
  launch.appendChild(icon('leaf'));
  const failed = element('p', 'front-window-failed');
  pages.append(launch, failed);

  body.append(rail, files, agent, pages);
  win.append(bar, body);
  scrim.appendChild(win);
  document.body.appendChild(scrim);

  const open = new Map();
  let active = '';
  let opener = null;
  let watch = 0;

  const narrow = () => matchMedia('(max-width: 720px)').matches;
  const showPane = (pane, button, on) => {
    pane.classList.toggle('is-shown', on);
    button.classList.toggle('is-on', on);
    button.setAttribute('aria-pressed', String(on));
  };
  const showFiles = (on) => {
    showPane(files, filesButton, on);
    if (on && narrow()) showPane(agent, agentButton, false);
  };
  const showAgent = (on) => {
    showPane(agent, agentButton, on);
    if (on && narrow()) showPane(files, filesButton, false);
  };

  const fail = () => {
    failed.replaceChildren(document.createTextNode('This page did not start in the window. '), Object.assign(element('a', '', 'Open it as a page'), { href: open.get(active)?.address || '' }));
    failed.classList.add('is-shown');
    launch.classList.remove('is-shown');
  };

  const select = (path) => {
    active = path;
    for (const [key, tab] of open) {
      const on = key === path;
      tab.tab.classList.toggle('is-on', on);
      tab.tab.setAttribute('aria-selected', String(on));
      tab.frame.classList.toggle('is-on', on);
    }
    for (const [key, pick] of fileButtons) pick.classList.toggle('is-on', key === path);
    const tab = open.get(path);
    failed.classList.remove('is-shown');
    launch.classList.toggle('is-shown', Boolean(tab && !tab.ready));
    if (narrow()) {
      showFiles(false);
      showAgent(false);
    }
  };

  /** Watch a frame until its page is drawn: dress it the moment it has a body, show it once its document is in. */
  const dress = (tab) => {
    const started = performance.now();
    const look = () => {
      if (!open.has(tab.path)) return;
      let doc = null;
      try {
        doc = tab.frame.contentDocument;
      } catch {
        doc = null;
      }
      const body = doc && doc.body;
      if (body && doc.location.href !== 'about:blank') {
        body.classList.add(WINDOWED_CLASS);
        const drawn = doc.querySelector('.reader-column .document-body:not(.front-layout)');
        // A file with no page of its own opens over the site's root, whose first response is the marketing page; once the file is drawn in its place, the app's own layout comes back.
        if (drawn && marketing) body.classList.remove(marketing);
        if (drawn && drawn.textContent.trim()) {
          tab.ready = true;
          tab.frame.classList.add('is-ready');
          if (active === tab.path) launch.classList.remove('is-shown');
          return;
        }
      }
      if (performance.now() - started > DEADLINE_MS) {
        if (active === tab.path) fail();
        return;
      }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  };

  const openFile = (path) => {
    if (open.has(path)) {
      select(path);
      return;
    }
    const address = addressOf(path, root);
    const tab = element('div', 'front-window-tab');
    tab.setAttribute('role', 'tab');
    const name = element('button', 'front-window-tab-name', nameOf(path));
    name.type = 'button';
    const shut = iconButton('front-window-tab-close', 'tab-close', `Close ${nameOf(path)}`);
    tab.append(name, shut);
    tabs.appendChild(tab);
    const frame = element('iframe', 'front-window-page');
    frame.setAttribute(APP_WINDOW_ATTRIBUTE, '');
    frame.title = nameOf(path);
    frame.src = address;
    pages.insertBefore(frame, launch);
    const record = { path, address, tab, name, frame, ready: false, shown: path };
    open.set(path, record);
    name.addEventListener('click', () => select(record.path));
    shut.addEventListener('click', () => closeTab(record.path));
    select(path);
    dress(record);
    tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const closeTab = (path) => {
    const tab = open.get(path);
    if (!tab) return;
    const keys = [...open.keys()];
    const at = keys.indexOf(path);
    tab.tab.remove();
    tab.frame.remove();
    open.delete(path);
    if (active !== path) return;
    const next = keys[at + 1] || keys[at - 1];
    if (next) select(next);
    else {
      active = '';
      launch.classList.remove('is-shown');
      showFiles(true);
    }
  };

  /** A link followed inside a tab: the tab takes the name of the file it now shows. */
  const follow = () => {
    for (const tab of open.values()) {
      if (!tab.ready) continue;
      let now = '';
      try {
        now = pathAt(tab.frame.contentWindow, root);
      } catch {
        now = '';
      }
      if (!now || now === tab.shown) continue;
      tab.shown = now;
      tab.name.textContent = nameOf(now);
      tab.frame.title = nameOf(now);
    }
  };

  const addLine = (who, words) => {
    const line = element('li', `front-window-said front-window-said-${who}`);
    line.textContent = words;
    chat.appendChild(line);
    chat.scrollTop = chat.scrollHeight;
    return line;
  };

  let busy = false;
  const reply = (asked) => {
    if (busy || !asked.trim()) return;
    busy = true;
    addLine('you', asked.trim());
    const answer = REPLIES.find((one) => one.match.test(asked)) || { say: FALLBACK };
    const line = addLine('agent', '');
    line.classList.add('is-typing');
    const words = answer.say.split(' ');
    setTimeout(() => {
      line.classList.remove('is-typing');
      let at = 0;
      const step = setInterval(() => {
        at += 1;
        line.textContent = words.slice(0, at).join(' ');
        chat.scrollTop = chat.scrollHeight;
        if (at < words.length) return;
        clearInterval(step);
        busy = false;
        if (answer.open) openFile(answer.open);
      }, 35);
    }, 650);
  };

  const keys = (event) => {
    if (event.key === 'Escape') hide();
  };

  const show = (from) => {
    opener = from || null;
    scrim.classList.add('is-open');
    showFiles(!narrow());
    showAgent(innerWidth >= 1100);
    if (!chat.childElementCount) addLine('agent', GREETING);
    if (!open.size) openFile(DEMO_FILES[0].path);
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!still && from && typeof win.animate === 'function') {
      const start = from.getBoundingClientRect();
      const end = win.getBoundingClientRect();
      const dx = start.left + start.width / 2 - (end.left + end.width / 2);
      const dy = start.top + start.height / 2 - (end.top + end.height / 2);
      const scale = Math.max(0.08, start.width / end.width);
      win.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: duration('--lt-duration-400', 400), easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
      scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: duration('--lt-duration-300', 300), easing: 'ease-out' });
    }
    addEventListener('keydown', keys);
    clearInterval(watch);
    watch = setInterval(follow, 500);
    win.focus({ preventScroll: true });
  };

  const hide = () => {
    scrim.classList.remove('is-open');
    removeEventListener('keydown', keys);
    clearInterval(watch);
    if (opener) opener.focus({ preventScroll: true });
  };

  close.addEventListener('click', hide);
  scrim.addEventListener('click', (event) => {
    if (event.target === scrim) hide();
  });
  add.addEventListener('click', () => showFiles(true));
  filesButton.addEventListener('click', () => showFiles(!files.classList.contains('is-shown')));
  agentButton.addEventListener('click', () => showAgent(!agent.classList.contains('is-shown')));
  for (const [path, pick] of fileButtons) pick.addEventListener('click', () => openFile(path));
  for (const ask of asks.querySelectorAll('button')) ask.addEventListener('click', () => reply(ask.textContent));
  say.addEventListener('submit', (event) => {
    event.preventDefault();
    const words = input.value;
    input.value = '';
    reply(words);
  });

  return { show, hide, openFile, scrim, open };
}

/**
 * Turn every Try the app link inside `root` — the landing's laid-out page — into the window's opener, and answer how to stop. The press is caught on the way down, ahead of the host's own link handling, so the host never takes the visitor to the page; a press with a modifier, or a middle press, still goes there.
 */
export function installAppWindow(root, { marketing = '', selector = 'a[data-app-window]' } = {}) {
  if (!root || typeof root.contains !== 'function' || typeof addEventListener !== 'function' || typeof document === 'undefined') return () => {};
  const press = (event) => {
    const link = event.target && typeof event.target.closest === 'function' ? event.target.closest(selector) : null;
    if (!link || !root.contains(link) || link.closest('.document-minimap, .document-minimap-preview')) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (!shown) shown = buildWindow(new URL(window.__leafSiteRoot || '/', location.href).href, marketing);
    shown.show(link);
  };
  addEventListener('click', press, true);
  return () => removeEventListener('click', press, true);
}

/** The window as it stands, for the checks and the driver: open or not, and the tabs it holds. */
export function appWindowState() {
  if (!shown) return { built: false, open: false, tabs: [] };
  return { built: true, open: shown.scrim.classList.contains('is-open'), tabs: [...shown.open.values()].map((tab) => ({ path: tab.shown, ready: tab.ready })) };
}
