//! Whether a reader can tell a table's two rows apart, on every family in both appearances.

use super::*;

/// The floor a family's two rows have to land apart, in CIE L\*. It sits in open ground on purpose: every family shipped at or under 2.4 with the one gray, and every family lands well clear of it with the themed recess, so this refuses the collapse without ranking two fills that both work. A family is free to choose a subtler stripe deliberately; it is not free to draw none.
const ROW_SEPARATION_FLOOR: f64 = 3.5;

/// What share of a grained row the dots actually ink, averaged over one 2px tile.
///
/// The lattice is a circle solid to a 0.6px radius, fading linearly to nothing at 0.7px, on a 2px by 2px tile. Solid disc, pi times 0.6 squared, is 1.1310; the feathered ring integrates to 0.1990. Over the tile's 4px squared: 0.3325.
///
/// This is the idealization, and it is why a number here and a number off a photograph disagree by up to 1.2: a browser rasterizing a 0.6px radius at a real device pixel ratio does not land on the ideal. The floor above is chosen to survive that spread in both directions. Ranking two fills finely needs a driven copy, not this.
const GRAIN_COVERAGE: f64 = 0.3325;

/// A fill as the stylesheet writes it: an ink and the alpha it is laid on at. A themed color is opaque, so its alpha is 1.
#[derive(Debug, Clone, Copy)]
struct Fill {
    ink: Rgb,
    alpha: f64,
}

/// Every spelling a fill reaches this sweep in: a six-digit hex, an eight-digit hex, an `rgb()` or `rgba()`, or `transparent`.
fn parse_fill(value: &str) -> Fill {
    let value = value.trim();
    let black = Rgb {
        red: 0.0,
        green: 0.0,
        blue: 0.0,
    };
    if value == "transparent" {
        return Fill {
            ink: black,
            alpha: 0.0,
        };
    }
    if let Some(hex) = value.strip_prefix('#') {
        if hex.len() == 8 {
            let ink = parse_hex_color(&format!("#{}", &hex[0..6]))
                .unwrap_or_else(|| panic!("expected a color in {value}"));
            let alpha = f64::from(
                u8::from_str_radix(&hex[6..8], 16)
                    .unwrap_or_else(|_| panic!("expected an alpha in {value}")),
            ) / 255.0;
            return Fill { ink, alpha };
        }
        return Fill {
            ink: parse_hex_color(value).unwrap_or_else(|| panic!("expected a color in {value}")),
            alpha: 1.0,
        };
    }

    let inside = value
        .strip_prefix("rgba(")
        .or_else(|| value.strip_prefix("rgb("))
        .and_then(|rest| rest.strip_suffix(')'))
        .unwrap_or_else(|| panic!("expected a color in {value}"));
    let parts: Vec<&str> = inside.split(',').map(str::trim).collect();
    let number = |at: usize| -> f64 {
        parts[at]
            .parse::<f64>()
            .unwrap_or_else(|_| panic!("expected a number in {value}"))
    };
    Fill {
        ink: Rgb {
            red: number(0) / 255.0,
            green: number(1) / 255.0,
            blue: number(2) / 255.0,
        },
        alpha: if parts.len() > 3 { number(3) } else { 1.0 },
    }
}

/// One fill laid over what is already there.
fn over(fill: Fill, under: Rgb) -> Rgb {
    Rgb {
        red: fill.ink.red * fill.alpha + under.red * (1.0 - fill.alpha),
        green: fill.ink.green * fill.alpha + under.green * (1.0 - fill.alpha),
        blue: fill.ink.blue * fill.alpha + under.blue * (1.0 - fill.alpha),
    }
}

/// CIE L\*, which is what an eye grades a near-black pair by where a contrast ratio flattens it. The luminance underneath is the same Y the contrast helper computes, so the two can never disagree about a color.
fn lightness(color: Rgb) -> f64 {
    let luminance = relative_luminance(color);
    if luminance > 0.008856 {
        116.0 * luminance.cbrt() - 16.0
    } else {
        903.3 * luminance
    }
}

/// A row as it is painted: the page, whatever fill the row carries, and the dot lattice over both at its mean coverage.
fn row_lightness(page: Rgb, fill: Option<Fill>, grain: Fill) -> f64 {
    let surface = match fill {
        Some(fill) => over(fill, page),
        None => page,
    };
    let dots = Fill {
        ink: grain.ink,
        alpha: grain.alpha * GRAIN_COVERAGE,
    };
    lightness(over(dots, surface))
}

/// A grain resolved for one appearance, through whatever chain the stylesheet writes it as. Read out of the compiled stylesheet rather than written down here, so a change to the grain moves this sweep with it.
fn grain(css: &str, appearance: Appearance, name: &str) -> Fill {
    let mut blocks = Vec::new();
    if appearance == Appearance::Dark {
        blocks.extend(css_blocks(css, "[data-theme=\"dark\"] {"));
    }
    blocks.extend(css_blocks(css, ":root {"));
    parse_fill(&css_token_value(&blocks, name))
}

/// How far apart a family draws its two body rows, with `fill` in the tinted one. Every color comes through `theme_source_token_value`, which applies a family's own overrides — reading the theme files instead is what once put Sage two families away from where it really is.
fn row_separation(css: &str, source: &ThemeSource, fill: &str) -> f64 {
    let page = parse_fill(
        theme_source_token_value(source, "--lt-markdown-background")
            .unwrap_or_else(|| panic!("{} resolves its page", source.id)),
    )
    .ink;

    let tinted = row_lightness(
        page,
        Some(parse_fill(fill)),
        grain(css, source.appearance, "--reader-surface-grain"),
    );
    let untinted = row_lightness(
        page,
        None,
        grain(css, source.appearance, "--reader-row-grain"),
    );

    (tinted - untinted).abs()
}

/// The fill the stylesheet puts in the tinted row for one family, overrides and defaults applied.
fn shipped_fill(source: &ThemeSource) -> &'static str {
    theme_source_token_value(source, "--lt-markdown-table-row-background")
        .unwrap_or_else(|| panic!("{} resolves its alternating row", source.id))
}

#[test]
fn every_family_draws_two_table_rows_a_reader_can_tell_apart() {
    // One gray for eleven families in two appearances shipped a dark table with no bands in it at all — the gray lightens the row while the grain darkens it and the lift raises the row beside it, and the three cancel — and every test in the tree passed, because they all ask whether the lattice is there rather than whether a reader can see the row.
    let css = reading_mode_css();

    for source in theme_sources() {
        let apart = row_separation(&css, source, shipped_fill(source));
        assert!(
            apart >= ROW_SEPARATION_FLOOR,
            "{} ({}) draws its two table rows {apart:.2} apart in L*, under the floor of {ROW_SEPARATION_FLOOR}",
            source.family_name,
            source.appearance.as_str()
        );
    }
}

#[test]
fn the_sweep_reads_every_family_and_a_short_one_is_a_failure() {
    // A check that silently reads ten families of eleven is the fault it was written against, so the count is asserted rather than trusted: twenty-two sources, half of them dark, and every one answering a number rather than being skipped.
    let css = reading_mode_css();
    let sources = theme_sources();

    assert_eq!(sources.len(), 22, "eleven families in two appearances");
    assert_eq!(
        sources
            .iter()
            .filter(|source| source.appearance == Appearance::Dark)
            .count(),
        11,
        "every family has a dark half, which is the half this sweep was written for"
    );

    let read: Vec<f64> = sources
        .iter()
        .map(|source| row_separation(&css, source, shipped_fill(source)))
        .collect();
    assert_eq!(read.len(), sources.len(), "every source is measured");
    assert!(
        read.iter().all(|apart| apart.is_finite()),
        "every source answers a number"
    );
}

#[test]
fn the_sweep_refuses_the_gray_that_shipped_and_passes_the_recess_that_replaced_it() {
    // Proved on the two values themselves rather than on whichever one is in the stylesheet today: a check that only ever sees the fixed value cannot say it would have caught the broken one.
    let css = reading_mode_css();
    let github_dark = theme_sources()
        .iter()
        .find(|source| source.family == "github" && source.appearance == Appearance::Dark)
        .expect("GitHub dark");

    let one_gray = row_separation(&css, github_dark, "rgba(110, 118, 129, 0.08)");
    assert!(
        one_gray < ROW_SEPARATION_FLOOR,
        "the one gray drew GitHub dark's rows {one_gray:.2} apart, which this floor has to refuse"
    );
    assert!(
        one_gray < 0.5,
        "GitHub dark was the worst of the eleven at 0.18, so nothing here should read it as a stripe"
    );

    let recess = row_separation(&css, github_dark, shipped_fill(github_dark));
    assert!(
        recess >= ROW_SEPARATION_FLOOR,
        "the themed recess draws GitHub dark's rows {recess:.2} apart, which this floor has to pass"
    );
}

#[test]
fn the_grains_assumed_coverage_is_the_arithmetic_written_beside_it() {
    // The one idealization in this file, so it is computed here rather than believed. A number that has drifted from its own reasoning is how a sweep starts passing for the wrong reason.
    let solid = std::f64::consts::PI * 0.6_f64.powi(2);
    // The feathered ring, integrated from 0.6 to 0.7 with the alpha falling linearly to nothing.
    let ring = |radius: f64| 0.35 * radius.powi(2) - radius.powi(3) / 3.0;
    let feather = 20.0 * std::f64::consts::PI * (ring(0.7) - ring(0.6));
    let tile = 2.0 * 2.0;
    let computed = (solid + feather) / tile;

    assert!(
        (computed - GRAIN_COVERAGE).abs() < 0.0005,
        "the stated coverage is {GRAIN_COVERAGE}, the arithmetic gives {computed}"
    );
}
