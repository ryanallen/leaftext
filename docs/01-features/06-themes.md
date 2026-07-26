# Themes

> Make it look like yours. Pick a **family** (the palette) and an **appearance** (light or dark), and everything moves together — text, code, callouts, minimap — because every theme fills the same semantic token contract, checked when the theme CSS is compiled at launch. Each family's font is fetched from Google Fonts the first time you choose it, rather than bundled.

From the user side, themes are simple: open the theme picker, tap a family, pick an appearance, and the app updates immediately. Under the hood every family covers the full `--leaf-*` token set, and the active family's font is loaded from Google Fonts the moment you switch to it.

## Families

Pick a family in the theme picker. Ten ship, listed alphabetically, with **Fern** as the default. Each family is a plain Markdown file that opens with a screenshot of its own palette — browse them all in the [**themes gallery**](https://github.com/ryanallen/leaftext/blob/main/themes/README.md), which shows that preview plus a light-vs-dark swatch table per family, or open one below:

| Family | Palette |
| --- | --- |
| [Amaranth](https://github.com/ryanallen/leaftext/blob/main/themes/amaranth.md) | Clean light/dark base ramps with a violet accent |
| [Arabica](https://github.com/ryanallen/leaftext/blob/main/themes/arabica.md) | A coffee palette — creamy latte light, dark-roast espresso dark — with an AnuPpuccin mauve accent |
| [Fern](https://github.com/ryanallen/leaftext/blob/main/themes/fern.md) | **Default.** An Amaranth-based palette with a fern-green cast |
| [Ginger](https://github.com/ryanallen/leaftext/blob/main/themes/ginger.md) | A warm palette — cream light, cool slate dark — with a ginger-orange accent |
| [GitHub](https://github.com/ryanallen/leaftext/blob/main/themes/github.md) | GitHub's light/dark palette, in its own system-font stack |
| [Goldenrod](https://github.com/ryanallen/leaftext/blob/main/themes/goldenrod.md) | A stark black-and-gold palette — honey-on-white light, near-black dark — with a golden-yellow accent |
| [Halcyon](https://github.com/ryanallen/leaftext/blob/main/themes/halcyon.md) | A calm, clean palette with one blue accent and a cool blue-gray dark mode |
| [Nightshade](https://github.com/ryanallen/leaftext/blob/main/themes/nightshade.md) | The classic Dracula palette (light "Alucard" and dark) |
| [Pippin](https://github.com/ryanallen/leaftext/blob/main/themes/pippin.md) | A crisp, macOS-style palette — clean neutral greys with a system-blue accent |
| [Sage](https://github.com/ryanallen/leaftext/blob/main/themes/sage.md) | A neutral greyscale palette with a muted-blue (Minimal-style) accent |

An eleventh picker entry, **Random**, is a preference rather than a palette — see [Random](#random).

## Previews

Every family rendering the same reference document, split diagonally so the light variant sits above the dark one. These are the previews each family file carries at the top.

### Amaranth

![Amaranth — the same document in the light and dark variants](../../imgs/themes/amaranth.png)

### Arabica

![Arabica — the same document in the light and dark variants](../../imgs/themes/arabica.png)

### Fern

![Fern — the same document in the light and dark variants](../../imgs/themes/fern.png)

### Ginger

![Ginger — the same document in the light and dark variants](../../imgs/themes/ginger.png)

### GitHub

![GitHub — the same document in the light and dark variants](../../imgs/themes/github.png)

### Goldenrod

![Goldenrod — the same document in the light and dark variants](../../imgs/themes/goldenrod.png)

### Halcyon

![Halcyon — the same document in the light and dark variants](../../imgs/themes/halcyon.png)

### Nightshade

![Nightshade — the same document in the light and dark variants](../../imgs/themes/nightshade.png)

### Pippin

![Pippin — the same document in the light and dark variants](../../imgs/themes/pippin.png)

### Sage

![Sage — the same document in the light and dark variants](../../imgs/themes/sage.png)

## Random

The last entry in the theme picker is **Random**. It is not a palette; it is a preference that draws a concrete family at each launch, so the app opens in a different theme every time. The draw is a no-repeat cycle: every family shows once before any repeats, and when the cycle resets it avoids immediately repeating the family you just saw. The families already used in the current cycle are remembered across restarts (saved as `theme_random_used` in `settings.json`), so quitting and relaunching keeps the rotation going rather than starting over. The picker keeps showing Random as selected — the concrete family it resolved to for this session drives the actual colors.

## Appearance

Each family has a light and a dark variant; the Appearance control picks which:

| Appearance | What it does |
| --- | --- |
| System | Follows the OS light/dark preference, updating live |
| Light | Forces the family's light variant |
| Dark | Forces the family's dark variant |
| Daylight | Light between 09:00 and 18:00 local time, dark otherwise |

## Model

```mermaid
flowchart LR
    A[Family] --> C[Theme source]
    B[Appearance] --> C
    C --> D[Semantic tokens]
    D --> E[Reader UI]
    D --> F[Code blocks]
    D --> G[Alerts]
    D --> H[Minimap]
```

## Choose

Open **Settings**, then **Theme** to slide up the theme picker. It lists every family as a button — plus [Random](#random) at the end — with an Appearance control (System / Light / Dark / Daylight) at the top. Changes apply immediately and are saved as `theme_family` and `theme_mode` in `settings.json` (see [Settings](05-settings.md#options)).

## Fonts

Leaf Text does not bundle fonts. Instead, the active theme's font is fetched from **Google Fonts** when the theme activates, and the WebView caches it on disk so later launches are instant:

- Each family carries its own type: **Fern** uses Noto (Sans/Serif/Sans Mono); **Nightshade** pairs Fraunces headings with Inter and Fira Code; **Halcyon** uses IBM Plex Sans/Mono; **Amaranth** uses the Source family (Serif 4 / Sans 3 / Code Pro); **Sage** uses Inter with JetBrains Mono; **Arabica** pairs Rubik with JetBrains Mono; **Goldenrod** pairs Space Grotesk with Space Mono; **Ginger** pairs Nunito with Inconsolata; **Pippin** pairs DM Sans with DM Mono.
- The **GitHub** family is the exception: it uses your OS's native font stack (like github.com) and fetches nothing.
- Switching families swaps the font link, so the font changes with the theme.
- Every font stack lists system fallbacks, so text is readable immediately while the web font loads — and stays readable offline, falling back until you have loaded the font online once.

## Tokens

The semantic token set covers:

- app chrome
- document text
- headings (a base color plus a per-level color for `h2`–`h6`, so a theme can tint deeper headings) and links
- blockquotes and alerts
- code surfaces and syntax colors
- minimap colors
- focus and selection styling

If a theme source misses one required token, Leaf Text fails the contract check instead of silently rendering with broken fallback colors. See [Theming](../02-development/04-theming.md#the-token-contract) for the full contract.

## Add your own

The theme picker links to the project on GitHub for making your own theme. A theme is pure data — a map of contract tokens to values plus a font block — authored as a file under `themes/` and compiled into the bundle, so it can be validated against the contract without injecting third-party CSS. See [Theming → Adding a theme](../02-development/04-theming.md#adding-a-theme) for the full recipe.

## CSS

The compiled stylesheet is assembled in this order:

1. Compiled `--leaf-*` theme mappings (each family's palette, plus its font-family stacks)
2. The `:root` alias layer — the radius/shadow scales and the short component names the UI consumes
3. App CSS for layout and components

Every palette is pure data, compiled from [`themes.md`](../02-development/04-theming.md#palettes-are-data-themesmd); the font *files* still load separately from Google Fonts per the active theme. The ordering keeps one stable semantic layer so the app can swap themes quickly.

## Windows

On Windows, Leaf Text uses a frameless window with its own title bar rather than the native one, so nothing the OS draws sits above the app. The app bar doubles as the title bar: drag it to move the window, double-click to maximize or restore, and its right edge carries the minimize / maximize / close buttons, which take the same rounded hover chip as the other toolbar icons (close turns red instead of the accent color). The taskbar still shows the leaf icon, and the window border follows the theme's divider color so the app reads as a distinct surface against the desktop.

## Next

- [Settings](05-settings.md)
- [Theming](../02-development/04-theming.md)
