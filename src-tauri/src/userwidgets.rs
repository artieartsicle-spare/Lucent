use std::fs;
use std::path::PathBuf;
use std::sync::mpsc::RecvTimeoutError;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_opener::OpenerExt;

use crate::state::data_dir;

const MAX_BYTES: u64 = 512 * 1024;
const TEMPLATE: &str = include_str!("../widgets/_template.widget.html");
const EXAMPLES: [(&str, &str); 2] = [
    ("system-meter.widget.html", include_str!("../widgets/system-meter.widget.html")),
    ("tally.widget.html", include_str!("../widgets/tally.widget.html")),
];
const README: &str = "Drop *.widget.html files here: one file = one widget.\r\n\
They appear in Edit Widgets > My Widgets as soon as you save them, and reload live when you change them.\r\n\
Start from _template.widget.html (documented). Files starting with _ are ignored.\r\n";

#[derive(Serialize, Clone)]
pub struct UserWidget {
    file: String,
    source: String,
}

pub fn dir(app: &AppHandle) -> PathBuf {
    data_dir(app).join("widgets")
}

fn is_widget_file(name: &str) -> bool {
    let l = name.to_lowercase();
    l.ends_with(".widget.html") && !l.starts_with('_') && !l.starts_with('.')
}

fn scan(app: &AppHandle) -> Vec<UserWidget> {
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(dir(app)) else { return out };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !is_widget_file(&name) {
            continue;
        }
        let Ok(md) = e.metadata() else { continue };
        if !md.is_file() || md.len() > MAX_BYTES {
            continue;
        }
        if let Ok(source) = fs::read_to_string(e.path()) {
            out.push(UserWidget { file: name, source });
        }
    }
    out.sort_by(|a, b| a.file.to_lowercase().cmp(&b.file.to_lowercase()));
    out
}

pub fn ensure_folder(app: &AppHandle) {
    let d = dir(app);
    let first = !d.exists();
    let _ = fs::create_dir_all(&d);
    let _ = fs::write(d.join("_template.widget.html"), TEMPLATE);
    if first {
        for (name, body) in EXAMPLES {
            let _ = fs::write(d.join(name), body);
        }
        let _ = fs::write(d.join("README.txt"), README);
    }
}

pub fn send(app: &AppHandle) {
    let _ = app.emit_to("main", "userwidgets:changed", scan(app));
}

pub fn watch(app: AppHandle) {
    std::thread::spawn(move || {
        use notify::Watcher as _;
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        let txc = tx.clone();
        let Ok(mut w) = notify::recommended_watcher(move |_r: notify::Result<notify::Event>| {
            let _ = txc.send(());
        }) else {
            return;
        };
        if w.watch(&dir(&app), notify::RecursiveMode::NonRecursive).is_err() {
            return;
        }
        loop {
            match rx.recv_timeout(Duration::from_secs(3600)) {
                Ok(()) => {
                    while rx.recv_timeout(Duration::from_millis(250)).is_ok() {}
                    send(&app);
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
        drop(w);
        drop(tx);
    });
}

#[tauri::command]
pub fn userwidgets_list(app: AppHandle) -> Vec<UserWidget> {
    scan(&app)
}

#[tauri::command]
pub fn userwidgets_open_folder(app: AppHandle) {
    ensure_folder(&app);
    let _ = app.opener().open_path(dir(&app).to_string_lossy().to_string(), None::<&str>);
}

#[tauri::command]
pub fn userwidgets_new(app: AppHandle) -> Option<String> {
    ensure_folder(&app);
    let d = dir(&app);
    let mut n = 1;
    let mut name = "my-widget.widget.html".to_string();
    while d.join(&name).exists() {
        n += 1;
        name = format!("my-widget-{n}.widget.html");
    }
    fs::write(d.join(&name), TEMPLATE).ok()?;
    let _ = app.opener().reveal_item_in_dir(d.join(&name));
    Some(name)
}
