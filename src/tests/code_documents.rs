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
