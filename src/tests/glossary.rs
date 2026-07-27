//! Glossary term auto-linking.

use super::*;

#[test]
fn links_terms_with_diacritics_without_panicking() {
    // Regression: slicing the original with lowercased-copy offsets panicked on
    // the diacritics these documents are full of. Terms are (term, slug),
    // longest-first.
    let terms = vec![
        ("King of Aṅga".to_string(), "king-of-aṅga".to_string()),
        ("Mahāpadma".to_string(), "mahāpadma".to_string()),
        ("Aṅga".to_string(), "aṅga".to_string()),
        ("Tuṣita".to_string(), "tuṣita".to_string()),
    ];
    let html = "<p>The King of Aṅga fought Mahāpadma near Aṅga, \
            while dwelling in Tuṣita. king of aṅga again.</p>";
    let linked = link_terms_in_html(html, &terms);

    // Longest-first: "King of Aṅga" wins over the bare "Aṅga" inside it.
    assert_contains(
        &linked,
        r#"<a href="glossary:king-of-aṅga">King of Aṅga</a>"#,
    );
    assert_contains(&linked, r#"<a href="glossary:mahāpadma">Mahāpadma</a>"#);
    assert_contains(&linked, r#"<a href="glossary:tuṣita">Tuṣita</a>"#);
    // The standalone "Aṅga" (comma after) still links via the short term.
    assert_contains(&linked, r#"<a href="glossary:aṅga">Aṅga</a>"#);
    // Case-insensitive match keeps the original casing in the link text.
    assert_contains(
        &linked,
        r#"<a href="glossary:king-of-aṅga">king of aṅga</a>"#,
    );
}

#[test]
fn does_not_link_substrings_inside_larger_words() {
    let terms = vec![("go".to_string(), "go".to_string())];
    // "go" must not match inside "going" or "ago".
    let linked = link_terms_in_html("<p>going ago; go now</p>", &terms);
    // "going" and "ago" are left untouched; only the standalone word links.
    assert_contains(&linked, "<p>going ago; ");
    assert_contains(&linked, r#"<a href="glossary:go">go</a> now</p>"#);
    assert!(
        !linked.contains(r#"<a href="glossary:go">go</a>ing"#),
        "should not have linked the 'go' inside 'going'"
    );
}

#[test]
fn auto_links_glossary_terms_from_an_ancestor_folder() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("leaf-glossary-walkup-{unique}"));
    // Glossary lives at the project root; the document sits several folders down.
    let deep = root.join("collection").join("volume").join("book");
    fs::create_dir_all(&deep).expect("tree is created");
    fs::write(
        root.join("GLOSSARY.md"),
        "# Glossary\n\n## Bodhisattva\n*byang chub sems dpa'*, a being bound for awakening.\n",
    )
    .expect("glossary written");

    let md = deep.join("chapter.md");
    fs::write(&md, "# Chapter\n\nThe Bodhisattva was dwelling there.\n").expect("markdown written");
    let from_md =
        opened_document_from_markdown("# Chapter\n\nThe Bodhisattva was dwelling there.\n", &md);

    let xml = deep.join("chapter.xml");
    let tei = "<TEI xmlns=\"http://www.tei-c.org/ns/1.0\"><text><body>\
            <div type=\"translation\"><p>The Bodhisattva was dwelling there.</p></div>\
            </body></text></TEI>";
    fs::write(&xml, tei).expect("xml written");
    let from_xml = opened_document_from_xml(tei, &xml);

    fs::remove_dir_all(&root).expect("tree removed");

    assert_contains(
        &from_md.html,
        r#"<a href="glossary:bodhisattva">Bodhisattva</a>"#,
    );
    assert_contains(
        &from_xml.html,
        r#"<a href="glossary:bodhisattva">Bodhisattva</a>"#,
    );
}

#[test]
fn does_not_auto_link_terms_inside_the_glossary_file_itself() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("leaf-glossary-self-{unique}"));
    fs::create_dir_all(&root).expect("tree is created");
    let glossary = root.join("GLOSSARY.md");
    let text = "# Glossary\n\n## Buddha\nan awakened one.\n\n## Dharma\nthe Buddha's teaching.\n";
    fs::write(&glossary, text).expect("glossary written");

    let rendered = opened_document_from_markdown(text, &glossary);
    fs::remove_dir_all(&root).expect("tree removed");

    // "Buddha" appears in the Dharma definition but must not be self-linked.
    assert!(
        !rendered.html.contains("glossary:buddha"),
        "the glossary file should not auto-link its own terms"
    );
}

#[test]
fn app_shell_raises_a_spinner_when_a_glossary_link_is_followed() {
    let html = app_shell_html();

    // The wait starts in the page, before the host is told: the host renders on
    // its own thread and can't send a spinner until that work is already done.
    assert_contains(
        &html,
        "      awaitGlossaryEntry();\n      send({ command: 'openGlossary', href: rawHref });",
    );
    assert_contains(
        &html,
        "    awaitGlossaryEntry();\n    send({ command: 'openGlossary', href: glossaryHrefBase + '#' + within });",
    );
    assert_contains(&html, "spinner.className = 'glossary-sheet-spinner';");
    // Neither an answer that never comes nor one the user stopped waiting for
    // may leave the sheet spinning.
    assert_contains(&html, "glossarySheetMessage('glossary.failed');");
    assert_contains(&html, "if (!glossaryWaiting) return;");
    assert_contains(&html, "window.leafGlossaryFailed = (reason) => {");

    // The spinner is delayed past the sheet's slide-up, so the common cached
    // lookup never flashes one.
    let css = reading_mode_css();
    assert_contains(
        &css,
        "  animation: leaf-glossary-wait-in 0.2s ease 0.3s forwards;",
    );
}
