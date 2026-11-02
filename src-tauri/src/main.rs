#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod battery;
mod desktop;
mod media;
mod netinfo;
mod overlay;
mod platform;
mod settings;
mod shell;
mod spotlight;
mod state;
mod stats;
mod tray;
mod userwidgets;
mod web;
mod wallpaper;
mod widgetfs;

use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--icons-watchdog") {
        platform::run_icons_watchdog(&args[2..]);
        return;
    }
    run();
}

fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| overlay::toggle_edit(app)))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(state::Shared::new())
        .manage(spotlight::Spot::default())
        .invoke_handler(tauri::generate_handler![
            overlay::overlay_set_interactive,
            overlay::overlay_set_editing,
            overlay::overlay_bottom_inset,
            overlay::overlay_set_typing,
            overlay::overlay_copy,
            overlay::overlay_ready,
            overlay::sys_open_settings,
            settings::settings_open,
            settings::settings_ready,
            settings::settings_backdrop,
            settings::settings_window,
            settings::settings_get,
            settings::settings_set,
            settings::settings_action,
            wallpaper::wallpaper_meta,
            wallpaper::wallpaper_bytes,
            battery::bat_get,
            netinfo::net_status,
            netinfo::net_ping,
            netinfo::radios_get,
            netinfo::radio_set,
            netinfo::bt_devices,
            netinfo::power_status,
            media::media_get,
            media::media_control,
            web::http_get,
            web::open_url,
            web::rss_get,
            web::page_image,
            widgetfs::files_list,
            widgetfs::photos_list,
            widgetfs::pick_folder,
            widgetfs::photo_thumb,
            widgetfs::path_open,
            spotlight::spotlight_hide,
            spotlight::spotlight_blur,
            spotlight::spotlight_set_native,
            spotlight::spotlight_backdrop,
            spotlight::spotlight_index_status,
            spotlight::spotlight_search,
            spotlight::spotlight_browse,
            spotlight::spotlight_clip_list,
            spotlight::spotlight_clip_clear,
            spotlight::spotlight_custom_icons,
            spotlight::spotlight_pick_icon,
            spotlight::spotlight_reset_icon,
            spotlight::spotlight_copy,
            spotlight::spotlight_open,
            spotlight::spotlight_icons,
            spotlight::spotlight_action,
            userwidgets::userwidgets_list,
            userwidgets::userwidgets_open_folder,
            userwidgets::userwidgets_new,
            desktop::desktop_get,
            desktop::desktop_open,
            desktop::desktop_reveal,
            desktop::desktop_trash,
            desktop::desktop_rename,
            desktop::desktop_info,
            desktop::desktop_pick_icon,
            desktop::desktop_reset_icon,
            desktop::desktop_open_with,
            desktop::desktop_duplicate,
            desktop::desktop_alias,
            desktop::desktop_compress,
            desktop::desktop_copy,
            desktop::desktop_copy_path,
            desktop::desktop_drop,
            desktop::desktop_drag_out,
            desktop::desktop_paste,
            desktop::desktop_new_folder,
            desktop::desktop_set_size,
            desktop::desktop_refresh,
            overlay::desktop_native_menu,
            desktop::desktop_empty_bin,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            state::load_settings(&handle);

            overlay::create_window(&handle)?;
            overlay::start_threads(handle.clone());
            overlay::start_icon_guard(handle.clone());
            stats::start(handle.clone());
            wallpaper::start_watch(handle.clone());
            desktop::watch(handle.clone());
            userwidgets::ensure_folder(&handle);
            userwidgets::watch(handle.clone());

            spotlight::create_window(&handle)?;
            spotlight::start(handle.clone());

            tray::build(&handle)?;

            let gs = handle.global_shortcut();
            let report = |keys: &str, ok: bool| {
                println!("[hotkey] {keys}: {}", if ok { "ok" } else { "FAILED (already used by another app)" });
            };
            let r = gs.on_shortcut("Control+Shift+Q", |app, _s, ev| {
                if ev.state() == ShortcutState::Pressed {
                    app.exit(0);
                }
            });
            report("Control+Shift+Q", r.is_ok());
            for keys in ["Control+Shift+H", "Control+Alt+W"] {
                let r = gs.on_shortcut(keys, |app, _s, ev| {
                    if ev.state() == ShortcutState::Pressed {
                        overlay::toggle_edit(app);
                    }
                });
                report(keys, r.is_ok());
            }
            if spotlight::enabled(&handle) {
                spotlight::register_hotkeys(&handle);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Lucent app");

    app.run(|app, event| {
        if let tauri::RunEvent::Exit = event {
            overlay::restore_windows_icons(app);
            let _ = app.global_shortcut().unregister_all();
        }
    });
}
