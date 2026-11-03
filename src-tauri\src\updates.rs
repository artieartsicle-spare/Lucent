//! Looks for a newer Lucent release on GitHub.
//!
//! It only reads the public releases list and never downloads or installs
//! anything: when a newer version exists, the tray item and the Settings
//! button point you at the release page.

use std::io::Read;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

use crate::state::Shared;

const API: &str = "https://api.github.com/repos/artieartsicle-spare/Lucent/releases?per_page=10";
const PAGE: &str = "https://github.com/artieartsicle-spare/Lucent/releases/latest";
const PREFIX: &str = "https://github.com/artieartsicle-spare/Lucent/";
const UA: &str = "Lucent-update-check";
const MAX_BYTES: u64 = 1_000_000;

#[derive(Clone, Debug, PartialEq)]
pub struct Found {
    pub version: String,
    pub url: String,
}

static FOUND: Mutex<Option<Found>> = Mutex::new(None);

/// The newer release found by the last check, if any.
pub fn available() -> Option<Found> {
    FOUND.lock().unwrap().clone()
}

// ---- pure logic (unit tested) ------------------------------------------------

fn parse_version(v: &str) -> Option<[u32; 3]> {
    let core = v.trim().trim_start_matches(['v', 'V']).split(['-', '+']).next()?;
    let mut out = [0u32; 3];
    let mut n = 0;
    for part in core.split('.') {
        if n == 3 {
            break;
        }
        out[n] = part.parse().ok()?;
        n += 1;
    }
    if n == 0 {
        None
    } else {
        Some(out)
    }
}

/// Picks the highest-versioned published release out of GitHub's list and
/// returns it only when it is newer than `current`.
fn newer_release(body: &str, current: &str) -> Result<Option<Found>, String> {
    let cur = parse_version(current).ok_or("could not read the current version")?;
    let list: serde_json::Value = serde_json::from_str(body).map_err(|e| e.to_string())?;
    let list = list.as_array().ok_or("unexpected reply from GitHub")?;

    let mut best: Option<([u32; 3], Found)> = None;
    for r in list {
        if r["draft"].as_bool().unwrap_or(false) {
            continue;
        }
        let Some(tag) = r["tag_name"].as_str() else { continue };
        let Some(v) = parse_version(tag) else { continue };
        if best.as_ref().map_or(true, |(b, _)| v > *b) {
            let url = r["html_url"].as_str().filter(|u| u.starts_with(PREFIX)).unwrap_or(PAGE);
            best = Some((
                v,
                Found {
                    version: tag.trim_start_matches(['v', 'V']).to_string(),
                    url: url.to_string(),
                },
            ));
        }
    }
    Ok(best.filter(|(v, _)| *v > cur).map(|(_, f)| f))
}

// ---- network + UI ------------------------------------------------------------

fn check() -> Result<Option<Found>, String> {
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(10)).build();
    let resp = agent
        .get(API)
        .set("User-Agent", UA)
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| e.to_string())?;
    let mut body = String::new();
    resp.into_reader().take(MAX_BYTES).read_to_string(&mut body).map_err(|e| e.to_string())?;
    let found = newer_release(&body, env!("CARGO_PKG_VERSION"))?;
    *FOUND.lock().unwrap() = found.clone();
    Ok(found)
}

fn open_page(app: &AppHandle, url: &str) {
    let _ = app.opener().open_url(url, None::<&str>);
}

/// Quiet check when Lucent starts. Does nothing if the user turned it off, and
/// only updates the tray item.
pub fn auto(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(10));
        if !app.state::<Shared>().settings.lock().unwrap().check_updates {
            return;
        }
        if let Ok(Some(_)) = check() {
            crate::tray::rebuild(&app);
        }
    });
}

/// "Check for Updates" from the tray or Settings: always tells you the result.
pub fn manual(app: AppHandle) {
    std::thread::spawn(move || {
        let current = env!("CARGO_PKG_VERSION");
        let result = check();
        crate::tray::rebuild(&app);
        match result {
            Ok(Some(f)) => {
                let app2 = app.clone();
                let url = f.url.clone();
                app.dialog()
                    .message(format!("Lucent {} is available. You have {current}.", f.version))
                    .title("Lucent")
                    .kind(MessageDialogKind::Info)
                    .buttons(MessageDialogButtons::OkCancelCustom("Open download page".into(), "Later".into()))
                    .show(move |open| {
                        if open {
                            open_page(&app2, &url);
                        }
                    });
            }
            Ok(None) => {
                app.dialog()
                    .message(format!("You're up to date. Lucent {current} is the latest version."))
                    .title("Lucent")
                    .kind(MessageDialogKind::Info)
                    .show(|_| {});
            }
            Err(e) => {
                app.dialog()
                    .message(format!("Couldn't check for updates.\n\n{e}"))
                    .title("Lucent")
                    .kind(MessageDialogKind::Warning)
                    .show(|_| {});
            }
        }
    });
}


/// Settings' "Check Now": runs the check and hands the result to the page, which shows it as an iOS-style alert inside the phone.
#[tauri::command]
pub async fn update_check(app: AppHandle, caller: tauri::WebviewWindow) -> serde_json::Value {
    use serde_json::json;
    if caller.label() != "settings" {
        return serde_json::Value::Null;
    }
    let current = env!("CARGO_PKG_VERSION");
    let result = tauri::async_runtime::spawn_blocking(check).await;
    crate::tray::rebuild(&app);
    match result {
        Ok(Ok(Some(f))) => json!({ "status": "available", "current": current, "version": f.version }),
        Ok(Ok(None)) => json!({ "status": "latest", "current": current }),
        Ok(Err(e)) => json!({ "status": "error", "message": e }),
        Err(e) => json!({ "status": "error", "message": e.to_string() }),
    }
}

/// Opens the release page of the update found by the last check. The page never supplies a URL.
#[tauri::command]
pub fn update_open(app: AppHandle, caller: tauri::WebviewWindow) {
    if caller.label() != "settings" {
        return;
    }
    if let Some(f) = available() {
        open_page(&app, &f.url);
    }
}

/// Tray click: open the page when an update is already known, otherwise check.
pub fn tray_click(app: &AppHandle) {
    match available() {
        Some(f) => open_page(app, &f.url),
        None => manual(app.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BODY: &str = r#"[
      {"tag_name":"v0.1.1","draft":false,"html_url":"https://github.com/artieartsicle-spare/Lucent/releases/tag/v0.1.1"},
      {"tag_name":"v0.2.0","draft":true,"html_url":"https://github.com/artieartsicle-spare/Lucent/releases/tag/v0.2.0"},
      {"tag_name":"v0.1.0","draft":false,"prerelease":true,"html_url":"https://github.com/artieartsicle-spare/Lucent/releases/tag/v0.1.0"}
    ]"#;

    #[test]
    fn parses_versions() {
        assert_eq!(parse_version("v0.1.1"), Some([0, 1, 1]));
        assert_eq!(parse_version("1.2"), Some([1, 2, 0]));
        assert_eq!(parse_version("0.3.0-beta.1"), Some([0, 3, 0]));
        assert_eq!(parse_version("nightly"), None);
    }

    #[test]
    fn compares_numerically_not_as_text() {
        assert!(parse_version("0.10.0") > parse_version("0.9.0"));
    }

    #[test]
    fn newer_is_found() {
        let f = newer_release(BODY, "0.1.0").unwrap().unwrap();
        assert_eq!(f.version, "0.1.1");
        assert!(f.url.ends_with("v0.1.1"));
    }

    #[test]
    fn same_or_older_is_none() {
        assert_eq!(newer_release(BODY, "0.1.1").unwrap(), None);
        assert_eq!(newer_release(BODY, "0.5.0").unwrap(), None);
    }

    #[test]
    fn drafts_are_ignored() {
        // v0.2.0 is a draft, so it must not count.
        assert_eq!(newer_release(BODY, "0.1.1").unwrap(), None);
    }

    #[test]
    fn foreign_urls_fall_back_to_the_release_page() {
        let body = r#"[{"tag_name":"v9.0.0","draft":false,"html_url":"https://evil.example/x"}]"#;
        assert_eq!(newer_release(body, "0.1.0").unwrap().unwrap().url, PAGE);
    }

    #[test]
    fn bad_replies_are_errors() {
        assert!(newer_release("{\"message\":\"rate limited\"}", "0.1.0").is_err());
        assert!(newer_release("not json", "0.1.0").is_err());
    }

    #[test]
    fn empty_list_is_none() {
        assert_eq!(newer_release("[]", "0.1.0").unwrap(), None);
    }
}
