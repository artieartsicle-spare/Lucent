use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::state::{save_settings, Shared};

const MAX_VISIT: usize = 20_000;
const MAX_IMAGE_BYTES: u64 = 40 * 1024 * 1024;
const IMAGE_EXT: [&str; 6] = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];
const BLOCKED_EXT: [&str; 20] = [
    "exe", "bat", "cmd", "com", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "msi", "msp", "scr", "reg", "hta", "cpl",
    "jar", "lnk",
];
const JUNK_EXT: [&str; 6] = ["tmp", "crdownload", "part", "partial", "download", "ini"];

#[derive(Serialize, Clone)]
pub struct FileItem {
    name: String,
    path: String,
    mtime: u64,
    size: u64,
}

/// Canonical, existing folders the user picked through the native dialog (persisted in settings).
fn chosen(app: &AppHandle) -> Vec<PathBuf> {
    let list = app.state::<Shared>().settings.lock().map(|s| s.photo_folders.clone()).unwrap_or_default();
    list.iter().filter_map(|d| fs::canonicalize(d).ok()).filter(|d| d.is_dir()).collect()
}

/// Remember a folder. Only ever called with the result of the native folder dialog.
fn remember(app: &AppHandle, dir: &Path) -> Option<PathBuf> {
    let d = fs::canonicalize(dir).ok().filter(|d| d.is_dir())?;
    let text = d.to_string_lossy().into_owned();
    {
        let st = app.state::<Shared>();
        let mut s = st.settings.lock().ok()?;
        if !s.photo_folders.contains(&text) {
            s.photo_folders.push(text);
            let n = s.photo_folders.len();
            if n > 64 {
                s.photo_folders.drain(0..n - 64);
            }
        }
    }
    save_settings(app);
    Some(d)
}

/// A `path:` album is only honoured when it is (inside) a folder the user picked in the dialog.
fn picked_dir(app: &AppHandle, dir: &str) -> Option<PathBuf> {
    let d = fs::canonicalize(dir).ok().filter(|d| d.is_dir())?;
    chosen(app).iter().any(|c| d.starts_with(c)).then_some(d)
}

fn home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from)
}

fn known(home: &Path, name: &str) -> Vec<PathBuf> {
    let mut v = vec![home.join(name)];
    let od = home.join("OneDrive").join(name);
    if od.is_dir() {
        v.push(od);
    }
    v.into_iter().filter(|p| p.is_dir()).collect()
}

fn roots(kind: &str) -> (Vec<PathBuf>, usize) {
    let Some(h) = home() else { return (vec![], 0) };
    match kind {
        "downloads" => (known(&h, "Downloads"), 1),
        "documents" => (known(&h, "Documents"), 3),
        "desktop" => (known(&h, "Desktop"), 1),
        "pictures" => (known(&h, "Pictures"), 3),
        "screenshots" => (
            known(&h, "Pictures").into_iter().map(|p| p.join("Screenshots")).filter(|p| p.is_dir()).collect(),
            1,
        ),
        _ => {
            let mut v = known(&h, "Desktop");
            v.extend(known(&h, "Documents"));
            v.extend(known(&h, "Downloads"));
            (v, 2)
        }
    }
}

fn ext_of(p: &Path) -> String {
    p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}

fn skip_dir(name: &str) -> bool {
    name.starts_with('.')
        || name.starts_with('$')
        || matches!(name.to_ascii_lowercase().as_str(), "node_modules" | "appdata" | "__pycache__" | "venv" | "target" | "site-packages")
}

fn scan(roots: Vec<PathBuf>, depth: usize, keep: impl Fn(&Path) -> bool, limit: usize) -> Vec<FileItem> {
    let mut out: Vec<FileItem> = Vec::new();
    let mut queue: VecDeque<(PathBuf, usize)> = roots.into_iter().map(|r| (r, 0)).collect();
    let mut visited = 0usize;
    while let Some((dir, d)) = queue.pop_front() {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            visited += 1;
            if visited > MAX_VISIT {
                break;
            }
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || name.starts_with("~$") || name.eq_ignore_ascii_case("desktop.ini") || name.eq_ignore_ascii_case("thumbs.db") {
                continue;
            }
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_symlink() {
                continue;
            }
            let path = e.path();
            if ft.is_dir() {
                if d < depth && !skip_dir(&name) {
                    queue.push_back((path, d + 1));
                }
            } else if keep(&path) {
                let Ok(m) = e.metadata() else { continue };
                let mtime = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
                out.push(FileItem { name, path: path.to_string_lossy().into_owned(), mtime, size: m.len() });
            }
        }
    }
    out.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    out.truncate(limit);
    out
}

#[tauri::command]
pub async fn files_list(caller: WebviewWindow, kind: String, limit: Option<usize>) -> Vec<FileItem> {
    if caller.label() != crate::overlay::LABEL {
        return Vec::new();
    }
    tauri::async_runtime::spawn_blocking(move || {
        let (r, depth) = roots(&kind);
        scan(r, depth, |p| !JUNK_EXT.contains(&ext_of(p).as_str()), limit.unwrap_or(12).clamp(1, 50))
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn photos_list(app: AppHandle, caller: WebviewWindow, kind: String) -> Vec<FileItem> {
    if caller.label() != crate::overlay::LABEL {
        return Vec::new();
    }
    tauri::async_runtime::spawn_blocking(move || {
        let (r, depth) = match kind.strip_prefix("path:") {
            Some(dir) => (picked_dir(&app, dir).into_iter().collect::<Vec<PathBuf>>(), 3usize),
            None => roots(&kind),
        };
        scan(r, depth, |p| IMAGE_EXT.contains(&ext_of(p).as_str()), 400)
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn pick_folder(app: AppHandle, caller: WebviewWindow) -> Option<String> {
    if caller.label() != crate::overlay::LABEL {
        return None;
    }
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().set_title("Choose a folder of pictures").pick_folder(move |p| {
        let _ = tx.send(p);
    });
    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten()).await.ok().flatten()?;
    let dir = picked.into_path().ok()?;
    remember(&app, &dir).map(|d| d.to_string_lossy().trim_start_matches(r"\\?\").to_string())
}

fn inside_profile(app: &AppHandle, path: &str) -> Option<PathBuf> {
    let p = fs::canonicalize(path).ok()?;
    if let Some(h) = home().and_then(|h| fs::canonicalize(h).ok()) {
        if p.starts_with(&h) {
            return Some(p);
        }
    }
    chosen(app).iter().any(|d| p.starts_with(d)).then_some(p)
}

#[tauri::command]
pub async fn photo_thumb(app: AppHandle, caller: WebviewWindow, path: String, max_edge: Option<u32>) -> Result<String, String> {
    if caller.label() != crate::overlay::LABEL {
        return Err("not allowed".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let p = inside_profile(&app, &path).ok_or("not allowed")?;
        if !IMAGE_EXT.contains(&ext_of(&p).as_str()) {
            return Err("not an image".to_string());
        }
        if fs::metadata(&p).map(|m| m.len()).unwrap_or(u64::MAX) > MAX_IMAGE_BYTES {
            return Err("too large".to_string());
        }
        let edge = max_edge.unwrap_or(640).clamp(64, 1600);
        let img = image::open(&p).map_err(|e| e.to_string())?;
        let rgb = img.thumbnail(edge, edge).to_rgb8();
        let mut buf: Vec<u8> = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 84).encode_image(&rgb).map_err(|e| e.to_string())?;
        Ok(format!("data:image/jpeg;base64,{}", B64.encode(buf)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn path_open(app: AppHandle, caller: WebviewWindow, path: String, reveal: Option<bool>) {
    if caller.label() != crate::overlay::LABEL {
        return;
    }
    let Some(p) = inside_profile(&app, &path) else { return };
    if p.is_file() && BLOCKED_EXT.contains(&ext_of(&p).as_str()) {
        return;
    }
    if reveal.unwrap_or(false) && p.is_file() {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("explorer.exe")
                .arg(format!("/select,{}", p.to_string_lossy()))
                .creation_flags(0x0800_0000)
                .spawn();
        }
        return;
    }
    let _ = app.opener().open_path(p.to_string_lossy().into_owned(), None::<&str>);
}

#[cfg(test)]
mod tests {
    #[test]
    fn missing_paths_do_not_canonicalize() {
        assert!(std::fs::canonicalize("/definitely/not/here").is_err());
    }
}
