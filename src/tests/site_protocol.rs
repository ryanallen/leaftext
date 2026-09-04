use super::*;

/// A folder with a page and everything a page hangs off itself, plus one thing a page has no business reading.
fn scratch_site(name: &str) -> PathBuf {
    let folder = std::env::temp_dir().join(format!("leaftext-site-{name}"));
    let _ = fs::remove_dir_all(&folder);
    fs::create_dir_all(folder.join("assets")).expect("the scratch folder");
    fs::write(
        folder.join("page.html"),
        r#"<link rel="stylesheet" href="assets/site.css"><p class="card">Words</p>"#,
    )
    .expect("the page");
    fs::write(
        folder.join("assets/site.css"),
        "@import url(\"deeper.css\"); .card { border: 3px solid #ff0000 }",
    )
    .expect("the stylesheet");
    fs::write(folder.join("assets/deeper.css"), ".card { padding: 12px }").expect("the import");
    fs::write(folder.join("assets/mark.png"), [0x89, b'P', b'N', b'G']).expect("the picture");
    fs::write(folder.join("assets/text.woff2"), [b'w', b'O', b'F', b'2']).expect("the font");
    fs::write(folder.join("notes.md"), "# Not a page asset").expect("the note");
    fs::write(folder.join("keys.env"), "SECRET=1").expect("the file a page may not read");
    folder
}

/// The address the page is given as its base, which is the only way in.
fn site_base(folder: &Path) -> String {
    let document = opened_document_from_source(
        &fs::read_to_string(folder.join("page.html")).expect("the page"),
        folder.join("page.html"),
    );
    let at = document.html.find("&lt;base href=&quot;").expect("a base");
    let rest = &document.html[at + "&lt;base href=&quot;".len()..];
    rest[..rest.find("&quot;").expect("the base closes")].to_string()
}

#[test]
fn the_page_folder_answers_a_stylesheet_a_nested_import_a_picture_and_a_font() {
    let folder = scratch_site("assets");
    let base = site_base(&folder);

    for (path, kind, first) in [
        ("assets/site.css", "text/css; charset=utf-8", "@import"),
        ("assets/deeper.css", "text/css; charset=utf-8", ".card"),
    ] {
        let answer = site_protocol_response(&format!("{base}{path}"));
        assert_eq!(answer.status, 200, "{path} was refused");
        assert_eq!(answer.content_type, kind);
        assert!(String::from_utf8_lossy(&answer.body).starts_with(first));
    }

    let picture = site_protocol_response(&format!("{base}assets/mark.png"));
    assert_eq!(picture.status, 200);
    assert_eq!(picture.content_type, "image/png");

    let font = site_protocol_response(&format!("{base}assets/text.woff2"));
    assert_eq!(font.status, 200);
    assert_eq!(font.content_type, "font/woff2");
}

#[test]
fn nothing_escapes_the_page_folder_and_nothing_lists_it() {
    let folder = scratch_site("escape");
    let base = site_base(&folder);

    // Every way up and out, however it is spelled. The last two are the same escape written so the two dots never appear in the address.
    for climb in [
        "../secret.css",
        "assets/../../secret.css",
        "%2e%2e/secret.css",
        "assets/%2E%2E/%2E%2E/secret.css",
    ] {
        assert!(
            site_protocol_path(&format!("{base}{climb}")).is_none(),
            "{climb} escaped the page folder"
        );
    }

    // The folder itself is not a thing that can be asked for, so there is nothing to enumerate.
    for listing in ["", "assets/", "."] {
        assert_eq!(
            site_protocol_response(&format!("{base}{listing}")).status,
            404,
            "{listing} answered as if a folder were a file"
        );
    }

    // A folder nobody opened is not staged, so its name answers nothing even spelled correctly.
    assert!(site_protocol_path("leaf-site://local/1/site.css").is_none());
    assert!(site_protocol_path("http://leaf-site.local/1/site.css").is_none());
    // And the scheme is the only one it answers.
    assert!(site_protocol_path(
        &format!("{base}assets/site.css").replace("leaf-site", "leaf-image")
    )
    .is_none());
}

#[test]
fn a_file_a_page_cannot_draw_is_refused_and_a_missing_one_says_so() {
    let folder = scratch_site("types");
    let base = site_base(&folder);

    // Both of these are really there. A document beside the page is a document, not a page asset, and neither it nor anything without a drawable ending comes back.
    for refused in ["notes.md", "keys.env", "page.html"] {
        let answer = site_protocol_response(&format!("{base}{refused}"));
        assert_eq!(answer.status, 415, "{refused} was served to the page");
        assert!(answer.body.is_empty());
    }

    let missing = site_protocol_response(&format!("{base}assets/gone.css"));
    assert_eq!(missing.status, 404);
    assert!(missing.body.is_empty());

    // A failed asset is one answer, not the page: everything else in the folder still answers, so a page with one broken picture is a page with one broken picture.
    assert_eq!(
        site_protocol_response(&format!("{base}assets/site.css")).status,
        200
    );
}

#[test]
fn the_same_folder_is_always_the_same_address() {
    let folder = scratch_site("stable");
    // A render that moved the address would make the same file a different page each open, which the tab cache reads as a document that changed.
    assert_eq!(site_base(&folder), site_base(&folder));

    let other = scratch_site("stable-other");
    assert_ne!(site_base(&folder), site_base(&other));
}

#[test]
fn a_browser_is_handed_no_local_folder_at_all() {
    let folder = scratch_site("browser");
    let source = fs::read_to_string(folder.join("page.html")).expect("the page");
    let document =
        opened_document_from_source_with_host(&source, &folder.join("page.html"), &BareHost);

    // No disk, so nothing of this machine is named: no scheme in the policy, no address on the page, and no folder staged for it.
    assert!(!document.html.contains("leaf-site"));
    assert!(!document.html.contains("&lt;base"));
    assert!(!document.html.contains("file:"));
    // What it may reach instead is the origin the document was fetched from, which is where a published site keeps the page's own neighbors. On the desktop that origin is opaque and this names nothing.
    assert_contains(
        &document.html,
        "style-src 'unsafe-inline' 'self'; img-src data: 'self'",
    );
}
