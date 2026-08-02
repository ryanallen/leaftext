#!/usr/bin/env node
// Register folders as vaults in a screenshot profile's manifest.db.
//
//   node scripts/shot-add-vault.mjs <manifest.db> <folder> [<folder> …]
//
// Only capture-screenshot.ps1 calls this, and only against the throwaway
// profile it made — the library's search box and vault switcher do not exist
// until there is a vault, so a picture of either needs one seeded. The app
// builds the database and its migrations itself on first launch; this writes
// one row per folder into the table that is already there (src/store/vaults.rs)
// rather than guessing at a schema that would then be the second copy of it.

import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [db, ...folders] = process.argv.slice(2);
if (!db || !folders.length) {
  console.error('usage: shot-add-vault.mjs <manifest.db> <folder> [<folder> …]');
  process.exit(2);
}
if (!existsSync(db)) {
  console.error(`no database at ${db} — launch the app once in this profile first`);
  process.exit(1);
}

const conn = new DatabaseSync(db);
const insert = conn.prepare(
  'INSERT OR IGNORE INTO vaults (name, root_path, added_at) VALUES (?, ?, ?)',
);
folders.forEach((folder, index) => {
  const full = resolve(folder);
  insert.run(basename(full), full, index + 1);
  console.log(`vault: ${full}`);
});
conn.close();
