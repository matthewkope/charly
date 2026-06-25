use std::fs;
use std::path::{Path, PathBuf};

use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

/// A single filesystem entry shown in the library tree.
#[derive(Serialize)]
struct Entry {
    name: String,
    path: String,
    is_dir: bool,
    ext: String,
}

#[derive(Serialize, Deserialize, Default)]
struct Config {
    library_path: Option<String>,
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no config dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

fn read_config(app: &tauri::AppHandle) -> Config {
    let Ok(path) = config_path(app) else {
        return Config::default();
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn get_library(app: tauri::AppHandle) -> Option<String> {
    read_config(&app).library_path
}

#[tauri::command]
fn set_library(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let cfg = Config {
        library_path: Some(path),
    };
    let json = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    fs::write(config_path(&app)?, json).map_err(|e| e.to_string())
}

fn entry_from_path(p: &Path) -> Option<Entry> {
    let name = p.file_name()?.to_string_lossy().to_string();
    // Skip hidden / system files.
    if name.starts_with('.') {
        return None;
    }
    let is_dir = p.is_dir();
    let ext = if is_dir {
        String::new()
    } else {
        p.extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default()
    };
    Some(Entry {
        name,
        path: p.to_string_lossy().to_string(),
        is_dir,
        ext,
    })
}

/// List a single directory level (folders first, then files, alphabetical).
#[tauri::command]
fn list_dir(path: String) -> Result<Vec<Entry>, String> {
    let mut entries: Vec<Entry> = fs::read_dir(&path)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .filter_map(|d| entry_from_path(&d.path()))
        .collect();
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
fn create_folder(parent: String, name: String) -> Result<String, String> {
    let safe = name.trim().replace(['/', '\\'], "-");
    if safe.is_empty() {
        return Err("Folder name cannot be empty".into());
    }
    let target = Path::new(&parent).join(&safe);
    if target.exists() {
        return Err(format!("\"{safe}\" already exists here"));
    }
    fs::create_dir(&target).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn rename_entry(app: tauri::AppHandle, path: String, new_name: String) -> Result<String, String> {
    let src = Path::new(&path);
    let parent = src.parent().ok_or("No parent directory")?;
    let safe = new_name.trim().replace(['/', '\\'], "-");
    if safe.is_empty() {
        return Err("Name cannot be empty".into());
    }
    let dest = parent.join(&safe);
    if dest.exists() {
        return Err(format!("\"{safe}\" already exists here"));
    }
    fs::rename(src, &dest).map_err(|e| e.to_string())?;
    let dest_str = dest.to_string_lossy().to_string();
    if let Some(lib) = read_config(&app).library_path {
        move_meta(&lib, &path, &dest_str);
    }
    Ok(dest_str)
}

#[tauri::command]
fn delete_entry(app: tauri::AppHandle, path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())?;
    if let Some(lib) = read_config(&app).library_path {
        remove_meta(&lib, &path);
    }
    Ok(())
}

#[tauri::command]
fn move_entry(app: tauri::AppHandle, path: String, dest_dir: String) -> Result<String, String> {
    let src = Path::new(&path);
    let name = src.file_name().ok_or("Invalid source")?;
    let dest = Path::new(&dest_dir).join(name);
    if dest == src {
        return Ok(path);
    }
    if dest.exists() {
        return Err("An item with that name already exists in the destination".into());
    }
    fs::rename(src, &dest).map_err(|e| e.to_string())?;
    let dest_str = dest.to_string_lossy().to_string();
    if let Some(lib) = read_config(&app).library_path {
        move_meta(&lib, &path, &dest_str);
    }
    Ok(dest_str)
}

/// Copy chosen files into a target directory, resolving name collisions.
#[tauri::command]
fn import_files(target_dir: String, sources: Vec<String>) -> Result<Vec<String>, String> {
    let dir = Path::new(&target_dir);
    let mut imported = Vec::new();
    for source in sources {
        let src = Path::new(&source);
        let Some(file_name) = src.file_name() else {
            continue;
        };
        let mut dest = dir.join(file_name);
        // Resolve collisions: "name.pdf" -> "name (2).pdf"
        if dest.exists() {
            let stem = src
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let ext = src
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy()))
                .unwrap_or_default();
            let mut n = 2;
            loop {
                let candidate = dir.join(format!("{stem} ({n}){ext}"));
                if !candidate.exists() {
                    dest = candidate;
                    break;
                }
                n += 1;
            }
        }
        fs::copy(src, &dest).map_err(|e| e.to_string())?;
        imported.push(dest.to_string_lossy().to_string());
    }
    Ok(imported)
}

/// Read a file's raw bytes (used to render PDFs/EPUBs in the webview).
#[tauri::command]
fn read_file(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Recursive filename search for documents under the library root.
#[tauri::command]
fn search(root: String, query: String) -> Result<Vec<Entry>, String> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    walk(Path::new(&root), &needle, &mut out);
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

fn walk(dir: &Path, needle: &str, out: &mut Vec<Entry>) {
    if out.len() >= 500 {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for d in rd.filter_map(|r| r.ok()) {
        let p = d.path();
        let name = match p.file_name() {
            Some(n) => n.to_string_lossy().to_string(),
            None => continue,
        };
        if name.starts_with('.') {
            continue;
        }
        if p.is_dir() {
            walk(&p, needle, out);
        } else if name.to_lowercase().contains(needle) {
            if let Some(e) = entry_from_path(&p) {
                out.push(e);
            }
        }
    }
}

fn sanitize(name: &str) -> String {
    name.trim().replace(['/', '\\', ':'], "-")
}

// ===========================================================================
// Item tags & notes — stored centrally in `<library>/.charly/meta.json`,
// keyed by each item's path relative to the library root (folder-portable).
// ===========================================================================

/// A display title (alias), tags, and a free-form note attached to one library
/// item (file or folder). The real filename on disk is never changed by these.
#[derive(Serialize, Deserialize, Default, Clone)]
struct ItemMeta {
    #[serde(default)]
    title: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    note: String,
}

type MetaIndex = std::collections::HashMap<String, ItemMeta>;

fn meta_path(library: &str) -> PathBuf {
    Path::new(library).join(".charly").join("meta.json")
}

fn read_meta_index(library: &str) -> MetaIndex {
    fs::read_to_string(meta_path(library))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_meta_index(library: &str, idx: &MetaIndex) -> Result<(), String> {
    let mp = meta_path(library);
    if let Some(parent) = mp.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(idx).map_err(|e| e.to_string())?;
    fs::write(mp, json).map_err(|e| e.to_string())
}

/// An item's path relative to the library root — the stable key we store under.
fn rel_key(library: &str, path: &str) -> Option<String> {
    Path::new(path)
        .strip_prefix(library)
        .ok()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .filter(|k| !k.is_empty())
}

/// Drop an index entry that carries no title, tags, or note.
fn prune(idx: &mut MetaIndex, key: &str) {
    if let Some(m) = idx.get(key) {
        if m.title.trim().is_empty() && m.tags.is_empty() && m.note.trim().is_empty() {
            idx.remove(key);
        }
    }
}

/// Re-key metadata when an item (and any descendants) is renamed or moved.
fn move_meta(library: &str, old_path: &str, new_path: &str) {
    let (Some(old_key), Some(new_key)) = (rel_key(library, old_path), rel_key(library, new_path))
    else {
        return;
    };
    let mut idx = read_meta_index(library);
    if idx.is_empty() {
        return;
    }
    let prefix = format!("{old_key}/");
    let mut next = MetaIndex::new();
    let mut changed = false;
    for (k, v) in idx.drain() {
        if k == old_key {
            next.insert(new_key.clone(), v);
            changed = true;
        } else if let Some(rest) = k.strip_prefix(&prefix) {
            next.insert(format!("{new_key}/{rest}"), v);
            changed = true;
        } else {
            next.insert(k, v);
        }
    }
    if changed {
        let _ = write_meta_index(library, &next);
    }
}

/// Drop metadata for a deleted item (and any descendants).
fn remove_meta(library: &str, path: &str) {
    let Some(key) = rel_key(library, path) else {
        return;
    };
    let prefix = format!("{key}/");
    let mut idx = read_meta_index(library);
    let before = idx.len();
    idx.retain(|k, _| k != &key && !k.starts_with(&prefix));
    if idx.len() != before {
        let _ = write_meta_index(library, &idx);
    }
}

#[tauri::command]
fn get_item_meta(library: String, path: String) -> ItemMeta {
    match rel_key(&library, &path) {
        Some(key) => read_meta_index(&library).get(&key).cloned().unwrap_or_default(),
        None => ItemMeta::default(),
    }
}

#[tauri::command]
fn set_item_tags(library: String, path: String, tags: Vec<String>) -> Result<(), String> {
    let key = rel_key(&library, &path).ok_or("Item is outside the library")?;
    let mut idx = read_meta_index(&library);
    let mut seen = std::collections::HashSet::new();
    let clean: Vec<String> = tags
        .into_iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty() && seen.insert(t.to_lowercase()))
        .collect();
    idx.entry(key.clone()).or_default().tags = clean;
    prune(&mut idx, &key);
    write_meta_index(&library, &idx)
}

#[tauri::command]
fn set_item_note(library: String, path: String, note: String) -> Result<(), String> {
    let key = rel_key(&library, &path).ok_or("Item is outside the library")?;
    let mut idx = read_meta_index(&library);
    idx.entry(key.clone()).or_default().note = note;
    prune(&mut idx, &key);
    write_meta_index(&library, &idx)
}

#[tauri::command]
fn set_item_title(library: String, path: String, title: String) -> Result<(), String> {
    let key = rel_key(&library, &path).ok_or("Item is outside the library")?;
    let mut idx = read_meta_index(&library);
    idx.entry(key.clone()).or_default().title = title.trim().to_string();
    prune(&mut idx, &key);
    write_meta_index(&library, &idx)
}

/// Filesystem facts for an item: modified time (ms since epoch) and byte size.
#[derive(Serialize)]
struct FileInfo {
    modified_ms: u64,
    size: u64,
}

#[tauri::command]
fn file_info(path: String) -> Result<FileInfo, String> {
    let md = fs::metadata(&path).map_err(|e| e.to_string())?;
    let modified_ms = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(FileInfo {
        modified_ms,
        size: md.len(),
    })
}

/// A file row with display metadata, for the Zotero-style list view.
#[derive(Serialize)]
struct FileItem {
    name: String,
    path: String,
    ext: String,
    title: String,   // alias from meta (frontend falls back to the filename)
    creator: String, // e.g. a clipped link's site; empty otherwise
    modified_ms: u64,
    size: u64,
}

/// Build one list row (title alias, creator, modified time) for a file path.
fn build_file_item(library: &str, idx: &MetaIndex, p: &Path) -> Option<FileItem> {
    let name = p.file_name()?.to_string_lossy().to_string();
    if name.starts_with('.') {
        return None;
    }
    let ext = p
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let path_s = p.to_string_lossy().to_string();
    let title = rel_key(library, &path_s)
        .and_then(|k| idx.get(&k).map(|m| m.title.clone()))
        .unwrap_or_default();
    let creator = if ext == "charlylink" {
        fs::read_to_string(p)
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| v.get("site").and_then(|x| x.as_str().map(str::to_string)))
            .unwrap_or_default()
    } else {
        String::new()
    };
    let (modified_ms, size) = fs::metadata(p)
        .map(|md| {
            let m = md
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            (m, md.len())
        })
        .unwrap_or((0, 0));
    Some(FileItem {
        name,
        path: path_s,
        ext,
        title,
        creator,
        modified_ms,
        size,
    })
}

#[tauri::command]
fn list_items(library: String, folder: String) -> Result<Vec<FileItem>, String> {
    let idx = read_meta_index(&library);
    let mut items: Vec<FileItem> = fs::read_dir(&folder)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .map(|d| d.path())
        .filter(|p| p.is_file())
        .filter_map(|p| build_file_item(&library, &idx, &p))
        .collect();
    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(items)
}

fn walk_items(library: &str, idx: &MetaIndex, dir: &Path, out: &mut Vec<FileItem>) {
    if out.len() >= 5000 {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.filter_map(|r| r.ok()) {
        let p = e.path();
        let name = match p.file_name() {
            Some(n) => n.to_string_lossy().to_string(),
            None => continue,
        };
        if name.starts_with('.') {
            continue; // skip .charly and other hidden dirs/files
        }
        if p.is_dir() {
            walk_items(library, idx, &p, out);
        } else if let Some(it) = build_file_item(library, idx, &p) {
            out.push(it);
        }
    }
}

/// Every file in the library (recursively) — powers the "All Items" and
/// "Recently Added" special views.
#[tauri::command]
fn library_items(library: String) -> Result<Vec<FileItem>, String> {
    let idx = read_meta_index(&library);
    let mut out = Vec::new();
    walk_items(&library, &idx, Path::new(&library), &mut out);
    Ok(out)
}

// ---- Per-library Trash (move to .charly/Trash, with restore) ---------------

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Serialize, Deserialize, Clone)]
struct TrashEntry {
    name: String,       // original filename (display)
    trash_name: String, // unique filename inside .charly/Trash
    origin: String,     // absolute original path
    deleted_ms: u64,
}

fn trash_dir(library: &str) -> PathBuf {
    Path::new(library).join(".charly").join("Trash")
}
fn trash_manifest(library: &str) -> PathBuf {
    Path::new(library).join(".charly").join("trash.json")
}
fn read_trash(library: &str) -> Vec<TrashEntry> {
    fs::read_to_string(trash_manifest(library))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}
fn write_trash(library: &str, list: &[TrashEntry]) -> Result<(), String> {
    let mp = trash_manifest(library);
    if let Some(p) = mp.parent() {
        fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    fs::write(mp, serde_json::to_string_pretty(list).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

/// Move an item into the library's Trash (recoverable via restore_trash).
#[tauri::command]
fn trash_item(library: String, path: String) -> Result<(), String> {
    let src = Path::new(&path);
    let name = src.file_name().ok_or("Invalid path")?.to_string_lossy().to_string();
    let dir = trash_dir(&library);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut trash_name = name.clone();
    if dir.join(&trash_name).exists() {
        trash_name = format!("{}-{}", now_ms(), name);
    }
    fs::rename(src, dir.join(&trash_name)).map_err(|e| e.to_string())?;
    let mut list = read_trash(&library);
    list.push(TrashEntry {
        name,
        trash_name,
        origin: path,
        deleted_ms: now_ms(),
    });
    write_trash(&library, &list)
}

#[tauri::command]
fn list_trash(library: String) -> Result<Vec<TrashEntry>, String> {
    let dir = trash_dir(&library);
    let mut list: Vec<TrashEntry> = read_trash(&library)
        .into_iter()
        .filter(|e| dir.join(&e.trash_name).exists())
        .collect();
    list.sort_by(|a, b| b.deleted_ms.cmp(&a.deleted_ms));
    Ok(list)
}

/// Restore a trashed item to its original location (suffixed if taken).
#[tauri::command]
fn restore_trash(library: String, trash_name: String) -> Result<String, String> {
    let mut list = read_trash(&library);
    let pos = list
        .iter()
        .position(|e| e.trash_name == trash_name)
        .ok_or("Not found in Trash")?;
    let entry = list[pos].clone();
    let src = trash_dir(&library).join(&entry.trash_name);
    let mut dest = PathBuf::from(&entry.origin);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if dest.exists() {
        let stem = dest.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let ext = dest.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
        let parent = dest.parent().map(|p| p.to_path_buf()).unwrap_or_default();
        dest = parent.join(format!("{stem} (restored){ext}"));
    }
    fs::rename(&src, &dest).map_err(|e| e.to_string())?;
    list.remove(pos);
    write_trash(&library, &list)?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
fn empty_trash(library: String) -> Result<(), String> {
    let dir = trash_dir(&library);
    for entry in read_trash(&library) {
        let p = dir.join(&entry.trash_name);
        if p.is_dir() {
            let _ = fs::remove_dir_all(&p);
        } else {
            let _ = fs::remove_file(&p);
        }
        remove_meta(&library, &entry.origin);
    }
    write_trash(&library, &[])
}

// ---- Saved searches (rule-based virtual collections) -----------------------

#[derive(Serialize, Deserialize, Clone)]
struct SearchRule {
    field: String, // "title" | "tag" | "type"
    op: String,    // "contains" | "is"
    value: String,
}

fn match_all_default() -> String {
    "all".into()
}

#[derive(Serialize, Deserialize, Clone)]
struct SavedSearch {
    id: String,
    name: String,
    #[serde(rename = "match", default = "match_all_default")]
    match_mode: String, // "all" | "any"
    #[serde(default)]
    rules: Vec<SearchRule>,
}

fn searches_path(library: &str) -> PathBuf {
    Path::new(library).join(".charly").join("searches.json")
}
fn read_searches(library: &str) -> Vec<SavedSearch> {
    fs::read_to_string(searches_path(library))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}
fn write_searches(library: &str, list: &[SavedSearch]) -> Result<(), String> {
    let p = searches_path(library);
    if let Some(d) = p.parent() {
        fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    fs::write(p, serde_json::to_string_pretty(list).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_saved_searches(library: String) -> Result<Vec<SavedSearch>, String> {
    Ok(read_searches(&library))
}

#[tauri::command]
fn save_saved_search(library: String, search: SavedSearch) -> Result<Vec<SavedSearch>, String> {
    let mut list = read_searches(&library);
    match list.iter_mut().find(|s| s.id == search.id) {
        Some(existing) => *existing = search,
        None => list.push(search),
    }
    write_searches(&library, &list)?;
    Ok(list)
}

#[tauri::command]
fn delete_saved_search(library: String, id: String) -> Result<Vec<SavedSearch>, String> {
    let mut list = read_searches(&library);
    list.retain(|s| s.id != id);
    write_searches(&library, &list)?;
    Ok(list)
}

fn rule_matches(rule: &SearchRule, it: &FileItem, tags: &[String]) -> bool {
    let val = rule.value.to_lowercase();
    match rule.field.as_str() {
        "type" => {
            if rule.op == "is" {
                it.ext.eq_ignore_ascii_case(&rule.value)
            } else {
                it.ext.to_lowercase().contains(&val)
            }
        }
        "tag" => {
            if rule.op == "is" {
                tags.iter().any(|t| t.eq_ignore_ascii_case(&rule.value))
            } else {
                tags.iter().any(|t| t.to_lowercase().contains(&val))
            }
        }
        _ => {
            let hay = if it.title.is_empty() {
                it.name.to_lowercase()
            } else {
                it.title.to_lowercase()
            };
            if rule.op == "is" {
                hay == val
            } else {
                hay.contains(&val)
            }
        }
    }
}

/// Evaluate a saved search's rules against every file in the library.
#[tauri::command]
fn run_saved_search(library: String, search: SavedSearch) -> Result<Vec<FileItem>, String> {
    let idx = read_meta_index(&library);
    let mut all = Vec::new();
    walk_items(&library, &idx, Path::new(&library), &mut all);
    let any = search.match_mode == "any";
    let out: Vec<FileItem> = all
        .into_iter()
        .filter(|it| {
            if search.rules.is_empty() {
                return true;
            }
            let tags = rel_key(&library, &it.path)
                .and_then(|k| idx.get(&k).map(|m| m.tags.clone()))
                .unwrap_or_default();
            if any {
                search.rules.iter().any(|r| rule_matches(r, it, &tags))
            } else {
                search.rules.iter().all(|r| rule_matches(r, it, &tags))
            }
        })
        .collect();
    Ok(out)
}

#[derive(Serialize)]
struct TagCount {
    tag: String,
    count: usize,
}

#[tauri::command]
fn list_all_tags(library: String) -> Vec<TagCount> {
    let idx = read_meta_index(&library);
    let lib = Path::new(&library);
    let mut counts: std::collections::BTreeMap<String, usize> = Default::default();
    for (key, m) in &idx {
        if !lib.join(key).exists() {
            continue;
        }
        for t in &m.tags {
            *counts.entry(t.clone()).or_insert(0) += 1;
        }
    }
    let mut out: Vec<TagCount> =
        counts.into_iter().map(|(tag, count)| TagCount { tag, count }).collect();
    out.sort_by(|a, b| {
        b.count.cmp(&a.count).then(a.tag.to_lowercase().cmp(&b.tag.to_lowercase()))
    });
    out
}

#[tauri::command]
fn find_by_tag(library: String, tag: String) -> Vec<Entry> {
    let idx = read_meta_index(&library);
    let lib = Path::new(&library);
    let mut out: Vec<Entry> = idx
        .iter()
        .filter(|(_, m)| m.tags.iter().any(|t| t.eq_ignore_ascii_case(&tag)))
        .filter_map(|(key, _)| {
            let abs = lib.join(key);
            if abs.exists() {
                entry_from_path(&abs)
            } else {
                None
            }
        })
        .collect();
    out.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    out
}

// ---- PDF highlights (one sidecar JSON per document under .charly) ----------

/// A highlight rectangle in page-normalized coordinates (0..1), so it survives
/// zoom changes and re-rendering.
#[derive(Serialize, Deserialize, Clone)]
struct HlRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Serialize, Deserialize, Clone)]
struct Highlight {
    id: String,
    page: usize,
    color: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    note: String,
    rects: Vec<HlRect>,
}

fn highlights_path(library: &str, path: &str) -> Option<PathBuf> {
    let key = rel_key(library, path)?;
    let safe = key.replace(['/', '\\'], "__");
    Some(
        Path::new(library)
            .join(".charly")
            .join("highlights")
            .join(format!("{safe}.json")),
    )
}

#[tauri::command]
fn get_highlights(library: String, path: String) -> Vec<Highlight> {
    let Some(hp) = highlights_path(&library, &path) else {
        return vec![];
    };
    fs::read_to_string(hp)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn save_highlights(
    library: String,
    path: String,
    highlights: Vec<Highlight>,
) -> Result<(), String> {
    let hp = highlights_path(&library, &path).ok_or("Item is outside the library")?;
    if highlights.is_empty() {
        let _ = fs::remove_file(&hp);
        return Ok(());
    }
    if let Some(parent) = hp.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&highlights).map_err(|e| e.to_string())?;
    fs::write(hp, json).map_err(|e| e.to_string())
}

// ---- Bibliographic items (Zotero-style records: `<name>.charlyitem`) -------

#[derive(Serialize, Deserialize, Clone, Default)]
struct Creator {
    #[serde(default)]
    first: String,
    #[serde(default)]
    last: String,
    #[serde(default, rename = "creatorType")]
    creator_type: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct Item {
    #[serde(rename = "itemType")]
    item_type: String,
    #[serde(default)]
    fields: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    creators: Vec<Creator>,
    #[serde(default)]
    attachments: Vec<String>,
    #[serde(default, rename = "dateAdded")]
    date_added: String,
    #[serde(default, rename = "dateModified")]
    date_modified: String,
}

/// Seconds since the Unix epoch, as a string (no extra date dependency).
fn now_secs() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_default()
}

fn read_item(path: &str) -> Result<Item, String> {
    let s = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&s).map_err(|e| e.to_string())
}

fn write_item(path: &Path, item: &Item) -> Result<(), String> {
    let json = serde_json::to_string_pretty(item).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_item(dir: String, item_type: String, title: String) -> Result<String, String> {
    let folder = Path::new(&dir);
    fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    let mut base = sanitize(if title.trim().is_empty() { "New Item" } else { title.trim() });
    if base.chars().count() > 100 {
        base = base.chars().take(100).collect();
    }
    let mut dest = folder.join(format!("{base}.charlyitem"));
    let mut n = 2;
    while dest.exists() {
        dest = folder.join(format!("{base} ({n}).charlyitem"));
        n += 1;
    }
    let mut fields = std::collections::BTreeMap::new();
    if !title.trim().is_empty() {
        fields.insert("title".to_string(), title.trim().to_string());
    }
    let item = Item {
        item_type,
        fields,
        date_added: now_secs(),
        date_modified: now_secs(),
        ..Default::default()
    };
    write_item(&dest, &item)?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
fn get_item(path: String) -> Result<Item, String> {
    read_item(&path)
}

#[tauri::command]
fn save_item(path: String, mut item: Item) -> Result<(), String> {
    item.date_modified = now_secs();
    write_item(Path::new(&path), &item)
}

/// Write a UTF-8 text file. Used to save a generated report as standalone HTML.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Copy PDFs into the item's folder and attach them to the record.
#[tauri::command]
fn attach_to_item(path: String, sources: Vec<String>) -> Result<Item, String> {
    let dir = Path::new(&path).parent().ok_or("Invalid item path")?;
    let mut item = read_item(&path)?;
    for src in sources {
        let s = Path::new(&src);
        let Some(file_name) = s.file_name() else {
            continue;
        };
        let mut dest = dir.join(file_name);
        if dest.exists() {
            let stem = s.file_stem().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
            let ext = s.extension().map(|x| format!(".{}", x.to_string_lossy())).unwrap_or_default();
            let mut n = 2;
            loop {
                let c = dir.join(format!("{stem} ({n}){ext}"));
                if !c.exists() {
                    dest = c;
                    break;
                }
                n += 1;
            }
        }
        fs::copy(s, &dest).map_err(|e| e.to_string())?;
        let rel = dest.file_name().unwrap().to_string_lossy().to_string();
        if !item.attachments.contains(&rel) {
            item.attachments.push(rel);
        }
    }
    item.date_modified = now_secs();
    write_item(Path::new(&path), &item)?;
    Ok(item)
}

// ---- Identifier lookup (DOI via Crossref) ---------------------------------

#[derive(Serialize)]
struct FetchedItem {
    #[serde(rename = "itemType")]
    item_type: String,
    fields: std::collections::BTreeMap<String, String>,
    creators: Vec<Creator>,
}

fn extract_doi(s: &str) -> Option<String> {
    let lower = s.to_lowercase();
    let pos = lower.find("10.")?;
    let cand = s[pos..].trim_end_matches(|c: char| ".,;)]\"' ".contains(c));
    (cand.len() > 4).then(|| cand.to_string())
}

fn strip_tags(s: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn cr_str(m: &serde_json::Value, key: &str) -> String {
    m.get(key).and_then(|v| v.as_str()).unwrap_or("").to_string()
}

fn cr_first(m: &serde_json::Value, key: &str) -> String {
    m.get(key)
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn crossref_to_item(m: &serde_json::Value, doi: &str) -> FetchedItem {
    let mut fields: std::collections::BTreeMap<String, String> = Default::default();
    let mut put = |k: &str, v: String| {
        if !v.is_empty() {
            fields.insert(k.to_string(), v);
        }
    };
    put("title", cr_first(m, "title"));
    put("publicationTitle", cr_first(m, "container-title"));
    put("journalAbbreviation", cr_first(m, "short-container-title"));
    put("volume", cr_str(m, "volume"));
    put("issue", cr_str(m, "issue"));
    put("pages", cr_str(m, "page"));
    put("publisher", cr_str(m, "publisher"));
    put("DOI", doi.to_string());
    put("url", cr_str(m, "URL"));
    put("ISSN", cr_first(m, "ISSN"));
    put("language", cr_str(m, "language"));
    let abs = cr_str(m, "abstract");
    if !abs.is_empty() {
        put("abstractNote", strip_tags(&abs));
    }
    if let Some(parts) = m
        .get("issued")
        .and_then(|i| i.get("date-parts"))
        .and_then(|d| d.as_array())
        .and_then(|a| a.first())
        .and_then(|p| p.as_array())
    {
        let nums: Vec<String> = parts.iter().filter_map(|n| n.as_i64()).map(|n| format!("{n:02}")).collect();
        if !nums.is_empty() {
            put("date", nums.join("-"));
        }
    }
    let mut creators = Vec::new();
    if let Some(arr) = m.get("author").and_then(|a| a.as_array()) {
        for a in arr {
            creators.push(Creator {
                first: a.get("given").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                last: a.get("family").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                creator_type: "author".to_string(),
            });
        }
    }
    let item_type = match cr_str(m, "type").as_str() {
        "book" | "monograph" => "book",
        "book-chapter" => "bookSection",
        "proceedings-article" => "conferencePaper",
        "posted-content" => "preprint",
        "report" => "report",
        "dataset" => "dataset",
        "dissertation" => "thesis",
        _ => "journalArticle",
    }
    .to_string();
    FetchedItem { item_type, fields, creators }
}

/// Look up an identifier (currently DOI, also accepted inside a URL) via Crossref.
#[tauri::command]
async fn fetch_identifier(identifier: String) -> Result<FetchedItem, String> {
    let doi = extract_doi(identifier.trim()).ok_or("Enter a DOI (or a link containing one)")?;
    let url = format!("https://api.crossref.org/works/{doi}");
    let c = http_client()?;
    let resp = c
        .get(&url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("No match for that DOI ({})", resp.status()));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let m = v.get("message").ok_or("Unexpected response from Crossref")?;
    Ok(crossref_to_item(m, &doi))
}

// ---- Web fetching / link metadata -----------------------------------------

/// Link metadata for previews (image is a remote URL at this stage).
#[derive(Serialize, Clone)]
struct LinkMeta {
    kind: String,
    url: String,
    title: String,
    description: Option<String>,
    site: Option<String>,
    image: Option<String>,
    is_pdf: bool,
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/124.0 Safari/537.36 Charly/0.1",
        )
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|e| e.to_string())
}

fn host_site(u: &reqwest::Url) -> Option<String> {
    u.host_str().map(|h| h.trim_start_matches("www.").to_string())
}

fn parse_og(html: &str, base: &reqwest::Url) -> LinkMeta {
    let doc = Html::parse_document(html);
    let meta = |key: &str, attr: &str| -> Option<String> {
        let sel = Selector::parse(&format!("meta[{attr}=\"{key}\"]")).ok()?;
        doc.select(&sel)
            .next()
            .and_then(|e| e.value().attr("content"))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };
    let title = meta("og:title", "property")
        .or_else(|| meta("twitter:title", "name"))
        .or_else(|| {
            let sel = Selector::parse("title").ok()?;
            doc.select(&sel)
                .next()
                .map(|e| e.text().collect::<String>().trim().to_string())
                .filter(|s| !s.is_empty())
        })
        .unwrap_or_else(|| base.as_str().to_string());
    let description = meta("og:description", "property")
        .or_else(|| meta("description", "name"))
        .or_else(|| meta("twitter:description", "name"));
    let site = meta("og:site_name", "property").or_else(|| host_site(base));
    let image = meta("og:image", "property")
        .or_else(|| meta("og:image:url", "property"))
        .or_else(|| meta("twitter:image", "name"))
        .and_then(|i| base.join(&i).ok().map(|u| u.to_string()));
    LinkMeta {
        kind: "webpage".into(),
        url: base.as_str().to_string(),
        title,
        description,
        site,
        image,
        is_pdf: false,
    }
}

async fn fetch_webpage(url: &str) -> Result<LinkMeta, String> {
    let c = http_client()?;
    let resp = c.get(url).send().await.map_err(|e| e.to_string())?;
    let final_url = resp.url().clone();
    let ctype = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    let looks_pdf = ctype.contains("application/pdf")
        || final_url.path().to_lowercase().ends_with(".pdf");
    if looks_pdf {
        return Ok(LinkMeta {
            kind: "pdf".into(),
            url: url.to_string(),
            title: final_url
                .path_segments()
                .and_then(|s| s.last().map(|x| x.to_string()))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "Document".into()),
            description: None,
            site: host_site(&final_url),
            image: None,
            is_pdf: true,
        });
    }
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(parse_og(&body, &final_url))
}

#[derive(Deserialize)]
struct Oembed {
    title: Option<String>,
    author_name: Option<String>,
    thumbnail_url: Option<String>,
}

async fn fetch_youtube(url: &str) -> Result<LinkMeta, String> {
    let c = http_client()?;
    let resp = c
        .get("https://www.youtube.com/oembed")
        .query(&[("format", "json"), ("url", url)])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        // Not a video URL (e.g. a channel page) — fall back to OG parsing.
        return fetch_webpage(url).await;
    }
    let o: Oembed = resp.json().await.map_err(|e| e.to_string())?;
    Ok(LinkMeta {
        kind: "youtube".into(),
        url: url.to_string(),
        title: o.title.unwrap_or_else(|| "YouTube video".into()),
        description: o.author_name.clone(),
        site: o.author_name.or_else(|| Some("YouTube".into())),
        image: o.thumbnail_url,
        is_pdf: false,
    })
}

async fn fetch_meta(url: &str) -> Result<LinkMeta, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "Please enter a valid URL".to_string())?;
    let host = parsed.host_str().unwrap_or("").to_lowercase();
    if host.contains("youtube.com") || host.contains("youtu.be") {
        fetch_youtube(url).await
    } else {
        fetch_webpage(url).await
    }
}

async fn download_pdf(dir: &Path, url: &str, title: &str) -> Result<String, String> {
    let c = http_client()?;
    let resp = c.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("download failed: {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let mut base = sanitize(title);
    if base.is_empty() {
        base = "Document".into();
    }
    if !base.to_lowercase().ends_with(".pdf") {
        base.push_str(".pdf");
    }
    let stem = base.trim_end_matches(".pdf").to_string();
    let mut dest = dir.join(&base);
    let mut n = 2;
    while dest.exists() {
        dest = dir.join(format!("{stem} ({n}).pdf"));
        n += 1;
    }
    fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    Ok(dest.file_name().unwrap().to_string_lossy().to_string())
}

// ===========================================================================
// Browser-extension clip server — a tiny localhost HTTP endpoint the Charly
// browser extension talks to. It lets a link open in the browser be saved
// straight into a chosen folder of the library: PDFs download as real files,
// web pages / videos are saved as small `.charlylink` JSON files.
// ===========================================================================

/// Fixed localhost port. Mirrored in `extension/manifest.json` host_permissions.
const CLIP_PORT: u16 = 8765;

#[derive(Deserialize)]
struct ClipReq {
    url: String,
    /// Folder path relative to the library root. Absent → "Inbox", "" → root.
    #[serde(default)]
    folder: Option<String>,
    /// Optional title override (e.g. the browser tab title).
    #[serde(default)]
    title: Option<String>,
}

#[derive(Serialize)]
struct ClipResp {
    kind: String, // "pdf" | "webpage" | "youtube"
    title: String,
    folder: String,
    file: String,
}

#[derive(Serialize)]
struct FolderList {
    library: String,      // display name of the library root
    folders: Vec<String>, // folder paths relative to the root ("" == root)
}

/// Resolve a library-relative folder into an absolute path, rejecting traversal.
fn resolve_folder(library: &str, folder: &Option<String>) -> Result<PathBuf, String> {
    let rel = match folder {
        Some(f) => f.trim().trim_matches('/').to_string(),
        None => "Inbox".to_string(),
    };
    if rel.split('/').any(|c| c == "..") {
        return Err("Invalid folder".into());
    }
    let lib = Path::new(library);
    Ok(if rel.is_empty() { lib.to_path_buf() } else { lib.join(rel) })
}

/// Save a web page / video link as a portable `.charlylink` JSON sidecar.
fn save_link_file(dir: &Path, meta: &LinkMeta) -> Result<String, String> {
    let mut base = sanitize(&meta.title);
    if base.is_empty() {
        base = "Link".into();
    }
    if base.chars().count() > 120 {
        base = base.chars().take(120).collect();
    }
    let mut dest = dir.join(format!("{base}.charlylink"));
    let mut n = 2;
    while dest.exists() {
        dest = dir.join(format!("{base} ({n}).charlylink"));
        n += 1;
    }
    let body = serde_json::json!({
        "url": meta.url,
        "title": meta.title,
        "site": meta.site,
        "description": meta.description,
        "kind": meta.kind,
        "image": meta.image,
    });
    fs::write(&dest, serde_json::to_string_pretty(&body).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok(dest.file_name().unwrap().to_string_lossy().to_string())
}

/// Clip a link into a library folder, downloading PDFs and snapshotting pages.
async fn clip_to_folder(
    library: &str,
    folder: &Option<String>,
    url: &str,
    title: &Option<String>,
) -> Result<ClipResp, String> {
    let dir = resolve_folder(library, folder)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut meta = fetch_meta(url).await?;
    if let Some(t) = title {
        let t = t.trim();
        if !t.is_empty() {
            meta.title = t.to_string();
        }
    }
    let (kind, file) = if meta.is_pdf {
        ("pdf".to_string(), download_pdf(&dir, url, &meta.title).await?)
    } else {
        (meta.kind.clone(), save_link_file(&dir, &meta)?)
    };
    let rel = folder.clone().unwrap_or_else(|| "Inbox".into());
    Ok(ClipResp { kind, title: meta.title, folder: rel, file })
}

/// Collect non-hidden subfolders (relative paths) for the extension dropdown.
fn collect_dirs(root: &Path, dir: &Path, out: &mut Vec<String>, depth: usize) {
    if depth > 6 || out.len() > 2000 {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.filter_map(|r| r.ok()) {
        let p = e.path();
        if !p.is_dir() {
            continue;
        }
        let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if name.starts_with('.') {
            continue;
        }
        if let Ok(rel) = p.strip_prefix(root) {
            out.push(rel.to_string_lossy().to_string());
        }
        collect_dirs(root, &p, out, depth + 1);
    }
}

fn list_folders(library: &str) -> FolderList {
    let lib = Path::new(library);
    let mut folders = Vec::new();
    collect_dirs(lib, lib, &mut folders, 0);
    folders.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    let name = lib
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| library.to_string());
    FolderList { library: name, folders }
}

// ===========================================================================
// RSS/Atom feeds (Zotero-style) — subscriptions stored in
// `<library>/.charly/feeds.json`; items are fetched live (not cached) and a
// saved item is written as a `.charlylink` sidecar, matching the clip format.
// ===========================================================================

/// A subscribed feed (persisted in feeds.json).
#[derive(Serialize, Deserialize, Clone)]
struct Feed {
    url: String,
    title: String,
}

/// One entry parsed out of a live feed fetch.
#[derive(Serialize)]
struct FeedItem {
    title: String,
    link: String,
    summary: String,
    published: String,
}

fn feeds_manifest(library: &str) -> PathBuf {
    Path::new(library).join(".charly").join("feeds.json")
}

fn read_feeds(library: &str) -> Vec<Feed> {
    fs::read_to_string(feeds_manifest(library))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_feeds(library: &str, list: &[Feed]) -> Result<(), String> {
    let mp = feeds_manifest(library);
    if let Some(p) = mp.parent() {
        fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    fs::write(mp, serde_json::to_string_pretty(list).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

/// Fetch + parse a feed URL into a feed-rs model.
async fn load_feed(url: &str) -> Result<feed_rs::model::Feed, String> {
    let c = http_client()?;
    let resp = c.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Couldn’t fetch feed ({})", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    feed_rs::parser::parse(&bytes[..])
        .map_err(|e| format!("Not a valid RSS/Atom feed: {e}"))
}

fn feed_title(parsed: &feed_rs::model::Feed, fallback: &str) -> String {
    parsed
        .title
        .as_ref()
        .map(|t| t.content.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

/// Subscribe to a feed: validate by fetching/parsing, then persist {url,title}.
#[tauri::command]
async fn add_feed(library: String, url: String) -> Result<Vec<Feed>, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("Enter a feed URL".into());
    }
    let parsed = load_feed(&url).await?;
    let title = feed_title(&parsed, &url);
    let mut list = read_feeds(&library);
    if let Some(existing) = list.iter_mut().find(|f| f.url == url) {
        existing.title = title;
    } else {
        list.push(Feed { url, title });
    }
    write_feeds(&library, &list)?;
    Ok(list)
}

#[tauri::command]
fn list_feeds(library: String) -> Result<Vec<Feed>, String> {
    Ok(read_feeds(&library))
}

#[tauri::command]
fn remove_feed(library: String, url: String) -> Result<Vec<Feed>, String> {
    let mut list = read_feeds(&library);
    list.retain(|f| f.url != url);
    write_feeds(&library, &list)?;
    Ok(list)
}

/// Fetch a feed's current items (not persisted).
#[tauri::command]
async fn fetch_feed(url: String) -> Result<Vec<FeedItem>, String> {
    let parsed = load_feed(&url).await?;
    let items = parsed
        .entries
        .into_iter()
        .map(|e| {
            let title = e.title.map(|t| t.content.trim().to_string()).unwrap_or_default();
            let link = e
                .links
                .into_iter()
                .find(|l| l.rel.as_deref() != Some("self"))
                .map(|l| l.href)
                .unwrap_or_default();
            let summary = e
                .summary
                .map(|s| s.content)
                .or_else(|| e.content.and_then(|c| c.body))
                .map(|s| strip_html(&s))
                .unwrap_or_default();
            let published = e
                .published
                .or(e.updated)
                .map(|d| d.to_rfc3339())
                .unwrap_or_default();
            FeedItem { title, link, summary, published }
        })
        .collect();
    Ok(items)
}

/// Save a feed item into a library folder as a `.charlylink` sidecar.
#[tauri::command]
fn save_feed_item(
    library: String,
    folder: String,
    url: String,
    title: String,
) -> Result<String, String> {
    let dir = resolve_folder(&library, &Some(folder))?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let site = reqwest::Url::parse(&url).ok().and_then(|u| host_site(&u));
    let title = if title.trim().is_empty() { url.clone() } else { title };
    let meta = LinkMeta {
        kind: "webpage".into(),
        url,
        title,
        description: None,
        site,
        image: None,
        is_pdf: false,
    };
    save_link_file(&dir, &meta)
}

/// Best-effort strip of HTML tags from a feed summary for plain-text preview.
fn strip_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

type ClipResponse = tiny_http::Response<std::io::Cursor<Vec<u8>>>;

fn json_response(status: u16, body: String) -> ClipResponse {
    let mut resp = tiny_http::Response::from_string(body).with_status_code(status);
    for (k, v) in [
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
        ("Access-Control-Allow-Headers", "Content-Type"),
        ("Content-Type", "application/json"),
    ] {
        if let Ok(h) = tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()) {
            resp.add_header(h);
        }
    }
    resp
}

fn err_json(status: u16, msg: &str) -> ClipResponse {
    json_response(status, serde_json::json!({ "error": msg }).to_string())
}

/// Spawn the clip server on its own thread, with a small async runtime for the
/// network fetches each clip performs.
fn start_clip_server(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let server = match tiny_http::Server::http(("127.0.0.1", CLIP_PORT)) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[charly] clip server disabled: {e}");
                return;
            }
        };
        let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[charly] clip server runtime failed: {e}");
                return;
            }
        };
        eprintln!("[charly] clip server listening on http://127.0.0.1:{CLIP_PORT}");
        for mut request in server.incoming_requests() {
            let method = request.method().clone();
            let path = request.url().split('?').next().unwrap_or("").to_string();
            let resp = match (&method, path.as_str()) {
                (tiny_http::Method::Options, _) => json_response(204, String::new()),
                (tiny_http::Method::Get, "/ping") => {
                    let lib = read_config(&app).library_path;
                    json_response(
                        200,
                        serde_json::json!({ "app": "charly", "library": lib.is_some() }).to_string(),
                    )
                }
                (tiny_http::Method::Get, "/folders") => match read_config(&app).library_path {
                    Some(lib) => {
                        json_response(200, serde_json::to_string(&list_folders(&lib)).unwrap_or_default())
                    }
                    None => err_json(409, "No library selected in Charly yet"),
                },
                (tiny_http::Method::Post, "/clip") => {
                    let mut body = String::new();
                    if request.as_reader().read_to_string(&mut body).is_err() {
                        err_json(400, "Could not read request body")
                    } else {
                        match read_config(&app).library_path {
                            None => err_json(409, "No library selected in Charly yet"),
                            Some(lib) => match serde_json::from_str::<ClipReq>(&body) {
                                Err(e) => err_json(400, &e.to_string()),
                                Ok(req) => match rt
                                    .block_on(clip_to_folder(&lib, &req.folder, &req.url, &req.title))
                                {
                                    Ok(r) => {
                                        // Tell the open Charly window to re-scan disk so the
                                        // freshly clipped item appears without a manual refresh.
                                        let _ = app.emit("clip-added", &r);
                                        json_response(
                                            200,
                                            serde_json::to_string(&r).unwrap_or_default(),
                                        )
                                    }
                                    Err(e) => err_json(502, &e),
                                },
                            },
                        }
                    }
                }
                _ => err_json(404, "Not found"),
            };
            let _ = request.respond(resp);
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Build the native macOS menu bar. "File ▸ Open Folder…" lets the user pick
/// the library folder from the system menu instead of an in-app button.
fn build_app_menu(handle: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

    let open_folder = MenuItem::with_id(
        handle,
        "open_folder",
        "Open Folder…",
        true,
        Some("CmdOrCtrl+O"),
    )?;

    let app_menu = Submenu::with_items(
        handle,
        "Charly",
        true,
        &[
            &PredefinedMenuItem::about(handle, Some("About Charly"), None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::hide(handle, None)?,
            &PredefinedMenuItem::hide_others(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::quit(handle, None)?,
        ],
    )?;

    let file_menu = Submenu::with_items(
        handle,
        "File",
        true,
        &[
            &open_folder,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::close_window(handle, None)?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        handle,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(handle, None)?,
            &PredefinedMenuItem::redo(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::cut(handle, None)?,
            &PredefinedMenuItem::copy(handle, None)?,
            &PredefinedMenuItem::paste(handle, None)?,
            &PredefinedMenuItem::select_all(handle, None)?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        handle,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::close_window(handle, None)?,
        ],
    )?;

    Menu::with_items(handle, &[&app_menu, &file_menu, &edit_menu, &window_menu])
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .menu(build_app_menu)
        .on_menu_event(|app, event| {
            if event.id().0 == "open_folder" {
                let _ = app.emit("menu:open-folder", ());
            }
        })
        .setup(|app| {
            start_clip_server(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_library,
            set_library,
            list_dir,
            create_folder,
            rename_entry,
            delete_entry,
            move_entry,
            import_files,
            read_file,
            search,
            get_item_meta,
            set_item_tags,
            set_item_note,
            set_item_title,
            file_info,
            list_items,
            library_items,
            trash_item,
            list_trash,
            restore_trash,
            empty_trash,
            list_saved_searches,
            save_saved_search,
            delete_saved_search,
            run_saved_search,
            list_all_tags,
            find_by_tag,
            get_highlights,
            save_highlights,
            create_item,
            get_item,
            save_item,
            write_text_file,
            attach_to_item,
            fetch_identifier,
            add_feed,
            list_feeds,
            remove_feed,
            fetch_feed,
            save_feed_item,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
