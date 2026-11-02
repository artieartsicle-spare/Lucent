use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicIsize, AtomicU32, AtomicU64};
use std::sync::Mutex;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::tray::TrayIcon;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub desktop_icons: bool,
    pub desktop_menu: bool,
    pub show_drives: bool,
    pub icon_size: u32,
    pub gallery_above_dock: bool,
    pub dock_clearance: u32,
    pub spotlight_live_blur: bool,
    pub spotlight_enabled: bool,
    pub appearance: String,
    pub accent: String,
    pub widget_style: String,
    pub ui_font: String,
    pub tint_window: bool,
    pub reduce_transparency: bool,
    pub custom_icons: HashMap<String, String>,
    pub spot_custom_icons: HashMap<String, String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            desktop_icons: false,
            desktop_menu: true,
            show_drives: true,
            icon_size: 64,
            gallery_above_dock: false,
            dock_clearance: 70,
            spotlight_live_blur: false,
            spotlight_enabled: true,
            appearance: "light".into(),
            accent: "#0a84ff".into(),
            widget_style: "regular".into(),
            ui_font: "auto".into(),
            tint_window: true,
            reduce_transparency: false,
            custom_icons: HashMap::new(),
            spot_custom_icons: HashMap::new(),
        }
    }
}

#[derive(Clone, Default)]
pub struct BatDevice {
    pub name: String,
    pub pct: i64,
}

pub struct Shared {
    pub settings: Mutex<Settings>,

    pub editing: AtomicBool,
    pub interactive: AtomicBool,
    pub desktop_hwnd: AtomicIsize,
    pub hwnd: AtomicIsize,
    pub quitting: AtomicBool,
    pub focused: AtomicBool,
    pub win_w: AtomicU32,
    pub win_h: AtomicU32,
    pub win_x: AtomicI32,
    pub win_y: AtomicI32,
    pub win_scale_bits: AtomicU64,

    pub desk: Mutex<Vec<crate::desktop::Item>>,
    pub desk_gen: AtomicU64,
    pub desk_busy: AtomicBool,
    pub desk_again: AtomicBool,
    pub mem_icons: Mutex<HashMap<String, String>>,

    pub wp_sig: Mutex<String>,
    pub wp_busy: AtomicBool,

    pub bat: Mutex<(Option<Instant>, Vec<BatDevice>)>,

    pub tray: Mutex<Option<TrayIcon>>,
}

impl Shared {
    pub fn new() -> Self {
        Self {
            settings: Mutex::new(Settings::default()),
            editing: AtomicBool::new(false),
            interactive: AtomicBool::new(false),
            desktop_hwnd: AtomicIsize::new(0),
            hwnd: AtomicIsize::new(0),
            quitting: AtomicBool::new(false),
            focused: AtomicBool::new(false),
            win_w: AtomicU32::new(0),
            win_h: AtomicU32::new(0),
            win_x: AtomicI32::new(0),
            win_y: AtomicI32::new(0),
            win_scale_bits: AtomicU64::new(1.0f64.to_bits()),
            desk: Mutex::new(Vec::new()),
            desk_gen: AtomicU64::new(0),
            desk_busy: AtomicBool::new(false),
            desk_again: AtomicBool::new(false),
            mem_icons: Mutex::new(HashMap::new()),
            wp_sig: Mutex::new(String::new()),
            wp_busy: AtomicBool::new(false),
            bat: Mutex::new((None, Vec::new())),
            tray: Mutex::new(None),
        }
    }
}

pub fn data_dir(app: &AppHandle) -> PathBuf {
    let d = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("lucent"));
    let _ = std::fs::create_dir_all(&d);
    d
}

pub fn settings_file(app: &AppHandle) -> PathBuf {
    data_dir(app).join("settings.json")
}

pub fn save_settings(app: &AppHandle) {
    let s = app.state::<Shared>().settings.lock().unwrap().clone();
    if let Ok(json) = serde_json::to_string(&s) {
        let _ = std::fs::write(settings_file(app), json);
    }
}

pub fn load_settings(app: &AppHandle) {
    let file = settings_file(app);
    let mut loaded: Option<Settings> = None;

    if let Ok(txt) = std::fs::read_to_string(&file) {
        loaded = serde_json::from_str(&txt).ok();
    }

    if let Some(mut s) = loaded {
        if s.dock_clearance == 110 {
            s.dock_clearance = 70;
        }
        *app.state::<Shared>().settings.lock().unwrap() = s;
    }
    save_settings(app);
}
