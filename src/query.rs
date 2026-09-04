//! One filter syntax, parsed once and asked of anything.
//!
//! `#work status:open due:<friday -draft` means the same thing wherever it is typed, so the search box and the task views share one parser instead of two that nearly agree. Nothing here knows what a document is: a caller answers a handful of questions about one candidate and the tree does the rest, which is what lets a vault document and a task be filtered by the same string.
//!
//! **The parser is total.** A search box holds half a query nearly all the time, so an unclosed quote, an unmatched bracket and a trailing `OR` all mean something rather than raising an error where results should be. See the ticket's grammar table for every shape.
//!
//! A caller that cannot answer a question says so — [`FieldAnswer::Unknown`], or `None` — and the condition that asked matches nothing. The alternative is a caller guessing, which is how a filter comes to lie about what it filtered.

use std::path::Path;
use time::{Date, Duration, Weekday};

/// How deep brackets may nest. Past this a `(` is a plain character, so a wall of pasted punctuation cannot recurse the parser off the stack.
const MAX_GROUP_DEPTH: usize = 16;

/// The longest a field name may be. Longer than any real one, and short enough that a pasted time of day is never read as a field.
const MAX_FIELD_NAME: usize = 32;

/// Letters of English prose, rarest first. Skipping to a needle's rarest byte finds far fewer false starts than skipping to its first: 'm' in "demand" turns up half as often as 'd' does, and every false start costs a comparison.
const LETTERS_BY_RARITY: &[u8] = b"zqxjkvbpygfwmucldrhsnioate";

fn rank(byte: u8) -> usize {
    if byte == b' ' {
        // The one non-letter that is not rare. Pivoting a phrase on its space would skip to every gap in the document.
        return LETTERS_BY_RARITY.len();
    }
    LETTERS_BY_RARITY
        .iter()
        .position(|candidate| *candidate == byte)
        // Anything else that is not a letter is rarer than every letter.
        .unwrap_or(0)
}

fn rarest_byte(needle: &[u8]) -> usize {
    (0..needle.len())
        .min_by_key(|index| rank(needle[*index]))
        .unwrap_or(0)
}

/// Text to look for, lowercased once, with the path it takes and the byte it skips to decided here rather than per document. Built when a query is parsed, so a keystroke over a vault pays for this once instead of per file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Needle {
    text: String,
    ascii: bool,
    pivot: usize,
}

impl Needle {
    pub fn new(text: &str) -> Self {
        let text = text.to_lowercase();
        Self {
            ascii: text.is_ascii(),
            pivot: rarest_byte(text.as_bytes()),
            text,
        }
    }

    /// The lowercased text this looks for.
    pub fn text(&self) -> &str {
        &self.text
    }

    pub fn is_empty(&self) -> bool {
        self.text.is_empty()
    }

    /// The next place this appears at or after `from`, and its length **there** — case folding can make a match a different size than the needle.
    ///
    /// Offsets are into the text as it sits on disk, never into a lowercased copy of it: lowercasing can change a string's length, and offsets borrowed across that shift showed the wrong window of text and could land mid-character.
    pub fn find(&self, haystack: &str, from: usize) -> Option<(usize, usize)> {
        if self.text.is_empty() || from > haystack.len() {
            return None;
        }
        if self.ascii {
            self.find_ascii(haystack, from)
        } else {
            self.find_folded(haystack, from)
        }
    }

    pub fn is_in(&self, haystack: &str) -> bool {
        self.find(haystack, 0).is_some()
    }

    /// An all-ASCII needle — nearly every query — against text of any kind: skip to a byte that could be its rarest, in either case, then confirm the window around it. No allocation, and an ASCII byte in UTF-8 is never part of a longer character, so the offset is always a character boundary.
    fn find_ascii(&self, haystack: &str, from: usize) -> Option<(usize, usize)> {
        let needle = self.text.as_bytes();
        let bytes = haystack.as_bytes();
        let lower = *needle.get(self.pivot)?;
        let upper = lower.to_ascii_uppercase();
        let mut at = from + self.pivot;
        while at + (needle.len() - self.pivot) <= bytes.len() {
            let last_pivot = bytes.len() - (needle.len() - self.pivot) + 1;
            let found = at + memchr::memchr2(lower, upper, &bytes[at..last_pivot])?;
            let start = found - self.pivot;
            if bytes[start..start + needle.len()].eq_ignore_ascii_case(needle) {
                return Some((start, needle.len()));
            }
            at = found + 1;
        }
        None
    }

    /// A needle carrying a non-ASCII character, so `É` still finds `é`. Folds the text a character at a time as it walks it, which is slower per byte than the ASCII path and is the rare query.
    fn find_folded(&self, haystack: &str, from: usize) -> Option<(usize, usize)> {
        let head = self.text.chars().next()?;
        for (offset, ch) in haystack.get(from..)?.char_indices() {
            if ch.to_lowercase().next() != Some(head) {
                continue;
            }
            if let Some(length) = folded_match_len(&haystack[from + offset..], &self.text) {
                return Some((from + offset, length));
            }
        }
        None
    }
}

/// How much of `text` a folded `needle` covers at its start, if it covers any. Not the needle's own length: `İ` folds to two characters, so the span in the text can be a different number of bytes than the needle is.
fn folded_match_len(text: &str, needle: &str) -> Option<usize> {
    let mut wanted = needle.chars().peekable();
    let mut consumed = 0usize;
    for ch in text.chars() {
        if wanted.peek().is_none() {
            break;
        }
        for folded in ch.to_lowercase() {
            // A character that folds into more than the needle still wants ends past the match, so this is not one.
            if wanted.next() != Some(folded) {
                return None;
            }
        }
        consumed += ch.len_utf8();
    }
    wanted.next().is_none().then_some(consumed)
}

/// One value of one field, as the caller holds it. The caller converts its own representation into this, which is why the parser needs to know nothing about frontmatter. Owned, because a caller that parses its fields on the way past has nothing for a borrow to point at.
#[derive(Debug, Clone, PartialEq)]
pub enum FieldValue {
    Text(String),
    Number(f64),
    Checkbox(bool),
    Date(Date),
}

impl FieldValue {
    /// The value written out, for the `key:value` test that compares text.
    fn as_text(&self) -> String {
        match self {
            FieldValue::Text(text) => text.clone(),
            FieldValue::Number(number) => number.to_string(),
            FieldValue::Checkbox(state) => state.to_string(),
            FieldValue::Date(date) => date.to_string(),
        }
    }
}

/// What a caller can say about one field name.
#[derive(Debug, Clone, PartialEq)]
pub enum FieldAnswer {
    /// This caller does not hold fields at all — a task, or anything that holds no field block. Every field condition asked of it matches nothing.
    Unknown,
    /// It holds fields, and this is not one of them.
    Missing,
    Values(Vec<FieldValue>),
}

/// How many of a document's checkboxes are ticked. `task:open` wants one unticked; `task:done` wants some tasks and none left.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TaskTally {
    pub open: usize,
    pub done: usize,
}

/// One thing a filter can be asked of. Everything a condition wants to know is a method here, and a caller that cannot answer says so rather than pretending.
pub trait Candidate {
    /// The name shown for this — a file's name without its extension.
    fn name(&self) -> &str;

    /// Where it lives, so `in:` and `ext:` have something to read.
    fn path(&self) -> &str;

    /// The other names it answers to.
    fn aliases(&self) -> &[String] {
        &[]
    }

    /// Its whole text, or `None` from a caller that does not hold any.
    fn text(&self) -> Option<&str> {
        None
    }

    fn field(&self, name: &str) -> FieldAnswer {
        let _ = name;
        FieldAnswer::Unknown
    }

    /// The tags it carries, or `None` until something knows the vault's tag set.
    fn tags(&self) -> Option<&[String]> {
        None
    }

    /// Its checkboxes, or `None` from a caller that cannot see inside a document.
    fn tasks(&self) -> Option<TaskTally> {
        None
    }
}

/// The comparison a `key:<value` asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Compare {
    Before,
    After,
    NotAfter,
    NotBefore,
}

/// The right-hand side of a comparison, read once when the query is parsed.
#[derive(Debug, Clone, PartialEq)]
pub enum Bound {
    Date(Date),
    Number(f64),
    Text(String),
}

/// What a `key:…` asks of one field.
#[derive(Debug, Clone, PartialEq)]
pub enum FieldTest {
    /// `status:` — set at all, whatever it says.
    Set,
    /// `status:open` — one of its values is exactly that. `date` is the same value read as a day when it reads as one, so `due:today` finds a date field rather than a field holding the word.
    Is { text: String, date: Option<Date> },
    /// `due:<friday`.
    Compare(Compare, Bound),
}

/// One node of a parsed query.
#[derive(Debug, Clone, PartialEq)]
pub enum Condition {
    /// A word or a quoted phrase, looked for in a name, an alias, the folder path or the text — the same four places a bare term reaches today.
    Text(Needle),
    /// `#work`, matching that tag or anything under it.
    Tag(String),
    Field {
        name: String,
        test: FieldTest,
    },
    /// `in:notes/2026`.
    In(String),
    /// `ext:md`.
    Ext(String),
    /// `task:open` / `task:done`.
    Task {
        open: bool,
    },
    Not(Box<Condition>),
    All(Vec<Condition>),
    Any(Vec<Condition>),
}

/// Which kinds of question a query asks, so a caller can say which part of a filter it could not apply without being handed a row to probe.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Asks {
    pub text: bool,
    pub fields: bool,
    pub tags: bool,
    pub tasks: bool,
}

/// A filter, parsed.
#[derive(Debug, Clone, PartialEq)]
pub struct Query {
    root: Condition,
}

impl Query {
    /// Parse a filter. `today` anchors every date word in it, so `friday` is the reader's Friday rather than the machine's idea of one.
    pub fn parse(text: &str, today: Date) -> Self {
        let tokens = lex(text);
        let mut parser = Parser {
            tokens: &tokens,
            at: 0,
            today,
        };
        let root = parser.parse_or(0);
        Self {
            root: root.unwrap_or_else(|| Condition::All(Vec::new())),
        }
    }

    /// A query asking nothing — an empty box, or one holding only punctuation that dropped out.
    pub fn is_empty(&self) -> bool {
        matches!(&self.root, Condition::All(parts) if parts.is_empty())
    }

    /// Whether this is nothing but required words, which is what the search box did before there was a syntax. The narrowing shortcut is only sound for one of these: `OR` and `-` can both grow what a longer query matches.
    pub fn is_plain(&self) -> bool {
        match &self.root {
            Condition::Text(_) => true,
            Condition::All(parts) => parts.iter().all(|part| matches!(part, Condition::Text(_))),
            _ => false,
        }
    }

    pub fn root(&self) -> &Condition {
        &self.root
    }

    /// Whether one candidate passes.
    pub fn matches(&self, candidate: &dyn Candidate) -> bool {
        matches_condition(&self.root, candidate)
    }

    /// The words worth scoring a hit on, in the order they were typed. Everything under a `-` is left out: a document does not rank higher for the absence of a word.
    pub fn scoring_needles(&self) -> Vec<&Needle> {
        let mut out = Vec::new();
        collect_needles(&self.root, false, &mut out);
        out
    }

    /// Every field name the query names, in the order they were typed and without repeats, so a caller can say which of them it has never heard of.
    pub fn field_names(&self) -> Vec<&str> {
        let mut out: Vec<&str> = Vec::new();
        collect_field_names(&self.root, &mut out);
        out
    }

    pub fn asks(&self) -> Asks {
        let mut asks = Asks::default();
        collect_asks(&self.root, &mut asks);
        asks
    }

    /// The query read back in words, for the line under the box. A person who typed `due:<fri` and got nothing needs to see that the app read it as a date before they will believe the empty list.
    pub fn describe(&self) -> String {
        describe(&self.root, false)
    }
}

fn describe(condition: &Condition, nested: bool) -> String {
    match condition {
        Condition::Text(needle) => needle.text().to_string(),
        Condition::Tag(tag) => format!("tagged {tag}"),
        Condition::Field { name, test } => match test {
            FieldTest::Set => format!("{name} is set"),
            FieldTest::Is { text, date } => match date {
                Some(day) => format!("{name} is {day}"),
                None => format!("{name} is {text}"),
            },
            FieldTest::Compare(compare, bound) => {
                // A date is before and after; a number is under and over. The same words for both would have the box reading `rating:>4` back as "rating after 4".
                let dated = matches!(bound, Bound::Date(_));
                let word = match (compare, dated) {
                    (Compare::Before, true) => "before",
                    (Compare::Before, false) => "under",
                    (Compare::After, true) => "after",
                    (Compare::After, false) => "over",
                    (Compare::NotAfter, _) => "up to",
                    (Compare::NotBefore, _) => "from",
                };
                format!("{name} {word} {}", describe_bound(bound))
            }
        },
        Condition::In(folder) => format!("in {folder}"),
        Condition::Ext(extension) => format!(".{extension} files"),
        Condition::Task { open: true } => "with something unfinished".to_string(),
        Condition::Task { open: false } => "with everything finished".to_string(),
        Condition::Not(inner) => format!("not {}", describe(inner, true)),
        Condition::All(parts) => join(parts, ", ", nested),
        Condition::Any(parts) => join(parts, " or ", nested),
    }
}

fn join(parts: &[Condition], separator: &str, nested: bool) -> String {
    let inner = parts
        .iter()
        .map(|part| describe(part, true))
        .collect::<Vec<_>>()
        .join(separator);
    if nested && parts.len() > 1 {
        return format!("({inner})");
    }
    inner
}

fn describe_bound(bound: &Bound) -> String {
    match bound {
        Bound::Date(date) => date.to_string(),
        Bound::Number(number) => number.to_string(),
        Bound::Text(text) => text.clone(),
    }
}

fn collect_needles<'a>(condition: &'a Condition, negated: bool, out: &mut Vec<&'a Needle>) {
    match condition {
        Condition::Text(needle) if !negated => out.push(needle),
        Condition::Not(inner) => collect_needles(inner, !negated, out),
        Condition::All(parts) | Condition::Any(parts) => {
            for part in parts {
                collect_needles(part, negated, out);
            }
        }
        _ => {}
    }
}

fn collect_field_names<'a>(condition: &'a Condition, out: &mut Vec<&'a str>) {
    match condition {
        Condition::Field { name, .. } => {
            if !out.iter().any(|seen| seen.eq_ignore_ascii_case(name)) {
                out.push(name);
            }
        }
        Condition::Not(inner) => collect_field_names(inner, out),
        Condition::All(parts) | Condition::Any(parts) => {
            for part in parts {
                collect_field_names(part, out);
            }
        }
        _ => {}
    }
}

fn collect_asks(condition: &Condition, asks: &mut Asks) {
    match condition {
        Condition::Text(_) => asks.text = true,
        Condition::Field { .. } => asks.fields = true,
        Condition::Tag(_) => asks.tags = true,
        Condition::Task { .. } => asks.tasks = true,
        Condition::Not(inner) => collect_asks(inner, asks),
        Condition::All(parts) | Condition::Any(parts) => {
            for part in parts {
                collect_asks(part, asks);
            }
        }
        Condition::In(_) | Condition::Ext(_) => {}
    }
}

fn matches_condition(condition: &Condition, candidate: &dyn Candidate) -> bool {
    match condition {
        Condition::Text(needle) => matches_text(needle, candidate),
        Condition::Tag(tag) => match candidate.tags() {
            // The tag itself, or anything under it: `#work` finds `#work/reports`.
            Some(tags) => tags.iter().any(|carried| {
                carried.eq_ignore_ascii_case(tag)
                    || carried
                        .get(..tag.len())
                        .is_some_and(|head| head.eq_ignore_ascii_case(tag))
                        && carried.as_bytes().get(tag.len()) == Some(&b'/')
            }),
            None => false,
        },
        Condition::Field { name, test } => match candidate.field(name) {
            FieldAnswer::Unknown | FieldAnswer::Missing => false,
            FieldAnswer::Values(values) => matches_field(test, &values),
        },
        Condition::In(folder) => folder_key(candidate.path()).contains(folder),
        Condition::Ext(extension) => Path::new(candidate.path())
            .extension()
            .and_then(|found| found.to_str())
            .is_some_and(|found| found.eq_ignore_ascii_case(extension)),
        Condition::Task { open } => match candidate.tasks() {
            // Finished means there were tasks and none is left, not merely that a document has no checkbox in it.
            Some(tally) if *open => tally.open > 0,
            Some(tally) => tally.done > 0 && tally.open == 0,
            None => false,
        },
        Condition::Not(inner) => !matches_condition(inner, candidate),
        Condition::All(parts) => parts.iter().all(|part| matches_condition(part, candidate)),
        Condition::Any(parts) => parts.iter().any(|part| matches_condition(part, candidate)),
    }
}

/// The four places a bare term reaches: the name, any alias, the folder path, and the text.
fn matches_text(needle: &Needle, candidate: &dyn Candidate) -> bool {
    if needle.is_in(candidate.name()) {
        return true;
    }
    if candidate
        .aliases()
        .iter()
        .any(|alias| needle.is_in(alias.as_str()))
    {
        return true;
    }
    if needle.is_in(folder_of(candidate.path())) {
        return true;
    }
    candidate.text().is_some_and(|text| needle.is_in(text))
}

fn matches_field(test: &FieldTest, values: &[FieldValue]) -> bool {
    match test {
        FieldTest::Set => !values.is_empty(),
        FieldTest::Is { text, date } => values.iter().any(|value| {
            value.as_text().eq_ignore_ascii_case(text)
                || matches!((value, date), (FieldValue::Date(held), Some(wanted)) if held == wanted)
        }),
        FieldTest::Compare(compare, bound) => values
            .iter()
            .any(|value| compare_value(*compare, value, bound)),
    }
}

fn compare_value(compare: Compare, value: &FieldValue, bound: &Bound) -> bool {
    // A comparison only means something between two of a kind, so a date field asked against a number is not a match rather than a coincidence.
    let ordering = match (value, bound) {
        (FieldValue::Date(held), Bound::Date(wanted)) => held.cmp(wanted),
        (FieldValue::Number(held), Bound::Number(wanted)) => match held.partial_cmp(wanted) {
            Some(ordering) => ordering,
            None => return false,
        },
        (_, Bound::Text(wanted)) => value.as_text().to_lowercase().cmp(&wanted.to_lowercase()),
        _ => return false,
    };
    match compare {
        Compare::Before => ordering.is_lt(),
        Compare::After => ordering.is_gt(),
        Compare::NotAfter => ordering.is_le(),
        Compare::NotBefore => ordering.is_ge(),
    }
}

/// A document's folders: its path without the file name.
fn folder_of(path: &str) -> &str {
    &path[..path.rfind(['/', '\\']).unwrap_or(0)]
}

/// A path written the one way `in:` compares against: lowercase, forward slashes. `in:notes/2026` is then a substring test, which is why `in:notes` also finds what is under it.
fn folder_key(path: &str) -> String {
    folder_of(path).to_lowercase().replace('\\', "/")
}

/// What the tokenizer hands the parser.
#[derive(Debug, Clone, PartialEq)]
enum Token {
    Open,
    Close,
    Or,
    Not,
    /// A bare run of text, still to be read as a word, a tag or a field.
    Bare(String),
    /// Text that was in quotes: literal, whatever is in it.
    Quoted(String),
}

fn lex(input: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut chars = input.char_indices().peekable();
    while let Some((_, ch)) = chars.peek().copied() {
        if ch.is_whitespace() {
            chars.next();
            continue;
        }
        match ch {
            '(' => {
                chars.next();
                tokens.push(Token::Open);
            }
            ')' => {
                chars.next();
                tokens.push(Token::Close);
            }
            '"' => {
                chars.next();
                tokens.push(Token::Quoted(read_quoted(&mut chars)));
            }
            _ => {
                let run = read_run(&mut chars);
                push_run(&run, &mut tokens);
            }
        }
    }
    tokens
}

type Chars<'a> = std::iter::Peekable<std::str::CharIndices<'a>>;

/// The rest of a quoted span. An unclosed quote runs to the end of what was typed, because that is what a search box is holding halfway through a phrase.
fn read_quoted(chars: &mut Chars<'_>) -> String {
    let mut out = String::new();
    for (_, ch) in chars.by_ref() {
        if ch == '"' {
            break;
        }
        out.push(ch);
    }
    out
}

/// One run of non-whitespace, stopping at a bracket so `-(a b)` groups. A quote inside it opens a span that may hold spaces, so `status:"in progress"` is one value.
fn read_run(chars: &mut Chars<'_>) -> String {
    let mut out = String::new();
    while let Some((_, ch)) = chars.peek().copied() {
        if ch.is_whitespace() || ch == '(' || ch == ')' {
            break;
        }
        chars.next();
        if ch == '"' {
            out.push_str(&read_quoted(chars));
            continue;
        }
        out.push(ch);
    }
    out
}

fn push_run(run: &str, tokens: &mut Vec<Token>) {
    let Some(rest) = run.strip_prefix('-') else {
        push_word(run, tokens);
        return;
    };
    if rest.is_empty() {
        // A lone `-` excludes nothing, so it is the character somebody typed.
        push_word(run, tokens);
        return;
    }
    tokens.push(Token::Not);
    push_run(rest, tokens);
}

fn push_word(run: &str, tokens: &mut Vec<Token>) {
    if run.is_empty() {
        return;
    }
    if run == "OR" {
        tokens.push(Token::Or);
        return;
    }
    if run == "AND" {
        // A space already means and; accepting the word keeps a query pasted from another box meaning what it did there.
        return;
    }
    tokens.push(Token::Bare(run.to_string()));
}

struct Parser<'a> {
    tokens: &'a [Token],
    at: usize,
    today: Date,
}

impl Parser<'_> {
    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.at)
    }

    /// `a OR b`. A side that parsed to nothing drops out, so `a OR` is `a` and a bare `OR` is nothing.
    fn parse_or(&mut self, depth: usize) -> Option<Condition> {
        let mut parts: Vec<Condition> = Vec::new();
        loop {
            if let Some(condition) = self.parse_and(depth) {
                parts.push(condition);
            }
            match self.peek() {
                Some(Token::Or) => {
                    self.at += 1;
                }
                _ => break,
            }
        }
        match parts.len() {
            0 => None,
            1 => parts.pop(),
            _ => Some(Condition::Any(parts)),
        }
    }

    /// A run of terms with spaces between them.
    fn parse_and(&mut self, depth: usize) -> Option<Condition> {
        let mut parts: Vec<Condition> = Vec::new();
        while let Some(token) = self.peek() {
            if matches!(token, Token::Or | Token::Close) {
                break;
            }
            match self.parse_unary(depth) {
                Some(condition) => parts.push(condition),
                None => continue,
            }
        }
        match parts.len() {
            0 => None,
            1 => parts.pop(),
            _ => Some(Condition::All(parts)),
        }
    }

    fn parse_unary(&mut self, depth: usize) -> Option<Condition> {
        if matches!(self.peek(), Some(Token::Not)) {
            self.at += 1;
            // Excluding nothing is nothing, not "everything".
            return self
                .parse_unary(depth)
                .map(|inner| Condition::Not(Box::new(inner)));
        }
        self.parse_primary(depth)
    }

    fn parse_primary(&mut self, depth: usize) -> Option<Condition> {
        let token = self.peek()?.clone();
        self.at += 1;
        match token {
            Token::Open => {
                // Past the depth cap the bracket is a character, which is the one thing that cannot recurse.
                if depth >= MAX_GROUP_DEPTH {
                    return Some(Condition::Text(Needle::new("(")));
                }
                // An unmatched `(` groups to the end of what was typed; the close is taken when it is there.
                let inner = self.parse_or(depth + 1);
                if matches!(self.peek(), Some(Token::Close)) {
                    self.at += 1;
                }
                inner
            }
            // A stray close belongs to no group.
            Token::Close => None,
            Token::Or | Token::Not => None,
            Token::Quoted(text) => non_empty_needle(&text),
            Token::Bare(run) => Some(self.parse_bare(&run)),
        }
    }

    /// A bare run: a tag, a field, or a word.
    fn parse_bare(&mut self, run: &str) -> Condition {
        if let Some(tag) = run.strip_prefix('#') {
            if !tag.is_empty() {
                return Condition::Tag(tag.trim_end_matches('/').to_string());
            }
        }
        if let Some((name, value)) = split_field(run) {
            return self.field_condition(name, value);
        }
        Condition::Text(Needle::new(run))
    }

    fn field_condition(&self, name: &str, value: &str) -> Condition {
        match name.to_ascii_lowercase().as_str() {
            "in" if !value.is_empty() => {
                return Condition::In(value.to_lowercase().replace('\\', "/"))
            }
            "ext" if !value.is_empty() => {
                return Condition::Ext(value.trim_start_matches('.').to_string())
            }
            "task" => {
                // Anything but `done` is the unfinished half, so `task:` and `task:open` agree.
                return Condition::Task {
                    open: !value.eq_ignore_ascii_case("done"),
                };
            }
            _ => {}
        }
        let test = match value.strip_prefix("<=") {
            Some(rest) => FieldTest::Compare(Compare::NotAfter, self.bound(rest)),
            None => match value.strip_prefix(">=") {
                Some(rest) => FieldTest::Compare(Compare::NotBefore, self.bound(rest)),
                None => match value.strip_prefix('<') {
                    Some(rest) => FieldTest::Compare(Compare::Before, self.bound(rest)),
                    None => match value.strip_prefix('>') {
                        Some(rest) => FieldTest::Compare(Compare::After, self.bound(rest)),
                        None if value.is_empty() => FieldTest::Set,
                        None => FieldTest::Is {
                            text: value.to_string(),
                            date: read_date(value, self.today),
                        },
                    },
                },
            },
        };
        Condition::Field {
            name: name.to_string(),
            test,
        }
    }

    fn bound(&self, value: &str) -> Bound {
        if let Some(date) = read_date(value, self.today) {
            return Bound::Date(date);
        }
        if let Ok(number) = value.parse::<f64>() {
            if number.is_finite() {
                return Bound::Number(number);
            }
        }
        Bound::Text(value.to_string())
    }
}

fn non_empty_needle(text: &str) -> Option<Condition> {
    let needle = Needle::new(text.trim());
    (!needle.is_empty()).then_some(Condition::Text(needle))
}

/// Split a run into a field name and its value, when it looks like one. The three rules keep a pasted Windows path, a time of day and a web address as the findable text they are today — see the ticket's grammar table.
fn split_field(run: &str) -> Option<(&str, &str)> {
    let (name, value) = run.split_once(':')?;
    if name.is_empty() || name.len() > MAX_FIELD_NAME {
        return None;
    }
    if !name.chars().any(|ch| ch.is_ascii_alphabetic()) {
        return None;
    }
    if !name
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return None;
    }
    if value.starts_with('/') || value.starts_with('\\') {
        return None;
    }
    Some((name, value))
}

/// A date word, against the day the reader is having. `None` for anything that is not one, which is how a value falls through to a number or to text.
fn read_date(value: &str, today: Date) -> Option<Date> {
    let word = value.trim().to_ascii_lowercase();
    match word.as_str() {
        "today" => return Some(today),
        "tomorrow" => return today.next_day(),
        "yesterday" => return today.previous_day(),
        _ => {}
    }
    if let Some(weekday) = weekday_named(&word) {
        // The next one, and today when today is one.
        let ahead = (weekday.number_days_from_monday() as i64
            - today.weekday().number_days_from_monday() as i64)
            .rem_euclid(7);
        return today.checked_add(Duration::days(ahead));
    }
    if let Some(days) = relative_days(&word, "last") {
        return today.checked_sub(Duration::days(days));
    }
    if let Some(days) = relative_days(&word, "next") {
        return today.checked_add(Duration::days(days));
    }
    Date::parse(
        &word,
        time::macros::format_description!("[year]-[month]-[day]"),
    )
    .ok()
}

fn weekday_named(word: &str) -> Option<Weekday> {
    Some(match word {
        "monday" => Weekday::Monday,
        "tuesday" => Weekday::Tuesday,
        "wednesday" => Weekday::Wednesday,
        "thursday" => Weekday::Thursday,
        "friday" => Weekday::Friday,
        "saturday" => Weekday::Saturday,
        "sunday" => Weekday::Sunday,
        _ => return None,
    })
}

/// `last7d` and `next7d`, for any number of days.
fn relative_days(word: &str, prefix: &str) -> Option<i64> {
    word.strip_prefix(prefix)?.strip_suffix('d')?.parse().ok()
}

/// The date to read `friday` against when nobody said which day it is. The page sends the reader's own date with every query; this is the answer for a caller with no page behind it, and for one whose page sent something unreadable.
pub fn utc_today() -> Date {
    time::OffsetDateTime::from_unix_timestamp(crate::now_unix() as i64)
        .map(|now| now.date())
        .unwrap_or(Date::MIN)
}

/// The date a page sent with its query, or [`utc_today`] when it sent nothing readable.
pub fn today_or_utc(sent: Option<&str>) -> Date {
    sent.and_then(|text| {
        Date::parse(
            text.trim(),
            time::macros::format_description!("[year]-[month]-[day]"),
        )
        .ok()
    })
    .unwrap_or_else(utc_today)
}
