//! `yaml/yaml-test-suite` against `parse_yaml`.
//!
//! The suite puts an `error` file in a case's folder when the document must be
//! refused, and an `in.json` beside `in.yaml` when it says what the value comes
//! to. That last one makes our YAML reader and our JSON reader check each other,
//! using nothing but the two readers already in the binary.
//!
//! Two things the cross-check cannot do, both because a scalar holds display text
//! and no type: `1` and `"1"` are one node, and null has as many spellings as YAML
//! gives it. So the comparison is shape and text, with every spelling of null
//! flattened to one — see `same_meaning`.

use super::*;

/// The suite's own verdict for a case.
fn must_fail(case: &str) -> bool {
    yaml_case_file(case, "error").is_some()
}

#[test]
fn yaml_refuses_the_documents_the_suite_calls_broken_and_reads_the_rest() {
    let all = cases(Suite::Yaml);
    if all.is_empty() {
        return;
    }
    let mut report = Report::new(Suite::Yaml, Property::Verdict);
    for case in &all {
        let read = parse_yaml(&case.source).is_ok();
        let wrong = match (must_fail(&case.name), read) {
            (true, true) => Some("read a document the suite calls broken".to_string()),
            (false, false) => Some("refused a document the suite calls legal".to_string()),
            _ => None,
        };
        report.record(&case.name, wrong);
    }
    report.finish();
}

#[test]
fn every_yaml_range_reparses_to_the_node_it_came_from() {
    let all = cases(Suite::Yaml);
    if all.is_empty() {
        return;
    }
    let mut report = Report::new(Suite::Yaml, Property::RoundTrip);
    for case in &all {
        let Ok(root) = parse_yaml(&case.source) else {
            continue;
        };
        let mut nodes = Vec::new();
        spanned(&root, &mut nodes);
        let mut wrong = None;
        for ((start, end), node) in &nodes {
            let matches = case
                .source
                .get(*start..*end)
                .and_then(|slice| parse_yaml(slice).ok())
                .is_some_and(|reparsed| same_value(&reparsed, node));
            if !matches {
                wrong = Some(format!("{start}..{end} does not read back as its own node"));
                break;
            }
        }
        report.record(&case.name, wrong);
    }
    report.finish();
}

#[test]
fn no_two_yaml_nodes_claim_one_range() {
    let all = cases(Suite::Yaml);
    if all.is_empty() {
        return;
    }
    let mut report = Report::new(Suite::Yaml, Property::Disjoint);
    for case in &all {
        let Ok(root) = parse_yaml(&case.source) else {
            continue;
        };
        let mut nodes = Vec::new();
        spanned(&root, &mut nodes);
        let mut ranges: Vec<(usize, usize)> = nodes.iter().map(|(range, _)| *range).collect();
        let claimed = ranges.len();
        ranges.sort_unstable();
        ranges.dedup();
        // Stamping an alias with the anchor's range makes editing the alias rewrite
        // the anchor's line. This is the check that catches it.
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

/// Every spelling of null, flattened. The JSON reader gives null the empty string
/// (`data.rs`), YAML keeps whichever word the file used, and neither records a
/// type — so without this every case carrying a null fails for a reason that has
/// nothing to do with YAML.
fn denulled(text: &str) -> &str {
    match text {
        "null" | "Null" | "NULL" | "~" => "",
        other => other,
    }
}

/// The same shape and the same text, null spellings aside. Not the same values: a
/// scalar holds display text and no type, so `1` and `"1"` are one node here and
/// that is as deep as this comparison can honestly go.
fn same_meaning(left: &DataNode, right: &DataNode) -> bool {
    match (&left.value, &right.value) {
        (DataValue::Scalar(left), DataValue::Scalar(right)) => denulled(left) == denulled(right),
        (DataValue::Sequence(left), DataValue::Sequence(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .zip(right)
                    .all(|(left, right)| same_meaning(left, right))
        }
        (DataValue::Mapping(left), DataValue::Mapping(right)) => {
            // By key, not by position. Our tree keeps the file's order and the
            // suite's `in.json` does not — an explicit key written last can be
            // listed first there, and that is not a disagreement about meaning.
            let mut left: Vec<_> = left.iter().collect();
            let mut right: Vec<_> = right.iter().collect();
            left.sort_by(|(a, _), (b, _)| a.cmp(b));
            right.sort_by(|(a, _), (b, _)| a.cmp(b));
            left.len() == right.len()
                && left
                    .iter()
                    .zip(&right)
                    .all(|((left_key, left), (right_key, right))| {
                        left_key == right_key && same_meaning(left, right)
                    })
        }
        _ => false,
    }
}

#[test]
fn the_yaml_reader_and_the_json_reader_agree_on_what_a_case_means() {
    let all = cases(Suite::Yaml);
    if all.is_empty() {
        return;
    }
    let mut report = Report::new(Suite::Yaml, Property::Meaning);
    for case in &all {
        // A few cases carry both an `error` file and an `in.json`. A document the
        // suite calls broken has no meaning to agree about.
        if must_fail(&case.name) {
            continue;
        }
        let Some(json) = yaml_case_file(&case.name, "in.json")
            .and_then(|path| std::fs::read_to_string(path).ok())
        else {
            continue;
        };
        let wrong = match (parse_yaml(&case.source), parse_json(&json)) {
            (Ok(read), Ok(expected)) => (!same_meaning(&read, &expected))
                .then(|| "reads differently from the JSON the suite gives".to_string()),
            (Err(_), _) => Some("would not read at all".to_string()),
            // The suite's own `in.json` is a document holding several values in a
            // few cases, which our JSON reader refuses. Not our case to answer.
            (_, Err(_)) => None,
        };
        report.record(&case.name, wrong);
    }
    report.finish();
}
