use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::overlay::{push_appearance, push_desk_menu, run_in_page};
use crate::state::{data_dir, save_settings, Settings, Shared};

const LABEL: &str = "settings";
const ICON_SIZES: [u32; 4] = [48, 64, 80, 96];
const DOCK_CLEARANCES: [u32; 11] = [40, 50, 60, 70, 80, 90, 100, 120, 140, 160, 200];

// The page is laid out at a fixed design size: the phone screen (430 x 932) plus a transparent margin for its shadow.
// The window is made DESIGN * zoom and the webview gets the same zoom, so the page never rescales itself.
const DESIGN_W: f64 = 478.0;
const DESIGN_H: f64 = 980.0;
const MIN_ZOOM: f64 = 0.4;
const MAX_ZOOM: f64 = 1.0;

fn fit_zoom(app: &AppHandle) -> f64 {
    let Ok(Some(m)) = app.primary_monitor() else { return 0.65 };
    let logical_h = m.size().height as f64 / m.scale_factor().max(0.5);
    (logical_h * 0.7 / DESIGN_H).clamp(0.45, 0.7)
}

fn start_zoom(app: &AppHandle) -> f64 {
    let saved = app.state::<Shared>().settings.lock().unwrap().phone_zoom;
    if saved > 0.0 { saved.clamp(MIN_ZOOM, MAX_ZOOM) } else { fit_zoom(app) }
}

#[cfg(windows)]
fn hwnd_of(w: &WebviewWindow) -> isize {
    w.hwnd().map(|h| h.0 as isize).unwrap_or(0)
}
#[cfg(not(windows))]
fn hwnd_of(_w: &WebviewWindow) -> isize {
    0
}

pub fn open(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let zoom = start_zoom(&app);
        let builder = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("settings.html".into()))
            .title("Lucent Settings")
            .inner_size((DESIGN_W * zoom).round(), (DESIGN_H * zoom).round())
            .center()
            .transparent(true)
            .decorations(false)
            .resizable(false)
            .shadow(false)
            .visible(false);
        #[cfg(windows)]
        let builder = builder.additional_browser_args(crate::overlay::BROWSER_ARGS);
        match builder.build() {
            Ok(w) => {
                let _ = w.set_zoom(zoom);
                // Windows 11 paints its own backdrop behind undecorated windows; that was the grey box around the phone.
                let hwnd = hwnd_of(&w);
                crate::platform::no_backdrop_soon(hwnd);
                // Keep it clear when the wallpaper, theme or accent colour changes later on (see platform::watch_backdrop).
                let _ = app.run_on_main_thread(move || crate::platform::watch_backdrop(hwnd));
            }
            Err(e) => eprintln!("[settings] window failed: {e}"),
        }
    });
}

/// Called when the wallpaper changes: clears the system backdrop Windows puts back behind the Settings window and tells its
/// page to redraw the wallpaper it shows.
pub fn wallpaper_changed(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        crate::platform::reapply_backdrop(hwnd_of(&w));
        let _ = app.emit_to(LABEL, "wallpaper:changed", ());
    }
}

#[tauri::command]
pub fn settings_backdrop() -> tauri::ipc::Response {
    tauri::ipc::Response::new(Vec::<u8>::new())
}

pub fn push_widget_style(app: &AppHandle) {
    let v = app.state::<Shared>().settings.lock().unwrap().widget_style.clone();
    run_in_page(app, &format!("window.__setWidgetStyle && window.__setWidgetStyle('{v}')"));
}

pub const HIGHLIGHTS: [u32; 7] = [0, 25, 50, 75, 100, 125, 150];

pub fn push_highlight(app: &AppHandle) {
    let n = app.state::<Shared>().settings.lock().unwrap().glass_highlight;
    run_in_page(app, &format!("window.__setHighlight && window.__setHighlight({n})"));
}

pub fn push_dock_clear(app: &AppHandle) {
    let n = {
        let s = app.state::<Shared>().settings.lock().unwrap().clone();
        if s.gallery_above_dock { s.dock_clearance } else { 0 }
    };
    run_in_page(app, &format!("window.__setDockClear && window.__setDockClear({n})"));
}

#[tauri::command]
pub fn settings_open(app: AppHandle) {
    open(&app);
}

#[tauri::command]
pub fn settings_ready(app: AppHandle) -> bool {
    if let Some(w) = app.get_webview_window(LABEL) {
        crate::platform::no_backdrop_soon(hwnd_of(&w));
        let _ = w.show();
        let _ = w.set_focus();
    }
    false
}

#[tauri::command]
pub fn settings_window(app: AppHandle, action: String) {
    if let Some(w) = app.get_webview_window(LABEL) {
        match action.as_str() {
            "close" => {
                let _ = w.close();
            }
            "minimize" => {
                let _ = w.minimize();
            }
            "drag" => {
                let _ = w.start_dragging();
            }
            _ => {}
        }
    }
}

static RESIZING: AtomicBool = AtomicBool::new(false);

/// Sizes the window to `zoom` while keeping its top-right corner where it is (the resize grip is bottom-left).
fn apply_zoom(w: &WebviewWindow, zoom: f64, right: i32, top: i32, sf: f64) {
    let pw = (DESIGN_W * zoom * sf).round();
    let ph = (DESIGN_H * zoom * sf).round();
    let _ = w.set_size(PhysicalSize::new(pw as u32, ph as u32));
    let _ = w.set_position(PhysicalPosition::new(right - pw as i32, top));
    let _ = w.set_zoom(zoom);
}

fn remember_zoom(app: &AppHandle, zoom: f64) {
    app.state::<Shared>().settings.lock().unwrap().phone_zoom = zoom;
    save_settings(app);
}

/// Drag the bottom-left corner to resize (phase "start" .. "end"); double-click it to go back to the default size.
#[tauri::command]
pub fn settings_resize(app: AppHandle, caller: WebviewWindow, phase: String) {
    if caller.label() != LABEL {
        return;
    }
    match phase.as_str() {
        "start" => {
            if RESIZING.swap(true, Ordering::SeqCst) {
                return;
            }
            std::thread::spawn(move || {
                let Some(w) = app.get_webview_window(LABEL) else {
                    RESIZING.store(false, Ordering::SeqCst);
                    return;
                };
                let (Ok(pos), Ok(size)) = (w.outer_position(), w.outer_size()) else {
                    RESIZING.store(false, Ordering::SeqCst);
                    return;
                };
                let sf = w.scale_factor().unwrap_or(1.0);
                let right = pos.x + size.width as i32;
                let top = pos.y;
                let mut last = 0.0_f64;
                while RESIZING.load(Ordering::SeqCst) {
                    if let Ok(c) = app.cursor_position() {
                        let zw = (right as f64 - c.x) / sf / DESIGN_W;
                        let zh = (c.y - top as f64) / sf / DESIGN_H;
                        let z = ((zw + zh) / 2.0).clamp(MIN_ZOOM, MAX_ZOOM);
                        if (z - last).abs() > 0.002 {
                            apply_zoom(&w, z, right, top, sf);
                            last = z;
                        }
                    }
                    std::thread::sleep(Duration::from_millis(8));
                }
                if last > 0.0 {
                    remember_zoom(&app, last);
                }
            });
        }
        "end" => RESIZING.store(false, Ordering::SeqCst),
        "reset" => {
            if let (Ok(pos), Ok(size)) = (caller.outer_position(), caller.outer_size()) {
                let sf = caller.scale_factor().unwrap_or(1.0);
                apply_zoom(&caller, fit_zoom(&app), pos.x + size.width as i32, pos.y, sf);
                remember_zoom(&app, 0.0);
            }
        }
        _ => {}
    }
}

fn snapshot(app: &AppHandle) -> Value {
    let s = app.state::<Shared>().settings.lock().unwrap().clone();
    json!({
        "appearance": s.appearance,
        "accent": s.accent,
        "widgetStyle": if s.widget_style == "tinted" { "regular".to_string() } else { s.widget_style.clone() },
        "uiFont": s.ui_font,
        "tintWindow": s.tint_window,
        "reduceTransparency": s.reduce_transparency,
        "desktopIcons": s.desktop_icons,
        "desktopMenu": s.desktop_menu,
        "showDrives": s.show_drives,
        "iconSize": s.icon_size,
        "galleryAboveDock": s.gallery_above_dock,
        "dockClearance": s.dock_clearance,
        "glassHighlight": s.glass_highlight,
        "spotlightLiveBlur": s.spotlight_live_blur,
        "spotlightEnabled": s.spotlight_enabled,
        "launchAtLogin": launch_at_login(),
        "checkUpdates": s.check_updates,
        "version": env!("CARGO_PKG_VERSION"),
        "dataDir": data_dir(app).to_string_lossy(),
    })
}

#[tauri::command]
pub fn settings_get(app: AppHandle) -> Value {
    snapshot(&app)
}

fn valid_hex(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit())
}

pub fn set_desktop_icons(app: &AppHandle, on: bool) {
    app.state::<Shared>().settings.lock().unwrap().desktop_icons = on;
    save_settings(app);
    crate::desktop::refresh(app);
    push_desk_menu(app);
    crate::tray::rebuild(app);
    let _ = app.emit("settings:changed", snapshot(app));
}

#[tauri::command]
pub fn settings_set(app: AppHandle, caller: tauri::WebviewWindow, key: String, value: Value) -> Value {
    if caller.label() != LABEL && caller.label() != crate::overlay::LABEL {
        return Value::Null;
    }
    let st = app.state::<Shared>();
    match key.as_str() {
        "appearance" => {
            if let Some(v) = value.as_str().filter(|v| ["light", "dark", "auto"].contains(v)) {
                st.settings.lock().unwrap().appearance = v.to_string();
                save_settings(&app);
                push_appearance(&app);
            }
        }
        "widgetStyle" => {
            if let Some(v) = value.as_str().filter(|v| ["regular", "light", "frosted", "dark"].contains(v)) {
                st.settings.lock().unwrap().widget_style = v.to_string();
                save_settings(&app);
                push_widget_style(&app);
            }
        }
        "accent" => {
            if let Some(v) = value.as_str().filter(|v| valid_hex(v)) {
                st.settings.lock().unwrap().accent = v.to_string();
                save_settings(&app);
            }
        }
        "uiFont" => {
            if let Some(v) = value.as_str().map(|v| v.trim()).filter(|v| !v.is_empty() && v.len() <= 60 && v.chars().all(|c| c.is_alphanumeric() || " .-_".contains(c))) {
                st.settings.lock().unwrap().ui_font = v.to_string();
                save_settings(&app);
            }
        }
        "tintWindow" => {
            st.settings.lock().unwrap().tint_window = value.as_bool().unwrap_or(true);
            save_settings(&app);
        }
        "reduceTransparency" => {
            st.settings.lock().unwrap().reduce_transparency = value.as_bool().unwrap_or(false);
            save_settings(&app);
        }
        "desktopIcons" => set_desktop_icons(&app, value.as_bool().unwrap_or(false)),
        "showDrives" => {
            st.settings.lock().unwrap().show_drives = value.as_bool().unwrap_or(true);
            save_settings(&app);
            crate::desktop::refresh(&app);
        }
        "desktopMenu" => {
            st.settings.lock().unwrap().desktop_menu = value.as_bool().unwrap_or(true);
            save_settings(&app);
            push_desk_menu(&app);
        }
        "iconSize" => {
            if let Some(px) = value.as_u64().map(|v| v as u32).filter(|v| ICON_SIZES.contains(v)) {
                st.settings.lock().unwrap().icon_size = px;
                save_settings(&app);
                crate::desktop::send(&app);
            }
        }
        "spotlightLiveBlur" => {
            st.settings.lock().unwrap().spotlight_live_blur = value.as_bool().unwrap_or(false);
            save_settings(&app);
        }
        "spotlightEnabled" => crate::spotlight::set_enabled(&app, value.as_bool().unwrap_or(true)),
        "galleryAboveDock" => {
            st.settings.lock().unwrap().gallery_above_dock = value.as_bool().unwrap_or(false);
            save_settings(&app);
            push_dock_clear(&app);
        }
        "dockClearance" => {
            if let Some(px) = value.as_u64().map(|v| v as u32).filter(|v| DOCK_CLEARANCES.contains(v)) {
                st.settings.lock().unwrap().dock_clearance = px;
                save_settings(&app);
                push_dock_clear(&app);
            }
        }
        "glassHighlight" => {
            if let Some(p) = value.as_u64().map(|v| v as u32).filter(|v| HIGHLIGHTS.contains(v)) {
                st.settings.lock().unwrap().glass_highlight = p;
                save_settings(&app);
                push_highlight(&app);
            }
        }
        "launchAtLogin" => set_launch_at_login(value.as_bool().unwrap_or(false)),
        "checkUpdates" => {
            st.settings.lock().unwrap().check_updates = value.as_bool().unwrap_or(true);
            save_settings(&app);
        }
        _ => {}
    }
    let snap = snapshot(&app);
    let _ = app.emit("settings:changed", snap.clone());
    snap
}

#[tauri::command]
pub fn settings_action(app: AppHandle, caller: tauri::WebviewWindow, id: String) {
    if caller.label() != LABEL {
        return;
    }
    match id.as_str() {
        "edit-widgets" => crate::overlay::toggle_edit(&app),
        "restyle-widgets" => {
            let v = app.state::<Shared>().settings.lock().unwrap().widget_style.clone();
            run_in_page(&app, &format!("window.__restyleAll && window.__restyleAll('{v}')"));
        }
        "calibrate" => run_in_page(&app, "window.__calibrate && window.__calibrate()"),
        "refresh-icons" => crate::desktop::hard_refresh(&app),
        "refresh-wallpaper" => crate::wallpaper::refresh(&app, true),
        "widgets-new" => {
            crate::userwidgets::userwidgets_new(app.clone());
        }
        "widgets-folder" => crate::userwidgets::userwidgets_open_folder(app.clone()),
        "spotlight" => crate::spotlight::toggle(&app),
        "reset-spotlight-icons" => crate::spotlight::reset_all_icons(&app),
        "clear-clipboard" => crate::spotlight::clip_clear(&app),
        "open-data" => {
            use tauri_plugin_opener::OpenerExt;
            let _ = app.opener().open_path(data_dir(&app).to_string_lossy().to_string(), None::<&str>);
        }
        "reset" => {
            {
                let shared = app.state::<Shared>();
                let mut cur = shared.settings.lock().unwrap();
                let icons = std::mem::take(&mut cur.custom_icons);
                let spot = std::mem::take(&mut cur.spot_custom_icons);
                let folders = std::mem::take(&mut cur.photo_folders);
                *cur = Settings::default();
                cur.custom_icons = icons;
                cur.spot_custom_icons = spot;
                cur.photo_folders = folders;
            }
            save_settings(&app);
            push_appearance(&app);
            push_widget_style(&app);
            push_desk_menu(&app);
            push_dock_clear(&app);
            push_highlight(&app);
            crate::spotlight::register_hotkeys(&app);
            crate::tray::rebuild(&app);
            crate::desktop::send(&app);
            crate::desktop::refresh(&app);
            let _ = app.emit("settings:changed", snapshot(&app));
        }
        "quit" => app.exit(0),
        _ => {}
    }
    if id.starts_with("cleanup:") {
        let how = &id["cleanup:".len()..];
        if ["name", "kind", "date"].contains(&how) {
            run_in_page(&app, &format!("window.__iconCmd && window.__iconCmd('cleanup','{how}')"));
        }
    }
}

#[cfg(windows)]
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(windows)]
const RUN_NAME: &str = "Lucent";

#[cfg(windows)]
fn launch_at_login() -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(RUN_KEY)
        .map(|k| k.get_value::<String, _>(RUN_NAME).is_ok())
        .unwrap_or(false)
}

#[cfg(windows)]
fn set_launch_at_login(on: bool) {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    use winreg::RegKey;
    let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE) else { return };
    if on {
        if let Ok(exe) = std::env::current_exe() {
            let _ = key.set_value(RUN_NAME, &format!("\"{}\"", exe.display()));
        }
    } else {
        let _ = key.delete_value(RUN_NAME);
    }
}

#[cfg(not(windows))]
fn launch_at_login() -> bool {
    false
}
#[cfg(not(windows))]
fn set_launch_at_login(_on: bool) {}
