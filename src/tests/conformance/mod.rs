//! The published conformance suites, run against the app's own readers.
//!
//! The corpora are fetched, never vendored: `just conformance` downloads them
//! into `target/conformance/`. Nothing here reaches the network, and every test
//! prints one line and returns when the corpus is not on disk, so `just verify`
//! is no slower than it was.
//!
//! Five properties are asked of every suite. The first and last are what the
//! suite was written for; the middle three are free once the files are there.
//! What we knowingly fail is committed under `expected/`, keyed by case *and*
//! property — a case excused for a verdict must not also excuse a panic or a
//! wrong byte range found in that same file later.

use super::*;
use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

mod json;
mod markdown;
mod survival;
mod xml;
mod yaml;

// ---------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------

/// A published suite: its folder under `target/conformance`, and the name its
/// `expected/` list is filed under.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Suite {
    CommonMark,
    Gfm,
    Json,
    Yaml,
    Xml,
    Html5lib,
}

impl Suite {
    /// Every suite, so a test can sweep them all.
    const ALL: [Self; 6] = [
        Self::Json,
        Self::Yaml,
        Self::CommonMark,
        Self::Gfm,
        Self::Xml,
        Self::Html5lib,
    ];

    fn id(self) -> &'static str {
        match self {
            Self::CommonMark => "commonmark",
            Self::Gfm => "gfm",
            Self::Json => "json",
            Self::Yaml => "yaml",
            Self::Xml => "xml",
            Self::Html5lib => "html5lib",
        }
    }

    fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|suite| suite.id() == id)
    }

    fn label(self) -> &'static str {
        match self {
            Self::CommonMark => "CommonMark",
            Self::Gfm => "GFM",
            Self::Json => "JSON",
            Self::Yaml => "YAML",
            Self::Xml => "XML",
            Self::Html5lib => "html5lib",
        }
    }
}

/// Which suites cover a format. No wildcard arm on purpose: a new format has
/// to answer this before the tests compile, which is the rule `format.rs` already
/// states for every other match on `DocumentFormat`.
fn suites_for(format: DocumentFormat) -> &'static [Suite] {
    match format {
        // Raw HTML arrives inside a Markdown document, so html5lib's tokenizer
        // cases go down the same path.
        DocumentFormat::Markdown => &[Suite::CommonMark, Suite::Gfm, Suite::Html5lib],
        DocumentFormat::Xml => &[Suite::Xml],
        DocumentFormat::Json => &[Suite::Json],
        DocumentFormat::Yaml => &[Suite::Yaml],
        // Nothing comparable is published for mail. If one ever is, this is where
        // it goes.
        DocumentFormat::Eml
        | DocumentFormat::Html
        | DocumentFormat::Text
        | DocumentFormat::Ini
        | DocumentFormat::Code => &[],
    }
}

/// The reader a case is fed to, and so which suite belongs to which format.
fn format_of(suite: Suite) -> DocumentFormat {
    DocumentFormat::ALL
        .into_iter()
        .find(|format| suites_for(*format).contains(&suite))
        .expect("every suite is named by a format")
}

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

fn corpus_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("conformance")
}

/// The suite's folder, or `None` with one printed line when it was never
/// fetched. Every conformance test opens with this.
fn corpus(suite: Suite) -> Option<PathBuf> {
    let dir = corpus_root().join(suite.id());
    if dir.is_dir() {
        return Some(dir);
    }
    println!(
        "conformance: no {} corpus on disk — run `just conformance`",
        suite.label()
    );
    None
}

/// One case: the text to read, and the name `expected/` knows it by.
pub(super) struct Case {
    pub(super) name: String,
    pub(super) source: String,
    /// The HTML the suite says this should render to, where it says so at all.
    pub(super) expected: Option<String>,
    /// The chapter of the specification an example came from, so a whole chapter
    /// can be left out with its reason.
    pub(super) section: Option<String>,
}

impl Case {
    fn new(name: String, source: String) -> Self {
        Self {
            name,
            source,
            expected: None,
            section: None,
        }
    }
}

/// Every case in a suite, in a fixed order — the order is an index the survival
/// runner hands to its child processes, so it has to be the same in both.
pub(super) fn cases(suite: Suite) -> Vec<Case> {
    let Some(dir) = corpus(suite) else {
        return Vec::new();
    };
    match suite {
        Suite::CommonMark => commonmark_cases(&dir),
        Suite::Gfm => gfm_cases(&dir),
        Suite::Json => file_cases(&dir.join("test_parsing"), "json"),
        Suite::Yaml => yaml_cases(&dir),
        Suite::Xml => xml_cases(&dir.join("xmlconf")),
        Suite::Html5lib => html5lib_cases(&dir.join("tokenizer")),
    }
}

/// A file inside one YAML case's folder — `error` when the case must fail,
/// `in.json` when the suite says what the value should come to.
pub(super) fn yaml_case_file(case: &str, file: &str) -> Option<PathBuf> {
    let path = corpus_root().join(Suite::Yaml.id()).join(case).join(file);
    path.is_file().then_some(path)
}

/// Read a file as text, or `None`. A corpus built to break parsers holds files
/// that are deliberately not UTF-8; the app decodes before any reader sees a
/// file, so those belong to `encoding.rs` rather than here.
fn utf8(path: &Path) -> Option<String> {
    String::from_utf8(std::fs::read(path).ok()?).ok()
}

/// Every file with this extension in one folder, named by its file name.
fn file_cases(dir: &Path, extension: &str) -> Vec<Case> {
    let mut cases = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return cases;
    };
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|e| e.to_str()) == Some(extension))
        .collect();
    paths.sort();
    for path in paths {
        let Some(source) = utf8(&path) else { continue };
        cases.push(Case::new(
            path.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into(),
            source,
        ));
    }
    cases
}

/// Every `.xml` file under the W3C tree. Which of them is valid, invalid or not
/// well-formed is the catalogs' answer, and the verdict property reads them;
/// survival only needs the files.
fn xml_cases(dir: &Path) -> Vec<Case> {
    let mut paths = Vec::new();
    collect_files(dir, "xml", &mut paths);
    paths.sort();
    paths
        .into_iter()
        .filter_map(|path| {
            let source = utf8(&path)?;
            let name = path
                .strip_prefix(dir)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            Some(Case::new(name, source))
        })
        .collect()
}

fn collect_files(dir: &Path, extension: &str, into: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files(&path, extension, into);
        } else if path.extension().and_then(|e| e.to_str()) == Some(extension) {
            into.push(path);
        }
    }
}

/// The YAML suite's `data` branch: one folder per case holding `in.yaml`, and a
/// numbered subfolder per part when a case has several.
fn yaml_cases(dir: &Path) -> Vec<Case> {
    let mut paths = Vec::new();
    collect_files(dir, "yaml", &mut paths);
    paths.retain(|path| path.file_name().and_then(|n| n.to_str()) == Some("in.yaml"));
    paths.sort();
    paths
        .into_iter()
        .filter_map(|path| {
            let source = utf8(&path)?;
            let name = path
                .parent()
                .and_then(|parent| parent.strip_prefix(dir).ok())
                .unwrap_or(Path::new("?"))
                .to_string_lossy()
                .replace('\\', "/");
            Some(Case::new(name, source))
        })
        .collect()
}

/// CommonMark ships its examples as JSON: markdown in, HTML out, numbered.
fn commonmark_cases(dir: &Path) -> Vec<Case> {
    let Some(text) = utf8(&dir.join("spec.json")) else {
        return Vec::new();
    };
    let Ok(examples) = serde_json::from_str::<Vec<serde_json::Value>>(&text) else {
        return Vec::new();
    };
    examples
        .into_iter()
        .filter_map(|example| {
            Some(Case {
                name: format!("example-{}", example.get("example")?.as_u64()?),
                source: example.get("markdown")?.as_str()?.to_string(),
                expected: example
                    .get("html")
                    .and_then(|html| html.as_str())
                    .map(str::to_string),
                section: example
                    .get("section")
                    .and_then(|section| section.as_str())
                    .map(str::to_string),
            })
        })
        .collect()
}

/// GFM ships its examples inside the specification text: a run of backticks, the
/// word `example`, the input, a `.` line, the expected HTML, and the run again.
fn gfm_cases(dir: &Path) -> Vec<Case> {
    let Some(text) = utf8(&dir.join("spec.txt")) else {
        return Vec::new();
    };
    let mut cases = Vec::new();
    let mut fence: Option<String> = None;
    let mut input = String::new();
    let mut html = String::new();
    let mut section = String::new();
    let mut past_separator = false;
    for line in text.lines() {
        match &fence {
            None => {
                if let Some(heading) = line.strip_prefix("## ") {
                    section = heading.trim().to_string();
                }
                let ticks: String = line.chars().take_while(|c| *c == '`').collect();
                // GFM tags its extension examples — `example table`, `example
                // strikethrough` — so the word is the start of the line, not all
                // of it.
                let tagged = line[ticks.len()..].split_whitespace().next() == Some("example");
                if ticks.len() >= 32 && tagged {
                    fence = Some(ticks);
                    input.clear();
                    html.clear();
                    past_separator = false;
                }
            }
            Some(ticks) => {
                if line == ticks {
                    cases.push(Case {
                        name: format!("example-{}", cases.len() + 1),
                        source: std::mem::take(&mut input),
                        expected: Some(std::mem::take(&mut html)),
                        section: Some(section.clone()),
                    });
                    fence = None;
                } else if line == "." && !past_separator {
                    past_separator = true;
                } else {
                    // The specification writes a tab as `→` so it survives editing.
                    let text = line.replace('\u{2192}', "\t");
                    let into = if past_separator {
                        &mut html
                    } else {
                        &mut input
                    };
                    into.push_str(&text);
                    into.push('\n');
                }
            }
        }
    }
    cases
}

/// html5lib's tokenizer cases are JSON: each `input` is a fragment of HTML. We
/// only ever ask whether the raw-HTML filter survives one.
fn html5lib_cases(dir: &Path) -> Vec<Case> {
    let mut paths = Vec::new();
    collect_files(dir, "test", &mut paths);
    paths.sort();
    let mut cases = Vec::new();
    for path in paths {
        let Some(text) = utf8(&path) else { continue };
        let Ok(file) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        let Some(tests) = file.get("tests").and_then(|tests| tests.as_array()) else {
            continue;
        };
        let stem = path.file_stem().unwrap_or_default().to_string_lossy();
        for (index, test) in tests.iter().enumerate() {
            let Some(input) = test.get("input").and_then(|input| input.as_str()) else {
                continue;
            };
            cases.push(Case::new(format!("{stem}-{index}"), input.to_string()));
        }
    }
    cases
}

/// Read one case with the reader that owns its format. The return value is
/// dropped: this is the shape every property starts from, and survival wants
/// nothing but the absence of a panic.
/// The one stand-in path every Markdown case is rendered against.
/// `render_markdown_body` takes a source path and it decides how an image
/// destination resolves, so a path that varied per case would move the answer
/// under the normalizer.
pub(super) fn markdown_stand_in_path() -> PathBuf {
    // Absolute, because a real document always is, and an image destination only
    // resolves against a folder the app can name.
    std::env::temp_dir()
        .join("leaftext-conformance")
        .join("case.md")
}

pub(super) fn read_case(suite: Suite, case: &Case) {
    let path = markdown_stand_in_path();
    match format_of(suite) {
        DocumentFormat::Markdown => {
            let _ = render_markdown_body(MarkdownSource {
                markdown: &case.source,
                source_path: &path,
                host: &DesktopHost::default(),
            });
        }
        DocumentFormat::Xml => {
            let _ = render_xml_document(&case.source, None);
        }
        DocumentFormat::Json => {
            let _ = render_json_document(&case.source, None);
        }
        DocumentFormat::Yaml => {
            let _ = render_yaml_document(&case.source, None);
        }
        DocumentFormat::Eml
        | DocumentFormat::Html
        | DocumentFormat::Text
        | DocumentFormat::Ini
        | DocumentFormat::Code => {}
    }
}

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

/// Every node in the tree that carries a byte range, with the range. Properties 3
/// and 4 both start here — one re-parses each slice, the other looks for two nodes
/// holding the same one.
pub(super) fn spanned<'a>(node: &'a DataNode, into: &mut Vec<((usize, usize), &'a DataNode)>) {
    if let Some(span) = &node.span {
        into.push(((span.start, span.end), node));
    }
    match &node.value {
        DataValue::Scalar(_) => {}
        DataValue::Sequence(items) => {
            for item in items {
                spanned(item, into);
            }
        }
        DataValue::Mapping(pairs) => {
            for (_, value) in pairs {
                spanned(value, into);
            }
        }
    }
}

/// Two nodes hold the same thing, wherever each came from. Comparing whole nodes
/// would compare their ranges too, and a slice re-parsed on its own starts at zero.
pub(super) fn same_value(left: &DataNode, right: &DataNode) -> bool {
    match (&left.value, &right.value) {
        (DataValue::Scalar(left), DataValue::Scalar(right)) => left == right,
        (DataValue::Sequence(left), DataValue::Sequence(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .zip(right)
                    .all(|(left, right)| same_value(left, right))
        }
        (DataValue::Mapping(left), DataValue::Mapping(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .zip(right)
                    .all(|((left_key, left), (right_key, right))| {
                        left_key == right_key && same_value(left, right)
                    })
        }
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Verdicts we accept
// ---------------------------------------------------------------------------

/// Which of the five checks a case is being held to. The `expected/` lists are
/// keyed by this as well as by case name: excusing a verdict deviation must not
/// also excuse a panic or a wrong byte range found in the same file later, and
/// those files are the likeliest place for one.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Property {
    Verdict,
    Survival,
    RoundTrip,
    Disjoint,
    Meaning,
}

impl Property {
    fn word(self) -> &'static str {
        match self {
            Self::Verdict => "verdict",
            Self::Survival => "survival",
            Self::RoundTrip => "range",
            Self::Disjoint => "disjoint",
            Self::Meaning => "meaning",
        }
    }

    fn from_word(word: &str) -> Option<Self> {
        [
            Self::Verdict,
            Self::Survival,
            Self::RoundTrip,
            Self::Disjoint,
            Self::Meaning,
        ]
        .into_iter()
        .find(|property| property.word() == word)
    }
}

/// A suite's run: what was checked, what failed, and what we already knew about.
pub(super) struct Report {
    suite: Suite,
    property: Property,
    listed: BTreeMap<String, String>,
    exercised: BTreeSet<String>,
    excused: BTreeSet<String>,
    failed: BTreeMap<String, String>,
    checked: usize,
}

impl Report {
    pub(super) fn new(suite: Suite, property: Property) -> Self {
        Self {
            suite,
            property,
            listed: expected_failures(suite, property),
            exercised: BTreeSet::new(),
            excused: BTreeSet::new(),
            failed: BTreeMap::new(),
            checked: 0,
        }
    }

    /// Record one case against this property. `detail` is what to print when the
    /// failure is not one we already accept.
    pub(super) fn record(&mut self, case: &str, detail: Option<String>) {
        self.checked += 1;
        self.exercised.insert(case.to_string());
        let Some(detail) = detail else { return };
        if self.listed.contains_key(case) {
            self.excused.insert(case.to_string());
        } else {
            self.failed.insert(case.to_string(), detail);
        }
    }

    /// Print the count, then fail on anything unlisted — and on a listed case that
    /// has started passing, because otherwise the list only ever grows.
    pub(super) fn finish(self) {
        println!(
            "conformance {} {}: {} checked, {} accepted deviations",
            self.suite.label(),
            self.property.word(),
            self.checked,
            self.excused.len()
        );
        let stale: Vec<&String> = self
            .listed
            .keys()
            .filter(|case| self.exercised.contains(*case) && !self.excused.contains(*case))
            .collect();
        if self.failed.is_empty() && stale.is_empty() {
            return;
        }
        let mut message = String::new();
        for (case, detail) in &self.failed {
            message.push_str(&format!("  {} {case} — {detail}\n", self.property.word()));
        }
        for case in stale {
            message.push_str(&format!(
                "  {} {case} — passes now: delete this line\n",
                self.property.word()
            ));
        }
        panic!(
            "{} {} did not match {}:\n{message}",
            self.suite.label(),
            self.property.word(),
            expected_path(self.suite).display()
        );
    }
}

fn expected_path(suite: Suite) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src/tests/conformance/expected")
        .join(format!("{}.txt", suite.id()))
}

/// The committed list of failures we accept: `<property> <case> <reason>`, one
/// per line. A missing file means we accept none.
fn expected_failures(suite: Suite, property: Property) -> BTreeMap<String, String> {
    let Ok(text) = std::fs::read_to_string(expected_path(suite)) else {
        return BTreeMap::new();
    };
    let mut listed = BTreeMap::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.splitn(3, char::is_whitespace);
        let word = parts.next().unwrap_or_default();
        let case = parts.next().unwrap_or_default().trim();
        let reason = parts.next().unwrap_or_default().trim();
        assert!(
            Property::from_word(word).is_some(),
            "{}: \"{word}\" is not one of the five properties",
            expected_path(suite).display()
        );
        assert!(
            !case.is_empty() && !reason.is_empty(),
            "{}: every line is `<property> <case> <reason>`, and this one is not:\n  {line}",
            expected_path(suite).display()
        );
        if Property::from_word(word) == Some(property) {
            listed.insert(case.to_string(), reason.to_string());
        }
    }
    listed
}

#[test]
fn every_suite_belongs_to_a_format_the_app_reads() {
    // `suites_for` is the manifest and it has no wildcard arm, so a new format
    // has to answer it. This is the other direction: a suite nobody's format
    // claims would silently never run.
    for suite in Suite::ALL {
        let format = format_of(suite);
        assert!(
            suites_for(format).contains(&suite),
            "{} is fetched and read by nothing",
            suite.label()
        );
    }
    assert!(
        suites_for(DocumentFormat::Eml).is_empty(),
        "no conformance suite is published for mail"
    );
}

#[test]
fn each_suite_is_either_absent_or_holds_the_cases_it_should() {
    // The counts the ticket's tables are written against. A pin moving under us
    // shows up here first, as a number rather than as hundreds of new failures.
    let counted = [
        (Suite::Json, 293),
        (Suite::Yaml, 402),
        (Suite::CommonMark, 652),
        (Suite::Gfm, 672),
    ];
    for (suite, expected) in counted {
        let found = cases(suite);
        if found.is_empty() {
            continue;
        }
        assert_eq!(found.len(), expected, "{}", suite.label());
    }
}
