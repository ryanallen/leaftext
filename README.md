# Refine your mind.
## Your thoughts, secure and free.

Leaf Text is a free desktop app for reading and writing your own documents. Everything stays on your device, in plain files you own.

![Leaf Text — a readable Markdown and XML document open in the app](imgs/leaftext.png)

<a href="https://github.com/ryanallen/leaftext/releases/latest"><img alt="Download" src="https://img.shields.io/badge/download-latest-0ea5e9?style=flat&labelColor=4b5563"></a>
<a href="https://github.com/ryanallen/leaftext/releases/latest"><img alt="macOS" src="https://img.shields.io/badge/macOS-Universal-silver?style=flat&labelColor=4b5563"></a>
<a href="https://github.com/ryanallen/leaftext/releases/latest"><img alt="Windows" src="https://img.shields.io/badge/Windows-x64-0078d4?style=flat&labelColor=4b5563"></a>

**[Download it →](https://github.com/ryanallen/leaftext/releases/latest)** · **[How to install it →](docs/02-installation.md#install)** · **[Mac won't open it? →](docs/02-installation.md#mac-blocks-the-first-launch)**

> **Read this if you're on a Mac.** macOS refuses the first launch of any app Apple hasn't been paid to vouch for, and Leaf Text is free, so it hasn't. Nothing was scanned and nothing was found. Let it through once — **System Settings → Privacy & Security → Open Anyway** — and it opens normally from then on. [The four clicks, spelled out →](docs/02-installation.md#mac-blocks-the-first-launch)

**[Get started →](docs/03-quickstart.md)** · **[Read the docs →](docs/)** · **[View the project on GitHub →](https://github.com/ryanallen/leaftext)**

---

Your notes deserve better than a text editor. Open a file in Leaf Text and it becomes a page you actually want to read — quiet, well set, and easy to move through. Click into a sentence and you can write. Nothing saves until you say so.

There's no account and no sign-up. Your files never leave your computer, and they stay [Markdown](docs/01-features/01-rendering.md), [XML](docs/01-features/01-rendering.md#xml), [JSON, and YAML](docs/01-features/01-rendering.md#data-files-json-and-yaml) — and even [saved emails](docs/01-features/01-rendering.md#email-eml) — formats every other app can read, so you're never locked in.

Free, on macOS and Windows.

## What you can do

### Read without the noise

![Leaf Text reading view rendering a Markdown document](imgs/rendering.png)

Open a `.md` file and it renders the way you'd expect — the same way GitHub does, with the extras people actually use: [highlighted code](docs/01-features/01-rendering.md#code), [diagrams](docs/01-features/01-rendering.md#mermaid-diagrams), [math](docs/01-features/01-rendering.md#math), [callouts](docs/01-features/01-rendering.md#blockquotes-and-alerts), [footnotes](docs/01-features/01-rendering.md#footnotes), [emoji](docs/01-features/01-rendering.md#emoji), task lists, and [your own images](docs/01-features/01-rendering.md#images).

[XML opens too](docs/01-features/01-rendering.md#xml). A sitemap, a feed, a config file — [any XML](docs/01-features/01-rendering.md#any-xml) reads as sections, fields, and tables instead of tags. And [84000-style TEI](docs/01-features/01-rendering.md#tei-xml-84000-translations), the format the Buddhist canon is translated into, gets a reader that understands its conventions.

[JSON and YAML open too](docs/01-features/01-rendering.md#data-files-json-and-yaml), read by the same shape rules — a lock file, a CI workflow, or a Kubernetes manifest as headed sections, aligned fields, and record tables instead of punctuation. And a [saved email](docs/01-features/01-rendering.md#email-eml) — an `.eml` from Gmail or Outlook — opens as the message it carries: headers, body, inline images, attachments. **[Rendering →](docs/01-features/01-rendering.md)**

### Write where you read

![Inline editing in the rendered page, with save and undo button](imgs/editing.png)
![Editing in code view, with save and undo button](imgs/code-view.png)

Click into a sentence and type. Split a paragraph with `Enter`, join it back with `Backspace`, tick a checkbox — the change lands in your file at exactly that spot, and [undo](docs/01-features/07-editing.md#undo) walks back step by step. Highlight words for a [format bar](docs/01-features/07-editing.md#the-format-bar), or reach into the left margin to [drag a block](docs/01-features/07-editing.md#the-block-gutter) or [add one](docs/01-features/07-editing.md#adding-a-block).

Prefer the raw text? Drop into [code view](docs/01-features/07-editing.md#code-view) for the file's actual source — Markdown, XML, JSON, YAML, or a raw email — colored like an editor. There's no autosave, ever: nothing touches your file until you press **Save**. **[Editing →](docs/01-features/07-editing.md)**

### Find anything you've written

![The library pane with the document graph view](imgs/graph.png)

A side pane that knows every Markdown file you own. [Search the words inside them](docs/01-features/03-library.md#search), or walk your folders with a [breadcrumb](docs/01-features/03-library.md#project) that always says where you are. The index is a plain SQLite file on your own disk — nothing is uploaded to search it. **[Library →](docs/01-features/03-library.md)**

### See how your ideas connect

The [graph view](docs/01-features/03-library.md#graph) maps the links between your documents, so you can see the shape of what you've written instead of scrolling a list. Notes you'd forgotten turn out to be next door to the one you're reading. **[Graph →](docs/01-features/03-library.md#graph)**

### Never lose your place

![Tabs and Back/Forward history in the app bar](imgs/navigation.png)

It moves like a browser: [tabs](docs/01-features/02-navigation.md#tabs), Back and Forward through your [history](docs/01-features/02-navigation.md#history), an [outline](docs/01-features/02-navigation.md#outline) at the top of every document, and a Previous/Next [pager](docs/01-features/05-settings.md#pager) that reads a folder in order. Change a file in another app and Leaf Text [picks it up](docs/01-features/02-navigation.md#reload) without losing your spot. **[Navigation →](docs/01-features/02-navigation.md)**

### Take in the whole page at once

![The minimap rail showing a scaled clone of the document](imgs/minimap.png)

A tiny version of your document runs down the side — real text, not abstract bars — with a marker showing where you are. You'll recognize a section by its shape. Click to jump, or drag to scroll. **[Minimap →](docs/01-features/04-minimap.md)**

### Point at any line

![Block permalink numbers in the left-margin gutter](imgs/permalink.png)

Every block — heading, paragraph, list item, table, code fence — has a stable address in the margin. Click it to copy a link that lands on that exact spot, in the app and on the web. Turn the numbers off if you'd rather not see them. **[Rendering →](docs/01-features/01-rendering.md)**

### Read faster when you need to

![Speed Reader dimming prose and adding bold lead anchors](imgs/speedreader.png)

Turn on Speed Reader and the page dims back while bold anchors mark the start of each word. Your eye follows the path down instead of hunting for it. **[Speed Reader →](docs/01-features/05-settings.md#speed-reader)**

### Make it look like yours

![Amaranth theme](imgs/themes/themes.png)

Eleven themes — [Amaranth, Arabica, Bloodleaf, Fern, Ginger, GitHub, Goldenrod, Halcyon, Nightshade, Pippin, and Sage](docs/01-features/06-themes.md#families) — each in light and dark, plus System and Daylight if you'd rather the app follow the time of day. Everything moves together: text, code, callouts, minimap. Each theme's font is fetched from Google Fonts the first time you choose it. **[Themes →](docs/01-features/06-themes.md)**

### Your thoughts stay yours

No account. No cloud. No telemetry. Nothing you open, write, or search ever leaves your machine.

The app touches the network exactly twice, and neither one carries your words: it asks GitHub whether a newer version exists, and it fetches a theme's font from Google Fonts the first time you pick that theme.

Your [settings](docs/01-features/05-settings.md) are a JSON file on your machine, and your documents are the files you already had. Delete Leaf Text tomorrow and every word you wrote is still sitting in the folder you put it in, readable by anything.

Updates download quietly in the background and are checked against a published digest, then wait for you to click **Restart to update**. Nothing installs on its own. **[Settings →](docs/01-features/05-settings.md#updates)**

## Get it

Leaf Text is free. **[Download the latest release](https://github.com/ryanallen/leaftext/releases/latest)**, then follow your platform below — or the fuller walkthrough in the **[Installation guide](docs/02-installation.md#install)**.

### macOS

1. Download the file ending in **`-macos-universal.dmg`**. One file covers Apple Silicon and Intel.
2. Open it. Drag the leaf app onto the **Applications** folder beside it.
3. Eject the disk image, then open **Leaf Text** from Applications.

**First launch — macOS will refuse it**

Expected. Apple charges a yearly fee to notarize an app; Leaf Text is free and isn't enrolled, so macOS blocks anything unnotarized on sight. Nothing was scanned and nothing was found. Let it through once:

1. Double-click **Leaf Text**, then click **Done** on the refusal.
2. Open **System Settings** → **Privacy & Security**.
3. Scroll to the bottom. Click **Open Anyway** on the line naming Leaf Text.
4. Confirm with Touch ID or your password, then click **Open**.

Every launch after that is an ordinary double-click. On macOS 12 and earlier it's shorter: right-click the app → **Open** → **Open**. If the **Open Anyway** button never appears, open Terminal and run `xattr -cr /Applications/leaftext.app` instead. **[More detail →](docs/02-installation.md#mac-blocks-the-first-launch)**

### Windows

Grab the 64-bit MSI and run it. If a blue **Windows protected your PC** box appears, click **More info** → **Run anyway** — the installer isn't signed with a paid certificate. It installs just for you, with no admin prompt. Here by default, though **Change...** puts it anywhere you like and updates keep it there:

```text
%LOCALAPPDATA%\Programs\leaftext\bin\leaftext.exe
```

Your library index and browser data live alongside it:

```text
%LOCALAPPDATA%\ryanallen\leaftext\data
```

Launch it from the Start Menu, or tap the Windows key and type **Leaf Text**. One Start Menu entry, no desktop shortcut.

> **Upgrading from v0.1.364 or earlier?** Uninstall the old version first, from **Settings → Apps**. Those installed machine-wide into `C:\Program Files`, and a per-user package can't remove one, so you'd end up with two copies.

## Learn it

New here? The **[Quickstart](docs/03-quickstart.md)** gets you reading in a couple of minutes. Then browse the **[full documentation](docs/01-introduction.md)**.

The pages are plain Markdown under [`docs/`](docs/) — the same format the app reads, so you can open them in Leaf Text itself.

---

## Development

See [Building](docs/02-development/02-building.md), [Architecture](docs/02-development/01-architecture.md), and [Releasing](docs/02-development/03-releasing.md) for the full developer docs.

Run the full verification suite before handing work back:

```sh
just verify
```

Other [`Justfile`](Justfile) tasks:

| Task | Command |
|:--|:--|
| Cut a release | `just release <version>` |

`just release` commits the version bump, tags, and pushes — CI builds the Windows MSI and the macOS DMG.
