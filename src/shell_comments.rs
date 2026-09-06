//! The front end with its comments taken out, for the copy a browser downloads.
//!
//! The desktop serves the fragments as written — it downloads nothing, and a thrown error there has to report a line somebody can open. A browser pays for every byte of the module before its first word appears, and 552 KB of the front end's 1,312 KB is prose no engine executes: 154 KB of the embed module compressed. So the strip runs on one side of that fork only, and [`crate::app_shell_script`] stays byte for byte what the fragments say.
//!
//! Matching `//` is not enough, because the front end writes that sequence inside strings, template literals and regular expressions — a URL alone carries one. So this reads the source as JavaScript rather than as text: it knows where a string ends, it follows a template literal through its `${…}` substitutions, and it tells a regular expression from a division by the token in front of the slash.

/// One thing the scanner is inside. The stack is what makes a template literal's substitution work: `` `a ${b ? `c` : d} e` `` opens a template, then code, then a second template, and each closing mark returns to the one below it.
enum Mode {
    /// Ordinary code. `braces` counts the `{` opened since this level began, so the `}` that ends a substitution is told from the one that ends a block.
    Code { braces: usize },
    /// Between the backticks of a template literal.
    Template,
}

/// What was last read, which is the only thing that says whether a `/` opens a regular expression or divides. `a / b` divides; `split(/ /)` does not.
enum Last {
    /// Nothing yet, so a slash opens a pattern.
    Nothing,
    /// A punctuation mark, kept so the set below can be asked about it.
    Punctuation(u8),
    /// A word — a name, a number or a keyword. Only the keywords let a pattern follow.
    Word(String),
}

/// Punctuation a regular expression may follow. `)` and `]` are absent on purpose: `(a + b) / 2` and `xs[0] / 2` are divisions, and `if (x) /re/.test(y)` — the one shape this reads the other way — is not written here. `}` is present because dividing by an object literal is not a thing anybody writes, while `if (x) { … } /re/.test(y)` is at least possible.
const REGEX_MAY_FOLLOW: &[u8] = b"(,=:[!&|?{};+-*%~^<>/";

/// Keywords a regular expression may follow. `return /^a/.test(x)` is a pattern; `total / count` is not.
const REGEX_MAY_FOLLOW_WORD: &[&str] = &[
    "return",
    "typeof",
    "instanceof",
    "in",
    "of",
    "new",
    "delete",
    "void",
    "throw",
    "case",
    "do",
    "else",
    "yield",
    "await",
];

/// The same JavaScript with its line and block comments removed, and nothing else changed.
///
/// A block comment leaves a space behind, or a newline where it spanned lines: `a/**/b` must not become `ab`, and a statement that relied on the comment's line break for automatic semicolon insertion must keep it. A line comment leaves its newline where it was, for the same reason.
pub(crate) fn without_comments(source: &str) -> String {
    let bytes = source.as_bytes();
    let mut out = String::with_capacity(source.len());
    let mut stack = vec![Mode::Code { braces: 0 }];
    let mut last = Last::Nothing;
    // Everything from here to the cut point is code to be copied through untouched, so a run of ordinary source costs one copy rather than one per byte.
    let mut kept = 0usize;
    let mut at = 0usize;

    while at < bytes.len() {
        let depth = stack.len();
        if matches!(stack.last(), Some(Mode::Template)) {
            match bytes[at] {
                // An escape covers whatever follows it, `${` and the closing backtick included.
                b'\\' => at += 2,
                b'`' => {
                    stack.pop();
                    at += 1;
                }
                b'$' if bytes.get(at + 1) == Some(&b'{') => {
                    stack.push(Mode::Code { braces: 0 });
                    at += 2;
                }
                _ => at += 1,
            }
            continue;
        }

        match bytes[at] {
            b'/' if bytes.get(at + 1) == Some(&b'/') => {
                out.push_str(&source[kept..at]);
                while at < bytes.len() && bytes[at] != b'\n' {
                    at += 1;
                }
                // The newline itself stays, so the line below still starts a statement.
                kept = at;
            }
            b'/' if bytes.get(at + 1) == Some(&b'*') => {
                out.push_str(&source[kept..at]);
                let opened = at;
                at += 2;
                while at < bytes.len() && !(bytes[at] == b'*' && bytes.get(at + 1) == Some(&b'/')) {
                    at += 1;
                }
                at = (at + 2).min(bytes.len());
                out.push(if source[opened..at].contains('\n') {
                    '\n'
                } else {
                    ' '
                });
                kept = at;
            }
            b'/' if regex_may_follow(&last) => {
                at = skip_regex(bytes, at);
                last = Last::Punctuation(b'/');
            }
            quote @ (b'"' | b'\'') => {
                at = skip_string(bytes, at, quote);
                last = Last::Punctuation(quote);
            }
            b'`' => {
                stack.push(Mode::Template);
                at += 1;
            }
            b'{' => {
                if let Some(Mode::Code { braces }) = stack.last_mut() {
                    *braces += 1;
                }
                last = Last::Punctuation(b'{');
                at += 1;
            }
            b'}' => {
                // A `}` with no block of its own open, inside a substitution, is the end of that substitution and the template around it goes on.
                if depth > 1 && matches!(stack.last(), Some(Mode::Code { braces: 0 })) {
                    stack.pop();
                } else {
                    if let Some(Mode::Code { braces }) = stack.last_mut() {
                        *braces = braces.saturating_sub(1);
                    }
                    last = Last::Punctuation(b'}');
                }
                at += 1;
            }
            byte => {
                if byte.is_ascii_whitespace() {
                    // Whitespace says nothing about what the next slash means.
                } else if is_word_byte(byte) {
                    let from = at;
                    while at < bytes.len() && is_word_byte(bytes[at]) {
                        at += 1;
                    }
                    last = Last::Word(source[from..at].to_string());
                    continue;
                } else {
                    last = Last::Punctuation(byte);
                }
                at += 1;
            }
        }
    }

    out.push_str(&source[kept.min(source.len())..]);
    out
}

/// Whether a `/` here opens a pattern rather than dividing.
fn regex_may_follow(last: &Last) -> bool {
    match last {
        Last::Nothing => true,
        Last::Punctuation(byte) => REGEX_MAY_FOLLOW.contains(byte),
        Last::Word(word) => REGEX_MAY_FOLLOW_WORD.contains(&word.as_str()),
    }
}

/// A name, a number or a keyword. `$` and `_` are name characters in JavaScript, and anything above ASCII is a letter as far as this needs to know.
fn is_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$' || byte >= 0x80
}

/// Past the closing quote of the string opening at `at`, or to the end of the source where it never closes.
fn skip_string(bytes: &[u8], at: usize, quote: u8) -> usize {
    let mut at = at + 1;
    while at < bytes.len() {
        match bytes[at] {
            b'\\' => at += 2,
            byte if byte == quote => return at + 1,
            _ => at += 1,
        }
    }
    at
}

/// Past the closing `/` of the pattern opening at `at`, and past its flags. A `/` inside a character class closes nothing — `[/]` is a slash, not the end of the pattern.
fn skip_regex(bytes: &[u8], at: usize) -> usize {
    let mut at = at + 1;
    let mut in_class = false;
    while at < bytes.len() {
        match bytes[at] {
            b'\\' => at += 2,
            b'[' => {
                in_class = true;
                at += 1;
            }
            b']' => {
                in_class = false;
                at += 1;
            }
            b'/' if !in_class => {
                at += 1;
                while at < bytes.len() && bytes[at].is_ascii_alphabetic() {
                    at += 1;
                }
                return at;
            }
            // A pattern cannot span a line. Where one appears to, the slash was a division after all and the scan is better off back in ordinary code than swallowing the rest of the file.
            b'\n' => return at,
            _ => at += 1,
        }
    }
    at
}
