use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::overlay::{push_appearance, push_desk_menu, run_in_page};
use crate::state::{data_dir, save_settings, Settings, Shared};

const LABEL: &str = "settings";
const ICON_SIZES: [u32; 4] = [48, 64, 80, 96];
const DOCK_CLEARANCES: [u32; 11] = [40, 50, 60, 70, 80, 90, 100, 120, 140, 160, 200];

static ACRYLIC: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn open(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let builder = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("settings.html".into()))
            .title("Lucent Settings")
            .inner_size(820.0, 600.0)
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
                #[cfg(windows)]
                {
                    use tauri::window::{Effect, EffectsBuilder};
                    if let Ok(h) = w.hwnd() {
                        crate::platform::round_corners(h.0 as isize);
                    }
                    let ok = w.set_effects(EffectsBuilder::new().effect(Effect::Acrylic).build()).is_ok();
                    ACRYLIC.store(ok, std::sync::atomic::Ordering::SeqCst);
                }
                let _ = w;
            }
            Err(e) => eprintln!("[settings] window failed: {e}"),
        }
    });
}

#[tauri::command]
pub fn settings_backdrop() -> tauri::ipc::Response {
    tauri::ipc::Response::new(Vec::<u8>::new())
}

pub fn push_widget_style(app: &AppHandle) {
    let v = app.state::<Shared>().settings.lock().unwrap().widget_style.clone();
    run_in_page(app, &format!("window.__setWidgetStyle && window.__setWidgetStyle('{v}')"));
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
        let _ = w.show();
        let _ = w.set_focus();
    }
    ACRYLIC.load(std::sync::atomic::Ordering::SeqCst)
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
pub fn settings_set(app: AppHandle, key: String, value: Value) -> Value {
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
pub fn settings_action(app: AppHandle, id: String) {
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
        "clear-clipboard" => crate::spotlight::spotlight_clip_clear(app.clone()),
        "check-update" => crate::updates::manual(app.clone()),
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
                *cur = Settings::default();
                cur.custom_icons = icons;
                cur.spot_custom_icons = spot;
            }
            save_settings(&app);
            push_appearance(&app);
            push_widget_style(&app);
            push_desk_menu(&app);
            push_dock_clear(&app);
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
