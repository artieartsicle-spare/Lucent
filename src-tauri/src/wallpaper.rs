use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager};

use crate::state::Shared;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperMeta {
    pub has_data: bool,
    pub style: i64,
    pub tile: bool,
    pub color: [u8; 3],
    pub rev: String,
}

struct Meta {
    file: Option<PathBuf>,
    pub style: i64,
    pub tile: bool,
    pub color: [u8; 3],
    sig: String,
}

fn transcoded() -> PathBuf {
    PathBuf::from(std::env::var("APPDATA").unwrap_or_default())
        .join("Microsoft")
        .join("Windows")
        .join("Themes")
        .join("TranscodedWallpaper")
}

#[cfg(windows)]
fn read_registry() -> (Option<String>, Option<String>, bool, [u8; 3]) {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let mut path = None;
    let mut style = None;
    let mut tile = false;
    if let Ok(desk) = hkcu.open_subkey("Control Panel\\Desktop") {
        path = desk.get_value::<String, _>("WallPaper").ok();
        style = desk.get_value::<String, _>("WallpaperStyle").ok();
        tile = desk.get_value::<String, _>("TileWallpaper").map(|v| v.trim() == "1").unwrap_or(false);
    }
    let mut color = [0u8; 3];
    if let Ok(cols) = hkcu.open_subkey("Control Panel\\Colors") {
        if let Ok(bg) = cols.get_value::<String, _>("Background") {
            for (i, part) in bg.split_whitespace().take(3).enumerate() {
                color[i] = part.parse::<u16>().unwrap_or(0).min(255) as u8;
            }
        }
    }
    (path, style, tile, color)
}
#[cfg(not(windows))]
fn read_registry() -> (Option<String>, Option<String>, bool, [u8; 3]) {
    (None, None, false, [0, 0, 0])
}

fn meta() -> Meta {
    let (reg_path, reg_style, tile, color) = read_registry();
    let mut file = None;
    let mut st = None;
    let mut candidates = vec![transcoded()];
    if let Some(p) = reg_path.filter(|p| !p.is_empty()) {
        candidates.push(PathBuf::from(p));
    }
    for c in candidates {
        if let Ok(m) = std::fs::metadata(&c) {
            if m.is_file() && m.len() > 0 {
                st = Some(m);
                file = Some(c);
                break;
            }
        }
    }
    let style = reg_style.and_then(|s| s.trim().parse::<i64>().ok()).unwrap_or(10);
    let (mtime, size) = st
        .map(|m| {
            let t = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis())
                .unwrap_or(0);
            (t, m.len())
        })
        .unwrap_or((0, 0));
    let sig = format!(
        "{}|{}|{}|{}|{}|{}",
        file.as_ref().map(|f| f.to_string_lossy().to_string()).unwrap_or_default(),
        mtime,
        size,
        style,
        tile,
        color.map(|c| c.to_string()).join(",")
    );
    Meta { file, style, tile, color, sig }
}

fn to_payload(m: &Meta) -> WallpaperMeta {
    WallpaperMeta { has_data: m.file.is_some(), style: m.style, tile: m.tile, color: m.color, rev: m.sig.clone() }
}

pub fn refresh(app: &AppHandle, force: bool) {
    let st = app.state::<Shared>();
    if st.wp_busy.swap(true, Ordering::SeqCst) {
        return;
    }
    let m = meta();
    {
        let mut sig = st.wp_sig.lock().unwrap();
        if force || *sig != m.sig {
            *sig = m.sig.clone();
            let _ = app.emit_to("main", "wallpaper:changed", to_payload(&m));
            crate::overlay::keep_clear_soon(app);
        }
    }
    st.wp_busy.store(false, Ordering::SeqCst);
}

pub fn start_watch(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last = String::new();
        let mut n = 0u32;
        loop {
            std::thread::sleep(Duration::from_secs(3));
            n += 1;
            let sig = std::fs::metadata(transcoded())
                .map(|m| format!("{:?}|{}", m.modified().ok(), m.len()))
                .unwrap_or_default();
            if sig != last {
                last = sig;
                refresh(&app, false);
            } else if n % 10 == 0 {
                refresh(&app, false);
            }
        }
    });
}

#[tauri::command]
pub fn wallpaper_meta(app: AppHandle) -> WallpaperMeta {
    let m = meta();
    *app.state::<Shared>().wp_sig.lock().unwrap() = m.sig.clone();
    to_payload(&m)
}

#[tauri::command]
pub fn wallpaper_bytes() -> Response {
    let m = meta();
    let data = m
        .file
        .and_then(|f| match std::fs::read(&f) {
            Ok(d) => Some(d),
            Err(e) => {
                eprintln!("[wallpaper] read failed: {e}");
                None
            }
        })
        .unwrap_or_default();
    Response::new(data)
}
