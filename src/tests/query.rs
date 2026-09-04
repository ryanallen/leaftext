//! One filter syntax: every row of the table it promises, and every malformed shape a half-typed box holds.

use super::*;

use time::macros::date;

/// The day every date word in these tests is read against. A Thursday, so `friday` is tomorrow and `thursday` is today.
const TODAY: time::Date = date!(2026 - 08 - 06);

/// A candidate that answers everything, so a test says what it is testing by setting one field rather than by which methods exist.
#[derive(Default)]
struct Note {
    name: String,
    path: String,
    aliases: Vec<String>,
    text: Option<String>,
    /// Field name, then its values. `None` for a caller that holds no fields at all.
    fields: Option<Vec<(String, Vec<FieldValue>)>>,
    tags: Option<Vec<String>>,
    tasks: Option<TaskTally>,
}

impl Candidate for Note {
    fn name(&self) -> &str {
        &self.name
    }

    fn path(&self) -> &str {
        &self.path
    }

    fn aliases(&self) -> &[String] {
        &self.aliases
    }

    fn text(&self) -> Option<&str> {
        self.text.as_deref()
    }

    fn field(&self, name: &str) -> FieldAnswer {
        let Some(fields) = &self.fields else {
            return FieldAnswer::Unknown;
        };
        match fields
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
        {
            Some((_, values)) => FieldAnswer::Values(values.clone()),
            None => FieldAnswer::Missing,
        }
    }

    fn tags(&self) -> Option<&[String]> {
        self.tags.as_deref()
    }

    fn tasks(&self) -> Option<TaskTally> {
        self.tasks
    }
}

fn note(name: &str, path: &str, text: &str) -> Note {
    Note {
        name: name.to_string(),
        path: path.to_string(),
        text: Some(text.to_string()),
        ..Note::default()
    }
}

fn matches(query: &str, candidate: &Note) -> bool {
    Query::parse(query, TODAY).matches(candidate)
}

fn meadow() -> Note {
    note(
        "The Meadow Walk",
        "C:\\vault\\notes\\2026\\the-meadow-walk.md",
        "A draft about the meadow walk and the road.",
    )
}

#[test]
fn a_bare_word_reaches_the_name_an_alias_the_folder_and_the_text() {
    let mut subject = meadow();
    subject.aliases = vec!["Kerouac".to_string()];
    assert!(matches("meadow", &subject), "the name");
    assert!(matches("kerouac", &subject), "an alias");
    assert!(matches("2026", &subject), "the folder");
    assert!(matches("road", &subject), "the text");
    assert!(!matches("kafka", &subject));
}

#[test]
fn a_space_means_and_as_it_always_has() {
    let subject = meadow();
    assert!(matches("meadow road", &subject));
    assert!(!matches("meadow kafka", &subject));
}

#[test]
fn a_quoted_phrase_wants_those_words_in_that_order() {
    let subject = meadow();
    assert!(matches("\"the meadow walk\"", &subject));
    assert!(!matches("\"walk meadow\"", &subject));
}

#[test]
fn a_minus_excludes() {
    let subject = meadow();
    assert!(!matches("-draft", &subject));
    assert!(matches("-kafka", &subject));
    assert!(matches("meadow -kafka", &subject));
}

#[test]
fn minus_and_hash_inside_a_quoted_phrase_are_plain_characters() {
    let subject = note(
        "Notes",
        "C:\\vault\\notes.md",
        "a -draft and a #work marker",
    );
    assert!(matches("\"-draft\"", &subject), "the minus is literal");
    assert!(matches("\"#work\"", &subject), "the hash is literal");
    // Unquoted, both are syntax: this note carries no tags at all, so `#work` matches nothing.
    assert!(!matches("#work", &subject));
    assert!(!matches("-draft", &subject));
}

#[test]
fn a_tag_matches_itself_and_anything_under_it() {
    let mut subject = meadow();
    subject.tags = Some(vec!["work/reports".to_string()]);
    assert!(matches("#work", &subject), "the parent");
    assert!(matches("#work/reports", &subject), "the tag itself");
    assert!(!matches("#workshop", &subject), "not a prefix of a word");
    assert!(!matches("#home", &subject));
}

#[test]
fn a_tag_matches_nothing_when_the_caller_does_not_know_the_tag_set() {
    let subject = meadow();
    assert_eq!(subject.tags(), None);
    assert!(!matches("#work", &subject), "cannot answer, so no match");
}

#[test]
fn a_field_is_read_by_value_and_by_being_set_at_all() {
    let mut subject = meadow();
    subject.fields = Some(vec![(
        "status".to_string(),
        vec![FieldValue::Text("open".to_string())],
    )]);
    assert!(matches("status:open", &subject));
    assert!(matches("status:OPEN", &subject), "value case is ignored");
    assert!(matches("Status:open", &subject), "name case is ignored");
    assert!(matches("status:", &subject), "set, whatever it says");
    assert!(!matches("status:done", &subject));
    assert!(!matches("due:", &subject), "a field this note has not got");
}

#[test]
fn a_field_matches_nothing_when_the_caller_holds_no_fields() {
    let subject = meadow();
    assert_eq!(subject.field("status"), FieldAnswer::Unknown);
    assert!(!matches("status:open", &subject));
    assert!(!matches("status:", &subject));
}

#[test]
fn an_unknown_field_name_is_carried_through_for_the_message() {
    let query = Query::parse("duee:open meadow status:<friday", TODAY);
    assert_eq!(query.field_names(), vec!["duee", "status"]);
}

#[test]
fn a_date_field_compares_as_a_date() {
    let mut subject = meadow();
    subject.fields = Some(vec![(
        "due".to_string(),
        vec![FieldValue::Date(date!(2026 - 08 - 07))],
    )]);
    assert!(matches("due:<saturday", &subject), "the 7th is a Friday");
    assert!(matches("due:>today", &subject));
    assert!(matches("due:tomorrow", &subject), "equal to the 7th");
    assert!(matches("due:<=2026-08-07", &subject));
    assert!(matches("due:>=2026-08-07", &subject));
    assert!(!matches("due:<yesterday", &subject));
    assert!(!matches("due:<last7d", &subject));
    assert!(matches("due:<next7d", &subject));
}

#[test]
fn a_weekday_means_the_next_one_and_today_when_today_is_one() {
    let mut subject = meadow();
    subject.fields = Some(vec![("due".to_string(), vec![FieldValue::Date(TODAY)])]);
    assert!(matches("due:thursday", &subject), "today is a Thursday");
    assert!(matches("due:<friday", &subject), "friday is tomorrow");
    assert!(!matches("due:friday", &subject));
}

#[test]
fn a_number_field_compares_as_a_number() {
    let mut subject = meadow();
    subject.fields = Some(vec![("rating".to_string(), vec![FieldValue::Number(4.5)])]);
    assert!(matches("rating:>4", &subject));
    assert!(!matches("rating:>5", &subject));
    assert!(matches("rating:<=4.5", &subject));
}

#[test]
fn a_checkbox_field_reads_as_the_word_it_was_written_with() {
    let mut subject = meadow();
    subject.fields = Some(vec![(
        "publish".to_string(),
        vec![FieldValue::Checkbox(true)],
    )]);
    assert!(matches("publish:true", &subject));
    assert!(!matches("publish:false", &subject));
}

#[test]
fn a_list_field_matches_on_any_of_its_items() {
    let mut subject = meadow();
    subject.fields = Some(vec![(
        "people".to_string(),
        vec![
            FieldValue::Text("Ada".to_string()),
            FieldValue::Text("Grace".to_string()),
        ],
    )]);
    assert!(matches("people:grace", &subject));
    assert!(!matches("people:alan", &subject));
}

#[test]
fn an_extension_and_a_folder_are_read_off_the_path() {
    let subject = meadow();
    assert!(matches("ext:md", &subject));
    assert!(matches("ext:MD", &subject));
    assert!(matches("ext:.md", &subject), "a leading dot is tolerated");
    assert!(!matches("ext:json", &subject));
    assert!(matches("in:notes/2026", &subject));
    assert!(matches("in:notes", &subject), "and everything under it");
    assert!(matches("in:notes\\2026", &subject), "either separator");
    assert!(!matches("in:archive", &subject));
}

#[test]
fn a_task_condition_reads_the_unfinished_markers() {
    let mut subject = meadow();
    assert!(
        !matches("task:open", &subject),
        "cannot answer, so no match"
    );
    subject.tasks = Some(TaskTally { open: 1, done: 2 });
    assert!(matches("task:open", &subject));
    assert!(!matches("task:done", &subject));
    subject.tasks = Some(TaskTally { open: 0, done: 2 });
    assert!(matches("task:done", &subject));
    assert!(!matches("task:open", &subject));
    subject.tasks = Some(TaskTally::default());
    assert!(
        !matches("task:done", &subject),
        "a document with no checkbox has not finished anything"
    );
}

#[test]
fn or_takes_either_side_and_brackets_group() {
    let subject = meadow();
    assert!(matches("kafka OR meadow", &subject));
    assert!(!matches("kafka OR proust", &subject));
    assert!(matches("(kafka OR meadow) -proust", &subject));
    assert!(!matches("(kafka OR meadow) -draft", &subject));
    assert!(matches("meadow AND road", &subject), "AND is the space");
}

#[test]
fn or_is_uppercase_only_so_a_document_named_or_is_still_found() {
    let subject = note("or", "C:\\vault\\or.md", "a document about disjunction");
    assert!(matches("or", &subject), "lowercase is a word");
    assert!(
        !matches("\"OR\" kafka", &subject),
        "the quoted literal is a word, and this one is absent"
    );
    assert!(matches("\"OR\" disjunction", &subject));
}

#[test]
fn an_unclosed_quote_runs_to_the_end_of_what_was_typed() {
    let subject = meadow();
    assert!(matches("\"the meadow", &subject));
    assert!(!matches("\"the kafka", &subject));
}

#[test]
fn an_unclosed_bracket_groups_to_the_end_and_a_stray_close_is_ignored() {
    let subject = meadow();
    assert!(matches("(kafka OR meadow", &subject));
    assert!(matches("meadow )", &subject));
    assert!(matches(") meadow (", &subject));
}

#[test]
fn a_dangling_or_drops_and_the_side_that_is_there_stands() {
    let subject = meadow();
    assert!(matches("meadow OR", &subject));
    assert!(matches("OR meadow", &subject));
    assert!(!matches("kafka OR", &subject));
    assert!(Query::parse("OR", TODAY).is_empty());
}

#[test]
fn an_empty_group_and_a_lone_minus_mean_what_they_look_like() {
    let subject = meadow();
    assert!(Query::parse("()", TODAY).is_empty());
    assert!(matches("() meadow", &subject));
    assert!(
        !matches("-", &subject),
        "a lone minus is the character, and this note has not got one"
    );
    assert!(matches("-", &note("a-b", "C:\\vault\\a-b.md", "")));
}

#[test]
fn a_colon_that_is_not_a_field_stays_findable_text() {
    let subject = note(
        "Paths",
        "C:\\vault\\paths.md",
        "See C:\\Users\\me and https://leaftext.com at 12:30.",
    );
    assert!(matches("c:\\Users\\me", &subject), "a Windows path");
    assert!(matches("https://leaftext.com", &subject), "a web address");
    assert!(matches("12:30", &subject), "a time of day");
    assert!(matches(":open", &subject) == false, "no name before it");
}

#[test]
fn a_field_name_longer_than_the_cap_is_text() {
    let long = "a".repeat(33);
    let subject = note("Long", "C:\\vault\\long.md", &format!("{long}:value here"));
    assert!(matches(&format!("{long}:value"), &subject));
}

#[test]
fn an_empty_query_asks_nothing() {
    assert!(Query::parse("", TODAY).is_empty());
    assert!(Query::parse("   ", TODAY).is_empty());
    assert!(!Query::parse("meadow", TODAY).is_empty());
}

#[test]
fn a_plain_query_is_told_apart_from_one_with_syntax_in_it() {
    assert!(Query::parse("meadow walk", TODAY).is_plain());
    assert!(Query::parse("\"the meadow walk\"", TODAY).is_plain());
    assert!(!Query::parse("meadow OR walk", TODAY).is_plain());
    assert!(!Query::parse("meadow -walk", TODAY).is_plain());
    assert!(!Query::parse("status:open", TODAY).is_plain());
    assert!(!Query::parse("#work", TODAY).is_plain());
}

#[test]
fn scoring_leaves_out_whatever_was_excluded() {
    let query = Query::parse("meadow -draft (walk OR road)", TODAY);
    let words: Vec<&str> = query
        .scoring_needles()
        .iter()
        .map(|needle| needle.text())
        .collect();
    assert_eq!(words, vec!["meadow", "walk", "road"]);
}

#[test]
fn a_query_says_which_kinds_of_question_it_asks() {
    let asks = Query::parse("meadow #work status:open task:open in:notes", TODAY).asks();
    assert_eq!(
        asks,
        Asks {
            text: true,
            fields: true,
            tags: true,
            tasks: true,
        }
    );
    let plain = Query::parse("meadow in:notes ext:md", TODAY).asks();
    assert_eq!(
        plain,
        Asks {
            text: true,
            fields: false,
            tags: false,
            tasks: false,
        }
    );
}

#[test]
fn a_query_of_two_hundred_terms_does_not_blow_the_stack() {
    let mut subject = meadow();
    subject.text = Some((0..200).fold(String::new(), |mut text, index| {
        text.push_str(&format!("word{index} "));
        text
    }));
    let query: String = (0..200)
        .map(|index| format!("word{index}"))
        .collect::<Vec<_>>()
        .join(" ");
    assert!(Query::parse(&query, TODAY).matches(&subject));
}

#[test]
fn brackets_nested_past_the_cap_become_plain_characters() {
    let subject = note(
        "Deep",
        "C:\\vault\\deep.md",
        "a ( in the text and meadow too",
    );
    let deep = format!("{}meadow{}", "(".repeat(64), ")".repeat(64));
    assert!(Query::parse(&deep, TODAY).matches(&subject));
}

#[test]
fn a_value_may_be_quoted_so_it_can_hold_a_space() {
    let mut subject = meadow();
    subject.fields = Some(vec![(
        "status".to_string(),
        vec![FieldValue::Text("in progress".to_string())],
    )]);
    assert!(matches("status:\"in progress\"", &subject));
    assert!(!matches("status:\"in\"", &subject));
}

#[test]
fn a_needle_folds_case_and_reports_the_span_it_covered() {
    let needle = Needle::new("Meadow");
    assert_eq!(needle.find("the MEADOW walk", 0), Some((4, 6)));
    assert_eq!(needle.find("nothing here", 0), None);
    let accented = Needle::new("café");
    assert!(accented.is_in("A CAFÉ somewhere"));
}

#[test]
fn the_date_a_page_sends_is_used_and_a_broken_one_falls_back() {
    assert_eq!(today_or_utc(Some("2026-08-06")), TODAY);
    assert_eq!(today_or_utc(Some(" 2026-08-06 ")), TODAY);
    assert_eq!(today_or_utc(Some("not a date")), utc_today());
    assert_eq!(today_or_utc(None), utc_today());
}

#[test]
fn the_box_reads_the_filter_back_in_words() {
    let query = Query::parse("#work status:open due:<friday -draft", TODAY);
    assert_eq!(
        query.describe(),
        "tagged work, status is open, due before 2026-08-07, not draft"
    );
    // A number is under and over; a date is before and after. One pair of words for both had the box reading `rating:>4` back as "rating after 4".
    assert_eq!(Query::parse("rating:>4", TODAY).describe(), "rating over 4");
    assert_eq!(
        Query::parse("rating:<4", TODAY).describe(),
        "rating under 4"
    );
    assert_eq!(
        Query::parse("(a OR b) ext:md task:open in:notes", TODAY).describe(),
        "(a or b), .md files, with something unfinished, in notes"
    );
}
