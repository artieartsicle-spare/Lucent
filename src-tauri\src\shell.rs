use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use tauri::AppHandle;

use crate::state::data_dir;

const ICON_EXTRACT_PS1: &str = include_str!("../scripts/icon-extract.ps1");

#[cfg(windows)]
fn hide_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000);
}
#[cfg(not(windows))]
fn hide_window(_cmd: &mut Command) {}

pub struct PsOut {
    pub ok: bool,
    pub stdout: String,
}

pub fn powershell(args: &[&str], envs: &[(&str, String)], timeout: Duration) -> PsOut {
    if !cfg!(windows) {
        return PsOut { ok: false, stdout: String::new() };
    }
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-ExecutionPolicy", "Bypass"]);
    cmd.args(args);
    for (k, v) in envs {
        cmd.env(k, v);
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    hide_window(&mut cmd);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[shell] powershell failed to start: {e}");
            return PsOut { ok: false, stdout: String::new() };
        }
    };
    let mut pipe = child.stdout.take();
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(p) = pipe.as_mut() {
            let _ = p.read_to_end(&mut buf);
        }
        String::from_utf8_lossy(&buf).into_owned()
    });

    let start = Instant::now();
    let ok = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    eprintln!("[shell] powershell timed out");
                    break false;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(_) => break false,
        }
    };
    let stdout = reader.join().unwrap_or_default();
    PsOut { ok, stdout }
}

pub fn ps_command(script: &str, envs: &[(&str, String)], timeout: Duration) -> PsOut {
    let full = format!("[Console]::OutputEncoding=[Text.Encoding]::UTF8;{script}");
    powershell(&["-Command", &full], envs, timeout)
}

pub fn icon_extract_script(app: &AppHandle) -> Option<PathBuf> {
    let dir = data_dir(app).join("scripts");
    std::fs::create_dir_all(&dir).ok()?;
    let p = dir.join("icon-extract.ps1");
    let same = std::fs::read_to_string(&p).map(|s| s == ICON_EXTRACT_PS1).unwrap_or(false);
    if !same {
        std::fs::write(&p, ICON_EXTRACT_PS1).ok()?;
    }
    Some(p)
}

pub fn ps_with_list(script: &str, list: &[String], extra: &[(&str, String)]) -> bool {
    let mut envs: Vec<(&str, String)> = vec![("LG_LIST", serde_json::to_string(list).unwrap_or_else(|_| "[]".into()))];
    envs.extend(extra.iter().map(|(k, v)| (*k, v.clone())));
    let r = ps_command(script, &envs, Duration::from_secs(120));
    if !r.ok {
        eprintln!("[shell] powershell snippet failed");
    }
    r.ok
}
