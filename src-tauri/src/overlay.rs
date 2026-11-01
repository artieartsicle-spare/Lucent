use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::platform;
use crate::state::{data_dir, Shared};

pub const LABEL: &str = "main";

#[cfg(windows)]
pub(crate) const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion \
--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows \
--autoplay-policy=no-user-gesture-required";

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

#[cfg(windows)]
fn hwnd_of(w: &WebviewWindow) -> isize {
    w.hwnd().map(|h| h.0 as isize).unwrap_or(0)
}
#[cfg(not(windows))]
fn hwnd_of(_w: &WebviewWindow) -> isize {
    0
}

pub fn run_in_page(app: &AppHandle, js: &str) {
    if let Some(w) = window(app) {
        let _ = w.eval(js);
    }
}

pub fn toggle_edit(app: &AppHandle) {
    run_in_page(app, "window.__toggleEdit && window.__toggleEdit()");
}

pub fn push_appearance(app: &AppHandle) {
    let a = app.state::<Shared>().settings.lock().unwrap().appearance.clone();
    let lit = serde_json::to_string(&a).unwrap_or_else(|_| "\"light\"".into());
    run_in_page(app, &format!("window.__setAppearance && window.__setAppearance({lit})"));
}

pub fn push_desk_menu(app: &AppHandle) {
    let on = {
        let st = app.state::<Shared>();
        let s = st.settings.lock().unwrap();
        s.desktop_menu && s.desktop_icons
    };
    run_in_page(app, &format!("window.__setDeskMenu && window.__setDeskMenu({on})"));
}

fn apply_bounds(app: &AppHandle, w: &WebviewWindow, pos: PhysicalPosition<i32>, size: PhysicalSize<u32>, scale: f64) {
    let _ = w.set_position(pos);
    let _ = w.set_size(size);
    let st = app.state::<Shared>();
    st.win_x.store(pos.x, Ordering::Relaxed);
    st.win_y.store(pos.y, Ordering::Relaxed);
    st.win_w.store(size.width, Ordering::Relaxed);
    st.win_h.store(size.height, Ordering::Relaxed);
    st.win_scale_bits.store(scale.to_bits(), Ordering::Relaxed);
}

pub fn create_window(app: &AppHandle) -> tauri::Result<()> {
    let (pos, size, scale) = match app.primary_monitor()? {
        Some(m) => (*m.position(), *m.size(), m.scale_factor()),
        None => (PhysicalPosition::new(0, 0), PhysicalSize::new(1920, 1080), 1.0),
    };

    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("overlay.html".into()))
        .title("Lucent")
        .transparent(true)
        .decorations(false)
        .resizable(false)
        .shadow(false)
        .skip_taskbar(true)
        .always_on_top(false)
        .focused(false)
        .visible(false);
    #[cfg(windows)]
    let builder = builder.additional_browser_args(BROWSER_ARGS);
    let w = builder.build()?;

    apply_bounds(app, &w, pos, size, scale);

    let st = app.state::<Shared>();
    let hwnd = hwnd_of(&w);
    st.hwnd.store(hwnd, Ordering::SeqCst);
    platform::no_backdrop_soon(hwnd);
    keep_clear_soon(app);
    platform::set_toolwindow(hwnd);
    platform::set_noactivate(hwnd, true);
    st.desktop_hwnd.store(platform::find_desktop_hwnd(), Ordering::SeqCst);
    platform::place_above_desktop(hwnd, st.desktop_hwnd.load(Ordering::SeqCst));
    let _ = w.set_ignore_cursor_events(true);
    let _ = w.show();

    let app2 = app.clone();
    w.on_window_event(move |e| {
        if let WindowEvent::Focused(f) = e {
            app2.state::<Shared>().focused.store(*f, Ordering::SeqCst);
            lower_to_desktop(&app2);
            keep_clear_soon(&app2);
        }
    });

    #[cfg(debug_assertions)]
    if std::env::var("OVERLAY_DEBUG").is_ok() {
        w.open_devtools();
    }
    Ok(())
}

pub fn keep_clear_soon(app: &AppHandle) {
    let h = app.state::<Shared>().hwnd.load(Ordering::SeqCst);
    if h == 0 {
        return;
    }
    platform::keep_clear(h);
    std::thread::spawn(move || {
        for ms in [60u64, 200, 500, 1200, 3000] {
            std::thread::sleep(Duration::from_millis(ms));
            platform::keep_clear(h);
        }
    });
}

pub fn lower_to_desktop(app: &AppHandle) {
    let st = app.state::<Shared>();
    let h = st.hwnd.load(Ordering::SeqCst);
    platform::set_toolwindow(h);
    if st.editing.load(Ordering::SeqCst) && st.focused.load(Ordering::SeqCst) {
        return;
    }
    platform::restore_if_minimized(h);
    platform::place_above_desktop(h, st.desktop_hwnd.load(Ordering::SeqCst));
}

fn check_bounds(app: &AppHandle) {
    let Ok(Some(m)) = app.primary_monitor() else { return };
    let st = app.state::<Shared>();
    let (p, s) = (*m.position(), *m.size());
    let same = st.win_x.load(Ordering::Relaxed) == p.x
        && st.win_y.load(Ordering::Relaxed) == p.y
        && st.win_w.load(Ordering::Relaxed) == s.width
        && st.win_h.load(Ordering::Relaxed) == s.height
        && f64::from_bits(st.win_scale_bits.load(Ordering::Relaxed)) == m.scale_factor();
    if !same {
        if let Some(w) = window(app) {
            apply_bounds(app, &w, p, s, m.scale_factor());
            lower_to_desktop(app);
        }
    }
}

pub fn start_threads(app: AppHandle) {
    let a = app.clone();
    std::thread::spawn(move || {
        let mut n: u64 = 0;
        let mut fg: isize = 0;
        loop {
            std::thread::sleep(Duration::from_millis(500));
            n += 1;
            lower_to_desktop(&a);
            let now = platform::foreground_window();
            if now != fg {
                fg = now;
                keep_clear_soon(&a);
            } else if n % 4 == 0 {
                platform::keep_clear(a.state::<Shared>().hwnd.load(Ordering::SeqCst));
            }
            if n % 4 == 0 {
                check_bounds(&a);
            }
            if n % 120 == 0 {
                a.state::<Shared>().desktop_hwnd.store(platform::find_desktop_hwnd(), Ordering::SeqCst);
            }
        }
    });

    let drag_app = app.clone();
    std::thread::spawn(move || {
        let mut was_down = false;
        let mut passing = false;
        loop {
            std::thread::sleep(Duration::from_millis(15));
            let st = drag_app.state::<Shared>();
            let down = platform::lbutton_down();
            if down && !was_down && st.interactive.load(Ordering::Relaxed) {
                let hwnd = st.hwnd.load(Ordering::SeqCst);
                if platform::cursor_over_other_window(hwnd) {
                    passing = true;
                    if let Some(w) = window(&drag_app) {
                        let _ = w.set_ignore_cursor_events(true);
                    }
                }
            }
            if !down && passing {
                passing = false;
                let on = st.interactive.load(Ordering::SeqCst);
                if let Some(w) = window(&drag_app) {
                    let _ = w.set_ignore_cursor_events(!on);
                }
            }
            was_down = down;
        }
    });

    std::thread::spawn(move || {
        let mut last: Option<(i32, i32)> = None;
        loop {
            std::thread::sleep(Duration::from_millis(16));
            let st = app.state::<Shared>();
            if st.interactive.load(Ordering::Relaxed) {
                last = None;
                continue;
            }
            let Some((x, y)) = platform::cursor_pos() else { continue };
            if last == Some((x, y)) {
                continue;
            }
            last = Some((x, y));
            let scale = f64::from_bits(st.win_scale_bits.load(Ordering::Relaxed)).max(0.1);
            let cx = (x - st.win_x.load(Ordering::Relaxed)) as f64 / scale;
            let cy = (y - st.win_y.load(Ordering::Relaxed)) as f64 / scale;
            let _ = app.emit_to(LABEL, "overlay:cursor", serde_json::json!({ "x": cx, "y": cy }));
        }
    });
}

pub fn start_icon_guard(app: AppHandle) {
    let marker = data_dir(&app).join("icons-hidden.flag");
    platform::spawn_icons_watchdog(&marker);
    std::thread::spawn(move || {
        let mut we_hid = marker.exists();
        loop {
            let st = app.state::<Shared>();
            if st.quitting.load(Ordering::SeqCst) {
                break;
            }
            let hide = st.settings.lock().unwrap().desktop_icons;
            platform::apply_icons(hide, &mut we_hid, &marker);
            std::thread::sleep(Duration::from_millis(1000));
        }
    });
}

pub fn restore_windows_icons(app: &AppHandle) {
    app.state::<Shared>().quitting.store(true, Ordering::SeqCst);
    let marker = data_dir(app).join("icons-hidden.flag");
    let mut we_hid = marker.exists();
    platform::apply_icons(false, &mut we_hid, &marker);
}

#[tauri::command]
pub fn overlay_set_interactive(app: AppHandle, on: bool) {
    app.state::<Shared>().interactive.store(on, Ordering::SeqCst);
    if let Some(w) = window(&app) {
        let _ = w.set_ignore_cursor_events(!on);
    }
}

#[tauri::command]
pub fn desktop_native_menu(app: AppHandle, x: f64, y: f64) {
    let Some(w) = window(&app) else { return };
    let sf = w.scale_factor().unwrap_or(1.0);
    let origin = w.outer_position().unwrap_or(PhysicalPosition::new(0, 0));
    let (px, py) = (origin.x + (x * sf).round() as i32, origin.y + (y * sf).round() as i32);
    let _ = w.set_ignore_cursor_events(true);
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(60));
        platform::send_right_click(px, py);
        std::thread::sleep(Duration::from_millis(450));
        let on = app.state::<Shared>().interactive.load(Ordering::SeqCst);
        if let Some(w) = window(&app) {
            let _ = w.set_ignore_cursor_events(!on);
        }
    });
}

#[tauri::command]
pub fn overlay_bottom_inset(app: AppHandle) -> f64 {
    let Some(w) = window(&app) else { return 0.0 };
    let (Ok(pos), Ok(size)) = (w.outer_position(), w.outer_size()) else { return 0.0 };
    let sf = w.scale_factor().unwrap_or(1.0);
    let px = platform::bottom_inset(hwnd_of(&w), pos.x, pos.y, size.width as i32, size.height as i32);
    px as f64 / sf
}

#[tauri::command]
pub fn overlay_set_editing(app: AppHandle, on: bool, light: Option<bool>) {
    let st = app.state::<Shared>();
    let hwnd = st.hwnd.load(Ordering::SeqCst);
    st.editing.store(on, Ordering::SeqCst);
    platform::set_noactivate(hwnd, !on);
    if let Some(w) = window(&app) {
        if on && light.unwrap_or(false) {
            let _ = w.set_always_on_top(true);
            let _ = w.set_focus();
        } else if !on {
            let _ = w.set_always_on_top(false);
        }
    }
    lower_to_desktop(&app);
}

#[tauri::command]
pub fn overlay_set_typing(app: AppHandle, on: bool) {
    let st = app.state::<Shared>();
    if st.editing.load(Ordering::SeqCst) {
        return;
    }
    let hwnd = st.hwnd.load(Ordering::SeqCst);
    if on {
        platform::set_noactivate(hwnd, false);
        platform::foreground(hwnd);
        if let Some(w) = window(&app) {
            let _ = w.set_focus();
        }
    } else {
        platform::set_noactivate(hwnd, true);
    }
}

#[tauri::command]
pub fn overlay_copy(app: AppHandle, text: String) {
    let _ = app.clipboard().write_text(text);
}

#[tauri::command]
pub fn overlay_ready(app: AppHandle) {
    crate::desktop::refresh(&app);
    push_appearance(&app);
    crate::settings::push_widget_style(&app);
    push_desk_menu(&app);
    crate::settings::push_dock_clear(&app);
}

#[tauri::command]
pub fn sys_open_settings(page: String) {
    if ["personalization-background", "display", "network-wifi", "network-status", "bluetooth", "batterysaver", "powersleep"].contains(&page.as_str()) {
        let _ = std::process::Command::new("explorer.exe").arg(format!("ms-settings:{page}")).spawn();
    }
}
