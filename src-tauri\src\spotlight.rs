use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::Serialize;
use sha1::{Digest, Sha1};
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;

use crate::platform;
use crate::shell::{icon_extract_script, powershell, ps_command};
use crate::state::{data_dir, save_settings, Shared};

pub const LABEL: &str = "spotlight";
const MAX_FILES: usize = 150_000;
const MAX_DEPTH: usize = 6;
const REINDEX_AFTER: Duration = Duration::from_secs(180);
const CLIP_MAX: usize = 50;
const ICON_PX: u32 = 64;

#[derive(Clone)]
pub struct Entry {
    pub name: String,
    pub lower: String,
    pub path: String,
    pub dir: bool,
    pub mtime: u64,
}

#[derive(Clone, Serialize)]
pub struct ClipItem {
    pub text: String,
    pub at: u64,
}

#[derive(Default)]
pub struct Spot {
    apps: Mutex<Vec<Entry>>,
    files: Mutex<Vec<Entry>>,
    clip: Mutex<Vec<ClipItem>>,
    backdrop: Mutex<Option<Vec<u8>>>,
    rect: Mutex<(i32, i32, i32, i32)>,
    icons: Mutex<HashMap<String, String>>,
    indexing: AtomicBool,
    indexed_at: Mutex<Option<Instant>>,
    shown_at: Mutex<Option<Instant>>,
    visible: AtomicBool,
    native: AtomicBool,
    picking: AtomicBool,
    count: AtomicU64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub name: String,
    pub path: String,
    pub dir: bool,
    pub mtime: u64,
    pub kind: &'static str,
}

#[derive(Serialize)]
pub struct Found {
    pub apps: Vec<Hit>,
    pub files: Vec<Hit>,
}

#[derive(Serialize, Clone)]
pub struct IndexStatus {
    pub indexing: bool,
    pub count: u64,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn hit(e: &Entry, kind: &'static str) -> Hit {
    Hit { name: e.name.clone(), path: e.path.clone(), dir: e.dir, mtime: e.mtime, kind }
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

/// Commands that drive Spotlight may only be called from the Spotlight window itself.
/// Tauri exposes every `#[tauri::command]` to every webview, so this is checked explicitly.
fn from_spotlight(caller: &WebviewWindow) -> bool {
    caller.label() == LABEL
}

const HOTKEYS: [&str; 2] = ["Alt+Space", "Control+Alt+Space"];

pub fn enabled(app: &AppHandle) -> bool {
    app.state::<Shared>().settings.lock().unwrap().spotlight_enabled
}

pub fn register_hotkeys(app: &AppHandle) {
    let gs = app.global_shortcut();
    for keys in HOTKEYS {
        if gs.is_registered(keys) {
            continue;
        }
        let r = gs.on_shortcut(keys, |app, _s, ev| {
            if ev.state() == ShortcutState::Pressed {
                toggle(app);
            }
        });
        println!("[hotkey] {keys}: {}", if r.is_ok() { "ok" } else { "FAILED (already used by another app)" });
    }
}

fn unregister_hotkeys(app: &AppHandle) {
    let gs = app.global_shortcut();
    for keys in HOTKEYS {
        let _ = gs.unregister(keys);
    }
}

pub fn set_enabled(app: &AppHandle, on: bool) {
    app.state::<Shared>().settings.lock().unwrap().spotlight_enabled = on;
    save_settings(app);
    if on {
        register_hotkeys(app);
    } else {
        hide(app);
        unregister_hotkeys(app);
        clip_clear(&app);
    }
    crate::tray::rebuild(app);
}

pub fn create_window(app: &AppHandle) -> tauri::Result<()> {
    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("spotlight.html".into()))
        .title("Spotlight Search")
        .transparent(true)
        .decorations(false)
        .resizable(false)
        .shadow(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .focused(false)
        .visible(false);
    #[cfg(windows)]
    let builder = builder.additional_browser_args(crate::overlay::BROWSER_ARGS);
    let w = builder.build()?;
    #[cfg(windows)]
    if let Ok(h) = w.hwnd() {
        platform::no_backdrop_soon(h.0 as isize);
    }
    let app2 = app.clone();
    w.on_window_event(move |e| {
        if let WindowEvent::Focused(false) = e {
            let st = app2.state::<Spot>();
            let recent = st.shown_at.lock().unwrap().map(|t| t.elapsed() < Duration::from_millis(350)).unwrap_or(false);
            if st.visible.load(Ordering::SeqCst) && !recent && !st.picking.load(Ordering::SeqCst) {
                hide(&app2);
            }
        }
    });
    Ok(())
}

fn target_monitor(app: &AppHandle) -> Option<(PhysicalPosition<i32>, PhysicalSize<u32>)> {
    if let Some((x, y)) = platform::cursor_pos() {
        if let Ok(Some(m)) = app.monitor_from_point(x as f64, y as f64) {
            return Some((*m.position(), *m.size()));
        }
    }
    app.primary_monitor().ok().flatten().map(|m| (*m.position(), *m.size()))
}

fn grab(x: i32, y: i32, w: i32, h: i32) -> Option<Vec<u8>> {
    let div = ((w + 959) / 960).max(2);
    platform::capture_screen(x, y, w, h, div).map(|(cw, ch, mut rgba)| {
        let mut out = Vec::with_capacity(rgba.len() + 8);
        out.extend_from_slice(&cw.to_le_bytes());
        out.extend_from_slice(&ch.to_le_bytes());
        out.append(&mut rgba);
        out
    })
}

pub fn show(app: &AppHandle) {
    if !enabled(app) {
        return;
    }
    let Some(w) = window(app) else { return };
    let st = app.state::<Spot>();
    let Some((pos, size)) = target_monitor(app) else { return };

    let cap = if st.native.load(Ordering::SeqCst) { None } else { grab(pos.x, pos.y, size.width as i32, size.height as i32) };
    *st.rect.lock().unwrap() = (pos.x, pos.y, size.width as i32, size.height as i32);
    *st.backdrop.lock().unwrap() = cap;

    let (wpos, wsize) = if st.native.load(Ordering::SeqCst) {
        let sf = w.scale_factor().unwrap_or(1.0);
        let ww = size.width.min((1000.0 * sf) as u32);
        let top = pos.y + (size.height as f64 * 0.27) as i32 - (40.0 * sf) as i32;
        let hh = ((pos.y + size.height as i32 - top).max(0) as u32).min((780.0 * sf) as u32);
        (PhysicalPosition::new(pos.x + ((size.width - ww) / 2) as i32, top), PhysicalSize::new(ww, hh))
    } else {
        (pos, size)
    };
    let _ = w.set_position(wpos);
    let _ = w.set_size(wsize);
    *st.shown_at.lock().unwrap() = Some(Instant::now());
    st.visible.store(true, Ordering::SeqCst);
    let _ = w.show();
    #[cfg(windows)]
    if let Ok(h) = w.hwnd() {
        platform::no_backdrop_soon(h.0 as isize);
        platform::foreground(h.0 as isize);
    }
    let _ = w.set_focus();
    let _ = app.emit_to(LABEL, "spotlight:show", ());

    let stale = st.indexed_at.lock().unwrap().map(|t| t.elapsed() > REINDEX_AFTER).unwrap_or(true);
    if stale && !st.indexing.load(Ordering::SeqCst) {
        let a = app.clone();
        std::thread::spawn(move || index_all(&a));
    }
}

pub fn hide(app: &AppHandle) {
    let st = app.state::<Spot>();
    st.visible.store(false, Ordering::SeqCst);
    *st.backdrop.lock().unwrap() = None;
    if let Some(w) = window(app) {
        let _ = app.emit_to(LABEL, "spotlight:hide", ());
        let _ = w.hide();
    }
}

pub fn toggle(app: &AppHandle) {
    if app.state::<Spot>().visible.load(Ordering::SeqCst) {
        hide(app);
    } else {
        show(app);
    }
}

#[tauri::command]
pub fn spotlight_hide(app: AppHandle, caller: WebviewWindow) {
    if !from_spotlight(&caller) {
        return;
    }
    hide(&app);
}

#[tauri::command]
pub fn spotlight_set_native(app: AppHandle, caller: WebviewWindow, on: bool) {
    if !from_spotlight(&caller) {
        return;
    }
    app.state::<Spot>().native.store(on, Ordering::SeqCst);
    #[cfg(windows)]
    if !on {
        if let Some(w) = window(&app) {
            if let Ok(h) = w.hwnd() {
                let _ = platform::blur_regions(h.0 as isize, &[]);
            }
        }
    }
}

#[tauri::command]
pub fn spotlight_blur(app: AppHandle, caller: WebviewWindow, rects: Vec<[f64; 5]>) -> bool {
    if !from_spotlight(&caller) {
        return false;
    }
    #[cfg(windows)]
    {
        let Some(w) = window(&app) else { return false };
        let Ok(h) = w.hwnd() else { return false };
        let r: Vec<[i32; 5]> = rects.iter().take(8).map(|a| [a[0].round() as i32, a[1].round() as i32, a[2].round() as i32, a[3].round() as i32, a[4].round() as i32]).collect();
        let ok = platform::blur_regions(h.0 as isize, &r);
        if !r.is_empty() {
            app.state::<Spot>().native.store(ok, Ordering::SeqCst);
        }
        ok
    }
    #[cfg(not(windows))]
    {
        let _ = (app, rects);
        false
    }
}

#[tauri::command]
pub fn spotlight_backdrop(app: AppHandle, caller: WebviewWindow) -> Response {
    if !from_spotlight(&caller) {
        return Response::new(Vec::<u8>::new());
    }
    Response::new(app.state::<Spot>().backdrop.lock().unwrap().clone().unwrap_or_default())
}

fn entry(name: String, path: String, dir: bool, mtime: u64) -> Entry {
    Entry { lower: name.to_lowercase(), name, path, dir, mtime }
}

fn mtime_of(m: &fs::Metadata) -> u64 {
    m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0)
}

fn start_menu_dirs() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Ok(p) = std::env::var("ProgramData") {
        v.push(PathBuf::from(p).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    if let Ok(p) = std::env::var("APPDATA") {
        v.push(PathBuf::from(p).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    v
}

fn scan_apps() -> Vec<Entry> {
    let mut out: Vec<Entry> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut stack = start_menu_dirs();
    while let Some(dir) = stack.pop() {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
                continue;
            }
            let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("").to_ascii_lowercase();
            if !["lnk", "url", "appref-ms"].contains(&ext.as_str()) {
                continue;
            }
            let Some(stem) = p.file_stem().and_then(|s| s.to_str()) else { continue };
            let low = stem.to_lowercase();
            if low.contains("uninstall") || low.starts_with("readme") || low.contains("release notes") {
                continue;
            }
            if seen.insert(low) {
                let mt = e.metadata().map(|m| mtime_of(&m)).unwrap_or(0);
                out.push(entry(stem.to_string(), p.to_string_lossy().into_owned(), false, mt));
            }
        }
    }
    let r = ps_command(
        "Get-StartApps | ForEach-Object { $_.Name + [char]9 + $_.AppID }",
        &[],
        Duration::from_secs(25),
    );
    if r.ok {
        for line in r.stdout.lines() {
            let Some((name, id)) = line.trim().split_once('\t') else { continue };
            if !id.contains('!') || name.is_empty() {
                continue;
            }
            if seen.insert(name.to_lowercase()) {
                out.push(entry(name.to_string(), format!("shell:AppsFolder\\{id}"), false, 0));
            }
        }
    }
    out.sort_by(|a, b| a.lower.cmp(&b.lower));
    out
}

fn skip_dir(name: &str) -> bool {
    name.starts_with('.')
        || name.starts_with('$')
        || matches!(
            name.to_ascii_lowercase().as_str(),
            "node_modules" | "appdata" | "__pycache__" | "venv" | "env" | "target" | "site-packages" | "$recycle.bin"
        )
}

fn scan_files(app: &AppHandle) -> Vec<Entry> {
    let Ok(profile) = std::env::var("USERPROFILE") else { return Vec::new() };
    let home = PathBuf::from(profile);
    let mut roots: Vec<PathBuf> =
        ["Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music"].iter().map(|d| home.join(d)).collect();
    for od in ["OneDrive"] {
        let p = home.join(od);
        if p.is_dir() {
            roots.push(p);
        }
    }
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut out: Vec<Entry> = Vec::new();
    let st = app.state::<Spot>();
    let mut stack: Vec<(PathBuf, usize)> = roots.into_iter().filter(|r| r.is_dir()).map(|r| (r, 0)).collect();
    while let Some((dir, depth)) = stack.pop() {
        if !seen.insert(dir.clone()) {
            continue;
        }
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || name.eq_ignore_ascii_case("desktop.ini") || name.starts_with("~$") {
                continue;
            }
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_symlink() {
                continue;
            }
            let mt = e.metadata().map(|m| mtime_of(&m)).unwrap_or(0);
            let path = e.path();
            if ft.is_dir() {
                if skip_dir(&name) {
                    continue;
                }
                if depth < MAX_DEPTH {
                    stack.push((path.clone(), depth + 1));
                }
                out.push(entry(name, path.to_string_lossy().into_owned(), true, mt));
            } else {
                out.push(entry(name, path.to_string_lossy().into_owned(), false, mt));
            }
            if out.len() % 1500 == 0 {
                st.count.store(out.len() as u64, Ordering::Relaxed);
                let _ = app.emit_to(LABEL, "spotlight:index", IndexStatus { indexing: true, count: out.len() as u64 });
            }
            if out.len() >= MAX_FILES {
                return out;
            }
        }
    }
    out
}

pub fn index_all(app: &AppHandle) {
    let st = app.state::<Spot>();
    if st.indexing.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = app.emit_to(LABEL, "spotlight:index", IndexStatus { indexing: true, count: 0 });
    let files = scan_files(app);
    let n = files.len() as u64;
    *st.files.lock().unwrap() = files;
    let apps = scan_apps();
    let total = n + apps.len() as u64;
    *st.apps.lock().unwrap() = apps;
    *st.indexed_at.lock().unwrap() = Some(Instant::now());
    st.count.store(total, Ordering::Relaxed);
    st.indexing.store(false, Ordering::SeqCst);
    let _ = app.emit_to(LABEL, "spotlight:index", IndexStatus { indexing: false, count: total });
}

#[tauri::command]
pub fn spotlight_index_status(app: AppHandle, caller: WebviewWindow) -> IndexStatus {
    if !from_spotlight(&caller) {
        return IndexStatus { indexing: false, count: 0 };
    }
    let st = app.state::<Spot>();
    IndexStatus { indexing: st.indexing.load(Ordering::SeqCst), count: st.count.load(Ordering::Relaxed) }
}

pub fn start(app: AppHandle) {
    let a = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(2));
        if enabled(&a) {
            index_all(&a);
        }
    });
    std::thread::spawn(move || {
        let mut last = String::new();
        loop {
            std::thread::sleep(Duration::from_millis(700));
            if !enabled(&app) {
                continue;
            }
            let Ok(text) = app.clipboard().read_text() else { continue };
            if text.trim().is_empty() || text.len() > 20_000 || text == last {
                continue;
            }
            last = text.clone();
            let st = app.state::<Spot>();
            let mut c = st.clip.lock().unwrap();
            c.retain(|x| x.text != text);
            c.insert(0, ClipItem { text, at: now_secs() });
            c.truncate(CLIP_MAX);
        }
    });
}

fn initials(lower: &str) -> String {
    lower.split(|c: char| !c.is_alphanumeric()).filter_map(|w| w.chars().next()).collect()
}

fn one(t: &str, name: &str, with_initials: bool) -> Option<i32> {
    if name == t {
        return Some(1000);
    }
    if name.starts_with(t) {
        return Some(800);
    }
    if let Some(p) = name.find(t) {
        let boundary = name[..p].chars().next_back().map(|c| !c.is_alphanumeric()).unwrap_or(true);
        return Some(if boundary { 600 } else { 400 - (p as i32).min(200) });
    }
    if with_initials && t.len() >= 2 && initials(name).starts_with(t) {
        return Some(500);
    }
    if t.len() >= 3 {
        let mut it = name.chars();
        if t.chars().all(|c| it.any(|n| n == c)) {
            return Some(120);
        }
    }
    None
}

fn score(tokens: &[String], e: &Entry, with_initials: bool) -> Option<i32> {
    let mut sum = 0;
    for t in tokens {
        sum += one(t, &e.lower, with_initials)?;
    }
    Some(sum * 4 - (e.lower.len() as i32).min(100))
}

fn top(list: &[Entry], tokens: &[String], limit: usize, apps: bool, kind: &'static str) -> Vec<Hit> {
    let mut v: Vec<(i32, &Entry)> = list
        .iter()
        .filter_map(|e| {
            score(tokens, e, apps).map(|s| {
                let recency = if apps { 0 } else { (e.mtime / 86_400 / 30).min(1000) as i32 / 100 };
                (s + recency, e)
            })
        })
        .collect();
    v.sort_by(|a, b| b.0.cmp(&a.0));
    v.into_iter().take(limit).map(|(_, e)| hit(e, kind)).collect()
}

#[tauri::command]
pub async fn spotlight_search(app: AppHandle, caller: WebviewWindow, query: String, filter: Option<String>) -> Found {
    if !from_spotlight(&caller) || !enabled(&app) || query.len() > 512 {
        return Found { apps: vec![], files: vec![] };
    }
    tauri::async_runtime::spawn_blocking(move || {
        let st = app.state::<Spot>();
        let tokens: Vec<String> = query.to_lowercase().split_whitespace().map(String::from).collect();
        if tokens.is_empty() {
            return Found { apps: vec![], files: vec![] };
        }
        let f = filter.as_deref();
        let apps = if f.is_none() || f == Some("apps") {
            top(&st.apps.lock().unwrap(), &tokens, if f.is_some() { 60 } else { 6 }, true, "app")
        } else {
            vec![]
        };
        let files = if f.is_none() || f == Some("files") {
            top(&st.files.lock().unwrap(), &tokens, if f.is_some() { 60 } else { 8 }, false, "file")
        } else {
            vec![]
        };
        Found { apps, files }
    })
    .await
    .unwrap_or(Found { apps: vec![], files: vec![] })
}

#[tauri::command]
pub async fn spotlight_browse(app: AppHandle, caller: WebviewWindow, mode: String) -> Vec<Hit> {
    if !from_spotlight(&caller) || !enabled(&app) {
        return Vec::new();
    }
    tauri::async_runtime::spawn_blocking(move || {
        let st = app.state::<Spot>();
        if mode == "apps" {
            return st.apps.lock().unwrap().iter().map(|e| hit(e, "app")).collect();
        }
        let mut f: Vec<Entry> = st.files.lock().unwrap().iter().filter(|e| !e.dir).cloned().collect();
        f.sort_by(|a, b| b.mtime.cmp(&a.mtime));
        f.truncate(60);
        f.iter().map(|e| hit(e, "file")).collect()
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub fn spotlight_clip_list(app: AppHandle, caller: WebviewWindow) -> Vec<ClipItem> {
    if !from_spotlight(&caller) {
        return Vec::new();
    }
    app.state::<Spot>().clip.lock().unwrap().clone()
}

pub fn clip_clear(app: &AppHandle) {
    app.state::<Spot>().clip.lock().unwrap().clear();
}

#[tauri::command]
pub fn spotlight_clip_clear(app: AppHandle, caller: WebviewWindow) {
    if !from_spotlight(&caller) {
        return;
    }
    clip_clear(&app);
}

#[tauri::command]
pub fn spotlight_copy(app: AppHandle, caller: WebviewWindow, text: String) {
    if !from_spotlight(&caller) {
        return;
    }
    let _ = app.clipboard().write_text(text);
    hide(&app);
}

#[cfg(windows)]
fn run(cmd: &str, args: &[&str]) {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new(cmd).args(args).creation_flags(0x0800_0000).spawn();
}
#[cfg(not(windows))]
fn run(_cmd: &str, _args: &[&str]) {}

/// Only paths that Spotlight itself indexed may be opened or revealed. The webview never gets to
/// name an arbitrary path or shell URI.
fn indexed(app: &AppHandle, path: &str) -> bool {
    let st = app.state::<Spot>();
    if st.apps.lock().unwrap().iter().any(|e| e.path == path) {
        return true;
    }
    let found = st.files.lock().unwrap().iter().any(|e| e.path == path);
    found
}

#[tauri::command]
pub fn spotlight_open(app: AppHandle, caller: WebviewWindow, path: String, reveal: bool) {
    let st = app.state::<Spot>();
    // Must come from the Spotlight window, while it is actually on screen, for a path it listed.
    if !from_spotlight(&caller) || !enabled(&app) || !st.visible.load(Ordering::SeqCst) || path.len() > 4096 || !indexed(&app, &path) {
        return;
    }
    hide(&app);
    if let Some(id) = path.strip_prefix("shell:AppsFolder\\") {
        if reveal {
            return;
        }
        run("explorer.exe", &[&format!("shell:AppsFolder\\{id}")]);
    } else if reveal {
        if Path::new(&path).exists() {
            run("explorer.exe", &[&format!("/select,{path}")]);
        }
    } else {
        let _ = app.opener().open_path(path, None::<&str>);
    }
}

fn custom_dir(app: &AppHandle) -> PathBuf {
    data_dir(app).join("custom-icons")
}
fn data_url(bytes: &[u8]) -> String {
    format!("data:image/png;base64,{}", B64.encode(bytes))
}

#[tauri::command]
pub async fn spotlight_custom_icons(app: AppHandle, caller: WebviewWindow) -> HashMap<String, String> {
    if !from_spotlight(&caller) {
        return HashMap::new();
    }
    tauri::async_runtime::spawn_blocking(move || {
        let map = app.state::<Shared>().settings.lock().unwrap().spot_custom_icons.clone();
        let dir = custom_dir(&app);
        let mut out = HashMap::new();
        for (k, f) in map {
            if let Ok(b) = fs::read(dir.join(&f)) {
                out.insert(k, data_url(&b));
            }
        }
        out
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn spotlight_pick_icon(app: AppHandle, caller: WebviewWindow, key: String) -> bool {
    if !from_spotlight(&caller) || !enabled(&app) {
        return false;
    }
    if key.is_empty() || key.len() > 2048 {
        return false;
    }
    app.state::<Spot>().picking.store(true, Ordering::SeqCst);
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title("Choose an icon")
        .add_filter("Images and icons", &["png", "jpg", "jpeg", "ico", "webp", "bmp", "gif"])
        .pick_file(move |p| {
            let _ = tx.send(p);
        });
    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten()).await.ok().flatten();
    app.state::<Spot>().picking.store(false, Ordering::SeqCst);
    if let Some(w) = window(&app) {
        let _ = w.set_focus();
    }
    let Some(src) = picked.and_then(|p| p.into_path().ok()) else { return false };

    let app2 = app.clone();
    let ok = tauri::async_runtime::spawn_blocking(move || -> bool {
        let Ok(mut img) = image::open(&src) else { return false };
        if img.width().max(img.height()) > 256 {
            img = img.resize(256, 256, image::imageops::FilterType::Lanczos3);
        }
        let dir = custom_dir(&app2);
        if fs::create_dir_all(&dir).is_err() {
            return false;
        }
        let mut h = Sha1::new();
        h.update(format!("spot|{key}|{:?}", SystemTime::now()));
        let file = format!("{}.png", hex::encode(h.finalize()));
        if img.save_with_format(dir.join(&file), image::ImageFormat::Png).is_err() {
            return false;
        }
        {
            let st = app2.state::<Shared>();
            let mut s = st.settings.lock().unwrap();
            if let Some(old) = s.spot_custom_icons.insert(key, file) {
                let _ = fs::remove_file(dir.join(old));
            }
        }
        save_settings(&app2);
        true
    })
    .await
    .unwrap_or(false);
    if ok {
        let _ = app.emit_to(LABEL, "spotlight:icons-changed", ());
    }
    ok
}

#[tauri::command]
pub fn spotlight_reset_icon(app: AppHandle, caller: WebviewWindow, key: String) -> bool {
    if !from_spotlight(&caller) {
        return false;
    }
    let removed = app.state::<Shared>().settings.lock().unwrap().spot_custom_icons.remove(&key);
    let Some(file) = removed else { return false };
    let _ = fs::remove_file(custom_dir(&app).join(file));
    save_settings(&app);
    let _ = app.emit_to(LABEL, "spotlight:icons-changed", ());
    true
}

pub fn reset_all_icons(app: &AppHandle) {
    let map = std::mem::take(&mut app.state::<Shared>().settings.lock().unwrap().spot_custom_icons);
    let dir = custom_dir(app);
    for (_, f) in map {
        let _ = fs::remove_file(dir.join(f));
    }
    save_settings(app);
    let _ = app.emit_to(LABEL, "spotlight:icons-changed", ());
}

#[tauri::command]
pub async fn spotlight_icons(app: AppHandle, caller: WebviewWindow, paths: Vec<String>) -> HashMap<String, String> {
    if !(from_spotlight(&caller) || caller.label() == crate::overlay::LABEL) {
        return HashMap::new();
    }
    tauri::async_runtime::spawn_blocking(move || {
        let st = app.state::<Spot>();
        let dir = data_dir(&app).join("spot-icons");
        let _ = fs::create_dir_all(&dir);
        let key = |p: &str| {
            let mt = fs::metadata(p).ok().map(|m| mtime_of(&m)).unwrap_or(0);
            let mut h = Sha1::new();
            h.update(format!("{p}|{mt}|{ICON_PX}"));
            hex::encode(h.finalize())
        };
        let mut out: HashMap<String, String> = HashMap::new();
        let mut need: Vec<(String, String)> = Vec::new();
        for p in paths.into_iter().take(80) {
            let k = key(&p);
            if let Some(u) = st.icons.lock().unwrap().get(&k) {
                out.insert(p, u.clone());
                continue;
            }
            if let Ok(b) = fs::read(dir.join(format!("{k}.png"))) {
                let u = format!("data:image/png;base64,{}", B64.encode(b));
                st.icons.lock().unwrap().insert(k, u.clone());
                out.insert(p, u);
                continue;
            }
            need.push((p, k));
        }
        if need.is_empty() || !cfg!(windows) {
            return out;
        }
        let Some(script) = icon_extract_script(&app) else { return out };
        let tmp = std::env::temp_dir();
        let stem = format!("lucent-spot-{}-{}", std::process::id(), now_secs());
        let (inf, outf) = (tmp.join(format!("{stem}.in.json")), tmp.join(format!("{stem}.out.json")));
        let input: Vec<serde_json::Value> = need.iter().map(|(p, _)| serde_json::json!({ "id": p, "path": p })).collect();
        if fs::write(&inf, serde_json::to_string(&input).unwrap_or_default()).is_err() {
            return out;
        }
        powershell(
            &["-File", &script.to_string_lossy(), "-InFile", &inf.to_string_lossy(), "-OutFile", &outf.to_string_lossy(), "-Size", &ICON_PX.to_string()],
            &[],
            Duration::from_secs(60),
        );
        let got: HashMap<String, String> = fs::read_to_string(&outf)
            .ok()
            .map(|s| s.trim_start_matches('\u{feff}').to_string())
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let _ = fs::remove_file(&inf);
        let _ = fs::remove_file(&outf);
        for (p, k) in need {
            if let Some(b64) = got.get(&p) {
                if let Ok(bytes) = B64.decode(b64.trim()) {
                    let _ = fs::write(dir.join(format!("{k}.png")), &bytes);
                    let u = format!("data:image/png;base64,{}", B64.encode(bytes));
                    st.icons.lock().unwrap().insert(k, u.clone());
                    out.insert(p, u);
                }
            }
        }
        out
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub fn spotlight_action(app: AppHandle, caller: WebviewWindow, id: String) {
    if !from_spotlight(&caller) {
        return;
    }
    hide(&app);
    match id.as_str() {
        "lock" => run("rundll32.exe", &["user32.dll,LockWorkStation"]),
        "sleep" => run("rundll32.exe", &["powrprof.dll,SetSuspendState", "0,1,0"]),
        "settings" => run("explorer.exe", &["ms-settings:"]),
        "app-settings" => crate::settings::open(&app),
        "display" => run("explorer.exe", &["ms-settings:display"]),
        "wifi" => run("explorer.exe", &["ms-settings:network-wifi"]),
        "bluetooth" => run("explorer.exe", &["ms-settings:bluetooth"]),
        "sound" => run("explorer.exe", &["ms-settings:sound"]),
        "wallpaper" => run("explorer.exe", &["ms-settings:personalization-background"]),
        "taskmgr" => run("taskmgr.exe", &[]),
        "calc" => run("calc.exe", &[]),
        "snip" => run("explorer.exe", &["ms-screenclip:"]),
        "terminal" => run("cmd.exe", &["/c", "start", "", "wt.exe"]),
        "recycle" => {
            std::thread::spawn(|| {
                let _ = powershell(&["-Command", "Clear-RecycleBin -Force -ErrorAction SilentlyContinue"], &[], Duration::from_secs(60));
            });
        }
        "edit-widgets" => crate::overlay::toggle_edit(&app),
        "new-widget" => {
            crate::userwidgets::userwidgets_new(app.clone());
        }
        "widgets-folder" => crate::userwidgets::userwidgets_open_folder(app.clone()),
        "quit" => app.exit(0),
        _ => {}
    }
}
