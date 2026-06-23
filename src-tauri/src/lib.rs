use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use scraper::{Html, Selector};
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

// ===========================================================================
// People — author/researcher profiles, stored as plain folders in the library
// (`<library>/People/<name>/person.json` + downloaded avatar/thumbnails/PDFs).
// ===========================================================================

/// One resource attached to a person: a PDF, a website snapshot, or a video.
#[derive(Serialize, Deserialize, Clone)]
struct Source {
    id: String,
    kind: String, // "pdf" | "webpage" | "youtube"
    #[serde(default)]
    url: Option<String>,
    title: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    site: Option<String>,
    #[serde(default)]
    thumb: Option<String>, // path relative to the person dir
    #[serde(default)]
    file: Option<String>, // PDF filename relative to the person dir
}

/// What we persist to `person.json`.
#[derive(Serialize, Deserialize, Clone, Default)]
struct PersonData {
    name: String,
    #[serde(default)]
    summary: String,
    #[serde(default)]
    photo: Option<String>, // avatar filename relative to the person dir
    #[serde(default)]
    sources: Vec<Source>,
}

/// What we hand to the frontend — `PersonData` plus the absolute folder path.
#[derive(Serialize)]
struct Person {
    dir: String,
    name: String,
    summary: String,
    photo: Option<String>,
    sources: Vec<Source>,
}

impl Person {
    fn build(dir: &Path, d: PersonData) -> Self {
        Person {
            dir: dir.to_string_lossy().to_string(),
            name: d.name,
            summary: d.summary,
            photo: d.photo,
            sources: d.sources,
        }
    }
}

fn now_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos}")
}

fn sanitize(name: &str) -> String {
    name.trim().replace(['/', '\\', ':'], "-")
}

fn people_root(library: &str) -> PathBuf {
    Path::new(library).join("People")
}

fn read_person_data(dir: &Path) -> Result<PersonData, String> {
    let s = fs::read_to_string(dir.join("person.json")).map_err(|e| e.to_string())?;
    serde_json::from_str(&s).map_err(|e| e.to_string())
}

fn write_person_data(dir: &Path, d: &PersonData) -> Result<(), String> {
    let s = serde_json::to_string_pretty(d).map_err(|e| e.to_string())?;
    fs::write(dir.join("person.json"), s).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_people(library: String) -> Result<Vec<Person>, String> {
    let root = people_root(&library);
    if !root.exists() {
        return Ok(vec![]);
    }
    let mut people: Vec<Person> = fs::read_dir(&root)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .map(|d| d.path())
        .filter(|p| p.is_dir())
        .filter_map(|p| read_person_data(&p).ok().map(|d| Person::build(&p, d)))
        .collect();
    people.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(people)
}

#[tauri::command]
fn create_person(library: String, name: String) -> Result<Person, String> {
    let safe = sanitize(&name);
    if safe.is_empty() {
        return Err("Name cannot be empty".into());
    }
    let root = people_root(&library);
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let mut dir = root.join(&safe);
    let mut n = 2;
    while dir.exists() {
        dir = root.join(format!("{safe} ({n})"));
        n += 1;
    }
    fs::create_dir(&dir).map_err(|e| e.to_string())?;
    let data = PersonData {
        name: name.trim().to_string(),
        ..Default::default()
    };
    write_person_data(&dir, &data)?;
    Ok(Person::build(&dir, data))
}

#[tauri::command]
fn update_person(dir: String, name: String, summary: String) -> Result<Person, String> {
    let p = Path::new(&dir);
    let mut data = read_person_data(p)?;
    data.name = name.trim().to_string();
    data.summary = summary;
    write_person_data(p, &data)?;
    Ok(Person::build(p, data))
}

#[tauri::command]
fn delete_person(dir: String) -> Result<(), String> {
    trash::delete(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_source(dir: String, id: String) -> Result<Person, String> {
    let p = Path::new(&dir);
    let mut data = read_person_data(p)?;
    if let Some(src) = data.sources.iter().find(|s| s.id == id) {
        if let Some(f) = &src.file {
            let _ = trash::delete(p.join(f));
        }
        if let Some(t) = &src.thumb {
            let _ = fs::remove_file(p.join(t));
        }
    }
    data.sources.retain(|s| s.id != id);
    write_person_data(p, &data)?;
    Ok(Person::build(p, data))
}

/// Copy local PDF files into a person's folder as attached sources.
#[tauri::command]
fn import_person_pdfs(dir: String, sources: Vec<String>) -> Result<Person, String> {
    let p = Path::new(&dir);
    let mut data = read_person_data(p)?;
    for (i, src) in sources.iter().enumerate() {
        let s = Path::new(src);
        let Some(file_name) = s.file_name() else {
            continue;
        };
        let mut dest = p.join(file_name);
        if dest.exists() {
            let stem = s.file_stem().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
            let ext = s.extension().map(|x| format!(".{}", x.to_string_lossy())).unwrap_or_default();
            let mut n = 2;
            loop {
                let cand = p.join(format!("{stem} ({n}){ext}"));
                if !cand.exists() {
                    dest = cand;
                    break;
                }
                n += 1;
            }
        }
        fs::copy(s, &dest).map_err(|e| e.to_string())?;
        let fname = dest.file_name().unwrap().to_string_lossy().to_string();
        let title = dest
            .file_stem()
            .map(|x| x.to_string_lossy().to_string())
            .unwrap_or_else(|| fname.clone());
        data.sources.insert(
            0,
            Source {
                id: format!("{}-{i}", now_id()),
                kind: "pdf".into(),
                url: None,
                title,
                description: None,
                site: None,
                thumb: None,
                file: Some(fname),
            },
        );
    }
    write_person_data(p, &data)?;
    Ok(Person::build(p, data))
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

/// Frontend-callable preview (no side effects) — used to confirm before saving.
#[tauri::command]
async fn preview_link(url: String) -> Result<LinkMeta, String> {
    fetch_meta(&url).await
}

fn ext_for(ctype: &str, url: &str) -> &'static str {
    let c = ctype.to_lowercase();
    let u = url.to_lowercase();
    if c.contains("png") || u.contains(".png") {
        "png"
    } else if c.contains("webp") || u.contains(".webp") {
        "webp"
    } else if c.contains("gif") || u.contains(".gif") {
        "gif"
    } else if c.contains("svg") || u.contains(".svg") {
        "svg"
    } else {
        "jpg"
    }
}

/// Download a remote image into the person dir; returns the relative filename.
async fn download_image(dir: &Path, base_name: &str, image_url: &str) -> Result<String, String> {
    let c = http_client()?;
    let resp = c.get(image_url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("image fetch failed: {}", resp.status()));
    }
    let ctype = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let ext = ext_for(&ctype, image_url);
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let fname = format!("{base_name}.{ext}");
    let full = dir.join(&fname);
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).ok();
    }
    fs::write(&full, &bytes).map_err(|e| e.to_string())?;
    Ok(fname)
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

/// Set a person's avatar by fetching an image from a link's metadata.
#[tauri::command]
async fn set_photo_from_link(dir: String, link: String) -> Result<Person, String> {
    let meta = fetch_meta(&link).await?;
    let image = meta.image.ok_or("Couldn’t find an image at that link")?;
    let p = Path::new(&dir).to_path_buf();
    let fname = download_image(&p, "avatar", &image).await?;
    let mut data = read_person_data(&p)?;
    data.photo = Some(fname);
    write_person_data(&p, &data)?;
    Ok(Person::build(&p, data))
}

/// Add a resource link to a person: downloads PDFs, snapshots webpages, or
/// captures YouTube metadata, then stores it in `person.json`.
#[tauri::command]
async fn add_source(dir: String, link: String) -> Result<Person, String> {
    let p = Path::new(&dir).to_path_buf();
    let meta = fetch_meta(&link).await?;
    let id = now_id();
    let source = if meta.is_pdf {
        let fname = download_pdf(&p, &link, &meta.title).await?;
        let title = fname.trim_end_matches(".pdf").to_string();
        Source {
            id,
            kind: "pdf".into(),
            url: Some(link.clone()),
            title,
            description: None,
            site: meta.site,
            thumb: None,
            file: Some(fname),
        }
    } else {
        let thumb = match &meta.image {
            Some(img) => download_image(&p, &format!(".thumbs/{id}"), img).await.ok(),
            None => None,
        };
        Source {
            id,
            kind: meta.kind,
            url: Some(link.clone()),
            title: meta.title,
            description: meta.description,
            site: meta.site,
            thumb,
            file: None,
        }
    };
    let mut data = read_person_data(&p)?;
    data.sources.insert(0, source);
    write_person_data(&p, &data)?;
    Ok(Person::build(&p, data))
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
                                    Ok(r) => json_response(
                                        200,
                                        serde_json::to_string(&r).unwrap_or_default(),
                                    ),
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
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
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
            list_people,
            create_person,
            update_person,
            delete_person,
            remove_source,
            import_person_pdfs,
            preview_link,
            set_photo_from_link,
            add_source,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
