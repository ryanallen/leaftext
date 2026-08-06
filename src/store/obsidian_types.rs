//! The field types another tool already decided, and the ones a note pins on itself.
//!
//! Both override what a value's own shape would say, and both are read here rather than guessed at, so there is one place a type is overridden and one order it happens in.

use super::{FieldType, FrontmatterField};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

/// The one key a note pins its own field types under, as `key=type` items. It is a property like any other, so Obsidian lists it in its own panel — one key holding every pin keeps that to one row rather than one per field.
pub const PIN_KEY: &str = "leaftext-types";

/// Field types decided somewhere other than the value: a key, lowercased the way both sides match keys, against the type it was given.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TypeOverrides {
    by_key: HashMap<String, FieldType>,
}

impl TypeOverrides {
    pub fn is_empty(&self) -> bool {
        self.by_key.is_empty()
    }

    fn get(&self, key: &str) -> Option<FieldType> {
        self.by_key.get(&key.to_lowercase()).copied()
    }

    /// First writer wins, which is how Obsidian resolves two spellings of one key in its own file.
    fn insert(&mut self, key: &str, kind: FieldType) {
        self.by_key.entry(key.to_lowercase()).or_insert(kind);
    }
}

/// Obsidian's name for a type, against ours. Its eleven are `text`, `multitext`, `number`, `checkbox`, `date`, `datetime`, `aliases`, `tags`, `file`, `folder` and `property`; the last three point at other notes and have no equivalent here, so they read as text rather than as a type we cannot draw.
fn field_type_for_widget(widget: &str) -> FieldType {
    match widget {
        "multitext" | "aliases" | "tags" => FieldType::List,
        "number" => FieldType::Number,
        "checkbox" => FieldType::Checkbox,
        "date" => FieldType::Date,
        "datetime" => FieldType::DateTime,
        _ => FieldType::Text,
    }
}

/// The name this app uses for a type, as a note writes it in a pin. The same words the six types are called everywhere else, so nobody has to learn Obsidian's.
fn field_type_for_name(name: &str) -> Option<FieldType> {
    match name.trim().to_lowercase().as_str() {
        "text" => Some(FieldType::Text),
        "list" => Some(FieldType::List),
        "number" => Some(FieldType::Number),
        "checkbox" => Some(FieldType::Checkbox),
        "date" => Some(FieldType::Date),
        "datetime" | "date and time" => Some(FieldType::DateTime),
        _ => None,
    }
}

/// The types the vault holding `document` has already assigned, from Obsidian's own `.obsidian/types.json`.
///
/// The vault is found by walking up the document's own ancestors for an `.obsidian` folder — the same bounded walk `markdown::repository_context` already does to find a `.git` on every open, and the way Obsidian itself decides what a vault is. So it needs no vault registry, no database handle, and opens no folder the user did not point at.
///
/// Missing, unreadable or unexpected is empty. It is another tool's private file, its absence is the normal case, and this never writes it.
pub fn vault_types_for(document: &Path) -> TypeOverrides {
    match types_file_for(document) {
        Some(file) => read_vault_types(&file),
        None => TypeOverrides::default(),
    }
}

/// Which folder a document's types file is in, remembered per folder.
///
/// **The walk is what costs, so the walk is what is cached.** One `exists` per level is about 14µs, and a document eight folders deep with no vault paid 110µs of that on every open — a fifth of the whole render, for an answer that cannot change while the app is up: a folder does not move into a different vault. The file itself is re-read each time, so setting a type in Obsidian shows on the next open rather than the next launch.
fn types_file_for(document: &Path) -> Option<PathBuf> {
    static FOUND: OnceLock<Mutex<HashMap<PathBuf, Option<PathBuf>>>> = OnceLock::new();
    let folder = document.parent()?.to_path_buf();
    let cache = FOUND.get_or_init(|| Mutex::new(HashMap::new()));
    // A poisoned lock is a folder looked up twice, never a wrong answer, so it is not worth failing an open over.
    if let Ok(found) = cache.lock() {
        if let Some(answer) = found.get(&folder) {
            return answer.clone();
        }
    }
    let mut current = folder.clone();
    let answer = loop {
        let file = current.join(".obsidian").join("types.json");
        if file.exists() {
            break Some(file);
        }
        if !current.pop() {
            break None;
        }
    };
    if let Ok(mut found) = cache.lock() {
        found.insert(folder, answer.clone());
    }
    answer
}

/// `{ "types": { "Due": "date" } }` — the shape Obsidian writes: the key as the file spelled it, against its widget name.
fn read_vault_types(file: &Path) -> TypeOverrides {
    let mut overrides = TypeOverrides::default();
    let Ok(text) = std::fs::read_to_string(file) else {
        return overrides;
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
        return overrides;
    };
    let Some(types) = json.get("types").and_then(|types| types.as_object()) else {
        return overrides;
    };
    for (key, widget) in types {
        if let Some(widget) = widget.as_str() {
            overrides.insert(key, field_type_for_widget(widget));
        }
    }
    overrides
}

/// The types a note pins on itself, out of its own [`PIN_KEY`] field: one `key=type` per item. An item naming a type this app does not have is skipped, so a typo costs that one pin rather than the field.
pub fn pinned_types(fields: &[FrontmatterField]) -> TypeOverrides {
    let mut overrides = TypeOverrides::default();
    for field in fields.iter().filter(|field| field.key_is(PIN_KEY)) {
        for value in &field.values {
            let Some((key, name)) = value.text.split_once('=') else {
                continue;
            };
            if let Some(kind) = field_type_for_name(name) {
                overrides.insert(key.trim(), kind);
            }
        }
    }
    overrides
}

/// Put the overriding types onto the fields: the note's own pin wins, then the vault's file, and what neither names keeps the type its own value and key already gave it.
pub fn apply_types(fields: &mut [FrontmatterField], vault: &TypeOverrides, pinned: &TypeOverrides) {
    if vault.is_empty() && pinned.is_empty() {
        return;
    }
    for field in fields.iter_mut() {
        if let Some(kind) = pinned.get(&field.key).or_else(|| vault.get(&field.key)) {
            field.kind = kind;
        }
    }
}
