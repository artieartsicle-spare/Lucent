use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::overlay::toggle_edit;
use crate::state::Shared;

fn make_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let none = None::<&str>;
    let edit = MenuItem::with_id(app, "edit", "Edit Widgets", true, none)?;
    let spot_on = crate::spotlight::enabled(app);
    let spot = MenuItem::with_id(app, "spotlight", "Spotlight Search (Alt+Space)", spot_on, none)?;
    let settings = MenuItem::with_id(app, "settings", "Settings\u{2026}", true, none)?;
    let glass_on = app.state::<Shared>().settings.lock().unwrap().desktop_icons;
    let glass = MenuItem::with_id(
        app,
        "glass-icons",
        if glass_on { "Show Windows Desktop Icons" } else { "Use Glass Desktop Icons" },
        true,
        none,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, none)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    Menu::with_items(app, &[&edit, &spot, &sep1, &glass, &settings, &sep2, &quit])
}

fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "edit" => toggle_edit(app),
        "spotlight" => crate::spotlight::toggle(app),
        "settings" => crate::settings::open(app),
        "glass-icons" => {
            let now = app.state::<Shared>().settings.lock().unwrap().desktop_icons;
            crate::settings::set_desktop_icons(app, !now);
        }
        "quit" => app.exit(0),
        _ => {}
    }
}

pub fn rebuild(app: &AppHandle) {
    if let Ok(menu) = make_menu(app) {
        if let Some(tray) = app.state::<Shared>().tray.lock().unwrap().as_ref() {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let menu = make_menu(app)?;
    let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
    let tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("Lucent")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| on_menu(app, ev.id().as_ref()))
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                toggle_edit(tray.app_handle());
            }
        })
        .build(app)?;
    *app.state::<Shared>().tray.lock().unwrap() = Some(tray);
    Ok(())
}
