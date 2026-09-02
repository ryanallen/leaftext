use super::*;

#[test]
fn source_paths_open_as_colored_code_with_their_own_labels() {
    for (path, token, label) in [
        ("main.rs", "rust", "Rust"),
        ("tool.py", "python", "Python"),
        ("build.sh", "sh", "Bash"),
        ("Cargo.toml", "toml", "TOML"),
        ("settings.jsonc", "jsonc", "JSONC"),
        ("schema.gql", "graphql", "GraphQL"),
        (".env", "dotenv", "Dotenv"),
        ("Dockerfile", "dockerfile", "Dockerfile"),
    ] {
        assert_eq!(
            DocumentFormat::for_path(Path::new(path)),
            Some(DocumentFormat::Code),
            "{path}"
        );
        let definition = source_definition(Path::new(path)).expect("source definition");
        assert_eq!(definition.language_token, token, "{path}");
        assert_eq!(definition.display_name, label, "{path}");
        let document = opened_document_from_source("let value = 1;", path);
        assert_eq!(document.format, DocumentFormat::Code, "{path}");
        assert_eq!(document.source, "let value = 1;", "{path}");
        assert_contains(&document.html, &format!(r#"data-language="{label}""#));
    }
}

#[test]
fn source_admission_is_case_insensitive_and_keeps_rich_formats_first() {
    for path in [
        "MAIN.RS",
        "TOOL.PY",
        "BUILD.SH",
        "SETTINGS.JSONC",
        "SCHEMA.GQL",
        ".ENV",
        "DOCKERFILE",
    ] {
        assert_eq!(
            DocumentFormat::for_path(Path::new(path)),
            Some(DocumentFormat::Code),
            "{path}"
        );
    }
    for (path, format) in [
        ("data.json", DocumentFormat::Json),
        ("page.html", DocumentFormat::Html),
        ("tree.xml", DocumentFormat::Xml),
        ("config.yaml", DocumentFormat::Yaml),
        ("note.md", DocumentFormat::Markdown),
    ] {
        assert_eq!(
            DocumentFormat::for_path(Path::new(path)),
            Some(format),
            "{path}"
        );
    }
    assert_eq!(DocumentFormat::for_path(Path::new("unknown.leaf")), None);
    assert_eq!(
        DocumentFormat::from_path(Path::new("README")),
        DocumentFormat::Markdown
    );
}

#[test]
fn source_definition_table_is_the_only_source_admission_list() {
    let extensions = source_extensions();
    for definition in source_definitions() {
        for extension in definition.extensions {
            assert!(extensions.contains(extension));
            assert_eq!(
                source_definition(Path::new(&format!("file.{extension}"))),
                Some(*definition)
            );
        }
        for name in definition.file_names {
            assert_eq!(source_definition(Path::new(name)), Some(*definition));
        }
    }
}

#[test]
fn source_files_open_directly_without_becoming_folder_or_vault_documents() {
    let root = scratch_dir("code-documents-admission");
    let note = root.join("note.md");
    let source = root.join("main.rs");
    fs::write(&note, "# Note\n\n[Source](./main.rs)\n").expect("note written");
    fs::write(&source, "fn main() {}\n").expect("source written");

    assert!(is_supported_document_path(&source));
    assert!(!is_listed_document_path(&source));
    let names: Vec<_> = read_folder_listing(Some(&root), "")
        .entries
        .into_iter()
        .map(|entry| entry.name)
        .collect();
    assert_eq!(names, ["note.md"]);
    let pager = document_pager_html(&note);
    assert!(!pager.contains("main.rs"));
    let corpus = VaultCorpus::read(&root);
    assert_eq!(corpus.documents.len(), 1);
    let graph = document_graph(&note, &crate::store::GraphRequest::default());
    assert_eq!(graph.nodes.len(), 1);

    fs::remove_dir_all(root).expect("test directory removed");
}

#[test]
fn the_listed_document_gate_admits_every_named_spelling_and_no_source_one() {
    for format in DocumentFormat::ALL {
        for extension in format.extensions() {
            for spelling in [
                extension.to_string(),
                extension.to_ascii_uppercase(),
                format!("{}{}", extension[..1].to_ascii_uppercase(), &extension[1..]),
            ] {
                let path = PathBuf::from(format!("note.{spelling}"));
                assert!(is_listed_document_path(&path), "{spelling}");
                assert!(is_supported_document_path(&path), "{spelling}");
                assert_eq!(DocumentFormat::for_path(&path), Some(format), "{spelling}");
            }
        }
    }

    for definition in source_definitions() {
        for extension in definition.extensions {
            for spelling in [extension.to_string(), extension.to_ascii_uppercase()] {
                let path = PathBuf::from(format!("file.{spelling}"));
                assert!(is_supported_document_path(&path), "{spelling}");
                assert!(!is_listed_document_path(&path), "{spelling}");
                assert_eq!(
                    DocumentFormat::for_path(&path),
                    Some(DocumentFormat::Code),
                    "{spelling}"
                );
                assert_eq!(source_definition(&path), Some(*definition), "{spelling}");
            }
        }
        for name in definition.file_names {
            for spelling in [name.to_string(), name.to_ascii_uppercase()] {
                let path = PathBuf::from(&spelling);
                assert!(is_supported_document_path(&path), "{spelling}");
                assert!(!is_listed_document_path(&path), "{spelling}");
                assert_eq!(source_definition(&path), Some(*definition), "{spelling}");
            }
        }
    }

    for unknown in [
        "shot.png",
        "app.exe",
        "font.woff2",
        "lock.LOCK",
        "archive.Zip",
    ] {
        let path = PathBuf::from(unknown);
        assert_eq!(DocumentFormat::for_path(&path), None, "{unknown}");
        assert!(!is_supported_document_path(&path), "{unknown}");
        assert!(!is_listed_document_path(&path), "{unknown}");
    }

    // A file with no extension is nobody's listed document, whether or not the source table knows its whole name.
    for bare in ["README", "Dockerfile", ".env"] {
        assert!(!is_listed_document_path(Path::new(bare)), "{bare}");
    }
}
