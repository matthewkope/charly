use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Manager;

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
fn rename_entry(path: String, new_name: String) -> Result<String, String> {
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
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
fn delete_entry(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn move_entry(path: String, dest_dir: String) -> Result<String, String> {
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
    Ok(dest.to_string_lossy().to_string())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
