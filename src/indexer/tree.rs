//! The folder tree the library pane renders.

use super::*;

#[derive(Default)]
pub(super) struct FolderBuild {
    pub(super) name: String,
    pub(super) path: String,
    pub(super) subfolders: std::collections::BTreeMap<String, FolderBuild>,
    pub(super) files: Vec<FileTreeNode>,
}

fn folder_to_node(folder: FolderBuild) -> FileTreeNode {
    let mut children: Vec<FileTreeNode> = folder
        .subfolders
        .into_values()
        .map(folder_to_node)
        .collect();
    let mut files = folder.files;
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    children.extend(files);
    FileTreeNode {
        name: folder.name,
        path: folder.path,
        kind: NodeKind::Folder,
        title: None,
        children,
    }
}

/// Build the pruned folder/file forest from the `ok` file rows. A folder exists
/// only as an ancestor of an included file, so empty branches never appear.
pub fn build_tree(conn: &Connection) -> DbResult<Vec<FileTreeNode>> {
    let mut stmt = conn
        .prepare(
            "SELECT r.path, f.display_path, f.filename, f.abs_path, f.title
             FROM files f JOIN scan_roots r ON r.id = f.scan_root_id
             WHERE f.status = 'ok'
             ORDER BY r.path, f.display_path",
        )
        .map_err(to_err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(to_err)?;

    let mut roots: std::collections::BTreeMap<String, FolderBuild> =
        std::collections::BTreeMap::new();

    for row in rows {
        let (root_path, display_path, filename, abs_path, title) = row.map_err(to_err)?;
        let root_entry = roots
            .entry(root_path.clone())
            .or_insert_with(|| FolderBuild {
                name: root_label(&root_path),
                path: root_path.clone(),
                ..FolderBuild::default()
            });

        // Folder components are everything in display_path before the filename.
        let mut components: Vec<&str> = display_path
            .split(['/', '\\'])
            .filter(|part| !part.is_empty())
            .collect();
        components.pop(); // drop the file name itself

        let mut folder = &mut *root_entry;
        let mut folder_path = PathBuf::from(&root_path);
        for component in components {
            folder_path.push(component);
            let key = component.to_string();
            let path_string = path_to_string(&folder_path);
            folder = folder
                .subfolders
                .entry(key.clone())
                .or_insert_with(|| FolderBuild {
                    name: key,
                    path: path_string,
                    ..FolderBuild::default()
                });
        }

        folder.files.push(FileTreeNode {
            name: filename,
            path: abs_path,
            kind: NodeKind::File,
            title,
            children: Vec::new(),
        });
    }

    Ok(roots.into_values().map(folder_to_node).collect())
}

// ---------------------------------------------------------------------------
// Graph building
// ---------------------------------------------------------------------------
