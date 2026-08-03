//! GitHub's additions: references, mentions, emoji, alerts, repo context.

use super::*;

pub(crate) fn github_markdown_extras(
    events: Vec<Event<'static>>,
    repository: Option<&RepositoryContext>,
) -> Vec<Event<'static>> {
    let mut transformed = Vec::new();
    let mut link_depth = 0usize;
    let mut code_block: Option<CodeBlockCapture> = None;
    let mut footnotes = FootnoteTracker::default();
    let mut current_footnote: Option<String> = None;
    // Where each definition's events landed in `transformed`, so they can be hoisted to the end (as GitHub does) once every reference is numbered.
    let mut footnote_ranges: Vec<(String, usize, usize)> = Vec::new();
    let mut footnote_start = 0usize;

    for event in events {
        if let Some(capture) = &mut code_block {
            match event {
                Event::Text(text) => capture.code.push_str(text.as_ref()),
                Event::End(TagEnd::CodeBlock) => {
                    transformed.push(Event::Html(cowstr(&render_code_block(capture))));
                    code_block = None;
                }
                _ => {}
            }
            continue;
        }

        match event {
            Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(info))) => {
                code_block = Some(CodeBlockCapture {
                    language: info
                        .split_whitespace()
                        .next()
                        .map(str::to_string)
                        .filter(|language| !language.is_empty()),
                    code: String::new(),
                });
            }
            Event::Start(Tag::Link { .. }) | Event::Start(Tag::Image { .. }) => {
                link_depth += 1;
                transformed.push(event);
            }
            Event::End(TagEnd::Link) | Event::End(TagEnd::Image) => {
                link_depth = link_depth.saturating_sub(1);
                transformed.push(event);
            }
            Event::Text(text) if link_depth == 0 => {
                append_github_text_events(text.as_ref(), repository, &mut transformed);
            }
            Event::Start(Tag::FootnoteDefinition(name)) => {
                current_footnote = Some(name.to_string());
                footnote_start = transformed.len();
                transformed.push(Event::Start(Tag::FootnoteDefinition(name)));
            }
            Event::End(TagEnd::FootnoteDefinition) => {
                if let Some(name) = current_footnote.take() {
                    let backlink = Event::Html(cowstr(&render_footnote_backlink(&name)));
                    // Insert inside the last paragraph so the icon sits inline at the sentence end, not as a separate block below it.
                    let last_para_end = (footnote_start..transformed.len())
                        .rev()
                        .find(|&i| matches!(transformed[i], Event::End(TagEnd::Paragraph)));
                    if let Some(idx) = last_para_end {
                        transformed.insert(idx, backlink);
                    } else {
                        transformed.push(backlink);
                    }
                    transformed.push(Event::End(TagEnd::FootnoteDefinition));
                    footnote_ranges.push((name, footnote_start, transformed.len()));
                } else {
                    transformed.push(Event::End(TagEnd::FootnoteDefinition));
                }
            }
            Event::FootnoteReference(name) => {
                transformed.push(Event::Html(cowstr(&footnotes.render_reference(&name))));
            }
            Event::DisplayMath(text) => {
                transformed.push(Event::DisplayMath(cowstr(text.trim())));
            }
            Event::InlineMath(text) => {
                transformed.push(Event::InlineMath(cowstr(text.trim())));
            }
            _ => transformed.push(event),
        }
    }

    if let Some(capture) = &code_block {
        transformed.push(Event::Html(cowstr(&render_code_block(capture))));
    }

    relocate_footnote_definitions(transformed, footnote_ranges, &footnotes)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RepositoryContext {
    pub(crate) owner: String,
    pub(crate) repo: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum GithubToken {
    Issue {
        owner: String,
        repo: String,
        number: String,
        text: String,
    },
    Mention {
        text: String,
    },
    Emoji {
        shortcode: String,
        glyph: &'static str,
    },
}

pub(crate) fn append_github_text_events(
    text: &str,
    repository: Option<&RepositoryContext>,
    events: &mut Vec<Event<'static>>,
) {
    let mut offset = 0;

    while offset < text.len() {
        if let Some((start, end, token)) = next_github_token(&text[offset..], repository) {
            if start > 0 {
                events.push(Event::Text(cowstr(&text[offset..offset + start])));
            }
            events.push(Event::Html(cowstr(&render_github_token(&token))));
            offset += end;
        } else {
            events.push(Event::Text(cowstr(&text[offset..])));
            break;
        }
    }
}

pub(crate) fn next_github_token(
    text: &str,
    repository: Option<&RepositoryContext>,
) -> Option<(usize, usize, GithubToken)> {
    text.char_indices()
        .filter_map(|(index, char)| {
            if index > 0 && !is_token_boundary(text[..index].chars().last()) {
                return None;
            }

            let tail = &text[index..];
            let token = match char {
                ':' => emoji_token(tail),
                '@' => mention_token(tail),
                '#' => issue_token(tail, repository),
                'A'..='Z' | 'a'..='z' | '0'..='9' => issue_token(tail, repository),
                _ => None,
            }?;
            Some((index, index + token_text_len(&token), token))
        })
        .next()
}

pub(crate) fn token_text_len(token: &GithubToken) -> usize {
    match token {
        GithubToken::Issue { text, .. } => text.len(),
        GithubToken::Mention { text } => text.len(),
        GithubToken::Emoji { shortcode, .. } => shortcode.len(),
    }
}

pub(crate) fn emoji_token(text: &str) -> Option<GithubToken> {
    let rest = text.strip_prefix(':')?;
    let end = rest.find(':')? + 2;
    let shortcode = &text[..end];
    let glyph = match shortcode {
        ":shipit:" => "🚢",
        ":rocket:" => "🚀",
        ":tada:" => "🎉",
        ":warning:" => "⚠️",
        ":white_check_mark:" => "✅",
        _ => return None,
    };

    Some(GithubToken::Emoji {
        shortcode: shortcode.to_string(),
        glyph,
    })
}

pub(crate) fn mention_token(text: &str) -> Option<GithubToken> {
    let username_end = take_identifier(&text[1..])? + 1;
    let mut end = username_end;

    if text[username_end..].starts_with('/') {
        let team_start = username_end + 1;
        end = take_identifier(&text[team_start..])? + team_start;
    }

    if !is_token_boundary(text[end..].chars().next()) {
        return None;
    }

    Some(GithubToken::Mention {
        text: text[..end].to_string(),
    })
}

pub(crate) fn issue_token(
    text: &str,
    repository: Option<&RepositoryContext>,
) -> Option<GithubToken> {
    if let Some(number) = text.strip_prefix('#').and_then(take_digits_text) {
        let repository = repository?;
        return issue_token_with_context(repository, number, &format!("#{number}"));
    }

    if let Some(number) = text.strip_prefix("GH-").and_then(take_digits_text) {
        let repository = repository?;
        return issue_token_with_context(repository, number, &format!("GH-{number}"));
    }

    let owner_end = take_identifier(text)?;
    if !text[owner_end..].starts_with('/') {
        return None;
    }
    let repo_start = owner_end + 1;
    let repo_end = take_repo_name(&text[repo_start..])? + repo_start;
    if !text[repo_end..].starts_with('#') {
        return None;
    }
    let number_start = repo_end + 1;
    let number = take_digits_text(&text[number_start..])?;
    if !is_token_boundary(text[number_start + number.len()..].chars().next()) {
        return None;
    }

    issue_token_with_context(
        &RepositoryContext {
            owner: text[..owner_end].to_string(),
            repo: text[repo_start..repo_end].to_string(),
        },
        number,
        &text[..number_start + number.len()],
    )
}

pub(crate) fn issue_token_with_context(
    repository: &RepositoryContext,
    number: &str,
    text: &str,
) -> Option<GithubToken> {
    Some(GithubToken::Issue {
        owner: repository.owner.clone(),
        repo: repository.repo.clone(),
        number: number.to_string(),
        text: text.to_string(),
    })
}

pub(crate) fn take_identifier(text: &str) -> Option<usize> {
    let mut end = 0;
    for (index, char) in text.char_indices() {
        if char.is_ascii_alphanumeric() || char == '-' {
            end = index + char.len_utf8();
        } else {
            break;
        }
    }
    (end > 0).then_some(end)
}

pub(crate) fn take_repo_name(text: &str) -> Option<usize> {
    let mut end = 0;
    for (index, char) in text.char_indices() {
        if char.is_ascii_alphanumeric() || char == '-' || char == '_' || char == '.' {
            end = index + char.len_utf8();
        } else {
            break;
        }
    }
    (end > 0).then_some(end)
}

pub(crate) fn take_digits_text(text: &str) -> Option<&str> {
    let end = text
        .char_indices()
        .take_while(|(_, char)| char.is_ascii_digit())
        .map(|(index, char)| index + char.len_utf8())
        .last()?;
    Some(&text[..end])
}

pub(crate) fn is_token_boundary(char: Option<char>) -> bool {
    char.map(|char| {
        !(char.is_ascii_alphanumeric() || matches!(char, '_' | '-' | '/' | '#' | '@' | ':'))
    })
    .unwrap_or(true)
}

pub(crate) fn render_github_token(token: &GithubToken) -> String {
    match token {
        GithubToken::Issue {
            owner,
            repo,
            number,
            text,
        } => format!(
            r#"<a class="github-ref issue-ref" href="https://github.com/{}/{}/issues/{}">{}</a>"#,
            encode_double_quoted_attribute(owner),
            encode_double_quoted_attribute(repo),
            encode_double_quoted_attribute(number),
            encode_text(text)
        ),
        GithubToken::Mention { text } => format!(
            r#"<span class="github-mention">{}</span>"#,
            encode_text(text)
        ),
        GithubToken::Emoji { shortcode, glyph } => format!(
            r#"<span class="emoji" title="{}" aria-label="{}">{}</span>"#,
            encode_double_quoted_attribute(shortcode),
            encode_double_quoted_attribute(shortcode),
            glyph
        ),
    }
}

pub(crate) fn repository_context(start: &Path) -> Option<RepositoryContext> {
    let mut current = if start.is_file() {
        start.parent()?.to_path_buf()
    } else {
        start.to_path_buf()
    };

    loop {
        let git = current.join(".git");
        if git.exists() {
            return repository_context_from_git(&git);
        }

        if !current.pop() {
            return None;
        }
    }
}

pub(crate) fn repository_context_from_git(git_path: &Path) -> Option<RepositoryContext> {
    let config_paths = if git_path.is_file() {
        let git_file = fs::read_to_string(git_path).ok()?;
        let git_dir = git_file.trim().strip_prefix("gitdir:")?.trim();
        let git_dir = PathBuf::from(git_dir);
        let mut paths = vec![git_dir.join("config")];
        if let Ok(commondir) = fs::read_to_string(git_dir.join("commondir")) {
            let commondir = commondir.trim();
            let common_path = if Path::new(commondir).is_absolute() {
                PathBuf::from(commondir)
            } else {
                git_dir.join(commondir)
            };
            paths.push(common_path.join("config"));
        }
        paths
    } else {
        vec![git_path.join("config")]
    };

    config_paths.into_iter().find_map(|config_path| {
        let config = fs::read_to_string(config_path).ok()?;
        config
            .lines()
            .find_map(|line| line.trim().strip_prefix("url = "))
            .and_then(repository_context_from_remote_url)
    })
}

pub(crate) fn repository_context_from_remote_url(url: &str) -> Option<RepositoryContext> {
    let path = url
        .strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("http://github.com/"))
        .or_else(|| url.strip_prefix("git@github.com:"))?;
    let path = path.strip_suffix(".git").unwrap_or(path);
    let mut parts = path.split('/');
    let owner = parts.next()?.to_string();
    let repo = parts.next()?.to_string();

    (!owner.is_empty() && !repo.is_empty()).then_some(RepositoryContext { owner, repo })
}
