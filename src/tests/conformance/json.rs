//! `nst/JSONTestSuite` against `parse_json`.
//!
//! The suite names its verdict in the file name: `y_` must be accepted, `n_` must
//! be refused, `i_` is free either way. Properties 3 and 4 come free with the
//! files, and this is the format whose ranges the source editor trusts most —
//! every JSON node carries one.
//!
//! The 25 files that are deliberately not UTF-8 are not here: the app decodes a
//! file before any reader sees it, so those belong to `encoding.rs`.

use super::*;

/// What the suite says should happen to a case, from its name.
enum Wanted {
    Accepted,
    Refused,
    Either,
}

fn wanted(name: &str) -> Wanted {
    match name.as_bytes().first() {
        Some(b'y') => Wanted::Accepted,
        Some(b'n') => Wanted::Refused,
        _ => Wanted::Either,
    }
}

#[test]
fn json_accepts_what_the_specification_calls_legal_and_refuses_the_rest() {
    let all = cases(Suite::Json);
    if all.is_empty() {
        return;
    }
    let mut report = Report::new(Suite::Json, Property::Verdict);
    for case in &all {
        let read = parse_json(&case.source).is_ok();
        let wrong = match wanted(&case.name) {
            Wanted::Accepted if !read => Some("refused a legal document".to_string()),
            Wanted::Refused if read => {
                Some("accepted a document the specification rejects".to_string())
            }
            _ => None,
        };
        report.record(&case.name, wrong);
    }
    report.finish();
}

#[test]
fn every_json_range_reparses_to_the_node_it_came_from() {
    let all = cases(Suite::Json);
    if all.is_empty() {
        return;
    }
    let mut report = Report::new(Suite::Json, Property::RoundTrip);
    for case in &all {
        let Ok(root) = parse_json(&case.source) else {
            continue;
        };
        let mut nodes = Vec::new();
        spanned(&root, &mut nodes);
        let mut wrong = None;
        for ((start, end), node) in &nodes {
            // The promise `data.rs` opens with: the source editor shows this slice
            // and writes what is typed back over exactly it.
            let slice = case.source.get(*start..*end);
            let matches = slice
                .and_then(|slice| parse_json(slice).ok())
                .is_some_and(|reparsed| same_value(&reparsed, node));
            if !matches {
                wrong = Some(format!(
                    "{start}..{end} does not read back as the node it belongs to"
                ));
                break;
            }
        }
        report.record(&case.name, wrong);
    }
    report.finish();
}

#[test]
fn no_two_json_nodes_claim_one_range() {
    let all = cases(Suite::Json);
    if all.is_empty() {
        return;
    }
    let mut report = Report::new(Suite::Json, Property::Disjoint);
    for case in &all {
        let Ok(root) = parse_json(&case.source) else {
            continue;
        };
        let mut nodes = Vec::new();
        spanned(&root, &mut nodes);
        let mut ranges: Vec<(usize, usize)> = nodes.iter().map(|(range, _)| *range).collect();
        let claimed = ranges.len();
        ranges.sort_unstable();
        ranges.dedup();
        // Two blocks on one slice means editing either rewrites the other's text.
        let wrong = (ranges.len() != claimed).then(|| {
            format!(
                "{} of {claimed} ranges are claimed twice",
                claimed - ranges.len()
            )
        });
        report.record(&case.name, wrong);
    }
    report.finish();
}
