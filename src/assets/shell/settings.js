let currentState = { recent: [], favorites: [], tabs: [], active: null, document: null };
let navigationState = { canGoBack: false, canGoForward: false };
// The home screen's three rotating slots — headline, subtitle, sentence — in one registry. A family owns all three for a visit, so the screen reads as one voice rather than three lines drawn separately. A line may claim only what the docs publish: no account, no cloud, no telemetry, plain files on the reader's own device that any other app can open.
const HOME_MESSAGE_FAMILIES = [
  {
    name: 'leaf',
    hero: 'Turn over a new leaf.',
    subtitle: 'Knowledge kept, leaf by leaf.',
    descriptions: [
      'For two thousand years knowledge was incised on palm leaves — talipot and palmyra, dried and smoke-cured. Turn over a new one.',
      'Scribes cut letters into palm leaves with a stylus, then rubbed in soot so the words rose to the surface. Read on.',
      'A palm-leaf book was threaded through a single hole and bound between wooden covers. Open yours.',
      'A palm leaf holds its text for a few decades — six hundred years at most — so temples recopied the old ones before they wore away.',
      'The round letters of Devanagari, Kannada, and Telugu curved that way so sharp strokes would not tear the leaf.',
      'In Indonesia these leaf-books were called lontar, from the old words for “leaf” and “palmyra palm.”',
      'The oldest palm-leaf manuscripts survived in cold, dry places — Nepal, Tibet, the high passes of central Asia.',
      'In Bali, Brahmin scribes still rewrite the sacred texts onto palm leaves by hand.',
      'The printing press ended the long cycle of copying palm leaf to palm leaf in the early 1800s.',
    ],
  },
  {
    name: 'clear-thinking',
    hero: 'Refine your mind.',
    subtitle: 'Your thoughts, secure and free.',
    descriptions: [
      'Give one thought the whole page.',
      'A quiet place for clear thinking.',
      'Follow a thread without the noise.',
    ],
  },
  {
    name: 'files',
    hero: 'Your files stay files.',
    subtitle: 'Open what you already own.',
    descriptions: [
      'Open a file and read it in peace. It stays on your device, in plain text you own.',
      'The page is yours; the app is the window.',
      'Plain Markdown, XML, JSON, and YAML — files any other app can open, so you are never locked in.',
    ],
  },
];
// Which family the window showed last, so the next visit picks among the others. Only within one run: across launches the pick is plain random, because remembering it would be a preference nobody asked for.
let lastHomeFamilyName = null;
function pickHomeMessage() {
  const choices = HOME_MESSAGE_FAMILIES.filter((family) => family.name !== lastHomeFamilyName);
  const family = choices[Math.floor(Math.random() * choices.length)];
  lastHomeFamilyName = family.name;
  return {
    family: family.name,
    hero: family.hero,
    subtitle: family.subtitle,
    description: family.descriptions[Math.floor(Math.random() * family.descriptions.length)],
  };
}
// Kept between renders so a re-render redraws the same message rather than re-rolling it under the reader.
let homeMessage = pickHomeMessage();
// UI toggles are persisted by the host, injected as window.__leafSettings before any page script (the app shell's opaque origin can't use localStorage). We seed from them synchronously here and report every change back so it can save them.
const LEAF_SETTINGS = (window.__leafSettings && typeof window.__leafSettings === 'object') ? window.__leafSettings : {};
// The reader's own operating system already answers whether scrollbars always show, so the app asks nobody: the host reads it at launch and injects it as window.__leafScrollbarsAlways. Never one of the switches above — a copy of somebody else's answer in settings.json goes stale the moment they change their mind. The flag rides the surface, where one stylesheet rule pins every bar in the app painted. A published page and an exported one carry no injected globals at all, so both stay as they are.
if (window.__leafScrollbarsAlways === true) {
  appSurface.classList.add('is-scrollbars-always');
}
// The minimap is not a choice any more, so this only ever holds true. It stays a switch because the rail still comes and goes with the document, and everything that draws it asks here.
let minimapEnabled = true;
const minimapListeners = new Set();
window.leafMinimap = {
  getEnabled: () => minimapEnabled,
  setEnabled(nextEnabled) {
    minimapEnabled = Boolean(nextEnabled);
    document.documentElement.dataset.minimapEnabled = String(minimapEnabled);
    minimapListeners.forEach((listener) => listener(minimapEnabled));
  },
  subscribe(listener) {
    minimapListeners.add(listener);
    listener(minimapEnabled);
    return () => minimapListeners.delete(listener);
  },
};
window.leafMinimap.setEnabled(minimapEnabled);
