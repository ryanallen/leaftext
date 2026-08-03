//! The W3C XML conformance suite against `parse_xml`.
//!
//! The catalogs are the truth, not the folder a file sits in. `xmlconf.xml` names
//! them through external entities, which `roxmltree` will not expand, so this
//! reads that list and then each catalog on its own — with our own XML reader,
//! since the catalogs are XML.
//!
//! **We are a non-validating reader and always were** (`xml.rs`). So an `invalid`
//! document must still be read: it breaks a rule in its DTD, not a rule about
//! being well formed. Only `not-wf` must be refused.

use super::*;

/// One `<TEST>` in a catalog.
struct Entry {
    id: String,
    /// `valid`, `invalid`, `not-wf` or `error`.
    kind: String,
    /// The XML version the entry is written for. We read 1.0.
    version: String,
    path: PathBuf,
}

/// Every catalog, read out of `xmlconf.xml`'s own entity declarations so the list
/// lives in one place — the file the W3C ships — rather than here.
fn catalogs() -> Vec<PathBuf> {
    let Some(root) = corpus(Suite::Xml) else {
        return Vec::new();
    };
    let dir = root.join("xmlconf");
    let Some(text) = std::fs::read_to_string(dir.join("xmlconf.xml")).ok() else {
        return Vec::new();
    };
    let mut found = Vec::new();
    let mut rest = text.as_str();
    while let Some(at) = rest.find("SYSTEM \"") {
        rest = &rest[at + 8..];
        let Some(end) = rest.find('"') else { break };
        let name = &rest[..end];
        rest = &rest[end..];
        if name.ends_with(".xml") {
            found.push(dir.join(name));
        }
    }
    found
}

fn entries() -> Vec<Entry> {
    catalogs()
        .iter()
        .flat_map(|path| entries_of(path))
        .collect()
}

fn entries_of(catalog: &Path) -> Vec<Entry> {
    let Some(text) = utf8(catalog) else {
        return Vec::new();
    };
    let dir = catalog.parent().unwrap_or(catalog).to_path_buf();
    if let Ok(document) = parse_xml(&text) {
        return harvest(&document, &dir);
    }
    // Three of the Sun catalogs have no root element of their own: the master
    // pulls them in as entities, inside its own. Give them one.
    let wrapped = format!("<CATALOG>{}</CATALOG>", without_declaration(&text));
    parse_xml(&wrapped)
        .map(|document| harvest(&document, &dir))
        .unwrap_or_default()
}

fn without_declaration(text: &str) -> &str {
    if !text.trim_start().starts_with("<?xml") {
        return text;
    }
    match text.find("?>") {
        Some(end) => &text[end + 2..],
        None => text,
    }
}

fn harvest(document: &roxmltree::Document<'_>, dir: &Path) -> Vec<Entry> {
    // An id is only unique inside its own catalog — `attlist01` is Sun's and IBM's
    // both — so the folder goes in front of it, or one entry's excuse would cover
    // the other's failure.
    let folder = dir
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    document
        .descendants()
        .filter(|node| node.has_tag_name("TEST"))
        .filter_map(|node| {
            let uri = node.attribute("URI")?;
            Some(Entry {
                id: format!("{folder}/{}", node.attribute("ID").unwrap_or(uri)),
                kind: node.attribute("TYPE").unwrap_or_default().to_string(),
                version: node.attribute("VERSION").unwrap_or("1.0").to_string(),
                path: dir.join(uri.replace('/', std::path::MAIN_SEPARATOR_STR)),
            })
        })
        .collect()
}

/// How many `<TEST>` the file actually declares, counted without reading it as
/// XML. Comments are cut out first: one IBM catalog keeps an old entry commented
/// out, and counting it is how 2,586 came to be quoted for a suite that holds
/// 2,585.
fn declared_tests(text: &str) -> usize {
    let mut out = text.to_string();
    while let Some(start) = out.find("<!--") {
        let Some(end) = out[start..].find("-->").map(|end| start + end + 3) else {
            break;
        };
        out.replace_range(start..end, "");
    }
    out.matches("<TEST ").count()
}

#[test]
fn the_xml_catalog_numbers_add_up() {
    let all = entries();
    if all.is_empty() {
        return;
    }
    let count = |kind: &str| all.iter().filter(|entry| entry.kind == kind).count();
    let labeled = count("valid") + count("invalid") + count("not-wf") + count("error");
    let missing = all.iter().filter(|entry| !entry.path.is_file()).count();
    let not_utf8 = all
        .iter()
        .filter(|entry| entry.path.is_file() && utf8(&entry.path).is_none())
        .count();
    let eleven = all.iter().filter(|entry| entry.version == "1.1").count();

    println!(
        "conformance XML catalog: {} entries in {} catalogs — {} valid, {} invalid, \
         {} not-wf, {} error ({labeled} labeled); {missing} name no file, \
         {not_utf8} are not UTF-8, {eleven} are XML 1.1",
        all.len(),
        catalogs().len(),
        count("valid"),
        count("invalid"),
        count("not-wf"),
        count("error"),
    );

    // Nothing may go missing between the catalogs and the run: a catalog this
    // cannot parse drops its entries in silence, and three of the Sun ones did.
    let declared: usize = catalogs()
        .iter()
        .filter_map(|path| utf8(path))
        .map(|text| declared_tests(&text))
        .sum();
    assert_eq!(
        all.len(),
        declared,
        "the catalogs declare a test nobody read"
    );
    assert_eq!(labeled, all.len(), "an entry carries no label");
    assert_eq!(missing, 0, "an entry names a file that is not there");
}

#[test]
fn xml_reads_every_well_formed_document_and_refuses_the_rest() {
    let all = entries();
    if all.is_empty() {
        return;
    }
    let mut report = Report::new(Suite::Xml, Property::Verdict);
    let mut set_aside = 0;
    for entry in &all {
        // Not UTF-8: the app decodes a file before any reader sees it, so these
        // belong to `encoding.rs`. XML 1.1: we read 1.0.
        let Some(source) = utf8(&entry.path) else {
            set_aside += 1;
            continue;
        };
        if entry.version != "1.0" {
            set_aside += 1;
            continue;
        }
        let read = parse_xml(&source).is_ok();
        let wrong = match entry.kind.as_str() {
            // Well formed either way. `invalid` breaks a DTD rule, and we do not
            // check DTDs.
            "valid" | "invalid" if !read => Some(format!("refused a well-formed {}", entry.kind)),
            // Two different things, and the difference is the whole point of this
            // suite for us. A document whose only fault is in its DTD or its
            // entities is one we deliberately do not check. One with no DTD at all
            // is a plain well-formedness fault, and that would be a real gap.
            "not-wf" if read && source.contains("<!DOCTYPE") => {
                Some("a DTD or entity rule we do not check".to_string())
            }
            "not-wf" if read => Some("read a document that is not well formed".to_string()),
            // `error` is a document a processor may report or may ignore. The
            // specification allows both, so neither is a failure.
            _ => None,
        };
        report.record(&entry.id, wrong);
    }
    println!("conformance XML verdict: {set_aside} entries set aside — not UTF-8, or XML 1.1");
    report.finish();
}
