use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::Ordering;
use std::sync::mpsc::RecvTimeoutError;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::Serialize;
use sha1::{Digest, Sha1};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::shell::{icon_extract_script, powershell, ps_command, ps_with_list};
use crate::state::{data_dir, save_settings, Shared};

pub const ICON_PX: u32 = 128;
const HIDDEN_EXT: [&str; 3] = [".lnk", ".url", ".appref-ms"];
const APP_EXT: [&str; 7] = [".exe", ".lnk", ".url", ".appref-ms", ".bat", ".cmd", ".msi"];

#[derive(Clone, Copy, Serialize, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Folder,
    App,
    File,
    Virtual,
}

#[derive(Clone)]
pub struct Item {
    pub id: String,
    pub path: String,
    pub name: String,
    pub kind: Kind,
    pub mtime: i64,
    pub open: Option<String>,
    pub icon: Option<String>,
}

#[derive(Serialize, Clone)]
struct PItem {
    id: String,
    name: String,
    kind: Kind,
    mtime: i64,
    icon: Option<String>,
    custom: bool,
}

#[derive(Serialize, Clone)]
pub struct Payload {
    enabled: bool,
    size: u32,
    items: Vec<PItem>,
    #[serde(rename = "binFull")]
    bin_full: bool,
}

fn ext_lower(p: &str) -> String {
    Path::new(p)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
        .unwrap_or_default()
}

fn ms(t: std::io::Result<std::time::SystemTime>) -> Option<i64> {
    t.ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
}

fn desktop_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Ok(d) = app.path().desktop_dir() {
        v.push(d);
    }
    let public = std::env::var("PUBLIC").unwrap_or_else(|_| "C:\\Users\\Public".into());
    v.push(PathBuf::from(public).join("Desktop"));
    v
}

fn user_desktop(app: &AppHandle) -> PathBuf {
    app.path().desktop_dir().unwrap_or_else(|_| PathBuf::from("."))
}

struct Virt {
    id: &'static str,
    guid: &'static str,
    name: String,
    open: &'static str,
    on: bool,
}

fn virtual_defs() -> Vec<Virt> {
    vec![
        Virt { id: "virtual:thispc", guid: "{20d04fe0-3aea-1069-a2d8-08002b30309d}", name: "This PC".into(), open: "shell:MyComputerFolder", on: false },
        Virt { id: "virtual:user", guid: "{59031a47-3f72-44a7-89c5-5595fe6b30ee}", name: std::env::var("USERNAME").unwrap_or_else(|_| "User".into()), open: "shell:UsersFilesFolder", on: false },
        Virt { id: "virtual:network", guid: "{f02c1a0d-be21-4350-88b0-7367fc96ef3c}", name: "Network".into(), open: "shell:NetworkPlacesFolder", on: false },
        Virt { id: "virtual:recycle", guid: "{645ff040-5081-101b-9f08-00aa002f954e}", name: "Recycle Bin".into(), open: "shell:RecycleBinFolder", on: true },
    ]
}

#[cfg(windows)]
fn virtual_items() -> Vec<Item> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::types::FromRegValue;
    use winreg::RegKey;

    let mut vals: HashMap<String, u32> = HashMap::new();
    if let Ok(k) = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\HideDesktopIcons\\NewStartPanel")
    {
        for (name, v) in k.enum_values().flatten() {
            if let Ok(n) = u32::from_reg_value(&v) {
                vals.insert(name.to_lowercase(), n);
            }
        }
    }
    virtual_defs()
        .into_iter()
        .filter(|v| match vals.get(v.guid) {
            Some(x) => *x == 0,
            None => v.on,
        })
        .map(|v| Item {
            id: v.id.into(),
            path: format!("::{}", v.guid.to_uppercase()),
            name: v.name,
            kind: Kind::Virtual,
            mtime: 0,
            open: Some(v.open.into()),
            icon: None,
        })
        .collect()
}
#[cfg(not(windows))]
fn virtual_items() -> Vec<Item> {
    let _ = virtual_defs();
    Vec::new()
}

static BIN_FULL: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(windows)]
fn drive_items() -> Vec<Item> {
    use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW};
    let mask = unsafe { GetLogicalDrives() };
    let mut out = Vec::new();
    for i in 0..26u32 {
        if mask & (1 << i) == 0 {
            continue;
        }
        let letter = (b'A' + i as u8) as char;
        let root: Vec<u16> = format!("{letter}:\\").encode_utf16().chain(std::iter::once(0)).collect();
        let ty = unsafe { GetDriveTypeW(root.as_ptr()) };
        let (generic, ask_label) = match ty {
            2 => ("Removable Disk", true),
            3 => ("Local Disk", true),
            4 => ("Network Drive", false),
            5 => ("CD Drive", false),
            _ => continue,
        };
        let mut label = String::new();
        if ask_label {
            let mut buf = [0u16; 261];
            let ok = unsafe {
                GetVolumeInformationW(root.as_ptr(), buf.as_mut_ptr(), buf.len() as u32, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), 0)
            };
            if ok != 0 {
                let n = buf.iter().position(|&c| c == 0).unwrap_or(0);
                label = String::from_utf16_lossy(&buf[..n]);
            } else if ty == 2 {
                continue;
            }
        }
        let name = format!("{} ({letter}:)", if label.is_empty() { generic } else { label.as_str() });
        out.push(Item {
            id: format!("drive:{letter}"),
            path: format!("{letter}:\\"),
            name,
            kind: Kind::Virtual,
            mtime: 0,
            open: Some(format!("{letter}:\\")),
            icon: None,
        });
    }
    out
}
#[cfg(not(windows))]
fn drive_items() -> Vec<Item> {
    Vec::new()
}

#[cfg(windows)]
fn recycle_full() -> bool {
    use windows_sys::Win32::UI::Shell::{SHQueryRecycleBinW, SHQUERYRBINFO};
    unsafe {
        let mut info: SHQUERYRBINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<SHQUERYRBINFO>() as u32;
        if SHQueryRecycleBinW(std::ptr::null(), &mut info) >= 0 {
            let n = info.i64NumItems;
            n > 0
        } else {
            false
        }
    }
}
#[cfg(not(windows))]
fn recycle_full() -> bool {
    false
}

#[tauri::command]
pub fn desktop_empty_bin(app: AppHandle, caller: tauri::WebviewWindow) {
    if caller.label() != crate::overlay::LABEL {
        return;
    }
    bg(move || {
        #[cfg(windows)]
        unsafe {
            use windows_sys::Win32::UI::Shell::SHEmptyRecycleBinW;
            SHEmptyRecycleBinW(std::ptr::null_mut(), std::ptr::null(), 0);
        }
        BIN_FULL.store(recycle_full(), Ordering::SeqCst);
        send(&app);
    });
}

fn scan_desktop(app: &AppHandle) -> Vec<Item> {
    let mut seen = std::collections::HashSet::new();
    let mut items = Vec::new();
    for dir in desktop_dirs(app) {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            let low = n.to_lowercase();
            if low == "desktop.ini" || low == "thumbs.db" || n.starts_with('.') {
                continue;
            }
            if seen.contains(&low) {
                continue;
            }
            let full = e.path();
            let Ok(md) = fs::metadata(&full) else { continue };
            seen.insert(low);
            let ext = ext_lower(&n);
            let name = if HIDDEN_EXT.contains(&ext.as_str()) { n[..n.len() - ext.len()].to_string() } else { n.clone() };
            let full_s = full.to_string_lossy().to_string();
            items.push(Item {
                id: full_s.clone(),
                path: full_s,
                name,
                kind: if md.is_dir() {
                    Kind::Folder
                } else if APP_EXT.contains(&ext.as_str()) {
                    Kind::App
                } else {
                    Kind::File
                },
                mtime: ms(md.modified()).unwrap_or(0),
                open: None,
                icon: None,
            });
        }
    }
    items
}

fn icon_dir(app: &AppHandle) -> PathBuf {
    data_dir(app).join("icon-cache")
}
fn custom_dir(app: &AppHandle) -> PathBuf {
    data_dir(app).join("custom-icons")
}
fn icon_key(it: &Item) -> String {
    let mut h = Sha1::new();
    h.update(format!("{}|{}|{}|thumb1", it.path, it.mtime, ICON_PX));
    hex::encode(h.finalize())
}
fn data_url(bytes: &[u8]) -> String {
    format!("data:image/png;base64,{}", B64.encode(bytes))
}

fn cached_icon(app: &AppHandle, it: &Item) -> Option<String> {
    let k = icon_key(it);
    let st = app.state::<Shared>();
    if let Some(u) = st.mem_icons.lock().unwrap().get(&k) {
        return Some(u.clone());
    }
    let bytes = fs::read(icon_dir(app).join(format!("{k}.png"))).ok()?;
    let url = data_url(&bytes);
    st.mem_icons.lock().unwrap().insert(k, url.clone());
    Some(url)
}

fn store_icon(app: &AppHandle, it: &Item, b64: &str) -> Option<String> {
    let bytes = B64.decode(b64.trim()).ok()?;
    let k = icon_key(it);
    let url = data_url(&bytes);
    app.state::<Shared>().mem_icons.lock().unwrap().insert(k.clone(), url.clone());
    let dir = icon_dir(app);
    let _ = fs::create_dir_all(&dir);
    let _ = fs::write(dir.join(format!("{k}.png")), bytes);
    Some(url)
}

fn extract_icons(app: &AppHandle, need: &[Item]) -> HashMap<String, String> {
    if !cfg!(windows) || need.is_empty() {
        return HashMap::new();
    }
    let Some(script) = icon_extract_script(app) else { return HashMap::new() };
    let tmp = app.path().temp_dir().unwrap_or_else(|_| std::env::temp_dir());
    let stem = format!("lucent-icons-{}", std::process::id());
    let in_file = tmp.join(format!("{stem}.in.json"));
    let out_file = tmp.join(format!("{stem}.out.json"));
    let input: Vec<serde_json::Value> = need.iter().map(|n| serde_json::json!({ "id": n.id, "path": n.path })).collect();
    if fs::write(&in_file, serde_json::to_string(&input).unwrap_or_default()).is_err() {
        return HashMap::new();
    }
    let r = powershell(
        &[
            "-File",
            &script.to_string_lossy(),
            "-InFile",
            &in_file.to_string_lossy(),
            "-OutFile",
            &out_file.to_string_lossy(),
            "-Size",
            &ICON_PX.to_string(),
        ],
        &[],
        Duration::from_secs(120),
    );
    if !r.ok {
        eprintln!("[icons] extract failed");
    }
    let out = fs::read_to_string(&out_file)
        .ok()
        .map(|s| s.trim_start_matches('\u{feff}').to_string())
        .and_then(|s| serde_json::from_str::<HashMap<String, String>>(&s).ok())
        .unwrap_or_default();
    let _ = fs::remove_file(&in_file);
    let _ = fs::remove_file(&out_file);
    out
}

fn custom_url(app: &AppHandle, path: &str) -> Option<String> {
    let file = app.state::<Shared>().settings.lock().unwrap().custom_icons.get(path).cloned()?;
    fs::read(custom_dir(app).join(file)).ok().map(|b| data_url(&b))
}

fn payload(app: &AppHandle) -> Payload {
    let st = app.state::<Shared>();
    let (enabled, size) = {
        let s = st.settings.lock().unwrap();
        (s.desktop_icons, s.icon_size)
    };
    let items: Vec<Item> = if enabled { st.desk.lock().unwrap().clone() } else { Vec::new() };
    Payload {
        enabled,
        size,
        bin_full: BIN_FULL.load(Ordering::SeqCst),
        items: items
            .into_iter()
            .map(|i| {
                let c = custom_url(app, &i.path);
                PItem { id: i.id, name: i.name, kind: i.kind, mtime: i.mtime, custom: c.is_some(), icon: c.or(i.icon) }
            })
            .collect(),
    }
}

pub fn send(app: &AppHandle) {
    let _ = app.emit_to("main", "desktop:changed", payload(app));
}

fn refresh_once(app: &AppHandle) {
    let st = app.state::<Shared>();
    let enabled = st.settings.lock().unwrap().desktop_icons;
    if !enabled {
        st.desk.lock().unwrap().clear();
        send(app);
        return;
    }
    let mut items = scan_desktop(app);
    items.extend(virtual_items());
    if st.settings.lock().unwrap().show_drives {
        items.extend(drive_items());
    }
    BIN_FULL.store(recycle_full(), Ordering::SeqCst);
    for it in items.iter_mut() {
        it.icon = cached_icon(app, it);
    }
    let gen = st.desk_gen.fetch_add(1, Ordering::SeqCst) + 1;
    *st.desk.lock().unwrap() = items.clone();
    send(app);

    let need: Vec<Item> = items.iter().filter(|i| i.icon.is_none() && !i.id.starts_with("drive:")).cloned().collect();
    if need.is_empty() {
        return;
    }
    let got = extract_icons(app, &need);
    let mut fresh: HashMap<String, String> = HashMap::new();
    for it in &need {
        if let Some(b64) = got.get(&it.id) {
            if let Some(url) = store_icon(app, it, b64) {
                fresh.insert(it.id.clone(), url);
            }
        }
    }
    if !fresh.is_empty() && st.desk_gen.load(Ordering::SeqCst) == gen {
        for it in st.desk.lock().unwrap().iter_mut() {
            if let Some(u) = fresh.get(&it.id) {
                it.icon = Some(u.clone());
            }
        }
        send(app);
    }
}

pub fn refresh(app: &AppHandle) {
    let st = app.state::<Shared>();
    if st.desk_busy.swap(true, Ordering::SeqCst) {
        st.desk_again.store(true, Ordering::SeqCst);
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || loop {
        refresh_once(&app);
        let st = app.state::<Shared>();
        if st.desk_again.swap(false, Ordering::SeqCst) {
            continue;
        }
        st.desk_busy.store(false, Ordering::SeqCst);
        if st.desk_again.load(Ordering::SeqCst) && !st.desk_busy.swap(true, Ordering::SeqCst) {
            continue;
        }
        break;
    });
}

pub fn watch(app: AppHandle) {
    let poll_app = app.clone();
    std::thread::spawn(move || {
        let mut drives = String::new();
        loop {
            std::thread::sleep(Duration::from_secs(3));
            let full = recycle_full();
            let now = drive_items().iter().map(|d| d.name.clone()).collect::<Vec<_>>().join("|");
            if full != BIN_FULL.load(Ordering::SeqCst) {
                BIN_FULL.store(full, Ordering::SeqCst);
                send(&poll_app);
            }
            if now != drives {
                if !drives.is_empty() {
                    refresh(&poll_app);
                }
                drives = now;
            }
        }
    });
    std::thread::spawn(move || {
        use notify::Watcher as _;
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        let mut keep = Vec::new();
        for d in desktop_dirs(&app) {
            let txc = tx.clone();
            if let Ok(mut w) = notify::recommended_watcher(move |_r: notify::Result<notify::Event>| {
                let _ = txc.send(());
            }) {
                if w.watch(&d, notify::RecursiveMode::NonRecursive).is_ok() {
                    keep.push(w);
                }
            }
        }
        loop {
            match rx.recv_timeout(Duration::from_secs(60)) {
                Ok(()) => {
                    while rx.recv_timeout(Duration::from_millis(350)).is_ok() {}
                    refresh(&app);
                }
                Err(RecvTimeoutError::Timeout) => refresh(&app),
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
        drop(keep);
        drop(tx);
    });
}

fn known_item(app: &AppHandle, id: &str) -> Option<Item> {
    app.state::<Shared>().desk.lock().unwrap().iter().find(|i| i.id == id).cloned()
}

fn real_paths(app: &AppHandle, ids: &[String]) -> Vec<String> {
    ids.iter()
        .filter_map(|id| known_item(app, id))
        .filter(|it| it.kind != Kind::Virtual)
        .map(|it| it.path)
        .collect()
}

fn bg<F: FnOnce() + Send + 'static>(f: F) {
    tauri::async_runtime::spawn_blocking(f);
}

fn free_name(dir: &Path, base: &str, ext: &str, suffix: &str) -> PathBuf {
    let mut n = 1;
    let mut name = format!("{base}{suffix}{ext}");
    while dir.join(&name).exists() {
        n += 1;
        name = format!("{base}{suffix} {n}{ext}");
    }
    dir.join(name)
}

fn split_name(p: &Path, is_dir: bool) -> (String, String) {
    let file_name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    if is_dir {
        return (file_name, String::new());
    }
    let stem = p.file_stem().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (stem, ext)
}

fn copy_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if src.is_dir() {
        fs::create_dir_all(dst)?;
        for e in fs::read_dir(src)? {
            let e = e?;
            copy_recursive(&e.path(), &dst.join(e.file_name()))?;
        }
    } else {
        fs::copy(src, dst)?;
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_get(app: AppHandle) -> Payload {
    payload(&app)
}

#[tauri::command]
pub fn desktop_open(app: AppHandle, caller: tauri::WebviewWindow, id: String) {
    if caller.label() != crate::overlay::LABEL {
        return;
    }
    let Some(it) = known_item(&app, &id) else { return };
    if it.kind == Kind::Virtual {
        if let Some(o) = it.open {
            let _ = Command::new("explorer.exe").arg(o).spawn();
        }
    } else if let Err(e) = app.opener().open_path(&it.path, None::<&str>) {
        eprintln!("[icons] open failed: {e}");
    }
}

static DRAG_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn blank_png() -> Vec<u8> {
    let img = image::RgbaImage::from_pixel(32, 32, image::Rgba([0, 0, 0, 0]));
    let mut buf = std::io::Cursor::new(Vec::new());
    let _ = img.write_to(&mut buf, image::ImageFormat::Png);
    buf.into_inner()
}

#[tauri::command]
pub fn desktop_drag_out(app: AppHandle, caller: tauri::WebviewWindow, ids: Vec<String>) -> bool {
    if caller.label() != crate::overlay::LABEL {
        return false;
    }
    if DRAG_ACTIVE.load(Ordering::SeqCst) || !crate::platform::lbutton_down() {
        return false;
    }
    let hwnd = app.state::<Shared>().hwnd.load(Ordering::SeqCst);
    if !crate::platform::cursor_over_other_window(hwnd) {
        return false;
    }
    let mut paths: Vec<PathBuf> = Vec::new();
    let mut icon: Option<PathBuf> = None;
    for id in ids.iter().filter(|i| !i.starts_with("virtual:") && !i.starts_with("drive:")) {
        if let Some(it) = known_item(&app, id) {
            let p = PathBuf::from(&it.path);
            if it.kind != Kind::Virtual && p.exists() {
                if icon.is_none() {
                    let c = icon_dir(&app).join(format!("{}.png", icon_key(&it)));
                    if c.exists() {
                        icon = Some(c);
                    }
                }
                paths.push(p);
            }
        }
    }
    if paths.is_empty() {
        return false;
    }
    let Some(win) = crate::overlay::window(&app) else { return false };
    let png = icon.and_then(|p| fs::read(p).ok()).unwrap_or_else(blank_png);
    DRAG_ACTIVE.store(true, Ordering::SeqCst);
    let app2 = app.clone();
    let queued = app.run_on_main_thread(move || {
        let r = drag::start_drag(&win, drag::DragItem::Files(paths), drag::Image::Raw(png), |_result, _pos| {}, drag::Options { mode: drag::DragMode::Move, ..Default::default() });
        if let Err(e) = r {
            eprintln!("[icons] drag out failed: {:?}", e);
        }
        DRAG_ACTIVE.store(false, Ordering::SeqCst);
        refresh(&app2);
    });
    if queued.is_err() {
        DRAG_ACTIVE.store(false, Ordering::SeqCst);
        return false;
    }
    true
}

#[tauri::command]
pub fn desktop_reveal(app: AppHandle, caller: tauri::WebviewWindow, id: String) {
    if caller.label() != crate::overlay::LABEL {
        return;
    }
    if let Some(it) = known_item(&app, &id) {
        if it.kind != Kind::Virtual {
            let _ = app.opener().reveal_item_in_dir(&it.path);
        }
    }
}

fn recycle(path: String) -> bool {
    std::thread::spawn(move || {
        #[cfg(windows)]
        {
            use windows_sys::Win32::UI::Shell::{SHFileOperationW, SHFILEOPSTRUCTW};
            let mut from: Vec<u16> = path.encode_utf16().collect();
            from.push(0);
            from.push(0);
            unsafe {
                let mut op: SHFILEOPSTRUCTW = std::mem::zeroed();
                op.wFunc = 3 as _;
                op.pFrom = from.as_ptr();
                op.fFlags = (0x0040 | 0x0010) as _;
                let r = SHFileOperationW(&mut op);
                let aborted = op.fAnyOperationsAborted;
                r == 0 && aborted == 0
            }
        }
        #[cfg(not(windows))]
        {
            trash::delete(&path).is_ok()
        }
    })
    .join()
    .unwrap_or(false)
}

#[tauri::command]
pub async fn desktop_trash(app: AppHandle, caller: tauri::WebviewWindow, id: String) -> bool {
    if caller.label() != crate::overlay::LABEL {
        return false;
    }
    let Some(it) = known_item(&app, &id) else { return false };
    if it.kind == Kind::Virtual {
        return false;
    }
    let path = it.path.clone();
    let ok = tauri::async_runtime::spawn_blocking(move || recycle(path)).await.unwrap_or(false);
    if !ok {
        eprintln!("[icons] could not move to the Recycle Bin: {}", it.path);
    }
    BIN_FULL.store(recycle_full(), Ordering::SeqCst);
    refresh(&app);
    ok
}

#[derive(Serialize, Default)]
pub struct RenameResult {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[tauri::command]
pub fn desktop_rename(app: AppHandle, caller: tauri::WebviewWindow, id: String, name: String) -> RenameResult {
    if caller.label() != crate::overlay::LABEL {
        return RenameResult::default();
    }
    let bad = |m: Option<&str>| RenameResult { ok: false, id: None, error: m.map(String::from) };
    let Some(it) = known_item(&app, &id) else { return bad(None) };
    let name = name.trim().to_string();
    let invalid_char = name.chars().any(|c| "<>:\"/\\|?*".contains(c) || (c as u32) < 0x20);
    if it.kind == Kind::Virtual
        || name.is_empty()
        || name.chars().count() > 200
        || invalid_char
        || name.ends_with('.')
        || name.ends_with(' ')
    {
        return bad(None);
    }
    let old = PathBuf::from(&it.path);
    let hidden = HIDDEN_EXT.contains(&ext_lower(&it.path).as_str());
    let target_name = if hidden {
        format!("{}{}", name, old.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default())
    } else {
        name
    };
    let full = old.parent().unwrap_or(Path::new(".")).join(target_name);
    if full.exists() && full.to_string_lossy().to_lowercase() != it.path.to_lowercase() {
        return bad(Some("exists"));
    }
    if let Err(e) = fs::rename(&old, &full) {
        return bad(Some(&e.to_string()));
    }
    let full_s = full.to_string_lossy().to_string();
    {
        let st = app.state::<Shared>();
        let mut s = st.settings.lock().unwrap();
        if let Some(f) = s.custom_icons.remove(&it.path) {
            s.custom_icons.insert(full_s.clone(), f);
        }
    }
    save_settings(&app);
    refresh(&app);
    RenameResult { ok: true, id: Some(full_s), error: None }
}

#[derive(Serialize)]
pub struct Info {
    name: String,
    #[serde(rename = "type")]
    ty: String,
    #[serde(rename = "where")]
    place: String,
    size: Option<u64>,
    /// Free space, for drives.
    free: Option<u64>,
    created: Option<i64>,
    modified: Option<i64>,
    target: Option<String>,
}

#[cfg(windows)]
fn drive_space(root: &str) -> Option<(u64, u64)> {
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let w: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();
    let (mut avail, mut total, mut free) = (0u64, 0u64, 0u64);
    let ok = unsafe { GetDiskFreeSpaceExW(w.as_ptr(), &mut avail, &mut total, &mut free) };
    if ok != 0 && total > 0 { Some((total, avail)) } else { None }
}
#[cfg(not(windows))]
fn drive_space(_root: &str) -> Option<(u64, u64)> {
    None
}

#[cfg(windows)]
fn drive_type_name(root: &str) -> &'static str {
    use windows_sys::Win32::Storage::FileSystem::GetDriveTypeW;
    let w: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();
    match unsafe { GetDriveTypeW(w.as_ptr()) } {
        2 => "Removable disk",
        3 => "Local disk",
        4 => "Network drive",
        5 => "CD or DVD drive",
        _ => "Drive",
    }
}
#[cfg(not(windows))]
fn drive_type_name(_root: &str) -> &'static str {
    "Drive"
}

/// (items, bytes) in the Recycle Bin.
#[cfg(windows)]
fn recycle_stats() -> Option<(u64, u64)> {
    use windows_sys::Win32::UI::Shell::{SHQueryRecycleBinW, SHQUERYRBINFO};
    unsafe {
        let mut info: SHQUERYRBINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<SHQUERYRBINFO>() as u32;
        if SHQueryRecycleBinW(std::ptr::null(), &mut info) >= 0 {
            Some((info.i64NumItems.max(0) as u64, info.i64Size.max(0) as u64))
        } else {
            None
        }
    }
}
#[cfg(not(windows))]
fn recycle_stats() -> Option<(u64, u64)> {
    None
}

fn virtual_info(it: &Item) -> Info {
    let mut info = Info { name: it.name.clone(), ty: "System item".into(), place: "Desktop".into(), size: None, free: None, created: None, modified: None, target: None };
    if it.id.starts_with("drive:") {
        info.ty = drive_type_name(&it.path).into();
        info.place = "This PC".into();
        info.target = Some(it.path.clone());
        if let Some((total, avail)) = drive_space(&it.path) {
            info.size = Some(total);
            info.free = Some(avail);
        }
    } else if it.id == "virtual:recycle" {
        info.ty = "Recycle Bin".into();
        if let Some((n, bytes)) = recycle_stats() {
            info.ty = format!("Recycle Bin ({} {})", n, if n == 1 { "item" } else { "items" });
            info.size = Some(bytes);
        }
    }
    info
}

#[tauri::command]
pub async fn desktop_info(app: AppHandle, caller: tauri::WebviewWindow, id: String) -> Option<Info> {
    if caller.label() != crate::overlay::LABEL {
        return None;
    }
    let it = known_item(&app, &id)?;
    if it.kind == Kind::Virtual {
        return tauri::async_runtime::spawn_blocking(move || virtual_info(&it)).await.ok();
    }
    tauri::async_runtime::spawn_blocking(move || {
        let md = fs::metadata(&it.path).ok();
        let ext = ext_lower(&it.path);
        let mut ty = if it.kind == Kind::Folder {
            "Folder".to_string()
        } else if ext == ".lnk" {
            "Shortcut".into()
        } else if ext == ".exe" {
            "Application".into()
        } else if !ext.is_empty() {
            format!("{} file", ext[1..].to_uppercase())
        } else {
            "File".into()
        };
        let mut size = md.as_ref().filter(|m| m.is_file()).map(|m| m.len());
        if md.as_ref().map(|m| m.is_dir()).unwrap_or(false) {
            size = None;
            if let Ok(rd) = fs::read_dir(&it.path) {
                ty.push_str(&format!(" ({} items)", rd.count()));
            }
        }
        let target = if ext == ".lnk" {
            let r = ps_command(
                "(New-Object -ComObject WScript.Shell).CreateShortcut($env:LG_P).TargetPath",
                &[("LG_P", it.path.clone())],
                Duration::from_secs(10),
            );
            Some(r.stdout.trim().to_string()).filter(|s| r.ok && !s.is_empty())
        } else {
            None
        };
        Some(Info {
            name: it.name.clone(),
            ty,
            place: Path::new(&it.path).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
            size,
            free: None,
            created: md.as_ref().and_then(|m| ms(m.created())),
            modified: md.as_ref().and_then(|m| ms(m.modified())),
            target,
        })
    })
    .await
    .ok()
    .flatten()
}

#[derive(Serialize, Default)]
pub struct PickResult {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    canceled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[tauri::command]
pub async fn desktop_pick_icon(app: AppHandle, id: String) -> PickResult {
    let Some(it) = known_item(&app, &id) else { return PickResult::default() };
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title("Choose an icon")
        .add_filter("Images and icons", &["png", "jpg", "jpeg", "ico", "webp", "bmp", "gif"])
        .pick_file(move |p| {
            let _ = tx.send(p);
        });
    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten()).await.ok().flatten();
    let Some(picked) = picked else {
        return PickResult { ok: false, canceled: Some(true), error: None };
    };
    let Ok(src) = picked.into_path() else { return PickResult { ok: false, canceled: None, error: Some("unreadable".into()) } };

    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || -> PickResult {
        let fail = |e: &str| PickResult { ok: false, canceled: None, error: Some(e.into()) };
        let Ok(mut img) = image::open(&src) else { return fail("unreadable") };
        let (w, h) = (img.width(), img.height());
        if w.max(h) > 256 {
            img = img.resize(256, 256, image::imageops::FilterType::Lanczos3);
        }
        let dir = custom_dir(&app2);
        if fs::create_dir_all(&dir).is_err() {
            return fail("cannot create folder");
        }
        let mut h = Sha1::new();
        h.update(format!("{}{:?}", it.path, std::time::SystemTime::now()));
        let file = format!("{}.png", hex::encode(h.finalize()));
        if let Err(e) = img.save_with_format(dir.join(&file), image::ImageFormat::Png) {
            return fail(&e.to_string());
        }
        {
            let st = app2.state::<Shared>();
            let mut s = st.settings.lock().unwrap();
            if let Some(old) = s.custom_icons.insert(it.path.clone(), file) {
                let _ = fs::remove_file(dir.join(old));
            }
        }
        save_settings(&app2);
        send(&app2);
        PickResult { ok: true, canceled: None, error: None }
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub fn desktop_reset_icon(app: AppHandle, caller: tauri::WebviewWindow, id: String) -> bool {
    if caller.label() != crate::overlay::LABEL {
        return false;
    }
    let Some(it) = known_item(&app, &id) else { return false };
    let removed = app.state::<Shared>().settings.lock().unwrap().custom_icons.remove(&it.path);
    let Some(file) = removed else { return false };
    let _ = fs::remove_file(custom_dir(&app).join(file));
    save_settings(&app);
    send(&app);
    true
}

#[tauri::command]
pub fn desktop_open_with(app: AppHandle, caller: tauri::WebviewWindow, id: String) {
    if caller.label() != crate::overlay::LABEL {
        return;
    }
    if let Some(it) = known_item(&app, &id) {
        if it.kind != Kind::Virtual && cfg!(windows) {
            let _ = Command::new("rundll32.exe").args(["shell32.dll,OpenAs_RunDLL", &it.path]).spawn();
        }
    }
}

#[tauri::command]
pub fn desktop_duplicate(app: AppHandle, caller: tauri::WebviewWindow, ids: Vec<String>) {
    if caller.label() != crate::overlay::LABEL {
        return;
    }
    let paths = real_paths(&app, &ids);
    bg(move || {
        for src in paths {
            let src = PathBuf::from(src);
            let is_dir = src.is_dir();
            let (base, ext) = split_name(&src, is_dir);
            let dir = src.parent().unwrap_or(Path::new(".")).to_path_buf();
            if let Err(e) = copy_recursive(&src, &free_name(&dir, &base, &ext, " copy")) {
                eprintln!("[icons] duplicate failed: {e}");
            }
        }
        refresh(&app);
    });
}

#[tauri::command]
pub fn desktop_alias(app: AppHandle, caller: tauri::WebviewWindow, ids: Vec<String>) {
    if caller.label() != crate::overlay::LABEL {
        return;
    }
    let paths = real_paths(&app, &ids);
    bg(move || {
        for src in paths {
            let p = PathBuf::from(&src);
            let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            let dest = free_name(p.parent().unwrap_or(Path::new(".")), &stem, ".lnk", " alias");
            ps_command(
                "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LG_DEST);$s.TargetPath=$env:LG_SRC;$s.Save()",
                &[("LG_DEST", dest.to_string_lossy().to_string()), ("LG_SRC", src)],
                Duration::from_secs(20),
            );
        }
        refresh(&app);
    });
}

#[tauri::command]
pub fn desktop_compress(app: AppHandle, caller: tauri::WebviewWindow, ids: Vec<String>) {
    if caller.label() != crate::overlay::LABEL {
        return;
    }
    let list = real_paths(&app, &ids);
    if list.is_empty() {
        return;
    }
    bg(move || {
        let dir = user_desktop(&app);
        let base = if list.len() == 1 {
            Path::new(&list[0]).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Archive".into())
        } else {
            "Archive".into()
        };
        let dest = free_name(&dir, &base, ".zip", "");
        ps_with_list(
            "$s = @($env:LG_LIST | ConvertFrom-Json); Compress-Archive -LiteralPath $s -DestinationPath $env:LG_DEST",
            &list,
            &[("LG_DEST", dest.to_string_lossy().to_string())],
        );
        refresh(&app);
    });
}

#[tauri::command]
pub fn desktop_copy(app: AppHandle, caller: tauri::WebviewWindow, ids: Vec<String>) {
    if caller.label() != crate::overlay::LABEL {
        return;
    }
    let list = real_paths(&app, &ids);
    if !list.is_empty() {
        let owner = app.state::<Shared>().hwnd.load(Ordering::SeqCst);
        if !crate::platform::clipboard_set_files(owner, &list, false) {
            bg(move || {
                ps_with_list("$s = @($env:LG_LIST | ConvertFrom-Json); Set-Clipboard -Path $s", &list, &[]);
            });
        }
    }
}

#[tauri::command]
pub fn desktop_paste(app: AppHandle, caller: tauri::WebviewWindow) {
    if caller.label() != crate::overlay::LABEL {
        return;
    }
    let owner = app.state::<Shared>().hwnd.load(Ordering::SeqCst);
    bg(move || {
        let Some((files, cut)) = crate::platform::clipboard_get_files(owner) else { return };
        let dir = user_desktop(&app);
        for src in files.into_iter().take(500) {
            let src = PathBuf::from(src);
            if !src.exists() {
                continue;
            }
            let same_dir = src.parent().map(|p| p.to_string_lossy().to_lowercase()) == Some(dir.to_string_lossy().to_lowercase());
            if cut && same_dir {
                continue;
            }
            let is_dir = src.is_dir();
            let file_name = src.file_name().map(|n| n.to_os_string()).unwrap_or_default();
            let plain = dir.join(&file_name);
            let dest = if plain.exists() {
                let (base, ext) = split_name(&src, is_dir);
                free_name(&dir, &base, &ext, " copy")
            } else {
                plain
            };
            if cut {
                if fs::rename(&src, &dest).is_err() {
                    if copy_recursive(&src, &dest).is_ok() {
                        let _ = if is_dir { fs::remove_dir_all(&src) } else { fs::remove_file(&src) };
                    }
                }
            } else if let Err(e) = copy_recursive(&src, &dest) {
                eprintln!("[icons] paste failed: {e}");
            }
        }
        refresh(&app);
    });
}

#[tauri::command]
pub fn desktop_copy_path(app: AppHandle, caller: tauri::WebviewWindow, id: String) {
    if caller.label() != crate::overlay::LABEL {
        return;
    }
    if let Some(it) = known_item(&app, &id) {
        if it.kind != Kind::Virtual {
            let _ = app.clipboard().write_text(it.path);
        }
    }
}

#[tauri::command]
pub fn desktop_drop(app: AppHandle, caller: tauri::WebviewWindow, paths: Vec<String>) {
    if caller.label() != crate::overlay::LABEL {
        return;
    }
    bg(move || {
        let dir = user_desktop(&app);
        for src in paths.into_iter().take(200) {
            let src = PathBuf::from(src);
            if !src.is_absolute() || !src.exists() {
                continue;
            }
            let parent = src.parent().map(|p| p.to_string_lossy().to_lowercase()).unwrap_or_default();
            if parent == dir.to_string_lossy().to_lowercase() {
                continue;
            }
            let is_dir = src.is_dir();
            let file_name = src.file_name().map(|n| n.to_os_string()).unwrap_or_default();
            let plain = dir.join(&file_name);
            let dest = if plain.exists() {
                let (base, ext) = split_name(&src, is_dir);
                free_name(&dir, &base, &ext, " copy")
            } else {
                plain
            };
            if let Err(e) = copy_recursive(&src, &dest) {
                eprintln!("[icons] drop failed: {e}");
            }
        }
        refresh(&app);
    });
}

#[derive(Serialize)]
pub struct NewFolder {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[tauri::command]
pub fn desktop_new_folder(app: AppHandle) -> NewFolder {
    let full = free_name(&user_desktop(&app), "untitled folder", "", "");
    match fs::create_dir(&full) {
        Ok(()) => {
            refresh(&app);
            NewFolder { ok: true, id: Some(full.to_string_lossy().to_string()), error: None }
        }
        Err(e) => NewFolder { ok: false, id: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn desktop_set_size(app: AppHandle, px: u32) {
    if ![48, 64, 80, 96].contains(&px) {
        return;
    }
    app.state::<Shared>().settings.lock().unwrap().icon_size = px;
    save_settings(&app);
    send(&app);
    crate::tray::rebuild(&app);
}

#[tauri::command]
pub fn desktop_refresh(app: AppHandle) {
    app.state::<Shared>().mem_icons.lock().unwrap().clear();
    refresh(&app);
}

pub fn hard_refresh(app: &AppHandle) {
    app.state::<Shared>().mem_icons.lock().unwrap().clear();
    let _ = fs::remove_dir_all(icon_dir(app));
    refresh(app);
}
